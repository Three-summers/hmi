/**
 * host_demo.c — 主机端回环演示：HMI 侧 <-> 设备业务模块
 *
 * 编译运行：make example
 * 演示内容与 device-sdk 测试一致：称量/搅拌/测粘度动作、心跳上报、PING 请求。
 */
#if !defined(_WIN32)
#define _POSIX_C_SOURCE 199309L /* nanosleep / struct timespec */
#endif

#include <stdio.h>
#include <string.h>

#if defined(_WIN32)
#include <windows.h>
#define DEMO_SLEEP_MS(ms) Sleep((DWORD)(ms))
#else
#include <time.h>
#define DEMO_SLEEP_MS(ms)                                       \
    do {                                                        \
        struct timespec ts;                                     \
        ts.tv_sec = (ms) / 1000;                                \
        ts.tv_nsec = ((long)((ms) % 1000)) * 1000000L;          \
        nanosleep(&ts, NULL);                                   \
    } while (0)
#endif

#include "hmip.h"
#include "device_business.h"

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

/* ---- HMI 侧回调 ---- */

static void on_response(hmip_t *h, const hmip_frame_t *f, uint32_t request_id,
                        uint16_t status, const uint8_t *body, size_t body_len,
                        void *user)
{
    (void)h;
    (void)user;
    printf("  [HMI] <- RESPONSE ch=%u seq=%u request_id=%u status=%u body_len=%zu",
           f->channel, f->seq, request_id, status, body_len);
    if (body_len == 4) {
        float v = 0;
        memcpy(&v, body, sizeof(v));
        printf(" value=%.3f bytes=", (double)v);
    }
    for (size_t i = 0; i < body_len; i++) {
        printf(" %02X", body[i]);
    }
    printf("\n");
}

static void on_event(hmip_t *h, const hmip_frame_t *f, uint16_t event_id,
                     uint64_t timestamp_ms, const uint8_t *body, size_t body_len,
                     void *user)
{
    (void)h;
    (void)f;
    (void)user;
    printf("  [HMI] <- EVENT ch=%u event_id=0x%04X ts=%llu body=%.*s\n", f->channel,
           event_id, (unsigned long long)timestamp_ms, (int)body_len,
           (const char *)body);
}

int main(void)
{
    /* ---- 设备侧（STM32 上即业务板） ---- */
    static uint8_t dev_rx[256];
    static hmip_t device;
    static pipe_t dev_to_hmi;
    memset(&dev_to_hmi, 0, sizeof(dev_to_hmi));

    hmip_config_t dcfg;
    memset(&dcfg, 0, sizeof(dcfg));
    dcfg.tx_write = pipe_write; /* 实际为 UART 发送 */
    dcfg.tx_ctx = &dev_to_hmi;
    dcfg.rx_buf = dev_rx;
    dcfg.rx_buf_size = sizeof(dev_rx);
    dcfg.channel = 1;
    dcfg.role = HMIP_ROLE_SERVER;
    dcfg.capabilities = 0x00000001u;
    dcfg.name = "dilution-machine";
    device_business_setup(&dcfg); /* 业务回调：只有这一行是业务代码 */
    if (hmip_init(&device, &dcfg) != HMIP_OK) {
        printf("device init failed\n");
        return 1;
    }

    /* ---- HMI 侧 ---- */
    static uint8_t hmi_rx[256];
    static hmip_t hmi_side;
    static pipe_t hmi_to_dev;
    memset(&hmi_to_dev, 0, sizeof(hmi_to_dev));

    hmip_config_t hcfg;
    memset(&hcfg, 0, sizeof(hcfg));
    hcfg.tx_write = pipe_write;
    hcfg.tx_ctx = &hmi_to_dev;
    hcfg.rx_buf = hmi_rx;
    hcfg.rx_buf_size = sizeof(hmi_rx);
    hcfg.on_response = on_response;
    hcfg.on_event = on_event;
    if (hmip_init(&hmi_side, &hcfg) != HMIP_OK) {
        printf("hmi init failed\n");
        return 1;
    }

    printf("== HMIP host loopback demo ==\n");

    /* 设备上电：HELLO + HEARTBEAT */
    hmip_send_hello(&device);
    pump(&dev_to_hmi, &hmi_side);
    printf("  device sent HELLO\n");

    /* 模拟 HMI 按 recipe 依次下发动作 */
    static const uint8_t weigh_payload[] = { 0x01, 0x01 };
    static const uint8_t mix_payload[] = { 0x02, 0x02 };
    static const uint8_t visc_payload[] = { 0x03, 0x03 };

    printf("[HMI] -> 称量 (0x40 ch=1)\n");
    hmip_send_frame(&hmi_side, 0x40, 0, 1, 0, weigh_payload, sizeof(weigh_payload));
    pump(&hmi_to_dev, &device);
    pump(&dev_to_hmi, &hmi_side);
    DEMO_SLEEP_MS(300);

    printf("[HMI] -> 称量 (0x40 ch=1) 第二次\n");
    hmip_send_frame(&hmi_side, 0x40, 0, 1, 0, weigh_payload, sizeof(weigh_payload));
    pump(&hmi_to_dev, &device);
    pump(&dev_to_hmi, &hmi_side);
    DEMO_SLEEP_MS(300);

    printf("[HMI] -> 搅拌 (0x41 ch=2)\n");
    hmip_send_frame(&hmi_side, 0x41, 0, 2, 0, mix_payload, sizeof(mix_payload));
    pump(&hmi_to_dev, &device);
    pump(&dev_to_hmi, &hmi_side);
    DEMO_SLEEP_MS(300);

    printf("[HMI] -> 测粘度 (0x42 ch=3)\n");
    hmip_send_frame(&hmi_side, 0x42, 0, 3, 0, visc_payload, sizeof(visc_payload));
    pump(&hmi_to_dev, &device);
    pump(&dev_to_hmi, &hmi_side);
    DEMO_SLEEP_MS(300);

    printf("[HMI] -> REQUEST ping (method=1)\n");
    hmip_send_request(&hmi_side, 1, 777u, 1, NULL, 0);
    pump(&hmi_to_dev, &device);
    pump(&dev_to_hmi, &hmi_side);
    DEMO_SLEEP_MS(300);

    /* 设备周期心跳 */
    hmip_send_heartbeat(&device, 123456789u);
    pump(&dev_to_hmi, &hmi_side);
    printf("  device sent HEARTBEAT\n");

    /* 设备主动事件上报 */
    hmip_send_event(&device, 1, 0x0009, 987654u, (const uint8_t *)"ready", 5);
    pump(&dev_to_hmi, &hmi_side);

    printf("demo finished\n");
    return 0;
}
