/**
 * interop_cli.c — C SDK 互操作测试 CLI
 *
 * decode 模式：stdin 字节流 -> hmip_feed -> 打印 F/M 行（与 Rust ref-hmip 对齐）
 * encode 模式：stdin 命令 -> SDK 编码 -> stdout 原始字节
 *   R mt flags ch seq hex      任意帧
 *   H role cap name            HELLO
 *   B ts                       HEARTBEAT
 *   Q ch reqid method hex      REQUEST
 *   P ch seq reqid status hex  RESPONSE
 *   V ch eventid ts hex        EVENT
 *   X ch code message          ERROR
 * dev   模式：加载 device_business，收到动作帧按业务应答（模拟真实设备端）
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#include "../hmip.h"
#include "../examples/device_business.h"

static hmip_t s_dev;
static uint8_t s_rx[1024];

static int tx_stdout(const uint8_t *data, size_t len, void *ctx)
{
    (void)ctx;
    if (fwrite(data, 1, len, stdout) != len) {
        return -1;
    }
    fflush(stdout);
    return 0;
}

static void print_hex(const uint8_t *p, size_t n)
{
    for (size_t i = 0; i < n; i++) {
        printf("%02x", p[i]);
    }
}

/* ---- decode 模式回调 ---- */

static void on_frame(hmip_t *h, const hmip_frame_t *f, void *user)
{
    (void)h;
    (void)user;
    printf("F %u %u %u %u %u ", f->msg_type, f->flags, f->channel, f->seq,
           (unsigned)f->payload_len);
    print_hex(f->payload, f->payload_len);
    printf("\n");
    fflush(stdout);
}

static void on_decode_error(hmip_t *h, int err, size_t dropped, void *user)
{
    (void)h;
    (void)user;
    printf("E %d %u\n", err, (unsigned)dropped);
    fflush(stdout);
}

static void on_hello(hmip_t *h, const hmip_frame_t *f, uint8_t role,
                     uint32_t capabilities, const char *name, size_t name_len,
                     void *user)
{
    (void)h;
    (void)f;
    (void)user;
    printf("M hello %u %u ", role, capabilities);
    fwrite(name, 1, name_len, stdout);
    printf("\n");
    fflush(stdout);
}

static void on_hello_ack(hmip_t *h, const hmip_frame_t *f, uint32_t capabilities,
                         const char *name, size_t name_len, void *user)
{
    (void)h;
    (void)f;
    (void)user;
    printf("M helloAck %u ", capabilities);
    fwrite(name, 1, name_len, stdout);
    printf("\n");
    fflush(stdout);
}

static void on_heartbeat(hmip_t *h, const hmip_frame_t *f,
                         uint64_t timestamp_ms, void *user)
{
    (void)h;
    (void)f;
    (void)user;
    printf("M heartbeat %llu\n", (unsigned long long)timestamp_ms);
    fflush(stdout);
}

static void on_request(hmip_t *h, const hmip_frame_t *f, uint32_t request_id,
                       uint16_t method, const uint8_t *body, size_t body_len,
                       void *user)
{
    (void)h;
    (void)f;
    (void)user;
    printf("M request %u %u ", request_id, method);
    print_hex(body, body_len);
    printf("\n");
    fflush(stdout);
}

static void on_response(hmip_t *h, const hmip_frame_t *f, uint32_t request_id,
                        uint16_t status, const uint8_t *body, size_t body_len,
                        void *user)
{
    (void)h;
    (void)f;
    (void)user;
    printf("M response %u %u ", request_id, status);
    print_hex(body, body_len);
    printf("\n");
    fflush(stdout);
}

static void on_event(hmip_t *h, const hmip_frame_t *f, uint16_t event_id,
                     uint64_t timestamp_ms, const uint8_t *body, size_t body_len,
                     void *user)
{
    (void)h;
    (void)f;
    (void)user;
    printf("M event %u %llu ", event_id, (unsigned long long)timestamp_ms);
    print_hex(body, body_len);
    printf("\n");
    fflush(stdout);
}

static void on_error(hmip_t *h, const hmip_frame_t *f, uint16_t code,
                     const char *message, size_t message_len, void *user)
{
    (void)h;
    (void)f;
    (void)user;
    printf("M error %u ", code);
    fwrite(message, 1, message_len, stdout);
    printf("\n");
    fflush(stdout);
}

static void setup_decode(hmip_config_t *cfg)
{
    memset(cfg, 0, sizeof(*cfg));
    cfg->tx_write = tx_stdout;
    cfg->tx_ctx = NULL;
    cfg->rx_buf = s_rx;
    cfg->rx_buf_size = sizeof(s_rx);
    cfg->channel = 1;
    cfg->name = "c-sdk-cli";
    cfg->on_frame = on_frame;
    cfg->on_decode_error = on_decode_error;
    cfg->on_hello = on_hello;
    cfg->on_hello_ack = on_hello_ack;
    cfg->on_heartbeat = on_heartbeat;
    cfg->on_request = on_request;
    cfg->on_response = on_response;
    cfg->on_event = on_event;
    cfg->on_error = on_error;
}

static int unhex_byte(char hi, char lo)
{
    int v = 0;
    if (hi >= '0' && hi <= '9') v = (hi - '0') << 4;
    else if (hi >= 'a' && hi <= 'f') v = (hi - 'a' + 10) << 4;
    else if (hi >= 'A' && hi <= 'F') v = (hi - 'A' + 10) << 4;
    else return -1;
    if (lo >= '0' && lo <= '9') v |= lo - '0';
    else if (lo >= 'a' && lo <= 'f') v |= lo - 'a' + 10;
    else if (lo >= 'A' && lo <= 'F') v |= lo - 'A' + 10;
    else return -1;
    return v;
}

static size_t unhex_buf(const char *s, uint8_t *out, size_t cap)
{
    size_t n = strlen(s);
    if (strcmp(s, "-") == 0) {
        return 0;
    }
    if (n % 2 != 0) {
        fprintf(stderr, "bad hex length\n");
        exit(2);
    }
    size_t len = n / 2;
    if (len > cap) {
        fprintf(stderr, "hex too long\n");
        exit(2);
    }
    for (size_t i = 0; i < len; i++) {
        int b = unhex_byte(s[i * 2], s[i * 2 + 1]);
        if (b < 0) {
            fprintf(stderr, "bad hex\n");
            exit(2);
        }
        out[i] = (uint8_t)b;
    }
    return len;
}

static void mode_encode(void)
{
    hmip_config_t cfg;
    setup_decode(&cfg);
    cfg.on_frame = NULL;
    cfg.on_decode_error = NULL;
    cfg.on_hello = NULL;
    cfg.on_hello_ack = NULL;
    cfg.on_heartbeat = NULL;
    cfg.on_request = NULL;
    cfg.on_response = NULL;
    cfg.on_event = NULL;
    cfg.on_error = NULL;
    if (hmip_init(&s_dev, &cfg) != HMIP_OK) {
        fprintf(stderr, "init failed\n");
        exit(1);
    }

    char line[512];
    while (fgets(line, sizeof(line), stdin)) {
        char hx[512] = { 0 };
        static uint8_t body[256];
        size_t blen;

        if (line[0] == 'R') {
            unsigned mt, flags, ch;
            unsigned long seq;
            if (sscanf(line, "R %u %u %u %lu %511s", &mt, &flags, &ch, &seq, hx) != 5) {
                exit(2);
            }
            blen = unhex_buf(hx, body, sizeof(body));
            hmip_send_frame(&s_dev, (uint8_t)mt, (uint8_t)flags, (uint8_t)ch,
                            (uint32_t)seq, body, blen);
        } else if (line[0] == 'H') {
            unsigned role;
            unsigned long cap;
            char name[256];
            if (sscanf(line, "H %u %lu %255s", &role, &cap, name) != 3) {
                exit(2);
            }
            s_dev.cfg.role = (uint8_t)role;
            s_dev.cfg.capabilities = (uint32_t)cap;
            s_dev.cfg.name = name;
            hmip_send_hello(&s_dev);
        } else if (line[0] == 'B') {
            unsigned long long ts;
            if (sscanf(line, "B %llu", &ts) != 1) {
                exit(2);
            }
            hmip_send_heartbeat(&s_dev, (uint64_t)ts);
        } else if (line[0] == 'Q') {
            unsigned ch;
            unsigned long reqid;
            unsigned method;
            if (sscanf(line, "Q %u %lu %u %511s", &ch, &reqid, &method, hx) != 4) {
                exit(2);
            }
            blen = unhex_buf(hx, body, sizeof(body));
            hmip_send_request(&s_dev, (uint8_t)ch, (uint32_t)reqid,
                              (uint16_t)method, body, blen);
        } else if (line[0] == 'P') {
            unsigned ch, status;
            unsigned long seq, reqid;
            if (sscanf(line, "P %u %lu %lu %u %511s", &ch, &seq, &reqid, &status, hx) != 5) {
                exit(2);
            }
            blen = unhex_buf(hx, body, sizeof(body));
            hmip_send_response(&s_dev, (uint8_t)ch, (uint32_t)seq,
                               (uint32_t)reqid, (uint16_t)status, body, blen);
        } else if (line[0] == 'V') {
            unsigned ch, eventid;
            unsigned long long ts;
            if (sscanf(line, "V %u %u %llu %511s", &ch, &eventid, &ts, hx) != 4) {
                exit(2);
            }
            blen = unhex_buf(hx, body, sizeof(body));
            hmip_send_event(&s_dev, (uint8_t)ch, (uint16_t)eventid, (uint64_t)ts,
                            body, blen);
        } else if (line[0] == 'X') {
            unsigned ch, code;
            char msg[256];
            if (sscanf(line, "X %u %u %255[^\n]", &ch, &code, msg) != 3) {
                exit(2);
            }
            hmip_send_error(&s_dev, (uint8_t)ch, (uint16_t)code, msg);
        } else {
            fprintf(stderr, "unknown command\n");
            exit(2);
        }
    }
}

static void mode_decode(void)
{
    hmip_config_t cfg;
    setup_decode(&cfg);
    if (hmip_init(&s_dev, &cfg) != HMIP_OK) {
        fprintf(stderr, "init failed\n");
        exit(1);
    }
    /* POSIX read()：管道有数据即返回（glibc fread 会等填满缓冲/EOF） */
    uint8_t chunk[512];
    ssize_t n;
    while ((n = read(STDIN_FILENO, chunk, sizeof(chunk))) > 0) {
        hmip_feed(&s_dev, chunk, (size_t)n);
    }
}

static void mode_dev(void)
{
    hmip_config_t cfg;
    setup_decode(&cfg);
    cfg.on_frame = NULL;
    cfg.on_decode_error = NULL;
    cfg.on_hello = NULL;
    cfg.on_hello_ack = NULL;
    cfg.on_heartbeat = NULL;
    cfg.on_request = NULL;
    cfg.on_response = NULL;
    cfg.on_event = NULL;
    cfg.on_error = NULL;
    cfg.channel = 1;
    cfg.name = "dilution-machine";
    device_business_setup(&cfg);
    if (hmip_init(&s_dev, &cfg) != HMIP_OK) {
        fprintf(stderr, "init failed\n");
        exit(1);
    }
    uint8_t chunk[512];
    ssize_t n;
    while ((n = read(STDIN_FILENO, chunk, sizeof(chunk))) > 0) {
        hmip_feed(&s_dev, chunk, (size_t)n);
    }
}

int main(int argc, char **argv)
{
    const char *mode = argc > 1 ? argv[1] : "decode";
    if (strcmp(mode, "encode") == 0) {
        mode_encode();
    } else if (strcmp(mode, "decode") == 0) {
        mode_decode();
    } else if (strcmp(mode, "dev") == 0) {
        mode_dev();
    } else {
        fprintf(stderr, "usage: interop_cli <encode|decode|dev>\n");
        return 1;
    }
    return 0;
}
