/**
 * 通用类型定义（跨模块复用）
 *
 * @module types/common
 */

/**
 * 通用错误处理回调
 *
 * 约定：
 * - message：面向 UI/日志的可读错误信息（已完成字符串化/格式化）
 * - error：原始错误对象（unknown），用于 debug/追踪
 */
export type ErrorHandler = (
    message: string,
    error: unknown,
) => void | Promise<void>;

