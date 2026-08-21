/**
 * device_business.h — 设备业务示例：光阻稀释机台（秤/搅拌器/粘度计）
 *
 * 演示“业务代码只需要写回调 + 调用发送方法”：
 *   - 处理 HMI 下发的动作帧（msgType 0x40/0x41/0x42 为双方约定编号）
 *   - 动作完成后用 hmip_ack 回 RESPONSE（自动回显 channel/seq，request_id=seq）
 *   - 处理 HMI 的 REQUEST（method=1 的 ping）
 *
 * 该模块与平台无关，可同时用于主机测试与 STM32 目标。
 */
#ifndef DEVICE_BUSINESS_H
#define DEVICE_BUSINESS_H

#include "hmip.h"

/**
 * 把业务回调挂到 hmip_config_t 上（在 hmip_init 之前调用）。
 * 使用方仍需要自行填写 tx_write / rx_buf / channel / name 等字段。
 */
void device_business_setup(hmip_config_t *cfg);

#endif /* DEVICE_BUSINESS_H */
