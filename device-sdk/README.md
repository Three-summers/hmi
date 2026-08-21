# device-sdk — HMIP v1 设备端 C SDK（STM32 等嵌入式平台）

面向设备侧（下位机/固件）开发人员的 HMIP 协议实现。**业务代码只需要写回调 + 调用发送方法**，帧封装/CRC/拆包粘包/重同步全部由 SDK 处理。

协议契约见 HMI 侧文档：[docs/device-serial-interface.md](../../docs/device-serial-interface.md)（帧格式、消息类型、链路行为、§5.6 请求-响应对应机制）。

## 特性

- **C99，无动态内存**：接收缓冲区由使用方提供（静态数组），无 malloc/OS 依赖
- **只需两个硬件接口**：`tx_write`（写字节）+ `hmip_feed`（喂入收到的字节）
- **解码器与 HMI 侧 Rust 实现行为一致**：拆包/粘包、噪声重同步、版本/长度/CRC 异常丢弃重对齐
- **CRC32**：IEEE 802.3（与 zlib / HMI 侧 crc32fast 完全一致），运行期一次性建表（无 1KB 常量表）
- **消息层**：HELLO / HELLO_ACK / HEARTBEAT / REQUEST / RESPONSE / EVENT / ERROR + 任意自定义动作帧
- **应答约定内置**：`hmip_ack` 自动回显 channel/seq，并把请求 seq 写入 RESPONSE 的 request_id（符合接口文档 §5.6 建议）

## 文件结构

```
device-sdk/
  hmip.h                      SDK 头文件（API 文档写在注释里）
  hmip.c                      SDK 实现（单文件，可直接加入工程）
  examples/
    device_business.c/.h      业务示例：光阻稀释机台（称量/搅拌/测粘度 + ping）
    host_demo.c               主机回环演示（HMI 侧 <-> 设备侧）
  tests/test_hmip.c           测试套件（7000+ 断言）
  Makefile                    主机测试/演示构建
```

## 快速上手（STM32）

### 1. 加入工程

把 `hmip.c` / `hmip.h` 拷入工程（CubeIDE 直接添加文件即可，无需任何配置宏）。

### 2. 分配实例与缓冲（全局静态）

```c
#include "hmip.h"

static uint8_t s_rx_buf[256];       /* 接收缓冲：至少 20 字节，建议 >= 最大单帧 */
static hmip_t   s_dev;              /* SDK 实例 */

#define MY_CHANNEL 1u               /* 与 HMI workspace devices/*.json 的 channel 一致 */
```

### 3. 实现发送回调（推荐：环形缓冲 + 中断发送）

```c
/* 把字节推入发送环形缓冲并启动发送中断；SDK 会分 1~3 块写出一帧 */
static int uart_tx_write(const uint8_t *data, size_t len, void *ctx)
{
    (void)ctx;
    for (size_t i = 0; i < len; i++) {
        if (ringbuf_push(&s_tx_rb, data[i]) != 0) return -1;  /* 满则报错 */
    }
    __HAL_UART_ENABLE_IT(&huart1, UART_IT_TXE);               /* 启动中断发送 */
    return 0;
}
```

### 4. 写业务回调

```c
static void on_action(hmip_t *h, const hmip_frame_t *f, void *user)
{
    (void)user;
    switch (f->msg_type) {
    case 0x40:   /* 双方约定：称量 */
        start_weighing();                    /* 你的业务：驱动传感器 */
        hmip_ack_ok(h, f);                   /* 完成后回 status=0 响应 */
        break;
    case 0x41:   /* 搅拌 */
        {
            float weight = read_weight();    /* 业务值 */
            hmip_ack(h, f, HMIP_STATUS_OK,   /* 可携带业务 body（编码双方约定） */
                     (const uint8_t *)&weight, sizeof(weight));
        }
        break;
    default:
        break;
    }
}
```

### 5. 初始化 + 收数据

```c
void app_init(void)
{
    hmip_config_t cfg = {
        .tx_write     = uart_tx_write,
        .tx_ctx       = NULL,
        .rx_buf       = s_rx_buf,
        .rx_buf_size  = sizeof(s_rx_buf),
        .channel      = MY_CHANNEL,
        .role         = HMIP_ROLE_SERVER,
        .capabilities = 0,
        .name         = "weigh-scale",
        .default_flags = 0,                /* 设 HMIP_FLAG_CRC32 则所有发送帧启用 CRC */
        .on_frame     = on_action,          /* 业务回调 */
    };
    hmip_init(&s_dev, &cfg);
}

/* 主循环（推荐：中断把字节收进自己的环形缓冲，主循环喂给 SDK） */
void app_loop(void)
{
    uint8_t chunk[64];
    size_t n;
    while ((n = ringbuf_drain(&s_rx_rb, chunk, sizeof(chunk))) > 0) {
        int rc = hmip_feed(&s_dev, chunk, n);
        if (rc != HMIP_OK) {
            /* 例如 HMIP_ERR_CRC / HMIP_ERR_RESYNC，可记日志或告警 */
        }
    }
    /* 周期心跳（设备本地毫秒时间戳） */
    if (heartbeat_due()) hmip_send_heartbeat(&s_dev, hal_millis());
}
```

若使用阻塞式发送（简单场景），`tx_write` 直接调 `HAL_UART_Transmit` 返回状态即可。

## API 一览

| 分类 | 函数 |
|---|---|
| 生命周期 | `hmip_init` |
| 接收 | `hmip_feed` / `hmip_poll` |
| 通用发送 | `hmip_send_frame`（任意自定义帧，seq 传 0 自动分配） |
| 标准消息 | `hmip_send_hello` / `hmip_send_heartbeat` / `hmip_send_request` / `hmip_send_response` / `hmip_send_event` / `hmip_send_error` |
| 应答便捷 | `hmip_ack` / `hmip_ack_ok`（回显 channel/seq，request_id=请求 seq） |
| 工具 | `hmip_next_seq` / `hmip_crc32` / `hmip_strerror` |

回调：`on_frame`（所有帧，业务动作在此处理）、`on_request/on_response/on_event/on_error/on_hello/on_hello_ack/on_heartbeat`（标准消息类型化）、`on_decode_error`（解码/重同步错误，可接告警灯）。

## 协议要点提醒（与 HMI 侧约定一致）

- 所有多字节字段**小端**；CRC32 只覆盖 payload，LE 存放
- 收到动作帧后：**channel 必须回显**，帧头 seq 建议回显，payload request_id 建议写入请求 seq（`hmip_ack` 已内置）
- **不要重发完成帧**：HMI 侧匹配不看 seq，迟到的重复响应可能串扰下一步骤（见接口文档 §5.6）
- 相邻步骤若复用同一反馈键，建议用不同 `status` 区分完成（残留值问题，见 §5.6）
- 设备上电可主动发 HELLO + 周期 HEARTBEAT（HMI 不主动握手/心跳）

## 测试（主机）

```sh
make test      # 编译并运行测试套件（gcc，需在 PATH 中）
make example   # 编译并运行回环演示
make interop   # 与 HMI 侧真实 Rust 协议代码的双向互操作联调（需 rustup 工具链 + node）
make clean
```

主机端编译产物统一输出到 `build/`（已 git 忽略），`make clean` 会删除该目录。

### 串口模拟联调（serial-mock，socat 虚拟串口）

用 socat 创建 **PTY 对（虚拟串口）**，把联调升级到真实串口设备节点上：

```
ref-serial（HMI 真实串口栈：src-tauri/src/comm/serial.rs + proto.rs，tokio-serial 打开 PTY）
   │ /tmp/hmi_mock_a（115200 8N1 配置路径）
socat pty <──字节流──> socat pty
   │ /tmp/hmi_mock_b（O_RDWR + cfmakeraw，与 STM32 用法一致）
pty_device（C SDK 设备端模拟器，跑在真实 TTY 上）
```

验证内容（全部走真实 TTY，不再是管道）：

- 设备上电 HELLO/HEARTBEAT → HMI 真实解码器
- 称量动作 → 应答 **seq/channel 回显 + float32 body**（真实 tokio-serial 收发）
- 未知动作 → status=1；PING → PONG
- 40 轮随机动作 fuzz（回显不变量逐轮断言）
- 线路噪声注入 4 字节 → 真实解码器重同步 + EVENT 恢复

`make serial-mock` 一键运行（需 socat + rustup 工具链 + node）。

### 互操作联调（interop）

这是**与 HMI 后端真实生产代码**的交叉验证：`interop/ref-hmip` 直接
`include` HMI 仓库的 `src-tauri/src/comm/proto.rs`（不改写一行），与 C SDK
通过管道双向互发互解。驱动脚本 `interop/run_interop.mjs` 共 6 个阶段、
5256 项断言：

| 阶段 | 内容 |
|---|---|
| A | C SDK 编码 → Rust 解码：300 帧随机模糊（CRC/空 payload/任意 msgType/channel/seq） |
| B | Rust 编码 → C SDK 解码：300 帧随机模糊 |
| C | C SDK 六种标准消息 → Rust `decode_message` 逐字段比对 |
| D | Rust 标准消息（测试编码器，按接口文档布局）→ C SDK 类型化回调逐字段比对 |
| E | 双向噪声重同步交叉验证（各 60 轮，逐字节核对丢弃计数） |
| F | 会话模拟：驱动扮演 HMI → C SDK 设备业务（称量/未知动作/PING）→ Rust 解码验证应答回显语义 |

> 注：真实设备/串口硬件联调仍需要在目标现场进行；本套件验证的是**两侧协议实现的
> 线上字节兼容性**（帧格式、CRC、重同步、消息布局、应答回显语义）。

测试覆盖（11702 项断言）：

- **CRC32**：zlib 标准校验向量 + 协议文档黄金向量 + 空数据
- **编码**：帧黄金向量（与接口文档 §8.1 逐字节一致）、空 payload/CRC、seq 自动分配、tx 分块写出次数、tx 失败传播
- **解码**：拆包/粘包/手工字节级帧（防编解码对称 bug）、magic 跨包/帧间噪声/payload 内嵌 magic、重同步、版本异常、CRC 异常、超大 payload、payload 容量边界（240 恰放得下 / 241 超限）、缓冲溢出
- **消息层**：全部标准消息类型化回调、畸形消息/非法 role/名称截断不触发回调、HELLO 名称 255 截断、ERROR 消息 65535 上限
- **API**：参数校验（NULL/非法配置）、poll 部分帧、回调内重入发送
- **压力/模糊**：500 轮随机帧随机分片 + 300 轮噪声前缀模糊 + 200 轮双向业务回环（channel/seq/request_id 回显不变量）
- **端到端**：称量/搅拌/测粘度/ping/心跳/事件/未知动作错误状态
