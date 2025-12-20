import { useState, useCallback } from "react";

interface ConfirmState {
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
}

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

const initialState: ConfirmState = {
    isOpen: false,
    title: "",
    message: "",
    onConfirm: () => {},
};

/**
 * 确认对话框状态管理 Hook
 */
export function useConfirm(): UseConfirmReturn {
    const [confirmState, setConfirmState] =
        useState<ConfirmState>(initialState);

    const showConfirm = useCallback(
        (title: string, message: string, onConfirm: () => void) => {
            setConfirmState({ isOpen: true, title, message, onConfirm });
        },
        [],
    );

    const closeConfirm = useCallback(() => {
        setConfirmState(initialState);
    }, []);

    const handleConfirm = useCallback(() => {
        confirmState.onConfirm();
        closeConfirm();
    }, [confirmState, closeConfirm]);

    return { confirmState, showConfirm, closeConfirm, handleConfirm };
}
