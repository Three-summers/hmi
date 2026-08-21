/**
 * run_interop.mjs — HMI 侧真实 Rust 协议代码（ref-hmip，include src-tauri/src/comm/proto.rs）
 * 与 C SDK（interop_cli）的双向互操作联调驱动。
 *
 * 阶段：
 *   A. C SDK 编码 -> Rust 解码：300 帧随机模糊（含 CRC/空 payload/粘包/噪声重同步）
 *   B. Rust 编码 -> C SDK 解码：300 帧随机模糊（同上）
 *   C. C SDK 标准消息（HELLO/HEARTBEAT/REQUEST/RESPONSE/EVENT/ERROR）-> Rust 消息解码
 *   D. Rust 标准消息（测试专用编码器）-> C SDK 类型化回调
 *   E. 双向噪声重同步交叉验证
 *   F. 会话模拟：HMI(驱动) -> C SDK 设备业务(dev) -> Rust 解码，验证应答回显语义
 */
import { spawn } from 'node:child_process';
import readline from 'node:readline';
import { randomBytes, randomInt } from 'node:crypto';
import { crc32 } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const here = path.dirname(fileURLToPath(import.meta.url));
const C_CLI = process.env.INTEROP_CLI || path.join(here, '..', 'build', 'interop_cli');
const RUST = process.env.REF_HMIP || path.join(here, 'ref-hmip/target/debug/ref-hmip');

let checks = 0;
let failures = 0;
function check(cond, msg) {
  checks++;
  if (!cond) {
    failures++;
    console.log('  FAIL:', msg);
  }
}

class LineReader {
  constructor(stream) {
    this.rl = readline.createInterface({ input: stream });
    this.rl.setMaxListeners(0);
    this.queue = [];
    this.waiters = [];
    this.rl.on('line', (l) => {
      if (this.waiters.length) this.waiters.shift()(l);
      else this.queue.push(l);
    });
  }
  next(timeout = 8000) {
    if (this.queue.length) return Promise.resolve(this.queue.shift());
    return new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error('line timeout')), timeout);
      this.waiters.push((l) => { clearTimeout(t); res(l); });
      this.rl.on('close', () => {
        clearTimeout(t);
        rej(new Error('line stream closed'));
      });
    });
  }
  close() { this.rl.close(); }
}

class ByteStream {
  constructor(stream) {
    this.stream = stream;
    this.stream.setMaxListeners(0);
    this.buf = Buffer.alloc(0);
    this.waiters = [];
    stream.on('data', (d) => {
      this.buf = Buffer.concat([this.buf, d]);
      this.pump();
    });
  }
  pump() {
    while (this.waiters.length && this.buf.length >= this.waiters[0].n) {
      const w = this.waiters.shift();
      w.res(this.buf.subarray(0, w.n));
      this.buf = this.buf.subarray(w.n);
    }
  }
  read(n, timeout = 8000) {
    if (this.buf.length >= n) {
      const b = this.buf.subarray(0, n);
      this.buf = this.buf.subarray(n);
      return Promise.resolve(b);
    }
    return new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error(`byte read timeout (${n} bytes)`)), timeout);
      this.waiters.push({ n, res: (b) => { clearTimeout(t); res(b); } });
      this.stream.on('close', () => {
        clearTimeout(t);
        rej(new Error(`byte stream closed while waiting ${n} bytes`));
      });
    });
  }
}

function writeAll(w, data) {
  return new Promise((res, rej) => {
    w.write(data, (err) => (err ? rej(err) : res()));
  });
}

function start(cmd, args) {
  const p = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] });
  let errlog = '';
  p.stderr.on('data', (d) => { errlog += d.toString(); });
  p.on('exit', (code) => {
    if (code !== 0) console.log(`  [${cmd} ${args.join(' ')} exited ${code}]`, errlog.slice(0, 400));
  });
  return p;
}

const hex = (b) => Buffer.from(b).toString('hex');
const JUNK_ALPHABET = 'abcxyz0123456789'; /* 不含大写 'H'，保证重同步路径确定 */

async function main() {
  for (const f of [C_CLI, RUST]) {
    if (!fs.existsSync(f)) {
      console.error(`missing binary: ${f}`);
      process.exit(2);
    }
  }

  const cEnc = start(C_CLI, ['encode']);
  const cDec = start(C_CLI, ['decode']);
  const cDev = start(C_CLI, ['dev']);
  const rEnc = start(RUST, ['encode']);
  const rDec = start(RUST, ['decode']);
  const rStd = start(RUST, ['stdmsg']);

  const cEncOut = new ByteStream(cEnc.stdout);
  const cDecLines = new LineReader(cDec.stdout);
  const cDevOut = new ByteStream(cDev.stdout);
  const rEncOut = new ByteStream(rEnc.stdout);
  const rDecLines = new LineReader(rDec.stdout);
  const rStdOut = new ByteStream(rStd.stdout);

  const sendLine = (p, s) => writeAll(p.stdin, s + '\n');

  const randFrame = () => {
    const mt = randomInt(0, 256);
    const flags = randomInt(0, 2);
    const ch = randomInt(0, 256);
    const seq = randomInt(0, 2 ** 32);
    const plen = randomInt(0, 201);
    const payload = randomBytes(plen);
    return { mt, flags, ch, seq, payload };
  };

  /* ---------- A. C 编码 -> Rust 解码 ---------- */
  console.log('A. C SDK 编码 -> Rust 解码（300 帧模糊）');
  for (let i = 0; i < 300; i++) {
    const f = randFrame();
    await sendLine(cEnc, `R ${f.mt} ${f.flags} ${f.ch} ${f.seq} ${f.payload.length ? hex(f.payload) : '-'}`);
    const len = 16 + (f.flags ? 4 : 0) + f.payload.length;
    const bytes = await cEncOut.read(len);
    await writeAll(rDec.stdin, bytes);
    const line = await rDecLines.next();
    const p = line.split(' ');
    check(p[0] === 'F', `A[${i}] expected F line, got ${line}`);
    if (p[0] !== 'F') continue;
    check(+p[1] === f.mt, `A[${i}] msg_type ${p[1]} != ${f.mt}`);
    check(+p[2] === f.flags, `A[${i}] flags ${p[2]} != ${f.flags}`);
    check(+p[3] === f.ch, `A[${i}] channel ${p[3]} != ${f.ch}`);
    check(+p[4] === f.seq, `A[${i}] seq ${p[4]} != ${f.seq}`);
    check(+p[5] === f.payload.length, `A[${i}] plen ${p[5]} != ${f.payload.length}`);
    check(p[7] === (f.payload.length ? hex(f.payload) : ''), `A[${i}] payload mismatch`);
    if (f.flags) {
      const expectCrc = (crc32(f.payload) >>> 0).toString(16).padStart(8, '0');
      check(p[6] === expectCrc, `A[${i}] crc ${p[6]} != ${expectCrc}`);
    } else {
      check(p[6] === '-', `A[${i}] crc should be '-'`);
    }
    /* Rust 侧每帧输出 F + M 两行，消费 M 行 */
    const mline = await rDecLines.next();
    check(mline.startsWith('M '), `A[${i}] expected M line, got ${mline}`);
    if (i % 50 === 49) console.log(`  A progress ${i + 1}/300`);
  }

  /* ---------- B. Rust 编码 -> C SDK 解码 ---------- */
  console.log('B. Rust 编码 -> C SDK 解码（300 帧模糊）');
  for (let i = 0; i < 300; i++) {
    /* 使用自定义 msgType（标准类型的 M 行已在 D 阶段单独验证） */
    const f = { ...randFrame(), mt: 0x40 + randomInt(0, 0x20) };
    await sendLine(rEnc, `${f.mt} ${f.flags} ${f.ch} ${f.seq} ${f.payload.length ? hex(f.payload) : '-'}`);
    const len = 16 + (f.flags ? 4 : 0) + f.payload.length;
    const bytes = await rEncOut.read(len);
    await writeAll(cDec.stdin, bytes);
    const line = await cDecLines.next();
    const p = line.split(' ');
    check(p[0] === 'F', `B[${i}] expected F line, got ${line}`);
    if (p[0] !== 'F') continue;
    check(+p[1] === f.mt, `B[${i}] msg_type ${p[1]} != ${f.mt}`);
    check(+p[2] === f.flags, `B[${i}] flags ${p[2]} != ${f.flags}`);
    check(+p[3] === f.ch, `B[${i}] channel ${p[3]} != ${f.ch}`);
    check(+p[4] === f.seq, `B[${i}] seq ${p[4]} != ${f.seq}`);
    check(+p[5] === f.payload.length, `B[${i}] plen ${p[5]} != ${f.payload.length}`);
    check(p[6] === (f.payload.length ? hex(f.payload) : ''), `B[${i}] payload mismatch`);
    if (i % 50 === 49) console.log(`  B progress ${i + 1}/300`);
  }

  /* ---------- C. C SDK 标准消息 -> Rust 消息解码 ---------- */
  console.log('C. C SDK 标准消息 -> Rust 消息解码');
  /* Rust F 行的 mt/flags/ch/seq/plen 均为十进制 */
  const stdCases = [
    {
      cmd: 'H 1 287454020 interop-dev', len: 33,
      f: ['1', '0', '1', '1', '17'],
      m: ['M hello 1 287454020 interop-dev'],
    },
    {
      cmd: 'B 72623859790382856', len: 24,
      f: ['3', '0', '1', '2', '8'],
      m: ['M heartbeat 72623859790382856'],
    },
    {
      cmd: 'Q 2 305419896 64 61626364', len: 28,
      f: ['16', '0', '2', '3', '12'],
      m: ['M request 305419896 64 61626364'],
    },
    {
      cmd: 'P 3 9 9 5 78797a', len: 27,
      f: ['17', '0', '3', '9', '11'],
      m: ['M response 9 5 78797a'],
    },
    {
      cmd: 'V 4 4660 99 7a', len: 29,
      f: ['32', '0', '4', '4', '13'],
      m: ['M event 4660 99 7a'],
    },
    {
      cmd: 'X 5 3 boom', len: 26,
      f: ['127', '0', '5', '5', '10'],
      m: ['M error 3 boom'],
    },
  ];
  for (const c of stdCases) {
    await sendLine(cEnc, c.cmd);
    const bytes = await cEncOut.read(c.len);
    await writeAll(rDec.stdin, bytes);
    const fl = (await rDecLines.next()).split(' ');
    check(fl[0] === 'F', `C expected F, got ${fl.join(' ')}`);
    check(fl[1] === c.f[0] && fl[2] === c.f[1] && fl[3] === c.f[2] && fl[4] === c.f[3] && fl[5] === c.f[4],
          `C frame fields ${fl.slice(1).join(' ')} != ${c.f.join(' ')}`);
    const ml = await rDecLines.next();
    check(ml === c.m[0], `C message ${ml} != ${c.m[0]}`);
  }

  /* ---------- D. Rust 标准消息（测试编码器）-> C SDK 类型化回调 ---------- */
  console.log('D. Rust 标准消息 -> C SDK 类型化回调');
  const rstdCases = [
    { cmd: 'H 1 287454020 ref-dev', len: 29, m: 'M hello 1 287454020 ref-dev' },
    { cmd: 'B 72623859790382856', len: 24, m: 'M heartbeat 72623859790382856' },
    { cmd: 'Q 2 305419896 64 61626364', len: 28, m: 'M request 305419896 64 61626364' },
    { cmd: 'P 3 9 9 5 78797a', len: 27, m: 'M response 9 5 78797a' },
    { cmd: 'V 4 4660 99 7a', len: 29, m: 'M event 4660 99 7a' },
    { cmd: 'X 5 3 boom', len: 26, m: 'M error 3 boom' },
  ];
  for (const c of rstdCases) {
    await sendLine(rStd, c.cmd);
    const bytes = await rStdOut.read(c.len);
    await writeAll(cDec.stdin, bytes);
    const fl = await cDecLines.next();
    check(fl.startsWith('F '), `D expected F, got ${fl}`);
    const ml = await cDecLines.next();
    check(ml === c.m, `D message ${ml} != ${c.m}`);
  }

  /* ---------- E. 双向噪声重同步交叉验证 ---------- */
  console.log('E. 双向噪声重同步交叉验证（各 60 轮）');
  for (let i = 0; i < 60; i++) {
    /* 固定自定义 msgType，避免标准类型触发额外的 M 行 */
    const f = { ...randFrame(), mt: 0x40 + randomInt(0, 0x20) };
    const junkLen = randomInt(1, 21);
    let junk = '';
    for (let k = 0; k < junkLen; k++) junk += JUNK_ALPHABET[randomInt(0, JUNK_ALPHABET.length)];
    const junkBuf = Buffer.from(junk, 'ascii');
    /* C 编码 + 噪声 -> Rust */
    await sendLine(cEnc, `R ${f.mt} 0 ${f.ch} ${f.seq} ${f.payload.length ? hex(f.payload) : '-'}`);
    const frame = await cEncOut.read(16 + f.payload.length);
    await writeAll(rDec.stdin, Buffer.concat([junkBuf, frame]));
    const el = (await rDecLines.next()).split(' ');
    check(el[0] === 'E', `E[${i}] rust expected E, got ${el.join(' ')}`);
    check(+el[1] === junkLen, `E[${i}] rust dropped ${el[1]} != ${junkLen}`);
    const fl = (await rDecLines.next()).split(' ');
    check(fl[0] === 'F' && +fl[4] === f.seq, `E[${i}] rust frame after resync`);
    const mline = await rDecLines.next(); /* 消费 M 行 */
    check(mline.startsWith('M '), `E[${i}] rust M line`);
    /* Rust 编码 + 噪声 -> C */
    await sendLine(rEnc, `${f.mt} 0 ${f.ch} ${f.seq} ${f.payload.length ? hex(f.payload) : '-'}`);
    const frame2 = await rEncOut.read(16 + f.payload.length);
    await writeAll(cDec.stdin, Buffer.concat([junkBuf, frame2]));
    const el2 = (await cDecLines.next()).split(' ');
    check(el2[0] === 'E' && +el2[1] === 4, `E[${i}] c expected E(4=RESYNC), got ${el2.join(' ')}`);
    check(+el2[2] === junkLen, `E[${i}] c dropped ${el2[2]} != ${junkLen}`);
    const fl2 = (await cDecLines.next()).split(' ');
    check(fl2[0] === 'F' && +fl2[4] === f.seq, `E[${i}] c frame after resync`);
  }

  /* ---------- F. 会话模拟：HMI -> C 设备业务 -> Rust ---------- */
  console.log('F. 会话模拟（称量/未知动作/PING）');
  // 称量动作 msgType=0x40(十进制 64) ch=1 seq=1 payload=0101
  await sendLine(cEnc, 'R 64 0 1 1 0101');
  await writeAll(cDev.stdin, await cEncOut.read(18));
  const resp1 = await cDevOut.read(28); /* 16+8+4（业务带 float32 体重 body） */
  await writeAll(rDec.stdin, resp1);
  let fl = (await rDecLines.next()).split(' ');
  check(fl[0] === 'F' && fl[1] === '17' && fl[3] === '1', `F weigh frame ${fl.join(' ')}`);
  let ml = await rDecLines.next();
  check(ml === 'M response 1 0 a4704541', `F weigh response: ${ml}`);

  // 未知动作 msgType=0x50(十进制 80) -> status=1
  await sendLine(cEnc, 'R 80 0 1 2 ffff');
  await writeAll(cDev.stdin, await cEncOut.read(18));
  const resp2 = await cDevOut.read(24);
  await writeAll(rDec.stdin, resp2);
  fl = (await rDecLines.next()).split(' ');
  check(fl[0] === 'F' && fl[1] === '17', `F unknown frame ${fl.join(' ')}`);
  ml = await rDecLines.next();
  check(ml === 'M response 2 1 ', `F unknown response: ${ml}`);

  // REQUEST ping method=1 -> PONG
  await sendLine(cEnc, 'Q 1 777 1 -');
  await writeAll(cDev.stdin, await cEncOut.read(24));
  const resp3 = await cDevOut.read(28);
  await writeAll(rDec.stdin, resp3);
  fl = (await rDecLines.next()).split(' ');
  check(fl[0] === 'F' && fl[1] === '17', `F ping frame ${fl.join(' ')}`);
  ml = await rDecLines.next();
  check(ml === 'M response 777 0 504f4e47', `F ping response: ${ml}`);

  /* 收尾 */
  for (const p of [cEnc, cDec, cDev, rEnc, rDec, rStd]) {
    try { p.stdin.end(); } catch {}
  }

  console.log(`\n互操作联调：${checks} checks, ${failures} failures`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('driver error:', e.message);
  process.exit(2);
});
