/**
 * 截图目录选择与持久化（IndexedDB）
 *
 * 说明：
 * - 目录选择使用 File System Access API（`showDirectoryPicker`），会弹出系统目录选择对话框
 * - 目录句柄（FileSystemDirectoryHandle）不可序列化到 localStorage，因此使用 IndexedDB 持久化
 * - 该能力在不同 WebView/浏览器上支持度不同：不支持时应回落到“下载目录”
 *
 * @module screenshotDirectory
 */

const DB_NAME = "hmi";
const STORE_NAME = "keyval";
const SCREENSHOT_DIR_KEY = "spectrumAnalyzer.screenshot.directoryHandle";

function openDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);

        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME);
            }
        };

        request.onsuccess = () => resolve(request.result);
        request.onerror = () =>
            reject(request.error ?? new Error("IndexedDB open failed"));
    });
}

async function idbGet<T>(key: string): Promise<T | null> {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readonly");
        const store = tx.objectStore(STORE_NAME);
        const req = store.get(key);
        req.onsuccess = () => resolve((req.result as T | undefined) ?? null);
        req.onerror = () =>
            reject(req.error ?? new Error("IndexedDB get failed"));
    });
}

async function idbSet<T>(key: string, value: T): Promise<void> {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        const store = tx.objectStore(STORE_NAME);
        const req = store.put(value, key);
        req.onsuccess = () => resolve();
        req.onerror = () =>
            reject(req.error ?? new Error("IndexedDB put failed"));
    });
}

async function idbDelete(key: string): Promise<void> {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        const store = tx.objectStore(STORE_NAME);
        const req = store.delete(key);
        req.onsuccess = () => resolve();
        req.onerror = () =>
            reject(req.error ?? new Error("IndexedDB delete failed"));
    });
}

export function isDirectoryPickerSupported(): boolean {
    return (
        typeof window !== "undefined" &&
        typeof (window as any).showDirectoryPicker === "function"
    );
}

export async function pickScreenshotDirectory(): Promise<FileSystemDirectoryHandle | null> {
    if (!isDirectoryPickerSupported()) return null;

    try {
        const picker = (window as any).showDirectoryPicker as () => Promise<FileSystemDirectoryHandle>;
        return await picker();
    } catch (error) {
        // 用户取消选择：视为无操作
        if (error instanceof DOMException && error.name === "AbortError") {
            return null;
        }
        throw error;
    }
}

export async function saveScreenshotDirectoryHandle(
    handle: FileSystemDirectoryHandle,
): Promise<void> {
    await idbSet(SCREENSHOT_DIR_KEY, handle);
}

export async function loadScreenshotDirectoryHandle(): Promise<FileSystemDirectoryHandle | null> {
    return await idbGet<FileSystemDirectoryHandle>(SCREENSHOT_DIR_KEY);
}

export async function clearScreenshotDirectoryHandle(): Promise<void> {
    await idbDelete(SCREENSHOT_DIR_KEY);
}

export async function ensureDirectoryReadWritePermission(
    handle: FileSystemDirectoryHandle,
): Promise<boolean> {
    // Safari/WKWebView 等环境可能不存在权限 API，这里做兼容
    const anyHandle = handle as any;
    if (typeof anyHandle.queryPermission !== "function") return true;

    const query = (anyHandle.queryPermission as (options: { mode: "readwrite" }) => Promise<PermissionState>);
    const request = (anyHandle.requestPermission as (options: { mode: "readwrite" }) => Promise<PermissionState>);

    const current = await query({ mode: "readwrite" });
    if (current === "granted") return true;
    const next = await request({ mode: "readwrite" });
    return next === "granted";
}

export async function writeBlobToDirectory(
    directory: FileSystemDirectoryHandle,
    filename: string,
    blob: Blob,
): Promise<void> {
    const ok = await ensureDirectoryReadWritePermission(directory);
    if (!ok) {
        throw new Error("Directory permission denied");
    }

    const fileHandle = await directory.getFileHandle(filename, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(blob);
    await writable.close();
}

