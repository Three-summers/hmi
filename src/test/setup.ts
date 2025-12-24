import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeAll, vi } from "vitest";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import zh from "@/i18n/locales/zh.json";
import en from "@/i18n/locales/en.json";

// 同步初始化 i18n（测试环境）
beforeAll(async () => {
    if (!i18n.isInitialized) {
        await i18n.use(initReactI18next).init({
            lng: "zh",
            fallbackLng: "en",
            resources: {
                zh: { translation: zh },
                en: { translation: en },
            },
            interpolation: {
                escapeValue: false,
            },
        });
    }
});

// JSDOM 未实现 ResizeObserver：为图表/布局相关组件提供最小 mock
class ResizeObserverMock {
    private readonly callback: ResizeObserverCallback;

    constructor(callback: ResizeObserverCallback) {
        this.callback = callback;
    }

    observe = (target: Element) => {
        const rect = target.getBoundingClientRect();
        const width = Math.max(1, Math.floor(rect.width || 800));
        const height = Math.max(1, Math.floor(rect.height || 600));

        this.callback(
            [
                {
                    target,
                    contentRect: {
                        width,
                        height,
                        x: 0,
                        y: 0,
                        top: 0,
                        left: 0,
                        right: width,
                        bottom: height,
                        toJSON: () => ({}),
                    } as DOMRectReadOnly,
                    borderBoxSize: [] as unknown as ResizeObserverSize[],
                    contentBoxSize: [] as unknown as ResizeObserverSize[],
                    devicePixelContentBoxSize: [] as unknown as ResizeObserverSize[],
                } as ResizeObserverEntry,
            ],
            this as unknown as ResizeObserver,
        );
    };

    unobserve = (_target: Element) => {
        // noop
    };

    disconnect = () => {
        // noop
    };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).ResizeObserver = ResizeObserverMock;

afterEach(() => {
    cleanup();

    // 测试间隔离：避免 localStorage/sessionStorage 污染导致状态泄漏
    window.localStorage.clear();
    window.sessionStorage.clear();

    // 测试间隔离：避免 mock/spy 泄漏到下一条用例
    vi.restoreAllMocks();
});
