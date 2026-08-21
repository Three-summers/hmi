/**
 * run_serial_mock.mjs — socat 虚拟串口（PTY 对）联调编排
 *
 * 拓扑：
 *   ref-serial（真实 HMI 串口栈：src-tauri/src/comm/serial.rs + proto.rs）
 *     │ 打开 PTY A（tokio-serial，115200 8N1）
 *   socat pty,link=A  <──字节流──>  socat pty,link=B
 *     │ 打开 PTY B（O_RDWR + cfmakeraw，与 STM32 用法一致）
 *   pty_device（C SDK 设备端模拟器）
 *
 * 验证：上电 HELLO/HEARTBEAT、称量/未知动作/PING 应答回显、线路噪声重同步、
 *       40 轮随机动作 fuzz，全部走真实串口设备节点。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const PTY_DEVICE = process.env.PTY_DEVICE || path.join(here, '..', 'build', 'pty_device');
const REF_SERIAL = process.env.REF_SERIAL || path.join(here, 'ref-serial/target/debug/ref-serial');
const SOCAT = process.env.SOCAT || 'socat';

const runId = process.pid;
const linkA = `/tmp/hmi_mock_a_${runId}`;
const linkB = `/tmp/hmi_mock_b_${runId}`;

let checks = 0;
let failures = 0;
function check(cond, msg) {
  checks++;
  if (!cond) {
    failures++;
    console.log('  FAIL:', msg);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(cond, timeoutMs, what) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (cond()) return;
    await sleep(100);
  }
  throw new Error(`timeout waiting for ${what}`);
}

function main() {
  for (const f of [PTY_DEVICE, REF_SERIAL]) {
    if (!fs.existsSync(f)) {
      console.error(`missing binary: ${f}`);
      process.exit(2);
    }
  }

  // 清理旧链接
  for (const l of [linkA, linkB]) {
    try { fs.unlinkSync(l); } catch {}
  }

  console.log(`[socat] 创建 PTY 对: ${linkA} <-> ${linkB}`);
  const socat = spawn(SOCAT, ['-d', '-d', `pty,raw,echo=0,link=${linkA}`, `pty,raw,echo=0,link=${linkB}`], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let socatLog = '';
  socat.stdout.on('data', (d) => { socatLog += d; });
  socat.stderr.on('data', (d) => { socatLog += d; });

  let deviceErr = '';
  let hmiOut = '';
  let hmiErr = '';

  let device = null;
  let hmi = null;
  const done = new Promise((resolve) => {
    const timer = setInterval(() => {
      if (hmi && hmi.exitCode !== null) {
        clearInterval(timer);
        resolve({ code: hmi.exitCode, hmiOut, hmiErr, deviceErr, socatLog });
      }
    }, 100);
  });

  waitFor(() => fs.existsSync(linkA) && fs.existsSync(linkB), 8000, 'socat pty links')
    .then(() => {
      console.log('[device] 启动 pty_device（上电 HELLO + HEARTBEAT）');
      device = spawn(PTY_DEVICE, [linkB], { stdio: ['ignore', 'pipe', 'pipe'] });
      device.stderr.on('data', (d) => { deviceErr += d; });
      return sleep(400);
    })
    .then(() => {
      console.log('[hmi] 启动 ref-serial（真实 tokio-serial 打开 PTY）');
      hmi = spawn(REF_SERIAL, [linkA], { stdio: ['ignore', 'pipe', 'pipe'] });
      hmi.stdout.on('data', (d) => { hmiOut += d; });
      hmi.stderr.on('data', (d) => { hmiErr += d; });
      return Promise.race([
        done,
        sleep(60000).then(() => ({ code: -1, hmiOut, hmiErr, deviceErr, socatLog })),
      ]);
    })
    .then(({ code, hmiOut: out, hmiErr: err, deviceErr: derr, socatLog: slog }) => {
      console.log('--- HMI 侧输出 ---');
      console.log(out.trim());
      if (err.trim()) console.log('HMI stderr:', err.trim().slice(0, 600));
      if (derr.trim()) console.log('DEVICE stderr:', derr.trim().slice(0, 400));

      check(code === 0, `ref-serial 退出码 ${code}（期望 0）`);
      check(out.includes('HELLO-OK name=dilution-mock role=1'), 'HELLO 解码（真实串口栈）');
      check(out.includes('HB-OK ts=111222333'), 'HEARTBEAT 解码');
      check(out.includes('WEIGH-OK seq=1 status=0 body=a4704541'), '称量应答（回显 + float32 body）');
      check(out.includes('UNKNOWN-OK seq=2 status=1'), '未知动作错误状态');
      check(out.includes('PING-OK seq=3 status=0 body=504f4e47'), 'PING -> PONG');
      check(out.includes('NOISE-OK dropped=4 event=9 body=6e6f6973652d646f6e65'), '线路噪声重同步 + EVENT');
      check(out.includes('FUZZ-OK n=40'), '40 轮随机动作 fuzz');
      check(out.includes('SERIAL-MOCK-ALL-OK'), '整体完成标记');

      // 收尾
      try { socat.kill('SIGTERM'); } catch {}
      try { device.kill('SIGTERM'); } catch {}
      for (const l of [linkA, linkB]) {
        try { fs.unlinkSync(l); } catch {}
      }

      console.log(`\n串口模拟联调：${checks} checks, ${failures} failures`);
      process.exit(failures === 0 ? 0 : 1);
    })
    .catch((e) => {
      console.error('driver error:', e.message);
      try { socat.kill('SIGTERM'); } catch {}
      try { device.kill('SIGTERM'); } catch {}
      try { hmi.kill('SIGTERM'); } catch {}
      process.exit(2);
    });
}

main();
