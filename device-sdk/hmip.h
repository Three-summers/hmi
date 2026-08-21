/**
 * hmip.h — HMI Binary Protocol v1 (HMIP) 设备端 C SDK
 *
 * 面向 STM32 等嵌入式平台的轻量实现：
 *   - C99，无动态内存分配（接收缓冲区由使用方提供）
 *   - 只依赖 <stdint.h>/<stddef.h>/<string.h>，无 HAL/OS 依赖
 *   - 单实例模型：使用方静态分配 hmip_t 并传入 hmip_config_t
 *   - 协议契约与 HMI 侧文档保持一致：docs/device-serial-interface.md
 *
 * 典型用法（业务代码只需要写回调 + 调用发送方法）：
 *
 *   static uint8_t rx_buf[256];
 *   static hmip_t dev;
 *
 *   static void on_action(hmip_t *h, const hmip_frame_t *f, void *user) {
 *       (void)user;
 *       switch (f->msg_type) {
 *       case 0x40:                          // 业务约定：称量动作
 *           start_weighing();
 *           hmip_ack_ok(h, f);              // 完成后回 status=0 响应
 *           break;
 *       ...
 *       }
 *   }
 *
 *   int main(void) {
 *       hmip_config_t cfg = {
 *           .tx_write    = uart_tx_write,   // 把字节写进串口（阻塞或环形缓冲）
 *           .tx_ctx      = NULL,
 *           .rx_buf      = rx_buf,
 *           .rx_buf_size = sizeof(rx_buf),
 *           .channel     = 1,               // 本设备通道号（与 HMI workspace 配置一致）
 *           .role        = HMIP_ROLE_SERVER,
 *           .capabilities = 0,
 *           .name        = "weigh-scale",
 *           .on_frame    = on_action,
 *       };
 *       hmip_init(&dev, &cfg);
 *       ...
 *       // UART 收数据（HAL 回调或主循环轮询）：
 *       hmip_feed(&dev, rx_chunk, rx_chunk_len);
 *   }
 *
 * 时间基准：心跳/事件的时间戳由使用方传入（timestamp_ms），SDK 不依赖 RTC。
 */
#ifndef HMIP_H
#define HMIP_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/* ==================== 协议常量 ==================== */

#define HMIP_VERSION 1u
#define HMIP_FLAG_CRC32 0x01u

#define HMIP_HEADER_BASE_LEN 16u
#define HMIP_HEADER_WITH_CRC_LEN 20u

#define HMIP_MIN_RX_BUF_SIZE HMIP_HEADER_WITH_CRC_LEN

#define HMIP_MSG_HELLO 0x01u
#define HMIP_MSG_HELLO_ACK 0x02u
#define HMIP_MSG_HEARTBEAT 0x03u
#define HMIP_MSG_REQUEST 0x10u
#define HMIP_MSG_RESPONSE 0x11u
#define HMIP_MSG_EVENT 0x20u
#define HMIP_MSG_ERROR 0x7Fu

#define HMIP_ROLE_CLIENT 0u
#define HMIP_ROLE_SERVER 1u

/* 业务常用状态码（RESPONSE.status，双方可自定义） */
#define HMIP_STATUS_OK 0u

/* ==================== 错误码 ==================== */

typedef enum {
    HMIP_OK = 0,
    HMIP_ERR_ARG = 1,             /* 参数/配置错误 */
    HMIP_ERR_TX = 2,              /* tx_write 返回非 0 */
    HMIP_ERR_OVERFLOW = 3,        /* 接收缓冲区溢出（数据被整体丢弃） */
    HMIP_ERR_RESYNC = 4,          /* 噪声/错位：已丢弃字节重新对齐 */
    HMIP_ERR_BAD_VERSION = 5,     /* 帧版本 != 1（已丢弃 1 字节重对齐） */
    HMIP_ERR_PAYLOAD_TOO_LARGE = 6, /* payload 长度超过接收缓冲区容量 */
    HMIP_ERR_CRC = 7              /* payload CRC32 校验失败（帧已丢弃） */
} hmip_err_t;

/* ==================== 帧视图 ==================== */

/** 解码出的完整帧。payload 指向接收缓冲区内部，仅在回调执行期间有效。 */
typedef struct {
    uint8_t msg_type;
    uint8_t flags;      /* bit0 = 带 CRC32 */
    uint8_t channel;
    uint32_t seq;
    const uint8_t *payload;
    size_t payload_len;
    uint32_t payload_crc32; /* 仅当 (flags & HMIP_FLAG_CRC32) 时有效 */
} hmip_frame_t;

typedef struct hmip hmip_t;

/* ==================== 回调 ==================== */

/**
 * 原始帧回调：对每一个解码成功的帧都会调用（若注册）。
 * 业务自定义动作（HMI → 设备）通常在此处理；标准消息（REQUEST 等）可
 * 同时注册更细粒度的类型化回调。
 * 注意：回调内可以安全地调用 hmip_send_* 系列函数。
 */
typedef void (*hmip_on_frame_fn)(hmip_t *h, const hmip_frame_t *frame, void *user);

/** 解码/重同步错误回调（可选）。dropped_bytes 为本次丢弃的字节数。 */
typedef void (*hmip_on_decode_error_fn)(hmip_t *h, int err, size_t dropped_bytes, void *user);

typedef void (*hmip_on_hello_fn)(hmip_t *h, const hmip_frame_t *frame,
                                 uint8_t role, uint32_t capabilities,
                                 const char *name, size_t name_len, void *user);
typedef void (*hmip_on_hello_ack_fn)(hmip_t *h, const hmip_frame_t *frame,
                                     uint32_t capabilities,
                                     const char *name, size_t name_len, void *user);
typedef void (*hmip_on_heartbeat_fn)(hmip_t *h, const hmip_frame_t *frame,
                                     uint64_t timestamp_ms, void *user);
typedef void (*hmip_on_request_fn)(hmip_t *h, const hmip_frame_t *frame,
                                   uint32_t request_id, uint16_t method,
                                   const uint8_t *body, size_t body_len, void *user);
typedef void (*hmip_on_response_fn)(hmip_t *h, const hmip_frame_t *frame,
                                    uint32_t request_id, uint16_t status,
                                    const uint8_t *body, size_t body_len, void *user);
typedef void (*hmip_on_event_fn)(hmip_t *h, const hmip_frame_t *frame,
                                 uint16_t event_id, uint64_t timestamp_ms,
                                 const uint8_t *body, size_t body_len, void *user);
typedef void (*hmip_on_error_fn)(hmip_t *h, const hmip_frame_t *frame,
                                 uint16_t code,
                                 const char *message, size_t message_len, void *user);

/* ==================== 配置与实例 ==================== */

typedef struct {
    /**
     * 发送回调（必填）：SDK 会以 1~3 个连续块写出完整一帧
     * （帧头 / 消息定长字段 / 消息体），每块调用一次 tx_write。
     * 返回 0 表示成功。实现可以是阻塞发送，也可以是把字节推入发送环形
     * 缓冲并启动中断发送（推荐）。
     */
    int (*tx_write)(const uint8_t *data, size_t len, void *ctx);
    void *tx_ctx;

    /** 接收缓冲区（必填）：使用方提供的静态数组，容量 >= HMIP_MIN_RX_BUF_SIZE */
    uint8_t *rx_buf;
    size_t rx_buf_size;

    /** 本设备默认通道号：设备主动发帧（HELLO/HEARTBEAT/EVENT/ERROR）时使用 */
    uint8_t channel;

    /** HELLO 报文内容 */
    uint8_t role;          /* HMIP_ROLE_CLIENT / HMIP_ROLE_SERVER */
    uint32_t capabilities;
    const char *name;      /* UTF-8，长度 <= 255 字节 */

    /**
     * 发送辅助函数（hmip_ack / hmip_send_hello / ...）默认使用的 FLAGS，
     * 例如设为 HMIP_FLAG_CRC32 即为所有发出的帧启用 CRC。
     */
    uint8_t default_flags;

    /* 回调（均可选） */
    hmip_on_frame_fn on_frame;
    hmip_on_decode_error_fn on_decode_error;
    hmip_on_hello_fn on_hello;
    hmip_on_hello_ack_fn on_hello_ack;
    hmip_on_heartbeat_fn on_heartbeat;
    hmip_on_request_fn on_request;
    hmip_on_response_fn on_response;
    hmip_on_event_fn on_event;
    hmip_on_error_fn on_error;

    void *user; /* 透传给所有回调 */
} hmip_config_t;

struct hmip {
    hmip_config_t cfg;
    size_t rx_len;      /* 接收缓冲区中待解析的字节数 */
    uint32_t tx_seq;    /* 本端发送序号（自增，与 HMI 侧约定一致） */
};

/* ==================== 生命周期与接收 ==================== */

/** 初始化。返回 HMIP_OK 或 HMIP_ERR_ARG。 */
int hmip_init(hmip_t *h, const hmip_config_t *cfg);

/**
 * 把收到的字节送入解码器。返回最后一次解析错误码（HMIP_OK=无错误）。
 * 一帧完整到达时会立即调用回调（在调用方上下文执行）。
 * 中断安全建议：ISR 里只把字节放入你自己的环形缓冲，主循环再 hmip_feed()。
 */
int hmip_feed(hmip_t *h, const uint8_t *data, size_t len);

/** 重新尝试解析缓冲中的剩余数据（feed 已自动解析，此函数一般无需调用）。 */
int hmip_poll(hmip_t *h);

/* ==================== 发送 ==================== */

/** 取下一个发送序号（1 起自增）。 */
uint32_t hmip_next_seq(hmip_t *h);

/**
 * 发送任意一帧（业务自定义动作等）。
 * seq 传 0 表示自动分配序号。
 */
int hmip_send_frame(hmip_t *h, uint8_t msg_type, uint8_t flags,
                    uint8_t channel, uint32_t seq,
                    const uint8_t *payload, size_t payload_len);

/** 发送 HELLO（使用配置中的 role/capabilities/name/channel）。 */
int hmip_send_hello(hmip_t *h);

/** 发送 HEARTBEAT。timestamp_ms 为设备本地毫秒时间戳。 */
int hmip_send_heartbeat(hmip_t *h, uint64_t timestamp_ms);

/** 发送 REQUEST（设备主动向 HMI 请求）。method 为双方约定的方法号。 */
int hmip_send_request(hmip_t *h, uint8_t channel, uint32_t request_id,
                      uint16_t method, const uint8_t *body, size_t body_len);

/** 发送 RESPONSE。 */
int hmip_send_response(hmip_t *h, uint8_t channel, uint32_t seq,
                       uint32_t request_id, uint16_t status,
                       const uint8_t *body, size_t body_len);

/** 发送 EVENT（主动上报）。 */
int hmip_send_event(hmip_t *h, uint8_t channel, uint16_t event_id,
                    uint64_t timestamp_ms,
                    const uint8_t *body, size_t body_len);

/** 发送 ERROR（协议/业务错误报告）。message 为 UTF-8，长度 <= 65535。 */
int hmip_send_error(hmip_t *h, uint8_t channel, uint16_t code,
                    const char *message);

/**
 * 便捷应答：对收到的请求帧 f 回一条 RESPONSE。
 *   - channel 与请求帧一致
 *   - 帧头 seq 回显请求帧 seq
 *   - payload request_id 写入请求帧 seq（与 HMI 文档 §5.6 建议一致）
 */
int hmip_ack(hmip_t *h, const hmip_frame_t *f, uint16_t status,
             const uint8_t *body, size_t body_len);

/** 便捷应答：status=HMIP_STATUS_OK、无消息体的成功响应。 */
int hmip_ack_ok(hmip_t *h, const hmip_frame_t *f);

/* ==================== 工具 ==================== */

/**
 * IEEE CRC-32（多项式 0xEDB88320，与 zlib crc32 一致，与 HMI 侧 crc32fast 一致）。
 * 初始值 0xFFFFFFFF，结果不做取反；HMIP 只对 payload 计算该 CRC。
 */
uint32_t hmip_crc32(const uint8_t *data, size_t len);

/** 错误码描述（调试用）。 */
const char *hmip_strerror(int err);

#ifdef __cplusplus
}
#endif

#endif /* HMIP_H */
