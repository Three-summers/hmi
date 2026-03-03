/**
 * 登录弹窗事件桥
 *
 * 作用：
 * - 让任意模块都能在“需要登录时”请求打开登录弹窗
 * - 复用顶部现有登录对话框，不新增重复弹窗实现
 */

const LOGIN_DIALOG_REQUEST_EVENT = "hmi:request-login-dialog";

/**
 * 请求打开登录弹窗
 */
export function requestLoginDialog(): void {
    if (typeof window === "undefined") return;
    window.dispatchEvent(new CustomEvent(LOGIN_DIALOG_REQUEST_EVENT));
}

/**
 * 订阅“请求打开登录弹窗”事件
 *
 * @param handler - 事件处理函数
 * @returns 取消订阅函数
 */
export function subscribeLoginDialogRequest(handler: () => void): () => void {
    if (typeof window === "undefined") return () => {};

    const wrapped = () => handler();
    window.addEventListener(LOGIN_DIALOG_REQUEST_EVENT, wrapped);
    return () => {
        window.removeEventListener(LOGIN_DIALOG_REQUEST_EVENT, wrapped);
    };
}
