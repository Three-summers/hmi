/**
 * 确认对话框状态管理 Hook
 *
 * 提供统一的确认弹窗能力，避免在各组件中重复实现确认逻辑。
 * 适用于删除、重置、关闭等需要二次确认的危险操作。
 *
 * @module useConfirm
 */

import { useState, useCallback } from "react";

/** 确认对话框状态 */
interface ConfirmState {
    /** 是否打开弹窗 */
    isOpen: boolean;
    /** 弹窗标题 */
    title: string;
    /** 提示消息 */
    message: string;
    /** 确认后的回调函数 */
    onConfirm: () => void;
}

/** Hook 返回值 */
interface UseConfirmReturn {
    /** 确认对话框状态 */
    confirmState: ConfirmState;
    /** 显示确认对话框 */
    showConfirm: (
        title: string,
        message: string,
        onConfirm: () => void,
    ) => void;
    /** 关闭确认对话框 */
    closeConfirm: () => void;
    /** 执行确认操作 */
    handleConfirm: () => void;
}

/** 初始状态：弹窗关闭且内容为空 */
const initialState: ConfirmState = {
    isOpen: false,
    title: "",
    message: "",
    onConfirm: () => {},
};

/**
 * 确认对话框状态管理 Hook
 *
 * @returns 确认对话框的状态和操作方法
 *
 * @example
 * ```tsx
 * const { confirmState, showConfirm, closeConfirm, handleConfirm } = useConfirm();
 *
 * const handleDelete = () => {
 *   showConfirm("删除确认", "确定要删除吗？", () => {
 *     // 执行删除操作
 *   });
 * };
 * ```
 */
export function useConfirm(): UseConfirmReturn {
    const [confirmState, setConfirmState] =
        useState<ConfirmState>(initialState);

    // 打开确认弹窗：保存标题、消息和确认回调
    const showConfirm = useCallback(
        (title: string, message: string, onConfirm: () => void) => {
            setConfirmState({ isOpen: true, title, message, onConfirm });
        },
        [],
    );

    // 关闭弹窗：重置为初始状态
    const closeConfirm = useCallback(() => {
        setConfirmState(initialState);
    }, []);

    // 执行确认操作：先调用用户传入的回调，再关闭弹窗
    const handleConfirm = useCallback(() => {
        confirmState.onConfirm();
        closeConfirm();
    }, [confirmState, closeConfirm]);

    return { confirmState, showConfirm, closeConfirm, handleConfirm };
}
