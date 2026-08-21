/**
 * pty_device.c — 跑在真实 TTY（socat PTY）上的设备端模拟器
 *
 * 与 STM32 部署形态一致：
 *   - open(O_RDWR | O_NOCTTY) + cfmakeraw 打开串口
 *   - SDK 的 tx_write = 直接 write(fd)，接收 = poll + read + hmip_feed
 *   - 上电发 HELLO + HEARTBEAT
 *   - 动作 0x40/0x41/0x42 按稀释机台业务应答；未知动作回 status=1
 *   - 动作 0x60：注入 4 字节线路噪声 + EVENT 上报后退出（噪声重同步测试用）
 *
 * 用法：pty_device <tty路径>
 */
#define _DEFAULT_SOURCE /* cfmakeraw (glibc) */
#include <fcntl.h>
#include <poll.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <termios.h>
#include <unistd.h>

#include "../hmip.h"

#define ACTION_NOISE_TEST 0x60u

static int g_fd = -1;
static hmip_t s_dev;
static uint8_t s_rx[512];
static unsigned s_weigh_count = 0;

static int tty_tx_write(const uint8_t *data, size_t len, void *ctx)
{
    (void)ctx;
    size_t off = 0;
    while (off < len) {
        ssize_t n = write(g_fd, data + off, len - off);
        if (n <= 0) {
            return -1;
        }
        off += (size_t)n;
    }
    return 0;
}

static void on_frame(hmip_t *h, const hmip_frame_t *f, void *user)
{
    (void)user;

    switch (f->msg_type) {
    case 0x40: { /* 称量：回 float32 体重 */
        s_weigh_count++;
        float weight = 12.34f * (float)s_weigh_count;
        hmip_ack(h, f, HMIP_STATUS_OK, (const uint8_t *)&weight, sizeof(weight));
        break;
    }
    case 0x41: /* 搅拌：空 body 成功 */
        hmip_ack_ok(h, f);
        break;
    case 0x42: { /* 测粘度：回 float32 */
        float viscosity = 5.50f;
        hmip_ack(h, f, HMIP_STATUS_OK, (const uint8_t *)&viscosity,
                 sizeof(viscosity));
        break;
    }
    case ACTION_NOISE_TEST: {
        /* 模拟线路噪声 + 主动事件上报，然后退出 */
        static const uint8_t noise[] = "zzzz"; /* 不含 'H'，重同步路径确定 */
        ssize_t ignored = write(g_fd, noise, sizeof(noise) - 1);
        (void)ignored;
        hmip_send_event(h, f->channel, 0x0009, 424242u,
                        (const uint8_t *)"noise-done", 10);
        _exit(0);
    }
    default:
        if (f->msg_type >= 0x40u) {
            hmip_ack(h, f, 0x0001u, NULL, 0); /* 未知动作错误状态 */
        }
        break;
    }
}

static void on_request(hmip_t *h, const hmip_frame_t *f, uint32_t request_id,
                       uint16_t method, const uint8_t *body, size_t body_len,
                       void *user)
{
    (void)body;
    (void)body_len;
    (void)user;
    if (method == 0x0001u) { /* ping */
        static const uint8_t pong[] = { 'P', 'O', 'N', 'G' };
        hmip_send_response(h, f->channel, f->seq, request_id, HMIP_STATUS_OK,
                           pong, sizeof(pong));
    }
}

int main(int argc, char **argv)
{
    if (argc < 2) {
        fprintf(stderr, "usage: pty_device <tty>\n");
        return 1;
    }

    g_fd = open(argv[1], O_RDWR | O_NOCTTY);
    if (g_fd < 0) {
        perror("open tty");
        return 1;
    }
    struct termios tio;
    if (tcgetattr(g_fd, &tio) != 0) {
        perror("tcgetattr");
        return 1;
    }
    cfmakeraw(&tio);
    tio.c_cflag |= (CLOCAL | CREAD);
    if (tcsetattr(g_fd, TCSANOW, &tio) != 0) {
        perror("tcsetattr");
        return 1;
    }

    hmip_config_t cfg;
    memset(&cfg, 0, sizeof(cfg));
    cfg.tx_write = tty_tx_write;
    cfg.tx_ctx = NULL;
    cfg.rx_buf = s_rx;
    cfg.rx_buf_size = sizeof(s_rx);
    cfg.channel = 1;
    cfg.role = HMIP_ROLE_SERVER;
    cfg.capabilities = 0x1;
    cfg.name = "dilution-mock";
    cfg.on_frame = on_frame;
    cfg.on_request = on_request;
    if (hmip_init(&s_dev, &cfg) != HMIP_OK) {
        fprintf(stderr, "hmip init failed\n");
        return 1;
    }

    /* 上电：HELLO + HEARTBEAT（与真实设备行为一致） */
    hmip_send_hello(&s_dev);
    hmip_send_heartbeat(&s_dev, 111222333u);

    uint8_t buf[512];
    for (;;) {
        struct pollfd pfd;
        pfd.fd = g_fd;
        pfd.events = POLLIN;
        pfd.revents = 0;
        int pr = poll(&pfd, 1, 100);
        if (pr < 0) {
            perror("poll");
            return 1;
        }
        if (pr == 0) {
            continue;
        }
        ssize_t n = read(g_fd, buf, sizeof(buf));
        if (n <= 0) {
            continue; /* PTY 对端关闭时返回 EIO，容忍 */
        }
        hmip_feed(&s_dev, buf, (size_t)n);
    }
}
