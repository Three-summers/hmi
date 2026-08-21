/**
 * hmip.c — HMIP v1 设备端协议实现（C99，无动态内存）
 *
 * 解码器行为与 HMI 侧 Rust 实现（src-tauri/src/comm/proto.rs）保持一致：
 *   - 支持拆包/粘包：数据不足等待，多帧一次解析
 *   - 重同步：发现非 MAGIC 前缀时扫描下一个 "HMIP" 并丢弃噪声字节
 *   - 版本/长度/CRC 异常：丢弃 1 字节后重新对齐
 */
#include "hmip.h"

#include <string.h>

static const uint8_t HMIP_MAGIC[4] = { 'H', 'M', 'I', 'P' };

static int hmip_process(hmip_t *h);
static void hmip_dispatch(hmip_t *h, const hmip_frame_t *f);

/* ==================== CRC32（IEEE 802.3，与 zlib / crc32fast 一致） ==================== */

static uint32_t crc_table[256];
static int crc_table_ready = 0;

static void crc_init(void)
{
    if (crc_table_ready) {
        return;
    }
    for (uint32_t i = 0; i < 256u; i++) {
        uint32_t c = i;
        for (int k = 0; k < 8; k++) {
            c = (c & 1u) ? (0xEDB88320u ^ (c >> 1)) : (c >> 1);
        }
        crc_table[i] = c;
    }
    crc_table_ready = 1;
}

static uint32_t crc_update(uint32_t crc, const uint8_t *data, size_t len)
{
    for (size_t i = 0; i < len; i++) {
        crc = crc_table[(crc ^ data[i]) & 0xFFu] ^ (crc >> 8);
    }
    return crc;
}

uint32_t hmip_crc32(const uint8_t *data, size_t len)
{
    crc_init();
    return crc_update(0xFFFFFFFFu, data, len) ^ 0xFFFFFFFFu;
}

/* ==================== 小端读写 ==================== */

static uint16_t rd_u16le(const uint8_t *p)
{
    return (uint16_t)((uint16_t)p[0] | ((uint16_t)p[1] << 8));
}

static uint32_t rd_u32le(const uint8_t *p)
{
    return (uint32_t)p[0] | ((uint32_t)p[1] << 8) | ((uint32_t)p[2] << 16) |
           ((uint32_t)p[3] << 24);
}

static uint64_t rd_u64le(const uint8_t *p)
{
    return (uint64_t)rd_u32le(p) | ((uint64_t)rd_u32le(p + 4) << 32);
}

static void wr_u16le(uint8_t *p, uint16_t v)
{
    p[0] = (uint8_t)(v & 0xFFu);
    p[1] = (uint8_t)((v >> 8) & 0xFFu);
}

static void wr_u32le(uint8_t *p, uint32_t v)
{
    p[0] = (uint8_t)(v & 0xFFu);
    p[1] = (uint8_t)((v >> 8) & 0xFFu);
    p[2] = (uint8_t)((v >> 16) & 0xFFu);
    p[3] = (uint8_t)((v >> 24) & 0xFFu);
}

static void wr_u64le(uint8_t *p, uint64_t v)
{
    wr_u32le(p, (uint32_t)(v & 0xFFFFFFFFu));
    wr_u32le(p + 4, (uint32_t)(v >> 32));
}

/* ==================== 错误上报 ==================== */

static int report(hmip_t *h, int err, size_t dropped)
{
    if (h->cfg.on_decode_error) {
        h->cfg.on_decode_error(h, err, dropped, h->cfg.user);
    }
    return err;
}

/* ==================== 生命周期 ==================== */

int hmip_init(hmip_t *h, const hmip_config_t *cfg)
{
    if (!h || !cfg) {
        return HMIP_ERR_ARG;
    }
    if (!cfg->tx_write) {
        return HMIP_ERR_ARG;
    }
    if (!cfg->rx_buf || cfg->rx_buf_size < HMIP_MIN_RX_BUF_SIZE) {
        return HMIP_ERR_ARG;
    }
    h->cfg = *cfg;
    h->rx_len = 0;
    h->tx_seq = 0;
    return HMIP_OK;
}

/* ==================== 解码 ==================== */

static size_t find_magic(const uint8_t *buf, size_t n)
{
    for (size_t i = 0; i + 4 <= n; i++) {
        if (buf[i] != HMIP_MAGIC[0]) {
            continue;
        }
        if (memcmp(buf + i, HMIP_MAGIC, 4) == 0) {
            return i;
        }
    }
    return n; /* 未找到 */
}

int hmip_feed(hmip_t *h, const uint8_t *data, size_t len)
{
    if (!h) {
        return HMIP_ERR_ARG;
    }
    if (len == 0) {
        return HMIP_OK;
    }
    if (!data) {
        return HMIP_ERR_ARG;
    }

    /* 缓冲区溢出：整体丢弃（与 HMI 侧一致），由调用方决定重连/告警 */
    if (len > h->cfg.rx_buf_size - h->rx_len) {
        size_t dropped = h->rx_len;
        h->rx_len = 0;
        return report(h, HMIP_ERR_OVERFLOW, dropped);
    }

    memcpy(h->cfg.rx_buf + h->rx_len, data, len);
    h->rx_len += len;
    return hmip_process(h);
}

int hmip_poll(hmip_t *h)
{
    if (!h) {
        return HMIP_ERR_ARG;
    }
    return hmip_process(h);
}

int hmip_process(hmip_t *h)
{
    int last = HMIP_OK;
    uint8_t *buf = h->cfg.rx_buf;

    for (;;) {
        size_t n = h->rx_len;
        if (n < 4) {
            return last;
        }

        /* 帧边界对齐：丢弃 MAGIC 之前的噪声字节 */
        size_t at = find_magic(buf, n);
        if (at == n) {
            /* 未找到 magic：保留最后 3 字节（可能是半个 magic），其余丢弃 */
            size_t keep = (n >= 3) ? 3 : n;
            size_t drop = n - keep;
            memmove(buf, buf + drop, keep);
            h->rx_len = keep;
            return report(h, HMIP_ERR_RESYNC, drop);
        }
        if (at > 0) {
            memmove(buf, buf + at, n - at);
            h->rx_len = n - at;
            last = report(h, HMIP_ERR_RESYNC, at);
            continue;
        }

        /* magic 对齐，等待完整头部 */
        if (n < HMIP_HEADER_BASE_LEN) {
            return last;
        }

        if (buf[4] != HMIP_VERSION) {
            memmove(buf, buf + 1, n - 1);
            h->rx_len = n - 1;
            last = report(h, HMIP_ERR_BAD_VERSION, 1);
            continue;
        }

        uint8_t msg_type = buf[5];
        uint8_t flags = buf[6];
        uint8_t channel = buf[7];
        uint32_t seq = rd_u32le(buf + 8);
        uint32_t payload_len = rd_u32le(buf + 12);
        size_t header_len = (flags & HMIP_FLAG_CRC32) ? HMIP_HEADER_WITH_CRC_LEN
                                                      : HMIP_HEADER_BASE_LEN;

        if (n < header_len) {
            return last;
        }

        /* payload 超出接收缓冲容量：本端无法接收，丢弃 1 字节重新对齐 */
        if (payload_len > h->cfg.rx_buf_size - header_len) {
            memmove(buf, buf + 1, n - 1);
            h->rx_len = n - 1;
            last = report(h, HMIP_ERR_PAYLOAD_TOO_LARGE, 1);
            continue;
        }

        /* 等待完整帧 */
        if (n < header_len + (size_t)payload_len) {
            return last;
        }

        uint32_t payload_crc32 = 0;
        if (flags & HMIP_FLAG_CRC32) {
            payload_crc32 = rd_u32le(buf + 16);
            if (hmip_crc32(buf + header_len, (size_t)payload_len) != payload_crc32) {
                memmove(buf, buf + 1, n - 1);
                h->rx_len = n - 1;
                last = report(h, HMIP_ERR_CRC, 1);
                continue;
            }
        }

        /* 帧完整：构造视图并分发回调 */
        hmip_frame_t frame;
        frame.msg_type = msg_type;
        frame.flags = flags;
        frame.channel = channel;
        frame.seq = seq;
        frame.payload = buf + header_len;
        frame.payload_len = (size_t)payload_len;
        frame.payload_crc32 = payload_crc32;
        hmip_dispatch(h, &frame);

        size_t consumed = header_len + (size_t)payload_len;
        memmove(buf, buf + consumed, n - consumed);
        h->rx_len = n - consumed;
        last = HMIP_OK;
    }
}

static void hmip_dispatch(hmip_t *h, const hmip_frame_t *f)
{
    /* 原始帧回调：任何解码成功的帧都会触发（若注册） */
    if (h->cfg.on_frame) {
        h->cfg.on_frame(h, f, h->cfg.user);
    }

    switch (f->msg_type) {
    case HMIP_MSG_HELLO: {
        if (!h->cfg.on_hello || f->payload_len < 6) {
            break;
        }
        uint8_t role = f->payload[0];
        size_t name_len = f->payload[5];
        if (role > 1 || f->payload_len < 6 + name_len) {
            break;
        }
        h->cfg.on_hello(h, f, role, rd_u32le(f->payload + 1),
                        (const char *)(f->payload + 6), name_len, h->cfg.user);
        break;
    }
    case HMIP_MSG_HELLO_ACK: {
        if (!h->cfg.on_hello_ack || f->payload_len < 5) {
            break;
        }
        size_t name_len = f->payload[4];
        if (f->payload_len < 5 + name_len) {
            break;
        }
        h->cfg.on_hello_ack(h, f, rd_u32le(f->payload),
                            (const char *)(f->payload + 5), name_len, h->cfg.user);
        break;
    }
    case HMIP_MSG_HEARTBEAT: {
        if (!h->cfg.on_heartbeat || f->payload_len != 8) {
            break;
        }
        h->cfg.on_heartbeat(h, f, rd_u64le(f->payload), h->cfg.user);
        break;
    }
    case HMIP_MSG_REQUEST: {
        if (!h->cfg.on_request || f->payload_len < 8) {
            break;
        }
        h->cfg.on_request(h, f, rd_u32le(f->payload), rd_u16le(f->payload + 4),
                          f->payload + 8, f->payload_len - 8, h->cfg.user);
        break;
    }
    case HMIP_MSG_RESPONSE: {
        if (!h->cfg.on_response || f->payload_len < 8) {
            break;
        }
        h->cfg.on_response(h, f, rd_u32le(f->payload), rd_u16le(f->payload + 4),
                           f->payload + 8, f->payload_len - 8, h->cfg.user);
        break;
    }
    case HMIP_MSG_EVENT: {
        if (!h->cfg.on_event || f->payload_len < 12) {
            break;
        }
        h->cfg.on_event(h, f, rd_u16le(f->payload), rd_u64le(f->payload + 4),
                        f->payload + 12, f->payload_len - 12, h->cfg.user);
        break;
    }
    case HMIP_MSG_ERROR: {
        if (!h->cfg.on_error || f->payload_len < 6) {
            break;
        }
        uint16_t code = rd_u16le(f->payload);
        size_t msg_len = rd_u16le(f->payload + 4);
        if (f->payload_len < 6 + msg_len) {
            break;
        }
        h->cfg.on_error(h, f, code, (const char *)(f->payload + 6), msg_len,
                        h->cfg.user);
        break;
    }
    default:
        break;
    }
}

/* ==================== 发送 ==================== */

static int tx_raw(hmip_t *h, const uint8_t *data, size_t len)
{
    if (len == 0) {
        return HMIP_OK;
    }
    if (h->cfg.tx_write(data, len, h->cfg.tx_ctx) != 0) {
        return HMIP_ERR_TX;
    }
    return HMIP_OK;
}

uint32_t hmip_next_seq(hmip_t *h)
{
    if (!h) {
        return 0;
    }
    h->tx_seq++;
    return h->tx_seq;
}

int hmip_send_frame(hmip_t *h, uint8_t msg_type, uint8_t flags,
                    uint8_t channel, uint32_t seq,
                    const uint8_t *payload, size_t payload_len)
{
    if (!h) {
        return HMIP_ERR_ARG;
    }
    if (payload_len > 0xFFFFFFFFu) {
        return HMIP_ERR_ARG;
    }
    if (payload_len && !payload) {
        return HMIP_ERR_ARG;
    }
    if (seq == 0) {
        seq = hmip_next_seq(h);
    }

    size_t header_len = (flags & HMIP_FLAG_CRC32) ? HMIP_HEADER_WITH_CRC_LEN
                                                  : HMIP_HEADER_BASE_LEN;
    uint8_t header[HMIP_HEADER_WITH_CRC_LEN];
    memcpy(header, HMIP_MAGIC, 4);
    header[4] = HMIP_VERSION;
    header[5] = msg_type;
    header[6] = flags;
    header[7] = channel;
    wr_u32le(header + 8, seq);
    wr_u32le(header + 12, (uint32_t)payload_len);
    if (flags & HMIP_FLAG_CRC32) {
        wr_u32le(header + 16, hmip_crc32(payload, payload_len));
    }

    int rc = tx_raw(h, header, header_len);
    if (rc != HMIP_OK) {
        return rc;
    }
    return tx_raw(h, payload, payload_len);
}

/* 组装标准消息：header + fixed + body，分块写出（每块一次 tx_write） */
static int send_message(hmip_t *h, uint8_t msg_type, uint8_t channel,
                        uint32_t seq, const uint8_t *fixed, size_t fixed_len,
                        const uint8_t *body, size_t body_len)
{
    size_t payload_len = fixed_len + body_len;
    if (payload_len > 0xFFFFFFFFu) {
        return HMIP_ERR_ARG;
    }

    uint8_t flags = h->cfg.default_flags;
    size_t header_len = (flags & HMIP_FLAG_CRC32) ? HMIP_HEADER_WITH_CRC_LEN
                                                  : HMIP_HEADER_BASE_LEN;
    uint8_t header[HMIP_HEADER_WITH_CRC_LEN];
    memcpy(header, HMIP_MAGIC, 4);
    header[4] = HMIP_VERSION;
    header[5] = msg_type;
    header[6] = flags;
    header[7] = channel;
    wr_u32le(header + 8, seq);
    wr_u32le(header + 12, (uint32_t)payload_len);
    if (flags & HMIP_FLAG_CRC32) {
        crc_init();
        uint32_t crc = crc_update(0xFFFFFFFFu, fixed, fixed_len);
        crc = crc_update(crc, body, body_len);
        wr_u32le(header + 16, crc ^ 0xFFFFFFFFu);
    }

    int rc = tx_raw(h, header, header_len);
    if (rc != HMIP_OK) {
        return rc;
    }
    rc = tx_raw(h, fixed, fixed_len);
    if (rc != HMIP_OK) {
        return rc;
    }
    return tx_raw(h, body, body_len);
}

int hmip_send_hello(hmip_t *h)
{
    if (!h) {
        return HMIP_ERR_ARG;
    }
    const char *name = h->cfg.name ? h->cfg.name : "";
    size_t name_len = strlen(name);
    if (name_len > 255) {
        name_len = 255;
    }

    uint8_t fixed[6];
    fixed[0] = h->cfg.role;
    wr_u32le(fixed + 1, h->cfg.capabilities);
    fixed[5] = (uint8_t)name_len;

    return send_message(h, HMIP_MSG_HELLO, h->cfg.channel, hmip_next_seq(h),
                        fixed, sizeof(fixed), (const uint8_t *)name, name_len);
}

int hmip_send_heartbeat(hmip_t *h, uint64_t timestamp_ms)
{
    if (!h) {
        return HMIP_ERR_ARG;
    }
    uint8_t fixed[8];
    wr_u64le(fixed, timestamp_ms);
    return send_message(h, HMIP_MSG_HEARTBEAT, h->cfg.channel, hmip_next_seq(h),
                        fixed, sizeof(fixed), NULL, 0);
}

int hmip_send_request(hmip_t *h, uint8_t channel, uint32_t request_id,
                      uint16_t method, const uint8_t *body, size_t body_len)
{
    if (!h) {
        return HMIP_ERR_ARG;
    }
    if (body_len && !body) {
        return HMIP_ERR_ARG;
    }
    uint8_t fixed[8];
    wr_u32le(fixed, request_id);
    wr_u16le(fixed + 4, method);
    wr_u16le(fixed + 6, 0); /* reserved */
    return send_message(h, HMIP_MSG_REQUEST, channel, hmip_next_seq(h),
                        fixed, sizeof(fixed), body, body_len);
}

int hmip_send_response(hmip_t *h, uint8_t channel, uint32_t seq,
                       uint32_t request_id, uint16_t status,
                       const uint8_t *body, size_t body_len)
{
    if (!h) {
        return HMIP_ERR_ARG;
    }
    if (body_len && !body) {
        return HMIP_ERR_ARG;
    }
    uint8_t fixed[8];
    wr_u32le(fixed, request_id);
    wr_u16le(fixed + 4, status);
    wr_u16le(fixed + 6, 0); /* reserved */
    return send_message(h, HMIP_MSG_RESPONSE, channel, seq, fixed,
                        sizeof(fixed), body, body_len);
}

int hmip_send_event(hmip_t *h, uint8_t channel, uint16_t event_id,
                    uint64_t timestamp_ms, const uint8_t *body, size_t body_len)
{
    if (!h) {
        return HMIP_ERR_ARG;
    }
    if (body_len && !body) {
        return HMIP_ERR_ARG;
    }
    uint8_t fixed[12];
    wr_u16le(fixed, event_id);
    wr_u16le(fixed + 2, 0); /* reserved */
    wr_u64le(fixed + 4, timestamp_ms);
    return send_message(h, HMIP_MSG_EVENT, channel, hmip_next_seq(h),
                        fixed, sizeof(fixed), body, body_len);
}

int hmip_send_error(hmip_t *h, uint8_t channel, uint16_t code,
                    const char *message)
{
    if (!h) {
        return HMIP_ERR_ARG;
    }
    const char *msg = message ? message : "";
    size_t msg_len = strlen(msg);
    if (msg_len > 0xFFFFu) {
        msg_len = 0xFFFFu;
    }
    uint8_t fixed[6];
    wr_u16le(fixed, code);
    wr_u16le(fixed + 2, 0); /* reserved */
    wr_u16le(fixed + 4, (uint16_t)msg_len);
    return send_message(h, HMIP_MSG_ERROR, channel, hmip_next_seq(h),
                        fixed, sizeof(fixed), (const uint8_t *)msg, msg_len);
}

int hmip_ack(hmip_t *h, const hmip_frame_t *f, uint16_t status,
             const uint8_t *body, size_t body_len)
{
    if (!h || !f) {
        return HMIP_ERR_ARG;
    }
    /* channel 回显 + 帧头 seq 回显 + payload request_id 写入请求 seq */
    return hmip_send_response(h, f->channel, f->seq, f->seq, status, body,
                              body_len);
}

int hmip_ack_ok(hmip_t *h, const hmip_frame_t *f)
{
    return hmip_ack(h, f, HMIP_STATUS_OK, NULL, 0);
}

/* ==================== 工具 ==================== */

const char *hmip_strerror(int err)
{
    switch (err) {
    case HMIP_OK:
        return "ok";
    case HMIP_ERR_ARG:
        return "invalid argument";
    case HMIP_ERR_TX:
        return "tx write failed";
    case HMIP_ERR_OVERFLOW:
        return "rx buffer overflow";
    case HMIP_ERR_RESYNC:
        return "resync: dropped bytes before magic";
    case HMIP_ERR_BAD_VERSION:
        return "unsupported frame version";
    case HMIP_ERR_PAYLOAD_TOO_LARGE:
        return "payload too large for rx buffer";
    case HMIP_ERR_CRC:
        return "payload crc32 mismatch";
    default:
        return "unknown error";
    }
}
