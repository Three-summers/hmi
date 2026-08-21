/**
 * device_business.c — 设备业务示例实现
 *
 * 动作约定（与 docs/device-serial-interface.md §5.1 的示例一致）：
 *   0x40 = weigh.start       称量   -> 完成后回 RESPONSE(status=0, body=重量 float32 LE)
 *   0x41 = mix.start         搅拌   -> 完成后回 RESPONSE(status=0)
 *   0x42 = viscosity.measure 测粘度 -> 完成后回 RESPONSE(status=0, body=粘度 float32 LE)
 *
 * 注意：body 的编码（此处为 float32 小端）是业务双方自行约定的内容，
 * 不是 HMIP 协议的一部分。
 */
#include "device_business.h"

#include <string.h>

#define ACTION_WEIGH_START 0x40u
#define ACTION_MIX_START 0x41u
#define ACTION_VISCOSITY_MEASURE 0x42u

#define METHOD_PING 0x0001u

typedef struct {
    unsigned weigh_count;
} business_state_t;

static business_state_t s_state;

static void on_frame(hmip_t *h, const hmip_frame_t *f, void *user)
{
    (void)user;

    switch (f->msg_type) {
    case ACTION_WEIGH_START: {
        /* 业务：执行称量。这里用模拟值演示；真实设备在此驱动传感器并等待稳定 */
        s_state.weigh_count++;
        float weight = 12.34f * (float)s_state.weigh_count;
        hmip_ack(h, f, HMIP_STATUS_OK, (const uint8_t *)&weight,
                 sizeof(weight));
        break;
    }
    case ACTION_MIX_START: {
        /* 业务：启动搅拌，转速/时长由后续动作参数帧携带（示例略） */
        hmip_ack_ok(h, f);
        break;
    }
    case ACTION_VISCOSITY_MEASURE: {
        /* 业务：测量粘度并回传读数 */
        float viscosity = 5.50f;
        hmip_ack(h, f, HMIP_STATUS_OK, (const uint8_t *)&viscosity,
                 sizeof(viscosity));
        break;
    }
    default:
        /* 未约定的动作编号（0x40 及以上视为动作空间）：回错误状态 */
        if (f->msg_type >= 0x40u) {
            hmip_ack(h, f, 0x0001u, NULL, 0);
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

    if (method == METHOD_PING) {
        static const uint8_t pong[] = { 'P', 'O', 'N', 'G' };
        /* 回 RESPONSE：channel/seq 回显，request_id 原样回传 */
        hmip_send_response(h, f->channel, f->seq, request_id, HMIP_STATUS_OK,
                           pong, sizeof(pong));
    }
}

void device_business_setup(hmip_config_t *cfg)
{
    cfg->on_frame = on_frame;
    cfg->on_request = on_request;
}
