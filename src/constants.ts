/**
 * 应用常量配置
 */

// 通信配置
export const COMM_CONFIG = {
    /** TCP 连接超时时间 (ms) */
    TCP_TIMEOUT_MS: 5000,
    /** TCP 端口范围 */
    TCP_PORT_MIN: 1,
    TCP_PORT_MAX: 65535,
    /** 串口默认波特率 */
    DEFAULT_BAUD_RATE: 9600,
    /** 支持的波特率列表 */
    BAUD_RATES: [9600, 19200, 38400, 57600, 115200] as const,
} as const;

// 日志桥接配置
export const LOG_BRIDGE_CONFIG = {
    /** 批量发送最大条数 */
    MAX_BATCH_SIZE: 50,
    /** 刷新间隔 (ms) */
    FLUSH_INTERVAL_MS: 250,
    /** 单条消息最大长度 */
    MAX_MESSAGE_LENGTH: 8000,
} as const;

// 通知配置
export const NOTIFICATION_CONFIG = {
    /** 默认显示时长 (ms) */
    DEFAULT_DURATION: 5000,
} as const;

// 频谱图配置
export const SPECTRUM_CONFIG = {
    /** dB 范围 */
    MIN_AMPLITUDE_DB: -100,
    MAX_AMPLITUDE_DB: 0,
    /** dB 刻度步长 */
    DB_STEPS: [-100, -90, -80, -70, -60, -50, -40, -30, -20, -10, 0] as const,
    /** 频率刻度 (kHz) */
    FREQ_STEPS_KHZ: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const,
    /** 动画平滑因子 */
    SMOOTHING_FACTOR: 0.4,
} as const;

// 文件浏览配置
export const FILES_CONFIG = {
    /** 默认可见图表数 */
    DEFAULT_VISIBLE_CHARTS: 4,
} as const;

// UI 配置
export const UI_CONFIG = {
    /** 滚动条宽度 */
    SCROLLBAR_WIDTH: 8,
} as const;
