/**
 * test_hmip.c — HMIP C SDK 测试套件（主机运行，无外部依赖）
 *
 * 覆盖：
 *   1. CRC32 已知向量（含 zlib 标准校验值与协议文档中的黄金向量）
 *   2. 帧编码黄金向量（与 docs/device-serial-interface.md §8.1 完全一致）
 *   3. 解码往返 / 拆包 / 粘包 / 噪声重同步 / 版本异常 / CRC 异常 / 超大 payload / 缓冲溢出
 *   4. 标准消息类型化回调（HELLO/HEARTBEAT/REQUEST/RESPONSE/EVENT/ERROR）
 *   5. 应答便捷函数（hmip_ack 回显 channel/seq/request_id）
 *   6. 随机压力测试（随机字段 + 随机分片喂入）
 *   7. 端到端业务模拟（HMI 侧 <-> 设备侧设备业务模块回环）
 */
#include <stdio.h>
#include <string.h>

#include "../hmip.h"
#include "../examples/device_business.h"

/* ==================== 测试框架 ==================== */

static int g_checks = 0;
static int g_failures = 0;

#define CHECK(cond)                                                          \
    do {                                                                     \
        g_checks++;                                                          \
        if (!(cond)) {                                                       \
            g_failures++;                                                    \
            printf("FAIL %s:%d: %s\n", __FILE__, __LINE__, #cond);          \
        }                                                                    \
    } while (0)

#define CHECK_EQ_INT(exp, act)                                               \
    do {                                                                     \
        g_checks++;                                                          \
        long long e_ = (long long)(exp), a_ = (long long)(act);              \
        if (e_ != a_) {                                                      \
            g_failures++;                                                    \
            printf("FAIL %s:%d: %s == %lld, got %lld\n", __FILE__,         \
                   __LINE__, #act, e_, a_);                                  \
        }                                                                    \
    } while (0)

#define CHECK_EQ_U32(exp, act) CHECK_EQ_INT((long long)(exp), (long long)(act))

/* ==================== 捕获器 ==================== */

typedef struct {
    uint8_t buf[4096];
    size_t len;
    int calls;
} tx_capture_t;

static int tx_capture(const uint8_t *data, size_t len, void *ctx)
{
    tx_capture_t *c = (tx_capture_t *)ctx;
    if (c->len + len > sizeof(c->buf)) {
        return -1;
    }
    memcpy(c->buf + c->len, data, len);
    c->len += len;
    c->calls++;
    return 0;
}

static void tx_reset(tx_capture_t *c)
{
    c->len = 0;
    c->calls = 0;
}

typedef struct {
    hmip_frame_t frames[16];
    uint8_t payload[16][256];
    size_t count;
} frame_capture_t;

static void on_frame_capture(hmip_t *h, const hmip_frame_t *f, void *user)
{
    (void)h;
    frame_capture_t *c = (frame_capture_t *)user;
    if (c->count >= 16) {
        return;
    }
    c->frames[c->count] = *f;
    size_t copy = f->payload_len < 256 ? f->payload_len : 256;
    if (copy) {
        memcpy(c->payload[c->count], f->payload, copy);
    }
    c->frames[c->count].payload = c->payload[c->count];
    c->frames[c->count].payload_len = f->payload_len;
    c->count++;
}

static void frame_capture_reset(frame_capture_t *c)
{
    c->count = 0;
    memset(c->frames, 0, sizeof(c->frames));
}

typedef struct {
    int errs[32];
    size_t dropped[32];
    size_t count;
} err_capture_t;

/* 解码错误回调与帧回调共享 cfg.user，帧回调已占用 user，
   故错误回调写入全局目标（仅测试代码使用） */
static err_capture_t *g_err_target;

static void on_decode_error_capture(hmip_t *h, int err, size_t dropped, void *user)
{
    (void)h;
    (void)user;
    err_capture_t *c = g_err_target;
    if (c && c->count < 32) {
        c->errs[c->count] = err;
        c->dropped[c->count] = dropped;
        c->count++;
    }
}

typedef struct {
    int called;
    uint8_t role;
    uint32_t capabilities;
    char name[256];
    size_t name_len;
} hello_capture_t;

typedef struct {
    int called;
    uint64_t timestamp_ms;
} heartbeat_capture_t;

typedef struct {
    int called;
    uint32_t request_id;
    uint16_t method;
    uint8_t body[64];
    size_t body_len;
} request_capture_t;

typedef struct {
    int called;
    uint32_t request_id;
    uint16_t status;
    uint8_t body[64];
    size_t body_len;
    uint8_t channel;
    uint32_t seq;
} response_capture_t;

typedef struct {
    int called;
    uint16_t event_id;
    uint64_t timestamp_ms;
    uint8_t body[64];
    size_t body_len;
} event_capture_t;

typedef struct {
    int called;
    uint16_t code;
    char message[256];
    size_t message_len;
} error_capture_t;

/* 所有类型化回调共享同一个 user 指针，统一收进 typed_ctx_t */
typedef struct typed_ctx {
    hello_capture_t hello;
    heartbeat_capture_t hb;
    request_capture_t req;
    response_capture_t resp;
    event_capture_t ev;
    error_capture_t err_msg;
} typed_ctx_t;

static void on_hello_capture(hmip_t *h, const hmip_frame_t *f, uint8_t role,
                             uint32_t capabilities, const char *name,
                             size_t name_len, void *user)
{
    (void)h;
    (void)f;
    typed_ctx_t *ctx = (typed_ctx_t *)user;
    hello_capture_t *c = &ctx->hello;
    c->called++;
    c->role = role;
    c->capabilities = capabilities;
    memcpy(c->name, name, name_len);
    c->name[name_len] = '\0';
    c->name_len = name_len;
}

static void on_heartbeat_capture(hmip_t *h, const hmip_frame_t *f,
                                 uint64_t timestamp_ms, void *user)
{
    (void)h;
    (void)f;
    typed_ctx_t *ctx = (typed_ctx_t *)user;
    heartbeat_capture_t *c = &ctx->hb;
    c->called++;
    c->timestamp_ms = timestamp_ms;
}

static void on_request_capture(hmip_t *h, const hmip_frame_t *f,
                               uint32_t request_id, uint16_t method,
                               const uint8_t *body, size_t body_len, void *user)
{
    (void)h;
    (void)f;
    typed_ctx_t *ctx = (typed_ctx_t *)user;
    request_capture_t *c = &ctx->req;
    c->called++;
    c->request_id = request_id;
    c->method = method;
    c->body_len = body_len < 64 ? body_len : 64;
    memcpy(c->body, body, c->body_len);
}

static void on_response_capture(hmip_t *h, const hmip_frame_t *f,
                                uint32_t request_id, uint16_t status,
                                const uint8_t *body, size_t body_len, void *user)
{
    (void)h;
    typed_ctx_t *ctx = (typed_ctx_t *)user;
    response_capture_t *c = &ctx->resp;
    c->called++;
    c->request_id = request_id;
    c->status = status;
    c->body_len = body_len < 64 ? body_len : 64;
    memcpy(c->body, body, c->body_len);
    c->channel = f->channel;
    c->seq = f->seq;
}

static void on_event_capture(hmip_t *h, const hmip_frame_t *f,
                             uint16_t event_id, uint64_t timestamp_ms,
                             const uint8_t *body, size_t body_len, void *user)
{
    (void)h;
    (void)f;
    typed_ctx_t *ctx = (typed_ctx_t *)user;
    event_capture_t *c = &ctx->ev;
    c->called++;
    c->event_id = event_id;
    c->timestamp_ms = timestamp_ms;
    c->body_len = body_len < 64 ? body_len : 64;
    memcpy(c->body, body, c->body_len);
}

static void on_error_capture(hmip_t *h, const hmip_frame_t *f, uint16_t code,
                             const char *message, size_t message_len, void *user)
{
    (void)h;
    (void)f;
    typed_ctx_t *ctx = (typed_ctx_t *)user;
    error_capture_t *c = &ctx->err_msg;
    c->called++;
    c->code = code;
    c->message_len = message_len; /* 原始长度 */
    size_t copy = message_len < sizeof(c->message) - 1 ? message_len
                                                       : sizeof(c->message) - 1;
    memcpy(c->message, message, copy);
    c->message[copy] = '\0';
}

/* ==================== 实例 ==================== */

static uint8_t rx_main[256];
static uint8_t rx_aux[256];
static uint8_t rx_small[32];
static hmip_t dev; /* 主设备实例 */
static tx_capture_t dev_tx;

static void dev_init(void)
{
    tx_reset(&dev_tx);
    hmip_config_t cfg;
    memset(&cfg, 0, sizeof(cfg));
    cfg.tx_write = tx_capture;
    cfg.tx_ctx = &dev_tx;
    cfg.rx_buf = rx_main;
    cfg.rx_buf_size = sizeof(rx_main);
    cfg.channel = 1;
    cfg.role = HMIP_ROLE_SERVER;
    cfg.capabilities = 0;
    cfg.name = "test-device";
    CHECK_EQ_INT(HMIP_OK, hmip_init(&dev, &cfg));
}

static int bytes_eq(const uint8_t *a, const uint8_t *b, size_t n)
{
    return memcmp(a, b, n) == 0;
}

/* ==================== 1. CRC32 ==================== */

static void test_crc32(void)
{
    static const char check_str[] = "123456789";
    CHECK_EQ_U32(0xCBF43926u, hmip_crc32((const uint8_t *)check_str, 9));

    static const uint8_t v2[] = { 0x01, 0x01 };
    CHECK_EQ_U32(0x2FC51328u, hmip_crc32(v2, 2));

    static const uint8_t z8[8] = { 0 };
    CHECK_EQ_U32(0x6522DF69u, hmip_crc32(z8, 8));

    CHECK_EQ_U32(0u, hmip_crc32(NULL, 0));
}

/* ==================== 2. 帧编码黄金向量 ==================== */

static void test_encode_golden(void)
{
    dev_init();

    static const uint8_t payload[] = { 0x01, 0x01 };

    /* 无 CRC：doc §8.1 示例 1 */
    tx_reset(&dev_tx);
    CHECK_EQ_INT(HMIP_OK, hmip_send_frame(&dev, 0x40, 0, 1, 42, payload, 2));
    static const uint8_t expect1[] = {
        0x48, 0x4D, 0x49, 0x50, 0x01, 0x40, 0x00, 0x01, 0x2A, 0x00, 0x00, 0x00,
        0x02, 0x00, 0x00, 0x00, 0x01, 0x01
    };
    CHECK_EQ_INT(sizeof(expect1), dev_tx.len);
    CHECK(bytes_eq(dev_tx.buf, expect1, sizeof(expect1)));

    /* 带 CRC：doc §8.1 示例 3 */
    tx_reset(&dev_tx);
    CHECK_EQ_INT(HMIP_OK,
                 hmip_send_frame(&dev, 0x40, HMIP_FLAG_CRC32, 1, 42, payload, 2));
    static const uint8_t expect3[] = {
        0x48, 0x4D, 0x49, 0x50, 0x01, 0x40, 0x01, 0x01, 0x2A, 0x00, 0x00, 0x00,
        0x02, 0x00, 0x00, 0x00, 0x28, 0x13, 0xC5, 0x2F, 0x01, 0x01
    };
    CHECK_EQ_INT(sizeof(expect3), dev_tx.len);
    CHECK(bytes_eq(dev_tx.buf, expect3, sizeof(expect3)));

    /* RESPONSE 无 CRC：doc §8.1 示例 2 */
    tx_reset(&dev_tx);
    CHECK_EQ_INT(HMIP_OK, hmip_send_response(&dev, 1, 43, 0, 0, NULL, 0));
    static const uint8_t expect2[] = {
        0x48, 0x4D, 0x49, 0x50, 0x01, 0x11, 0x00, 0x01, 0x2B, 0x00, 0x00, 0x00,
        0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00
    };
    CHECK_EQ_INT(sizeof(expect2), dev_tx.len);
    CHECK(bytes_eq(dev_tx.buf, expect2, sizeof(expect2)));

    /* RESPONSE 带 CRC（payload = 8 个 0x00）：doc §8.1 示例 4 */
    dev.cfg.default_flags = HMIP_FLAG_CRC32;
    tx_reset(&dev_tx);
    CHECK_EQ_INT(HMIP_OK, hmip_send_response(&dev, 1, 43, 0, 0, NULL, 0));
    static const uint8_t expect4[] = {
        0x48, 0x4D, 0x49, 0x50, 0x01, 0x11, 0x01, 0x01, 0x2B, 0x00, 0x00, 0x00,
        0x08, 0x00, 0x00, 0x00, 0x69, 0xDF, 0x22, 0x65, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00
    };
    CHECK_EQ_INT(sizeof(expect4), dev_tx.len);
    CHECK(bytes_eq(dev_tx.buf, expect4, sizeof(expect4)));
    dev.cfg.default_flags = 0;
}

/* ==================== 3. 解码 ==================== */

static void test_decode_roundtrip(void)
{
    dev_init();
    tx_reset(&dev_tx);
    static const uint8_t payload[] = { 0xDE, 0xAD, 0xBE, 0xEF };
    hmip_send_frame(&dev, 0x40, 0, 2, 77, payload, sizeof(payload));

    frame_capture_t cap;
    frame_capture_reset(&cap);
    hmip_config_t cfg;
    memset(&cfg, 0, sizeof(cfg));
    cfg.tx_write = tx_capture;
    cfg.tx_ctx = &dev_tx;
    cfg.rx_buf = rx_aux;
    cfg.rx_buf_size = sizeof(rx_aux);
    cfg.on_frame = on_frame_capture;
    cfg.user = &cap;
    hmip_t decoder;
    CHECK_EQ_INT(HMIP_OK, hmip_init(&decoder, &cfg));
    CHECK_EQ_INT(HMIP_OK, hmip_feed(&decoder, dev_tx.buf, dev_tx.len));

    CHECK_EQ_INT(1, cap.count);
    CHECK_EQ_INT(0x40, cap.frames[0].msg_type);
    CHECK_EQ_INT(0, cap.frames[0].flags);
    CHECK_EQ_INT(2, cap.frames[0].channel);
    CHECK_EQ_U32(77, cap.frames[0].seq);
    CHECK_EQ_INT(sizeof(payload), cap.frames[0].payload_len);
    CHECK(bytes_eq(cap.frames[0].payload, payload, sizeof(payload)));
}

static void test_decode_fragmented(void)
{
    dev_init();
    tx_reset(&dev_tx);
    static const uint8_t payload[] = { 1, 2, 3, 4, 5 };
    hmip_send_frame(&dev, 0x41, 0, 3, 5, payload, sizeof(payload));

    frame_capture_t cap;
    frame_capture_reset(&cap);
    hmip_config_t cfg;
    memset(&cfg, 0, sizeof(cfg));
    cfg.tx_write = tx_capture;
    cfg.tx_ctx = &dev_tx;
    cfg.rx_buf = rx_aux;
    cfg.rx_buf_size = sizeof(rx_aux);
    cfg.on_frame = on_frame_capture;
    cfg.user = &cap;
    hmip_t decoder;
    hmip_init(&decoder, &cfg);

    for (size_t i = 0; i < dev_tx.len; i++) {
        int rc = hmip_feed(&decoder, dev_tx.buf + i, 1);
        CHECK_EQ_INT(HMIP_OK, rc);
        if (i + 1 < dev_tx.len) {
            CHECK_EQ_INT(0, cap.count);
        }
    }
    CHECK_EQ_INT(1, cap.count);
    CHECK_EQ_INT(0x41, cap.frames[0].msg_type);
    CHECK_EQ_U32(5, cap.frames[0].seq);
}

static void test_decode_sticky(void)
{
    dev_init();
    tx_reset(&dev_tx);
    static const uint8_t p1[] = { 9 };
    static const uint8_t p2[] = { 8, 7 };
    hmip_send_frame(&dev, 0x40, 0, 1, 100, p1, sizeof(p1));
    hmip_send_frame(&dev, 0x40, 0, 1, 101, p2, sizeof(p2));

    frame_capture_t cap;
    frame_capture_reset(&cap);
    hmip_config_t cfg;
    memset(&cfg, 0, sizeof(cfg));
    cfg.tx_write = tx_capture;
    cfg.tx_ctx = &dev_tx;
    cfg.rx_buf = rx_aux;
    cfg.rx_buf_size = sizeof(rx_aux);
    cfg.on_frame = on_frame_capture;
    cfg.user = &cap;
    hmip_t decoder;
    hmip_init(&decoder, &cfg);

    CHECK_EQ_INT(HMIP_OK, hmip_feed(&decoder, dev_tx.buf, dev_tx.len));
    CHECK_EQ_INT(2, cap.count);
    CHECK_EQ_U32(100, cap.frames[0].seq);
    CHECK_EQ_U32(101, cap.frames[1].seq);
    CHECK_EQ_INT(1, cap.frames[0].payload_len);
    CHECK_EQ_INT(2, cap.frames[1].payload_len);
}

static void test_decode_resync(void)
{
    dev_init();
    tx_reset(&dev_tx);
    static const uint8_t payload[] = { 0xAA };
    hmip_send_frame(&dev, 0x40, 0, 1, 9, payload, sizeof(payload));

    frame_capture_t cap;
    frame_capture_reset(&cap);
    err_capture_t errs;
    memset(&errs, 0, sizeof(errs));
    g_err_target = &errs;
    hmip_config_t cfg;
    memset(&cfg, 0, sizeof(cfg));
    cfg.tx_write = tx_capture;
    cfg.tx_ctx = &dev_tx;
    cfg.rx_buf = rx_aux;
    cfg.rx_buf_size = sizeof(rx_aux);
    cfg.on_frame = on_frame_capture;
    cfg.on_decode_error = on_decode_error_capture;
    cfg.user = &cap;
    /* 注意：err 回调的 user 与 frame 回调共用；分开验证更清晰，这里用两个实例 */
    hmip_t decoder;
    hmip_init(&decoder, &cfg);

    /* "garbage" 7 字节无 magic：保留最后 3 字节，丢弃 4 字节 */
    CHECK_EQ_INT(HMIP_ERR_RESYNC, hmip_feed(&decoder, (const uint8_t *)"garbage", 7));
    CHECK_EQ_INT(1, errs.count);
    CHECK_EQ_INT(HMIP_ERR_RESYNC, errs.errs[0]);
    CHECK_EQ_INT(4, errs.dropped[0]);

    /* 追加有效帧：先跳过残留的 "age"，再解析出帧 */
    errs.count = 0;
    CHECK_EQ_INT(HMIP_OK, hmip_feed(&decoder, dev_tx.buf, dev_tx.len));
    CHECK_EQ_INT(1, errs.count);
    CHECK_EQ_INT(HMIP_ERR_RESYNC, errs.errs[0]);
    CHECK_EQ_INT(3, errs.dropped[0]);
    CHECK_EQ_INT(1, cap.count);
    CHECK_EQ_U32(9, cap.frames[0].seq);
}

static void test_decode_bad_version(void)
{
    dev_init();
    tx_reset(&dev_tx);
    static const uint8_t payload[] = { 1 };
    hmip_send_frame(&dev, 0x40, 0, 1, 1, payload, sizeof(payload));
    /* 先保存坏帧，再篡改版本字节（后续发送会覆盖 dev_tx 缓冲） */
    static uint8_t stream[256];
    size_t bad_len = dev_tx.len;
    memcpy(stream, dev_tx.buf, bad_len);
    stream[4] = 2;

    /* 追加一条好帧 */
    tx_reset(&dev_tx);
    static const uint8_t good_payload[] = { 2 };
    hmip_send_frame(&dev, 0x40, 0, 1, 2, good_payload, sizeof(good_payload));
    memcpy(stream + bad_len, dev_tx.buf, dev_tx.len);
    size_t stream_len = bad_len + dev_tx.len;

    frame_capture_t cap;
    frame_capture_reset(&cap);
    err_capture_t errs;
    memset(&errs, 0, sizeof(errs));
    g_err_target = &errs;
    hmip_config_t cfg;
    memset(&cfg, 0, sizeof(cfg));
    cfg.tx_write = tx_capture;
    cfg.tx_ctx = &dev_tx;
    cfg.rx_buf = rx_aux;
    cfg.rx_buf_size = sizeof(rx_aux);
    cfg.on_frame = on_frame_capture;
    cfg.on_decode_error = on_decode_error_capture;
    cfg.user = &cap;
    hmip_t decoder;
    hmip_init(&decoder, &cfg);

    hmip_feed(&decoder, stream, stream_len);
    CHECK(errs.count >= 1);
    CHECK_EQ_INT(HMIP_ERR_BAD_VERSION, errs.errs[0]);
    CHECK_EQ_INT(1, errs.dropped[0]);
    CHECK_EQ_INT(1, cap.count);
    CHECK_EQ_U32(2, cap.frames[0].seq);
}

static void test_decode_crc_mismatch(void)
{
    dev_init();
    tx_reset(&dev_tx);
    static const uint8_t payload[] = { 0xCA, 0xFE };
    hmip_send_frame(&dev, 0x40, HMIP_FLAG_CRC32, 1, 7, payload, sizeof(payload));
    /* 篡改 payload 最后一个字节 */
    dev_tx.buf[dev_tx.len - 1] ^= 0xFF;

    frame_capture_t cap;
    frame_capture_reset(&cap);
    err_capture_t errs;
    memset(&errs, 0, sizeof(errs));
    g_err_target = &errs;
    hmip_config_t cfg;
    memset(&cfg, 0, sizeof(cfg));
    cfg.tx_write = tx_capture;
    cfg.tx_ctx = &dev_tx;
    cfg.rx_buf = rx_aux;
    cfg.rx_buf_size = sizeof(rx_aux);
    cfg.on_frame = on_frame_capture;
    cfg.on_decode_error = on_decode_error_capture;
    cfg.user = &cap;
    hmip_t decoder;
    hmip_init(&decoder, &cfg);

    hmip_feed(&decoder, dev_tx.buf, dev_tx.len);
    CHECK(errs.count >= 1);
    CHECK_EQ_INT(HMIP_ERR_CRC, errs.errs[0]);
    CHECK_EQ_INT(0, cap.count); /* 坏帧不应被分发 */

    /* 之后好帧仍可正常解码 */
    tx_reset(&dev_tx);
    static const uint8_t ok[] = { 1 };
    hmip_send_frame(&dev, 0x40, 0, 1, 8, ok, sizeof(ok));
    errs.count = 0;
    CHECK_EQ_INT(HMIP_OK, hmip_feed(&decoder, dev_tx.buf, dev_tx.len));
    CHECK_EQ_INT(1, cap.count);
    CHECK_EQ_U32(8, cap.frames[0].seq);
}

static void test_decode_payload_too_large(void)
{
    /* 小接收缓冲：payload 长度超过缓冲容量时应报错并重对齐 */
    static uint8_t tiny_rx[64];
    frame_capture_t cap;
    frame_capture_reset(&cap);
    err_capture_t errs;
    memset(&errs, 0, sizeof(errs));
    g_err_target = &errs;
    hmip_config_t cfg;
    memset(&cfg, 0, sizeof(cfg));
    cfg.tx_write = tx_capture;
    cfg.tx_ctx = &dev_tx;
    cfg.rx_buf = tiny_rx;
    cfg.rx_buf_size = sizeof(tiny_rx);
    cfg.on_frame = on_frame_capture;
    cfg.on_decode_error = on_decode_error_capture;
    cfg.user = &cap;
    hmip_t decoder;
    hmip_init(&decoder, &cfg);

    /* 伪造头部：payload_len = 100（超出 64-16=48） */
    static uint8_t fake[20] = {
        0x48, 0x4D, 0x49, 0x50, 0x01, 0x40, 0x00, 0x01,
        0x01, 0x00, 0x00, 0x00, /* seq=1 */
        0x64, 0x00, 0x00, 0x00, /* payload_len=100 */
        0x00, 0x00, 0x00, 0x00
    };
    hmip_feed(&decoder, fake, sizeof(fake));
    CHECK(errs.count >= 1);
    CHECK_EQ_INT(HMIP_ERR_PAYLOAD_TOO_LARGE, errs.errs[0]);
    CHECK_EQ_INT(0, cap.count);

    /* 好帧仍可解码 */
    dev_init();
    tx_reset(&dev_tx);
    static const uint8_t ok[] = { 3 };
    hmip_send_frame(&dev, 0x40, 0, 1, 3, ok, sizeof(ok));
    errs.count = 0;
    CHECK_EQ_INT(HMIP_OK, hmip_feed(&decoder, dev_tx.buf, dev_tx.len));
    CHECK_EQ_INT(1, cap.count);
    CHECK_EQ_U32(3, cap.frames[0].seq);
}

static void test_decode_overflow(void)
{
    frame_capture_t cap;
    frame_capture_reset(&cap);
    err_capture_t errs;
    memset(&errs, 0, sizeof(errs));
    g_err_target = &errs;
    hmip_config_t cfg;
    memset(&cfg, 0, sizeof(cfg));
    cfg.tx_write = tx_capture;
    cfg.tx_ctx = &dev_tx;
    cfg.rx_buf = rx_small;
    cfg.rx_buf_size = sizeof(rx_small);
    cfg.on_frame = on_frame_capture;
    cfg.on_decode_error = on_decode_error_capture;
    cfg.user = &cap;
    hmip_t decoder;
    hmip_init(&decoder, &cfg);

    static uint8_t junk[40];
    memset(junk, 'x', sizeof(junk));
    CHECK_EQ_INT(HMIP_ERR_OVERFLOW, hmip_feed(&decoder, junk, sizeof(junk)));
    CHECK_EQ_INT(1, errs.count);
    CHECK_EQ_INT(HMIP_ERR_OVERFLOW, errs.errs[0]);
    CHECK_EQ_INT(0, errs.dropped[0]);

    /* 溢出恢复后好帧可解码 */
    dev_init();
    tx_reset(&dev_tx);
    static const uint8_t ok[] = { 4 };
    hmip_send_frame(&dev, 0x40, 0, 1, 4, ok, sizeof(ok));
    CHECK_EQ_INT(HMIP_OK, hmip_feed(&decoder, dev_tx.buf, dev_tx.len));
    CHECK_EQ_INT(1, cap.count);
    CHECK_EQ_U32(4, cap.frames[0].seq);
}

/* ==================== 4. 标准消息类型化回调 ==================== */

static void test_typed_messages(void)
{
    dev_init();
    dev.cfg.name = "stm32-scale";
    dev.cfg.role = HMIP_ROLE_SERVER;
    dev.cfg.capabilities = 0xAABBCCDDu;

    typed_ctx_t ctx;
    memset(&ctx, 0, sizeof(ctx));

    hmip_config_t cfg;
    memset(&cfg, 0, sizeof(cfg));
    cfg.tx_write = tx_capture;
    cfg.tx_ctx = &dev_tx;
    cfg.rx_buf = rx_aux;
    cfg.rx_buf_size = sizeof(rx_aux);
    cfg.on_hello = on_hello_capture;
    cfg.on_heartbeat = on_heartbeat_capture;
    cfg.on_request = on_request_capture;
    cfg.on_response = on_response_capture;
    cfg.on_event = on_event_capture;
    cfg.on_error = on_error_capture;
    cfg.user = &ctx;
    hmip_t decoder;
    hmip_init(&decoder, &cfg);

    /* HELLO */
    tx_reset(&dev_tx);
    hmip_send_hello(&dev);
    hmip_feed(&decoder, dev_tx.buf, dev_tx.len);
    CHECK_EQ_INT(1, ctx.hello.called);
    CHECK_EQ_INT(HMIP_ROLE_SERVER, ctx.hello.role);
    CHECK_EQ_U32(0xAABBCCDDu, ctx.hello.capabilities);
    CHECK_EQ_INT(0, strcmp(ctx.hello.name, "stm32-scale"));
    CHECK_EQ_INT(11, ctx.hello.name_len);

    /* HEARTBEAT */
    tx_reset(&dev_tx);
    hmip_send_heartbeat(&dev, 0x0102030405060708ULL);
    hmip_feed(&decoder, dev_tx.buf, dev_tx.len);
    CHECK_EQ_INT(1, ctx.hb.called);
    CHECK_EQ_U32(0x01020304u, (uint32_t)(ctx.hb.timestamp_ms >> 32));
    CHECK_EQ_U32(0x05060708u, (uint32_t)ctx.hb.timestamp_ms);

    /* REQUEST */
    tx_reset(&dev_tx);
    static const uint8_t req_body[] = { 'a', 'b', 'c' };
    hmip_send_request(&dev, 2, 0x12345678u, 0x0040, req_body, 3);
    hmip_feed(&decoder, dev_tx.buf, dev_tx.len);
    CHECK_EQ_INT(1, ctx.req.called);
    CHECK_EQ_U32(0x12345678u, ctx.req.request_id);
    CHECK_EQ_INT(0x0040, ctx.req.method);
    CHECK_EQ_INT(3, ctx.req.body_len);
    CHECK(bytes_eq(ctx.req.body, req_body, 3));

    /* RESPONSE */
    tx_reset(&dev_tx);
    static const uint8_t resp_body[] = { 'x', 'y' };
    hmip_send_response(&dev, 3, 7, 9, 5, resp_body, 2);
    hmip_feed(&decoder, dev_tx.buf, dev_tx.len);
    CHECK_EQ_INT(1, ctx.resp.called);
    CHECK_EQ_U32(9, ctx.resp.request_id);
    CHECK_EQ_INT(5, ctx.resp.status);
    CHECK_EQ_INT(2, ctx.resp.body_len);
    CHECK(bytes_eq(ctx.resp.body, resp_body, 2));
    CHECK_EQ_INT(3, ctx.resp.channel);
    CHECK_EQ_U32(7, ctx.resp.seq);

    /* EVENT */
    tx_reset(&dev_tx);
    static const uint8_t ev_body[] = { 'z' };
    hmip_send_event(&dev, 4, 0x1234, 99, ev_body, 1);
    hmip_feed(&decoder, dev_tx.buf, dev_tx.len);
    CHECK_EQ_INT(1, ctx.ev.called);
    CHECK_EQ_INT(0x1234, ctx.ev.event_id);
    CHECK_EQ_U32(99, (uint32_t)ctx.ev.timestamp_ms);
    CHECK_EQ_INT(1, ctx.ev.body_len);
    CHECK_EQ_INT('z', ctx.ev.body[0]);

    /* ERROR */
    tx_reset(&dev_tx);
    hmip_send_error(&dev, 5, 3, "boom");
    hmip_feed(&decoder, dev_tx.buf, dev_tx.len);
    CHECK_EQ_INT(1, ctx.err_msg.called);
    CHECK_EQ_INT(3, ctx.err_msg.code);
    CHECK_EQ_INT(0, strcmp(ctx.err_msg.message, "boom"));
    CHECK_EQ_INT(4, ctx.err_msg.message_len);
}

/* ==================== 5. 应答便捷函数 ==================== */

static void test_ack(void)
{
    /* 设备收到动作帧后在 on_frame 回调里直接 ack */
    dev_init();
    frame_capture_t cap;
    frame_capture_reset(&cap);
    typed_ctx_t ctx;
    memset(&ctx, 0, sizeof(ctx));

    /* 解码器（HMI 侧视角） */
    hmip_config_t cfg;
    memset(&cfg, 0, sizeof(cfg));
    cfg.tx_write = tx_capture;
    cfg.tx_ctx = &dev_tx;
    cfg.rx_buf = rx_aux;
    cfg.rx_buf_size = sizeof(rx_aux);
    cfg.on_response = on_response_capture;
    cfg.user = &ctx;
    hmip_t decoder;
    hmip_init(&decoder, &cfg);

    /* 设备视角：收到帧立即 ack（tx 走 dev_tx） */
    static uint8_t ack_buf[64];
    static hmip_t ack_dev;
    hmip_config_t acfg;
    memset(&acfg, 0, sizeof(acfg));
    acfg.tx_write = tx_capture;
    acfg.tx_ctx = &dev_tx;
    acfg.rx_buf = ack_buf;
    acfg.rx_buf_size = sizeof(ack_buf);
    CHECK_EQ_INT(HMIP_OK, hmip_init(&ack_dev, &acfg));

    /* 手动构造 HMI 下发的动作帧喂给设备 */
    tx_reset(&dev_tx);
    static const uint8_t payload[] = { 0x01, 0x01 };
    hmip_send_frame(&dev, 0x40, 0, 1, 42, payload, sizeof(payload));
    static uint8_t action_frame[32];
    size_t action_len = dev_tx.len;
    memcpy(action_frame, dev_tx.buf, action_len);

    /* 先解析出帧视图，再调用 hmip_ack_ok 应答（等价于业务在回调里应答） */
    {
        hmip_t probe;
        frame_capture_t probe_cap;
        frame_capture_reset(&probe_cap);
        hmip_config_t pcfg;
        memset(&pcfg, 0, sizeof(pcfg));
        pcfg.tx_write = tx_capture;
        pcfg.tx_ctx = &dev_tx;
        pcfg.rx_buf = rx_small;
        pcfg.rx_buf_size = sizeof(rx_small);
        pcfg.on_frame = on_frame_capture;
        pcfg.user = &probe_cap;
        hmip_init(&probe, &pcfg);
        hmip_feed(&probe, action_frame, action_len);
        CHECK_EQ_INT(1, probe_cap.count);

        /* 设备应答（tx 捕获到 dev_tx） */
        tx_reset(&dev_tx);
        CHECK_EQ_INT(HMIP_OK, hmip_ack_ok(&ack_dev, &probe_cap.frames[0]));
    }

    /* HMI 侧解码应答 */
    hmip_feed(&decoder, dev_tx.buf, dev_tx.len);
    CHECK_EQ_INT(1, ctx.resp.called);
    CHECK_EQ_INT(0, ctx.resp.status);
    CHECK_EQ_INT(1, ctx.resp.channel);   /* channel 回显 */
    CHECK_EQ_U32(42, ctx.resp.seq);      /* 帧头 seq 回显 */
    CHECK_EQ_U32(42, ctx.resp.request_id); /* payload request_id = 请求 seq */
    (void)cap;
}

static hmip_t *g_ack_dev;
static tx_capture_t *g_ack_tx;

static void on_action_ack(hmip_t *h, const hmip_frame_t *f, void *user)
{
    (void)h;
    (void)user;
    hmip_ack_ok(g_ack_dev, f);
}

static void test_ack_in_callback(void)
{
    /* 完整回调链路：设备实例 on_frame 内调用 hmip_ack_ok */
    static uint8_t dev_rx[64];
    static hmip_t dev_inst;
    static tx_capture_t dev_out;
    tx_reset(&dev_out);

    hmip_config_t dcfg;
    memset(&dcfg, 0, sizeof(dcfg));
    dcfg.tx_write = tx_capture;
    dcfg.tx_ctx = &dev_out;
    dcfg.rx_buf = dev_rx;
    dcfg.rx_buf_size = sizeof(dev_rx);
    dcfg.on_frame = on_action_ack;
    hmip_init(&dev_inst, &dcfg);
    g_ack_dev = &dev_inst;
    g_ack_tx = &dev_out;

    /* HMI 下发动作帧 */
    dev_init();
    tx_reset(&dev_tx);
    static const uint8_t payload[] = { 0x01, 0x01 };
    hmip_send_frame(&dev, 0x40, 0, 2, 55, payload, sizeof(payload));

    CHECK_EQ_INT(HMIP_OK, hmip_feed(&dev_inst, dev_tx.buf, dev_tx.len));

    /* 解码设备发出的应答 */
    typed_ctx_t ctx;
    memset(&ctx, 0, sizeof(ctx));
    hmip_config_t rcfg;
    memset(&rcfg, 0, sizeof(rcfg));
    rcfg.tx_write = tx_capture;
    rcfg.tx_ctx = &dev_tx;
    rcfg.rx_buf = rx_aux;
    rcfg.rx_buf_size = sizeof(rx_aux);
    rcfg.on_response = on_response_capture;
    rcfg.user = &ctx;
    hmip_t rdec;
    hmip_init(&rdec, &rcfg);
    hmip_feed(&rdec, dev_out.buf, dev_out.len);

    CHECK_EQ_INT(1, ctx.resp.called);
    CHECK_EQ_INT(0, ctx.resp.status);
    CHECK_EQ_INT(2, ctx.resp.channel);
    CHECK_EQ_U32(55, ctx.resp.seq);
    CHECK_EQ_U32(55, ctx.resp.request_id);
}

/* ==================== 6. 随机压力测试 ==================== */

static uint32_t xorshift32(uint32_t *state)
{
    uint32_t x = *state;
    x ^= x << 13;
    x ^= x >> 17;
    x ^= x << 5;
    *state = x;
    return x;
}

static void test_stress_random(void)
{
    dev_init();
    frame_capture_t cap;
    frame_capture_reset(&cap);
    err_capture_t errs;
    memset(&errs, 0, sizeof(errs));
    g_err_target = &errs;

    hmip_config_t cfg;
    memset(&cfg, 0, sizeof(cfg));
    cfg.tx_write = tx_capture;
    cfg.tx_ctx = &dev_tx;
    cfg.rx_buf = rx_aux;
    cfg.rx_buf_size = sizeof(rx_aux);
    cfg.on_frame = on_frame_capture;
    cfg.on_decode_error = on_decode_error_capture;
    cfg.user = &cap;
    hmip_t decoder;
    hmip_init(&decoder, &cfg);

    uint32_t rng = 0x12345678u;
    for (int iter = 0; iter < 500; iter++) {
        uint8_t msg_type = (uint8_t)(0x40 + (xorshift32(&rng) % 0x20));
        uint8_t channel = (uint8_t)(xorshift32(&rng) % 5);
        uint32_t seq = xorshift32(&rng);
        size_t plen = xorshift32(&rng) % 49; /* 0..48 */
        uint8_t flags = (xorshift32(&rng) & 1) ? HMIP_FLAG_CRC32 : 0;

        static uint8_t payload[64];
        for (size_t i = 0; i < plen; i++) {
            payload[i] = (uint8_t)(xorshift32(&rng) & 0xFF);
        }

        tx_reset(&dev_tx);
        CHECK_EQ_INT(HMIP_OK, hmip_send_frame(&dev, msg_type, flags, channel,
                                              seq, payload, plen));
        size_t frame_len = dev_tx.len;

        /* 随机分片喂入（1..16 字节/片） */
        size_t pos = 0;
        frame_capture_reset(&cap);
        while (pos < frame_len) {
            size_t chunk = 1 + (xorshift32(&rng) % 16);
            if (chunk > frame_len - pos) {
                chunk = frame_len - pos;
            }
            int rc = hmip_feed(&decoder, dev_tx.buf + pos, chunk);
            CHECK(rc == HMIP_OK || rc == HMIP_ERR_RESYNC);
            pos += chunk;
        }

        CHECK_EQ_INT(1, cap.count);
        CHECK_EQ_INT(msg_type, cap.frames[0].msg_type);
        CHECK_EQ_INT(channel, cap.frames[0].channel);
        CHECK_EQ_U32(seq, cap.frames[0].seq);
        CHECK_EQ_INT(flags, cap.frames[0].flags);
        CHECK_EQ_INT(plen, cap.frames[0].payload_len);
        CHECK(bytes_eq(cap.frames[0].payload, payload, plen));
    }
    (void)errs;
}

/* ==================== 7. 端到端业务回环 ==================== */

typedef struct {
    uint8_t buf[1024];
    size_t len;
} pipe_t;

static int pipe_write(const uint8_t *data, size_t len, void *ctx)
{
    pipe_t *p = (pipe_t *)ctx;
    if (p->len + len > sizeof(p->buf)) {
        return -1;
    }
    memcpy(p->buf + p->len, data, len);
    p->len += len;
    return 0;
}

static void pump(pipe_t *p, hmip_t *dst)
{
    if (p->len == 0) {
        return;
    }
    hmip_feed(dst, p->buf, p->len);
    p->len = 0;
}

static void test_end_to_end_business(void)
{
    /* 设备侧：业务模块 + 回环管道 */
    static uint8_t dev_rx[256];
    static hmip_t device;
    static pipe_t dev_to_hmi; /* 设备 → HMI */
    memset(&dev_to_hmi, 0, sizeof(dev_to_hmi));

    hmip_config_t dcfg;
    memset(&dcfg, 0, sizeof(dcfg));
    dcfg.tx_write = pipe_write;
    dcfg.tx_ctx = &dev_to_hmi;
    dcfg.rx_buf = dev_rx;
    dcfg.rx_buf_size = sizeof(dev_rx);
    dcfg.channel = 1;
    dcfg.role = HMIP_ROLE_SERVER;
    dcfg.capabilities = 0x1;
    dcfg.name = "dilution-machine";
    device_business_setup(&dcfg);
    CHECK_EQ_INT(HMIP_OK, hmip_init(&device, &dcfg));

    /* HMI 侧 */
    static uint8_t hmi_rx[256];
    static hmip_t hmi_side;
    static pipe_t hmi_to_dev; /* HMI → 设备 */
    memset(&hmi_to_dev, 0, sizeof(hmi_to_dev));

    typed_ctx_t ctx;
    memset(&ctx, 0, sizeof(ctx));

    hmip_config_t hcfg;
    memset(&hcfg, 0, sizeof(hcfg));
    hcfg.tx_write = pipe_write;
    hcfg.tx_ctx = &hmi_to_dev;
    hcfg.rx_buf = hmi_rx;
    hcfg.rx_buf_size = sizeof(hmi_rx);
    hcfg.on_response = on_response_capture;
    hcfg.on_event = on_event_capture;
    hcfg.on_heartbeat = on_heartbeat_capture;
    hcfg.on_hello = on_hello_capture;
    hcfg.user = &ctx;
    CHECK_EQ_INT(HMIP_OK, hmip_init(&hmi_side, &hcfg));

    /* 1. 设备上电：发 HELLO + HEARTBEAT */
    CHECK_EQ_INT(HMIP_OK, hmip_send_hello(&device));
    pump(&dev_to_hmi, &hmi_side);
    CHECK_EQ_INT(1, ctx.hello.called);
    CHECK_EQ_INT(HMIP_ROLE_SERVER, ctx.hello.role);
    CHECK_EQ_INT(0, strcmp(ctx.hello.name, "dilution-machine"));

    CHECK_EQ_INT(HMIP_OK, hmip_send_heartbeat(&device, 123456u));
    pump(&dev_to_hmi, &hmi_side);
    CHECK_EQ_INT(1, ctx.hb.called);
    CHECK_EQ_U32(123456u, (uint32_t)ctx.hb.timestamp_ms);

    /* 2. HMI 下发称量动作 0x40（channel=1），设备应回 RESPONSE + 重量 body */
    memset(&ctx.resp, 0, sizeof(ctx.resp));
    static const uint8_t weigh_payload[] = { 0x01, 0x01 };
    CHECK_EQ_INT(HMIP_OK, hmip_send_frame(&hmi_side, 0x40, 0, 1, 0,
                                          weigh_payload, sizeof(weigh_payload)));
    pump(&hmi_to_dev, &device);
    pump(&dev_to_hmi, &hmi_side);

    CHECK_EQ_INT(1, ctx.resp.called);
    CHECK_EQ_INT(0, ctx.resp.status);
    CHECK_EQ_INT(4, ctx.resp.body_len); /* float32 重量 */
    CHECK_EQ_INT(1, ctx.resp.channel);
    /* 第二次称量：重量应不同（业务计数递增） */
    memset(&ctx.resp, 0, sizeof(ctx.resp));
    hmip_send_frame(&hmi_side, 0x40, 0, 1, 0, weigh_payload, sizeof(weigh_payload));
    pump(&hmi_to_dev, &device);
    pump(&dev_to_hmi, &hmi_side);
    CHECK_EQ_INT(1, ctx.resp.called);
    CHECK_EQ_INT(4, ctx.resp.body_len);
    {
        float w = 0;
        memcpy(&w, ctx.resp.body, sizeof(w));
        CHECK(w > 12.0f && w < 25.0f); /* 12.34 * 计数 */
    }

    /* 3. 搅拌 0x41：空 body 成功应答 */
    memset(&ctx.resp, 0, sizeof(ctx.resp));
    static const uint8_t mix_payload[] = { 0x02, 0x02 };
    hmip_send_frame(&hmi_side, 0x41, 0, 2, 0, mix_payload, sizeof(mix_payload));
    pump(&hmi_to_dev, &device);
    pump(&dev_to_hmi, &hmi_side);
    CHECK_EQ_INT(1, ctx.resp.called);
    CHECK_EQ_INT(0, ctx.resp.status);
    CHECK_EQ_INT(0, ctx.resp.body_len);
    CHECK_EQ_INT(2, ctx.resp.channel);

    /* 4. 测粘度 0x42：body 为 float32 粘度 */
    memset(&ctx.resp, 0, sizeof(ctx.resp));
    static const uint8_t visc_payload[] = { 0x03, 0x03 };
    hmip_send_frame(&hmi_side, 0x42, 0, 3, 0, visc_payload, sizeof(visc_payload));
    pump(&hmi_to_dev, &device);
    pump(&dev_to_hmi, &hmi_side);
    CHECK_EQ_INT(1, ctx.resp.called);
    CHECK_EQ_INT(0, ctx.resp.status);
    CHECK_EQ_INT(4, ctx.resp.body_len);
    {
        float v = 0;
        memcpy(&v, ctx.resp.body, sizeof(v));
        CHECK(v > 5.0f && v < 6.0f);
    }

    /* 5. REQUEST ping：method=1 → 设备回 PONG */
    memset(&ctx.resp, 0, sizeof(ctx.resp));
    CHECK_EQ_INT(HMIP_OK, hmip_send_request(&hmi_side, 1, 777u, 1, NULL, 0));
    pump(&hmi_to_dev, &device);
    pump(&dev_to_hmi, &hmi_side);
    CHECK_EQ_INT(1, ctx.resp.called);
    CHECK_EQ_U32(777u, ctx.resp.request_id);
    CHECK_EQ_INT(4, ctx.resp.body_len);
    CHECK(bytes_eq(ctx.resp.body, (const uint8_t *)"PONG", 4));

    /* 6. 设备主动 EVENT 上报（业务可调用） */
    CHECK_EQ_INT(HMIP_OK, hmip_send_event(&device, 1, 0x0009, 987654u,
                                          (const uint8_t *)"alarm", 5));
    pump(&dev_to_hmi, &hmi_side);
    CHECK_EQ_INT(1, ctx.ev.called);
    CHECK_EQ_INT(0x0009, ctx.ev.event_id);
    CHECK_EQ_U32(987654u, (uint32_t)ctx.ev.timestamp_ms);
    CHECK_EQ_INT(5, ctx.ev.body_len);
    CHECK(bytes_eq(ctx.ev.body, (const uint8_t *)"alarm", 5));
}

/* ==================== 8. 手工字节级帧（绕过编码器验证解码器） ==================== */

static void test_hand_assembled_response(void)
{
    /* 直接使用接口文档 §8.1 示例 2 的线上字节，防止编解码对称性 bug */
    static const uint8_t wire[] = {
        0x48, 0x4D, 0x49, 0x50, 0x01, 0x11, 0x00, 0x01, 0x2B, 0x00, 0x00, 0x00,
        0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00
    };
    typed_ctx_t ctx;
    memset(&ctx, 0, sizeof(ctx));
    hmip_config_t cfg;
    memset(&cfg, 0, sizeof(cfg));
    cfg.tx_write = tx_capture;
    cfg.tx_ctx = &dev_tx;
    cfg.rx_buf = rx_aux;
    cfg.rx_buf_size = sizeof(rx_aux);
    cfg.on_response = on_response_capture;
    cfg.user = &ctx;
    hmip_t decoder;
    hmip_init(&decoder, &cfg);
    CHECK_EQ_INT(HMIP_OK, hmip_feed(&decoder, wire, sizeof(wire)));
    CHECK_EQ_INT(1, ctx.resp.called);
    CHECK_EQ_U32(0, ctx.resp.request_id);
    CHECK_EQ_INT(0, ctx.resp.status);
    CHECK_EQ_INT(1, ctx.resp.channel);
    CHECK_EQ_U32(43, ctx.resp.seq);
    CHECK_EQ_INT(0, ctx.resp.body_len);
}

static void test_hand_assembled_hello(void)
{
    /* HELLO: role=server(1), capabilities=0x11223344, name="ab" */
    static const uint8_t wire[] = {
        0x48, 0x4D, 0x49, 0x50, 0x01, 0x01, 0x00, 0x05,
        0x07, 0x00, 0x00, 0x00, /* seq=7 */
        0x08, 0x00, 0x00, 0x00, /* payload_len=8 */
        0x01,                   /* role */
        0x44, 0x33, 0x22, 0x11, /* capabilities LE */
        0x02, 'a', 'b'          /* name_len + name */
    };
    typed_ctx_t ctx;
    memset(&ctx, 0, sizeof(ctx));
    hmip_config_t cfg;
    memset(&cfg, 0, sizeof(cfg));
    cfg.tx_write = tx_capture;
    cfg.tx_ctx = &dev_tx;
    cfg.rx_buf = rx_aux;
    cfg.rx_buf_size = sizeof(rx_aux);
    cfg.on_hello = on_hello_capture;
    cfg.user = &ctx;
    hmip_t decoder;
    hmip_init(&decoder, &cfg);
    CHECK_EQ_INT(HMIP_OK, hmip_feed(&decoder, wire, sizeof(wire)));
    CHECK_EQ_INT(1, ctx.hello.called);
    CHECK_EQ_INT(HMIP_ROLE_SERVER, ctx.hello.role);
    CHECK_EQ_U32(0x11223344u, ctx.hello.capabilities);
    CHECK_EQ_INT(2, ctx.hello.name_len);
    CHECK_EQ_INT(0, strcmp(ctx.hello.name, "ab"));
}

/* ==================== 9. 空 payload 与 CRC ==================== */

static void test_empty_payload(void)
{
    dev_init();

    static uint8_t stream[64];
    size_t total = 0;

    /* 无 CRC 空帧：16 字节 */
    tx_reset(&dev_tx);
    CHECK_EQ_INT(HMIP_OK, hmip_send_frame(&dev, 0x40, 0, 1, 10, NULL, 0));
    CHECK_EQ_INT(16, dev_tx.len);
    memcpy(stream + total, dev_tx.buf, dev_tx.len);
    total += dev_tx.len;

    /* 带 CRC 空帧：20 字节，CRC32(空)=0 */
    tx_reset(&dev_tx);
    CHECK_EQ_INT(HMIP_OK, hmip_send_frame(&dev, 0x40, HMIP_FLAG_CRC32, 1, 11,
                                          NULL, 0));
    CHECK_EQ_INT(20, dev_tx.len);
    CHECK_EQ_INT(0x00, dev_tx.buf[16]);
    CHECK_EQ_INT(0x00, dev_tx.buf[17]);
    CHECK_EQ_INT(0x00, dev_tx.buf[18]);
    CHECK_EQ_INT(0x00, dev_tx.buf[19]);
    memcpy(stream + total, dev_tx.buf, dev_tx.len);
    total += dev_tx.len;

    /* 解码两个空帧 */
    frame_capture_t cap;
    frame_capture_reset(&cap);
    hmip_config_t cfg;
    memset(&cfg, 0, sizeof(cfg));
    cfg.tx_write = tx_capture;
    cfg.tx_ctx = &dev_tx;
    cfg.rx_buf = rx_aux;
    cfg.rx_buf_size = sizeof(rx_aux);
    cfg.on_frame = on_frame_capture;
    cfg.user = &cap;
    hmip_t decoder;
    hmip_init(&decoder, &cfg);
    CHECK_EQ_INT(HMIP_OK, hmip_feed(&decoder, stream, total));
    CHECK_EQ_INT(2, cap.count);
    CHECK_EQ_INT(0, cap.frames[0].payload_len);
    CHECK_EQ_INT(0, cap.frames[1].payload_len);
    CHECK_EQ_U32(10, cap.frames[0].seq);
    CHECK_EQ_U32(11, cap.frames[1].seq);
}

/* ==================== 10. payload 容量边界 ==================== */

static void test_payload_capacity_boundary(void)
{
    dev_init();
    static uint8_t payload[241];
    memset(payload, 0xAB, sizeof(payload));

    frame_capture_t cap;
    frame_capture_reset(&cap);
    err_capture_t errs;
    memset(&errs, 0, sizeof(errs));
    g_err_target = &errs;
    hmip_config_t cfg;
    memset(&cfg, 0, sizeof(cfg));
    cfg.tx_write = tx_capture;
    cfg.tx_ctx = &dev_tx;
    cfg.rx_buf = rx_aux; /* 256 字节 */
    cfg.rx_buf_size = sizeof(rx_aux);
    cfg.on_frame = on_frame_capture;
    cfg.on_decode_error = on_decode_error_capture;
    cfg.user = &cap;
    hmip_t decoder;
    hmip_init(&decoder, &cfg);

    /* 无 CRC 头部 16 字节：payload=240 恰好放得下 */
    tx_reset(&dev_tx);
    CHECK_EQ_INT(HMIP_OK, hmip_send_frame(&dev, 0x40, 0, 1, 1, payload, 240));
    CHECK_EQ_INT(HMIP_OK, hmip_feed(&decoder, dev_tx.buf, dev_tx.len));
    CHECK_EQ_INT(1, cap.count);
    CHECK_EQ_INT(240, cap.frames[0].payload_len);

    /* payload=241 超限：分片喂入，先触发 PAYLOAD_TOO_LARGE 而不是 feed 溢出 */
    frame_capture_reset(&cap);
    errs.count = 0;
    tx_reset(&dev_tx);
    CHECK_EQ_INT(HMIP_OK, hmip_send_frame(&dev, 0x40, 0, 1, 2, payload, 241));
    size_t total = dev_tx.len;
    CHECK_EQ_INT(HMIP_ERR_RESYNC, hmip_feed(&decoder, dev_tx.buf, 100));
    CHECK(errs.count >= 1);
    CHECK_EQ_INT(HMIP_ERR_PAYLOAD_TOO_LARGE, errs.errs[0]);
    CHECK_EQ_INT(0, cap.count);
    hmip_feed(&decoder, dev_tx.buf + 100, total - 100);
    CHECK_EQ_INT(0, cap.count);
}

/* ==================== 11. magic 跨包 ==================== */

static void test_magic_split_across_feeds(void)
{
    dev_init();
    tx_reset(&dev_tx);
    static const uint8_t payload[] = { 7 };
    hmip_send_frame(&dev, 0x40, 0, 1, 21, payload, sizeof(payload));
    static uint8_t frame[32];
    size_t frame_len = dev_tx.len;
    memcpy(frame, dev_tx.buf, frame_len);

    frame_capture_t cap;
    frame_capture_reset(&cap);
    err_capture_t errs;
    memset(&errs, 0, sizeof(errs));
    g_err_target = &errs;
    hmip_config_t cfg;
    memset(&cfg, 0, sizeof(cfg));
    cfg.tx_write = tx_capture;
    cfg.tx_ctx = &dev_tx;
    cfg.rx_buf = rx_aux;
    cfg.rx_buf_size = sizeof(rx_aux);
    cfg.on_frame = on_frame_capture;
    cfg.on_decode_error = on_decode_error_capture;
    cfg.user = &cap;
    hmip_t decoder;
    hmip_init(&decoder, &cfg);

    /* 先喂 "xxHM"：无完整 magic → 保留最后 3 字节 */
    CHECK_EQ_INT(HMIP_ERR_RESYNC, hmip_feed(&decoder, (const uint8_t *)"xxHM", 4));
    CHECK_EQ_INT(0, cap.count);
    /* 再喂 "IP"：补全 magic（跳过 1 字节噪声后对齐），但头部不足 → 等待 */
    CHECK_EQ_INT(HMIP_ERR_RESYNC, hmip_feed(&decoder, (const uint8_t *)"IP", 2));
    CHECK_EQ_INT(0, cap.count);
    /* 喂完整帧其余部分 */
    CHECK_EQ_INT(HMIP_OK, hmip_feed(&decoder, frame, frame_len));
    CHECK_EQ_INT(1, cap.count);
    CHECK_EQ_U32(21, cap.frames[0].seq);
}

/* ==================== 12. 帧间噪声 ==================== */

static void test_garbage_between_frames(void)
{
    dev_init();
    static uint8_t stream[128];
    static const uint8_t p1[] = { 1 };
    static const uint8_t p2[] = { 2 };

    tx_reset(&dev_tx);
    hmip_send_frame(&dev, 0x40, 0, 1, 31, p1, sizeof(p1));
    size_t len1 = dev_tx.len;
    memcpy(stream, dev_tx.buf, len1);

    tx_reset(&dev_tx);
    hmip_send_frame(&dev, 0x40, 0, 1, 32, p2, sizeof(p2));
    size_t len2 = dev_tx.len;

    size_t pos = len1;
    memcpy(stream + pos, "zzzzz", 5); /* 帧间噪声 */
    pos += 5;
    memcpy(stream + pos, dev_tx.buf, len2);
    pos += len2;

    frame_capture_t cap;
    frame_capture_reset(&cap);
    err_capture_t errs;
    memset(&errs, 0, sizeof(errs));
    g_err_target = &errs;
    hmip_config_t cfg;
    memset(&cfg, 0, sizeof(cfg));
    cfg.tx_write = tx_capture;
    cfg.tx_ctx = &dev_tx;
    cfg.rx_buf = rx_aux;
    cfg.rx_buf_size = sizeof(rx_aux);
    cfg.on_frame = on_frame_capture;
    cfg.on_decode_error = on_decode_error_capture;
    cfg.user = &cap;
    hmip_t decoder;
    hmip_init(&decoder, &cfg);

    CHECK_EQ_INT(HMIP_OK, hmip_feed(&decoder, stream, pos));
    CHECK_EQ_INT(2, cap.count);
    CHECK_EQ_U32(31, cap.frames[0].seq);
    CHECK_EQ_U32(32, cap.frames[1].seq);
    CHECK(errs.count >= 1);
    CHECK_EQ_INT(HMIP_ERR_RESYNC, errs.errs[0]);
    CHECK_EQ_INT(5, errs.dropped[0]);
}

/* ==================== 13. payload 内嵌 magic 字节 ==================== */

static void test_payload_containing_magic(void)
{
    dev_init();
    tx_reset(&dev_tx);
    static const uint8_t p1[] = { 'A', 'B', 'H', 'M', 'I', 'P', 'C', 'D' };
    static const uint8_t p2[] = { 'X', 'Y' };
    hmip_send_frame(&dev, 0x40, 0, 1, 41, p1, sizeof(p1));
    hmip_send_frame(&dev, 0x41, 0, 1, 42, p2, sizeof(p2));

    frame_capture_t cap;
    frame_capture_reset(&cap);
    hmip_config_t cfg;
    memset(&cfg, 0, sizeof(cfg));
    cfg.tx_write = tx_capture;
    cfg.tx_ctx = &dev_tx;
    cfg.rx_buf = rx_aux;
    cfg.rx_buf_size = sizeof(rx_aux);
    cfg.on_frame = on_frame_capture;
    cfg.user = &cap;
    hmip_t decoder;
    hmip_init(&decoder, &cfg);

    CHECK_EQ_INT(HMIP_OK, hmip_feed(&decoder, dev_tx.buf, dev_tx.len));
    CHECK_EQ_INT(2, cap.count);
    CHECK_EQ_INT(sizeof(p1), cap.frames[0].payload_len);
    CHECK(bytes_eq(cap.frames[0].payload, p1, sizeof(p1)));
    CHECK_EQ_INT(sizeof(p2), cap.frames[1].payload_len);
    CHECK(bytes_eq(cap.frames[1].payload, p2, sizeof(p2)));
}

/* ==================== 14. 畸形标准消息（类型化回调不应触发） ==================== */

static void test_malformed_typed_messages(void)
{
    dev_init();
    typed_ctx_t ctx;
    memset(&ctx, 0, sizeof(ctx));
    frame_capture_t cap;
    frame_capture_reset(&cap);

    hmip_config_t cfg;
    memset(&cfg, 0, sizeof(cfg));
    cfg.tx_write = tx_capture;
    cfg.tx_ctx = &dev_tx;
    cfg.rx_buf = rx_aux;
    cfg.rx_buf_size = sizeof(rx_aux);
    cfg.on_frame = on_frame_capture;
    cfg.on_hello = on_hello_capture;
    cfg.on_heartbeat = on_heartbeat_capture;
    cfg.on_request = on_request_capture;
    cfg.on_response = on_response_capture;
    cfg.on_event = on_event_capture;
    cfg.on_error = on_error_capture;
    cfg.user = &cap; /* 帧回调用它；本用例全部为畸形消息，类型化回调不应被触发 */
    hmip_t decoder;
    hmip_init(&decoder, &cfg);

    struct {
        uint8_t mt;
        const uint8_t payload[12];
        size_t len;
    } cases[] = {
        { HMIP_MSG_HELLO,     { 0, 1, 2, 3, 4 }, 5 },                  /* <6 */
        { HMIP_MSG_HELLO,     { 1, 1, 2, 3, 4, 5, 'a', 'b', 'c' }, 9 },/* name 截断 */
        { HMIP_MSG_HELLO,     { 2, 1, 2, 3, 4, 0 }, 6 },               /* role 非法 */
        { HMIP_MSG_HELLO_ACK, { 0, 0, 0, 0 }, 4 },                     /* <5 */
        { HMIP_MSG_HEARTBEAT, { 0, 0, 0, 0, 0, 0, 0 }, 7 },            /* !=8 */
        { HMIP_MSG_REQUEST,   { 1, 2, 3, 4, 5, 6, 7 }, 7 },            /* <8 */
        { HMIP_MSG_RESPONSE,  { 1, 2, 3 }, 3 },                        /* <8 */
        { HMIP_MSG_EVENT,     { 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11 }, 11 }, /* <12 */
        { HMIP_MSG_ERROR,     { 1, 2, 3, 4, 5 }, 5 },                  /* <6 */
        { HMIP_MSG_ERROR,     { 1, 2, 0, 0, 3, 0, 'x' }, 7 },          /* msg 截断 */
    };
    const size_t n_cases = sizeof(cases) / sizeof(cases[0]);

    for (size_t i = 0; i < n_cases; i++) {
        tx_reset(&dev_tx);
        CHECK_EQ_INT(HMIP_OK, hmip_send_frame(&dev, cases[i].mt, 0, 1,
                                              (uint32_t)(100 + i),
                                              cases[i].payload, cases[i].len));
        CHECK_EQ_INT(HMIP_OK, hmip_feed(&decoder, dev_tx.buf, dev_tx.len));
    }
    /* 原始帧回调每次都触发 */
    CHECK_EQ_INT(n_cases, cap.count);
    /* 类型化回调一次都不触发（畸形消息被跳过） */
    CHECK_EQ_INT(0, ctx.hello.called);
    CHECK_EQ_INT(0, ctx.hb.called);
    CHECK_EQ_INT(0, ctx.req.called);
    CHECK_EQ_INT(0, ctx.resp.called);
    CHECK_EQ_INT(0, ctx.ev.called);
    CHECK_EQ_INT(0, ctx.err_msg.called);
}

/* ==================== 15. seq 自动分配 ==================== */

static void test_seq_auto_assign(void)
{
    dev_init();
    static const uint8_t payload[] = { 1 };
    tx_reset(&dev_tx);
    CHECK_EQ_INT(HMIP_OK, hmip_send_frame(&dev, 0x40, 0, 1, 0, payload, 1)); /* seq=1 */
    CHECK_EQ_INT(HMIP_OK, hmip_send_frame(&dev, 0x40, 0, 1, 0, payload, 1)); /* seq=2 */
    CHECK_EQ_INT(HMIP_OK, hmip_send_frame(&dev, 0x40, 0, 1, 100, payload, 1)); /* 显式 100 */
    CHECK_EQ_INT(HMIP_OK, hmip_send_frame(&dev, 0x40, 0, 1, 0, payload, 1)); /* seq=3 */

    frame_capture_t cap;
    frame_capture_reset(&cap);
    hmip_config_t cfg;
    memset(&cfg, 0, sizeof(cfg));
    cfg.tx_write = tx_capture;
    cfg.tx_ctx = &dev_tx;
    cfg.rx_buf = rx_aux;
    cfg.rx_buf_size = sizeof(rx_aux);
    cfg.on_frame = on_frame_capture;
    cfg.user = &cap;
    hmip_t decoder;
    hmip_init(&decoder, &cfg);
    CHECK_EQ_INT(HMIP_OK, hmip_feed(&decoder, dev_tx.buf, dev_tx.len));
    CHECK_EQ_INT(4, cap.count);
    CHECK_EQ_U32(1, cap.frames[0].seq);
    CHECK_EQ_U32(2, cap.frames[1].seq);
    CHECK_EQ_U32(100, cap.frames[2].seq);
    CHECK_EQ_U32(3, cap.frames[3].seq);

    /* hmip_next_seq 直接调用 */
    CHECK_EQ_U32(4, hmip_next_seq(&dev));
    CHECK_EQ_U32(5, hmip_next_seq(&dev));
}

/* ==================== 16. tx 失败传播 ==================== */

static int tx_fail(const uint8_t *data, size_t len, void *ctx)
{
    (void)data;
    (void)len;
    (void)ctx;
    return -1;
}

static void test_tx_failure(void)
{
    static uint8_t rx_buf[64];
    static hmip_t d;
    hmip_config_t cfg;
    memset(&cfg, 0, sizeof(cfg));
    cfg.tx_write = tx_fail;
    cfg.tx_ctx = NULL;
    cfg.rx_buf = rx_buf;
    cfg.rx_buf_size = sizeof(rx_buf);
    cfg.channel = 1;
    cfg.name = "x";
    CHECK_EQ_INT(HMIP_OK, hmip_init(&d, &cfg));

    static const uint8_t payload[] = { 1, 2 };
    CHECK_EQ_INT(HMIP_ERR_TX, hmip_send_frame(&d, 0x40, 0, 1, 1, payload, 2));
    CHECK_EQ_INT(HMIP_ERR_TX, hmip_send_hello(&d));
    CHECK_EQ_INT(HMIP_ERR_TX, hmip_send_heartbeat(&d, 1));
    CHECK_EQ_INT(HMIP_ERR_TX, hmip_send_error(&d, 1, 1, "boom"));
}

/* ==================== 17. tx 分块写出 ==================== */

static void test_tx_chunk_calls(void)
{
    dev_init();

    /* send_frame：头部 + payload 共 2 次调用 */
    tx_reset(&dev_tx);
    static const uint8_t payload[] = { 1, 2, 3, 4, 5 };
    CHECK_EQ_INT(HMIP_OK, hmip_send_frame(&dev, 0x40, 0, 1, 1, payload, 5));
    CHECK_EQ_INT(2, dev_tx.calls);
    CHECK_EQ_INT(16 + 5, dev_tx.len);

    /* send_response 带 body：头部 + 定长字段 + body 共 3 次调用 */
    tx_reset(&dev_tx);
    static const uint8_t body[] = { 9, 8, 7 };
    CHECK_EQ_INT(HMIP_OK, hmip_send_response(&dev, 1, 9, 9, 0, body, 3));
    CHECK_EQ_INT(3, dev_tx.calls);
    CHECK_EQ_INT(16 + 8 + 3, dev_tx.len);

    /* 内容可被另一端解码 */
    typed_ctx_t ctx;
    memset(&ctx, 0, sizeof(ctx));
    hmip_config_t cfg;
    memset(&cfg, 0, sizeof(cfg));
    cfg.tx_write = tx_capture;
    cfg.tx_ctx = &dev_tx;
    cfg.rx_buf = rx_aux;
    cfg.rx_buf_size = sizeof(rx_aux);
    cfg.on_response = on_response_capture;
    cfg.user = &ctx;
    hmip_t decoder;
    hmip_init(&decoder, &cfg);
    CHECK_EQ_INT(HMIP_OK, hmip_feed(&decoder, dev_tx.buf, dev_tx.len));
    CHECK_EQ_INT(1, ctx.resp.called);
    CHECK_EQ_U32(9, ctx.resp.request_id);
    CHECK_EQ_INT(3, ctx.resp.body_len);
    CHECK(bytes_eq(ctx.resp.body, body, 3));
}

/* ==================== 18. 大 payload 往返 ==================== */

static void test_large_payload_roundtrip(void)
{
    dev_init();
    static uint8_t payload[200];
    for (size_t i = 0; i < sizeof(payload); i++) {
        payload[i] = (uint8_t)(i * 7 + 3);
    }

    tx_reset(&dev_tx);
    CHECK_EQ_INT(HMIP_OK, hmip_send_frame(&dev, 0x40, HMIP_FLAG_CRC32, 1, 61,
                                          payload, sizeof(payload)));

    frame_capture_t cap;
    frame_capture_reset(&cap);
    hmip_config_t cfg;
    memset(&cfg, 0, sizeof(cfg));
    cfg.tx_write = tx_capture;
    cfg.tx_ctx = &dev_tx;
    cfg.rx_buf = rx_aux;
    cfg.rx_buf_size = sizeof(rx_aux);
    cfg.on_frame = on_frame_capture;
    cfg.user = &cap;
    hmip_t decoder;
    hmip_init(&decoder, &cfg);
    CHECK_EQ_INT(HMIP_OK, hmip_feed(&decoder, dev_tx.buf, dev_tx.len));
    CHECK_EQ_INT(1, cap.count);
    CHECK_EQ_INT(sizeof(payload), cap.frames[0].payload_len);
    CHECK_EQ_INT(HMIP_FLAG_CRC32, cap.frames[0].flags);
    CHECK(bytes_eq(cap.frames[0].payload, payload, sizeof(payload)));
}

/* ==================== 19. HELLO 名称截断（>255 字节） ==================== */

static void test_hello_name_truncation(void)
{
    static char long_name[301];
    memset(long_name, 'n', 300);
    long_name[300] = '\0';

    static uint8_t name_rx[512];

    dev_init();
    dev.cfg.name = long_name;
    tx_reset(&dev_tx);
    CHECK_EQ_INT(HMIP_OK, hmip_send_hello(&dev));

    typed_ctx_t ctx;
    memset(&ctx, 0, sizeof(ctx));
    hmip_config_t cfg;
    memset(&cfg, 0, sizeof(cfg));
    cfg.tx_write = tx_capture;
    cfg.tx_ctx = &dev_tx;
    cfg.rx_buf = name_rx;
    cfg.rx_buf_size = sizeof(name_rx);
    cfg.on_hello = on_hello_capture;
    cfg.user = &ctx;
    hmip_t decoder;
    hmip_init(&decoder, &cfg);
    CHECK_EQ_INT(HMIP_OK, hmip_feed(&decoder, dev_tx.buf, dev_tx.len));
    CHECK_EQ_INT(1, ctx.hello.called);
    CHECK_EQ_INT(255, ctx.hello.name_len);
    for (size_t i = 0; i < ctx.hello.name_len; i++) {
        if (ctx.hello.name[i] != 'n') {
            CHECK_EQ_INT('n', ctx.hello.name[i]);
            break;
        }
    }
}

/* ==================== 20. ERROR 消息长度上限（65535） ==================== */

static uint8_t g_big_tx[132000];
static size_t g_big_tx_len;

static int big_tx_write(const uint8_t *data, size_t len, void *ctx)
{
    (void)ctx;
    if (g_big_tx_len + len > sizeof(g_big_tx)) {
        return -1;
    }
    memcpy(g_big_tx + g_big_tx_len, data, len);
    g_big_tx_len += len;
    return 0;
}

static void test_error_message_cap(void)
{
    static char msg[65537];
    memset(msg, 'a', 65536);
    msg[65536] = '\0';

    static uint8_t big_rx[132000];
    hmip_config_t scfg;
    memset(&scfg, 0, sizeof(scfg));
    scfg.tx_write = big_tx_write;
    scfg.tx_ctx = NULL;
    scfg.rx_buf = big_rx;
    scfg.rx_buf_size = sizeof(big_rx);
    scfg.channel = 5;
    hmip_t sender;
    CHECK_EQ_INT(HMIP_OK, hmip_init(&sender, &scfg));

    g_big_tx_len = 0;
    CHECK_EQ_INT(HMIP_OK, hmip_send_error(&sender, 5, 0x77, msg));
    /* 头部 16 + 定长字段 6 + 截断后的消息 65535 */
    CHECK_EQ_INT(16 + 6 + 65535, g_big_tx_len);

    typed_ctx_t ctx;
    memset(&ctx, 0, sizeof(ctx));
    hmip_config_t dcfg;
    memset(&dcfg, 0, sizeof(dcfg));
    dcfg.tx_write = tx_capture;
    dcfg.tx_ctx = &dev_tx;
    dcfg.rx_buf = big_rx;
    dcfg.rx_buf_size = sizeof(big_rx);
    dcfg.on_error = on_error_capture;
    dcfg.user = &ctx;
    hmip_t decoder;
    CHECK_EQ_INT(HMIP_OK, hmip_init(&decoder, &dcfg));
    CHECK_EQ_INT(HMIP_OK, hmip_feed(&decoder, g_big_tx, g_big_tx_len));
    CHECK_EQ_INT(1, ctx.err_msg.called);
    CHECK_EQ_INT(0x77, ctx.err_msg.code);
    CHECK_EQ_INT(65535, ctx.err_msg.message_len);
}

/* ==================== 21. API 参数校验 ==================== */

static void test_api_arg_validation(void)
{
    static uint8_t rx_buf[64];
    static const uint8_t payload[] = { 1 };

    hmip_t d;
    hmip_config_t cfg;
    memset(&cfg, 0, sizeof(cfg));
    cfg.tx_write = tx_capture;
    cfg.tx_ctx = &dev_tx;
    cfg.rx_buf = rx_buf;
    cfg.rx_buf_size = sizeof(rx_buf);
    cfg.channel = 1;
    cfg.name = "x";

    /* init 校验 */
    CHECK_EQ_INT(HMIP_ERR_ARG, hmip_init(NULL, &cfg));
    CHECK_EQ_INT(HMIP_ERR_ARG, hmip_init(&d, NULL));
    hmip_config_t bad = cfg;
    bad.tx_write = NULL;
    CHECK_EQ_INT(HMIP_ERR_ARG, hmip_init(&d, &bad));
    bad = cfg;
    bad.rx_buf = NULL;
    CHECK_EQ_INT(HMIP_ERR_ARG, hmip_init(&d, &bad));
    bad = cfg;
    bad.rx_buf_size = HMIP_MIN_RX_BUF_SIZE - 1;
    CHECK_EQ_INT(HMIP_ERR_ARG, hmip_init(&d, &bad));

    CHECK_EQ_INT(HMIP_OK, hmip_init(&d, &cfg));

    /* feed 校验 */
    CHECK_EQ_INT(HMIP_ERR_ARG, hmip_feed(NULL, payload, 1));
    CHECK_EQ_INT(HMIP_ERR_ARG, hmip_feed(&d, NULL, 1));
    CHECK_EQ_INT(HMIP_OK, hmip_feed(&d, payload, 0));
    CHECK_EQ_INT(HMIP_OK, hmip_feed(&d, NULL, 0));
    CHECK_EQ_INT(HMIP_ERR_ARG, hmip_poll(NULL));

    /* 发送校验 */
    CHECK_EQ_INT(HMIP_ERR_ARG, hmip_send_frame(NULL, 0x40, 0, 1, 1, payload, 1));
    CHECK_EQ_INT(HMIP_ERR_ARG, hmip_send_frame(&d, 0x40, 0, 1, 1, NULL, 1));
    CHECK_EQ_INT(HMIP_ERR_ARG, hmip_send_response(&d, 1, 1, 1, 0, NULL, 2));
    CHECK_EQ_INT(HMIP_ERR_ARG, hmip_send_request(&d, 1, 1, 1, NULL, 1));
    CHECK_EQ_INT(HMIP_ERR_ARG, hmip_send_event(&d, 1, 1, 1, NULL, 2));
    CHECK_EQ_INT(HMIP_ERR_ARG, hmip_ack(&d, NULL, 0, NULL, 0));
    CHECK_EQ_INT(HMIP_ERR_ARG, hmip_ack_ok(NULL, NULL));
    CHECK_EQ_INT(HMIP_ERR_ARG, hmip_send_hello(NULL));
    CHECK_EQ_INT(HMIP_ERR_ARG, hmip_send_heartbeat(NULL, 1));

    /* 工具校验 */
    CHECK_EQ_U32(0, hmip_next_seq(NULL));
    CHECK(hmip_strerror(HMIP_OK) != NULL);
    CHECK(hmip_strerror(HMIP_ERR_CRC) != NULL);
    CHECK(hmip_strerror(999) != NULL);
}

/* ==================== 22. poll 与部分帧 ==================== */

static void test_poll_partial(void)
{
    dev_init();
    tx_reset(&dev_tx);
    static const uint8_t payload[] = { 1, 2 };
    hmip_send_frame(&dev, 0x40, 0, 1, 71, payload, sizeof(payload));

    frame_capture_t cap;
    frame_capture_reset(&cap);
    hmip_config_t cfg;
    memset(&cfg, 0, sizeof(cfg));
    cfg.tx_write = tx_capture;
    cfg.tx_ctx = &dev_tx;
    cfg.rx_buf = rx_aux;
    cfg.rx_buf_size = sizeof(rx_aux);
    cfg.on_frame = on_frame_capture;
    cfg.user = &cap;
    hmip_t decoder;
    hmip_init(&decoder, &cfg);

    /* 喂 15 字节（头部不完整） */
    CHECK_EQ_INT(HMIP_OK, hmip_feed(&decoder, dev_tx.buf, 15));
    CHECK_EQ_INT(0, cap.count);
    /* poll 无新数据：不产生帧 */
    CHECK_EQ_INT(HMIP_OK, hmip_poll(&decoder));
    CHECK_EQ_INT(0, cap.count);
    /* 补齐剩余字节 */
    CHECK_EQ_INT(HMIP_OK, hmip_feed(&decoder, dev_tx.buf + 15, dev_tx.len - 15));
    CHECK_EQ_INT(1, cap.count);
    CHECK_EQ_U32(71, cap.frames[0].seq);
    /* 空缓冲上 poll 无害 */
    CHECK_EQ_INT(HMIP_OK, hmip_poll(&decoder));
}

/* ==================== 23. 回调内重入发送 ==================== */

static hmip_t *g_emit_dev;
static frame_capture_t *g_emit_cap;

static void on_frame_emit(hmip_t *h, const hmip_frame_t *f, void *user)
{
    (void)h;
    (void)user;
    frame_capture_t *c = g_emit_cap;
    if (c && c->count < 16) {
        c->frames[c->count] = *f;
        size_t copy = f->payload_len < 256 ? f->payload_len : 256;
        if (copy) {
            memcpy(c->payload[c->count], f->payload, copy);
        }
        c->frames[c->count].payload = c->payload[c->count];
        c->count++;
    }
    if (f->msg_type == 0x40) {
        /* 回调内发送 HELLO（验证解码器重入安全） */
        hmip_send_hello(g_emit_dev);
    }
}

static void test_reentrant_send_from_callback(void)
{
    static uint8_t dev_rx[64];
    static hmip_t dev_inst;
    static tx_capture_t dev_out;
    tx_reset(&dev_out);
    static frame_capture_t cap;
    frame_capture_reset(&cap);

    hmip_config_t dcfg;
    memset(&dcfg, 0, sizeof(dcfg));
    dcfg.tx_write = tx_capture;
    dcfg.tx_ctx = &dev_out;
    dcfg.rx_buf = dev_rx;
    dcfg.rx_buf_size = sizeof(dev_rx);
    dcfg.channel = 1;
    dcfg.name = "reentrant-dev";
    dcfg.on_frame = on_frame_emit;
    CHECK_EQ_INT(HMIP_OK, hmip_init(&dev_inst, &dcfg));
    g_emit_dev = &dev_inst;
    g_emit_cap = &cap;

    /* 一次喂两帧：回调内发送不应破坏后续帧解析 */
    dev_init();
    tx_reset(&dev_tx);
    static const uint8_t p1[] = { 1 };
    static const uint8_t p2[] = { 2 };
    hmip_send_frame(&dev, 0x40, 0, 1, 81, p1, sizeof(p1));
    hmip_send_frame(&dev, 0x41, 0, 1, 82, p2, sizeof(p2));
    CHECK_EQ_INT(HMIP_OK, hmip_feed(&dev_inst, dev_tx.buf, dev_tx.len));
    CHECK_EQ_INT(2, cap.count);
    CHECK_EQ_U32(81, cap.frames[0].seq);
    CHECK_EQ_U32(82, cap.frames[1].seq);

    /* 回调内发出的 HELLO 完整可解码 */
    typed_ctx_t ctx;
    memset(&ctx, 0, sizeof(ctx));
    hmip_config_t rcfg;
    memset(&rcfg, 0, sizeof(rcfg));
    rcfg.tx_write = tx_capture;
    rcfg.tx_ctx = &dev_tx;
    rcfg.rx_buf = rx_aux;
    rcfg.rx_buf_size = sizeof(rx_aux);
    rcfg.on_hello = on_hello_capture;
    rcfg.user = &ctx;
    hmip_t rdec;
    hmip_init(&rdec, &rcfg);
    CHECK_EQ_INT(HMIP_OK, hmip_feed(&rdec, dev_out.buf, dev_out.len));
    CHECK_EQ_INT(1, ctx.hello.called);
    CHECK_EQ_INT(0, strcmp(ctx.hello.name, "reentrant-dev"));
}

/* ==================== 24. 噪声模糊测试 ==================== */

static void test_noise_fuzz(void)
{
    dev_init();
    frame_capture_t cap;
    frame_capture_reset(&cap);
    err_capture_t errs;
    memset(&errs, 0, sizeof(errs));
    g_err_target = &errs;

    hmip_config_t cfg;
    memset(&cfg, 0, sizeof(cfg));
    cfg.tx_write = tx_capture;
    cfg.tx_ctx = &dev_tx;
    cfg.rx_buf = rx_aux;
    cfg.rx_buf_size = sizeof(rx_aux);
    cfg.on_frame = on_frame_capture;
    cfg.on_decode_error = on_decode_error_capture;
    cfg.user = &cap;
    hmip_t decoder;
    hmip_init(&decoder, &cfg);

    uint32_t rng = 0xDEADBEEFu;
    for (int iter = 0; iter < 300; iter++) {
        size_t junk_len = xorshift32(&rng) % 20;
        static uint8_t stream[512];
        /* 噪声字母表为小写 a-z（不含大写 'H'），保证重同步路径确定 */
        for (size_t i = 0; i < junk_len; i++) {
            stream[i] = (uint8_t)('a' + (xorshift32(&rng) % 26));
        }
        uint8_t msg_type = (uint8_t)(0x40 + (xorshift32(&rng) % 0x10));
        uint8_t channel = (uint8_t)(xorshift32(&rng) % 4);
        uint32_t seq = xorshift32(&rng);
        size_t plen = xorshift32(&rng) % 33;
        static uint8_t payload[64];
        for (size_t i = 0; i < plen; i++) {
            payload[i] = (uint8_t)(xorshift32(&rng) & 0xFF);
        }
        tx_reset(&dev_tx);
        CHECK_EQ_INT(HMIP_OK, hmip_send_frame(&dev, msg_type, 0, channel, seq,
                                              payload, plen));
        memcpy(stream + junk_len, dev_tx.buf, dev_tx.len);
        size_t total = junk_len + dev_tx.len;

        errs.count = 0;
        frame_capture_reset(&cap);
        CHECK_EQ_INT(HMIP_OK, hmip_feed(&decoder, stream, total));
        CHECK_EQ_INT(1, cap.count);
        CHECK_EQ_INT(msg_type, cap.frames[0].msg_type);
        CHECK_EQ_INT(channel, cap.frames[0].channel);
        CHECK_EQ_U32(seq, cap.frames[0].seq);
        CHECK_EQ_INT(plen, cap.frames[0].payload_len);
        CHECK(bytes_eq(cap.frames[0].payload, payload, plen));
        if (junk_len > 0) {
            CHECK_EQ_INT(1, errs.count);
            CHECK_EQ_INT(HMIP_ERR_RESYNC, errs.errs[0]);
            CHECK_EQ_INT(junk_len, errs.dropped[0]);
        } else {
            CHECK_EQ_INT(0, errs.count);
        }
    }
}

/* ==================== 25. 双向业务压力测试 ==================== */

static void test_two_way_stress(void)
{
    /* 设备侧 */
    static uint8_t dev_rx[256];
    static hmip_t device;
    static pipe_t dev_to_hmi;
    memset(&dev_to_hmi, 0, sizeof(dev_to_hmi));
    hmip_config_t dcfg;
    memset(&dcfg, 0, sizeof(dcfg));
    dcfg.tx_write = pipe_write;
    dcfg.tx_ctx = &dev_to_hmi;
    dcfg.rx_buf = dev_rx;
    dcfg.rx_buf_size = sizeof(dev_rx);
    dcfg.channel = 1;
    dcfg.name = "stress-device";
    device_business_setup(&dcfg);
    CHECK_EQ_INT(HMIP_OK, hmip_init(&device, &dcfg));

    /* HMI 侧 */
    static uint8_t hmi_rx[256];
    static hmip_t hmi_side;
    static pipe_t hmi_to_dev;
    memset(&hmi_to_dev, 0, sizeof(hmi_to_dev));
    typed_ctx_t ctx;
    memset(&ctx, 0, sizeof(ctx));
    hmip_config_t hcfg;
    memset(&hcfg, 0, sizeof(hcfg));
    hcfg.tx_write = pipe_write;
    hcfg.tx_ctx = &hmi_to_dev;
    hcfg.rx_buf = hmi_rx;
    hcfg.rx_buf_size = sizeof(hmi_rx);
    hcfg.on_response = on_response_capture;
    hcfg.user = &ctx;
    CHECK_EQ_INT(HMIP_OK, hmip_init(&hmi_side, &hcfg));

    uint32_t rng = 0xACE1BEEFu;
    for (int i = 0; i < 200; i++) {
        uint8_t action = (uint8_t)(0x40 + (xorshift32(&rng) % 4)); /* 0x40..0x43 */
        uint8_t channel = (uint8_t)(1 + (xorshift32(&rng) % 3));
        size_t blen = xorshift32(&rng) % 4;
        static uint8_t body[8];
        for (size_t j = 0; j < blen; j++) {
            body[j] = (uint8_t)(xorshift32(&rng) & 0xFF);
        }

        memset(&ctx.resp, 0, sizeof(ctx.resp));
        CHECK_EQ_INT(HMIP_OK, hmip_send_frame(&hmi_side, action, 0, channel, 0,
                                              body, blen));
        uint32_t sent_seq = hmi_side.tx_seq;
        pump(&hmi_to_dev, &device);
        pump(&dev_to_hmi, &hmi_side);

        CHECK_EQ_INT(1, ctx.resp.called);
        CHECK_EQ_INT(channel, ctx.resp.channel);      /* channel 回显 */
        CHECK_EQ_U32(sent_seq, ctx.resp.seq);         /* seq 回显 */
        CHECK_EQ_U32(sent_seq, ctx.resp.request_id);  /* request_id=请求 seq */
        /* 0x40/0x41/0x42 为已知动作（status=0），0x43 为未知动作（status=1） */
        uint16_t expect_status = (action <= 0x42) ? 0 : 1;
        CHECK_EQ_INT(expect_status, ctx.resp.status);
    }
}

/* ==================== 26. 未知动作错误状态 ==================== */

static void test_unknown_action_error_status(void)
{
    static uint8_t dev_rx[256];
    static hmip_t device;
    static pipe_t dev_to_hmi;
    memset(&dev_to_hmi, 0, sizeof(dev_to_hmi));
    hmip_config_t dcfg;
    memset(&dcfg, 0, sizeof(dcfg));
    dcfg.tx_write = pipe_write;
    dcfg.tx_ctx = &dev_to_hmi;
    dcfg.rx_buf = dev_rx;
    dcfg.rx_buf_size = sizeof(dev_rx);
    dcfg.channel = 1;
    dcfg.name = "unknown-action-dev";
    device_business_setup(&dcfg);
    CHECK_EQ_INT(HMIP_OK, hmip_init(&device, &dcfg));

    static uint8_t hmi_rx[256];
    static hmip_t hmi_side;
    static pipe_t hmi_to_dev;
    memset(&hmi_to_dev, 0, sizeof(hmi_to_dev));
    typed_ctx_t ctx;
    memset(&ctx, 0, sizeof(ctx));
    hmip_config_t hcfg;
    memset(&hcfg, 0, sizeof(hcfg));
    hcfg.tx_write = pipe_write;
    hcfg.tx_ctx = &hmi_to_dev;
    hcfg.rx_buf = hmi_rx;
    hcfg.rx_buf_size = sizeof(hmi_rx);
    hcfg.on_response = on_response_capture;
    hcfg.user = &ctx;
    CHECK_EQ_INT(HMIP_OK, hmip_init(&hmi_side, &hcfg));

    /* 未知动作 0x50 → 设备回 status=1 */
    static const uint8_t payload[] = { 0xFF, 0xFF };
    CHECK_EQ_INT(HMIP_OK, hmip_send_frame(&hmi_side, 0x50, 0, 1, 0, payload, 2));
    pump(&hmi_to_dev, &device);
    pump(&dev_to_hmi, &hmi_side);
    CHECK_EQ_INT(1, ctx.resp.called);
    CHECK_EQ_INT(1, ctx.resp.status);
    CHECK_EQ_INT(1, ctx.resp.channel);
    CHECK_EQ_U32(ctx.resp.seq, ctx.resp.request_id);

    /* REQUEST（0x10）不应被 on_frame 的 default 分支误答 */
    memset(&ctx.resp, 0, sizeof(ctx.resp));
    CHECK_EQ_INT(HMIP_OK, hmip_send_request(&hmi_side, 1, 55, 9, NULL, 0));
    pump(&hmi_to_dev, &device);
    pump(&dev_to_hmi, &hmi_side);
    CHECK_EQ_INT(0, ctx.resp.called); /* method=9 无处理：不应有响应 */
}

/* ==================== main ==================== */

int main(void)
{
    printf("== hmip C SDK test suite ==\n");

    test_crc32();
    printf("  crc32 .......... done\n");
    test_encode_golden();
    printf("  encode golden .. done\n");
    test_decode_roundtrip();
    printf("  decode roundtrip done\n");
    test_decode_fragmented();
    printf("  decode fragmented done\n");
    test_decode_sticky();
    printf("  decode sticky .. done\n");
    test_decode_resync();
    printf("  decode resync .. done\n");
    test_decode_bad_version();
    printf("  decode bad-version done\n");
    test_decode_crc_mismatch();
    printf("  decode crc ...... done\n");
    test_decode_payload_too_large();
    printf("  payload too large done\n");
    test_decode_overflow();
    printf("  buffer overflow  done\n");
    test_typed_messages();
    printf("  typed messages .. done\n");
    test_ack();
    printf("  ack helpers .... done\n");
    test_ack_in_callback();
    printf("  ack in callback  done\n");
    test_stress_random();
    printf("  stress random ... done\n");
    test_end_to_end_business();
    printf("  end-to-end ...... done\n");

    test_hand_assembled_response();
    printf("  hand resp ....... done\n");
    test_hand_assembled_hello();
    printf("  hand hello ...... done\n");
    test_empty_payload();
    printf("  empty payload ... done\n");
    test_payload_capacity_boundary();
    printf("  payload boundary  done\n");
    test_magic_split_across_feeds();
    printf("  magic split ..... done\n");
    test_garbage_between_frames();
    printf("  garbage between . done\n");
    test_payload_containing_magic();
    printf("  magic in payload  done\n");
    test_malformed_typed_messages();
    printf("  malformed msgs .. done\n");
    test_seq_auto_assign();
    printf("  seq auto ........ done\n");
    test_tx_failure();
    printf("  tx failure ...... done\n");
    test_tx_chunk_calls();
    printf("  tx chunks ....... done\n");
    test_large_payload_roundtrip();
    printf("  large payload ... done\n");
    test_hello_name_truncation();
    printf("  name truncation . done\n");
    test_error_message_cap();
    printf("  error msg cap ... done\n");
    test_api_arg_validation();
    printf("  api args ........ done\n");
    test_poll_partial();
    printf("  poll partial .... done\n");
    test_reentrant_send_from_callback();
    printf("  reentrant send .. done\n");
    test_noise_fuzz();
    printf("  noise fuzz ...... done\n");
    test_two_way_stress();
    printf("  two-way stress .. done\n");
    test_unknown_action_error_status();
    printf("  unknown action .. done\n");

    printf("\n%d checks, %d failures\n", g_checks, g_failures);
    return g_failures == 0 ? 0 : 1;
}
