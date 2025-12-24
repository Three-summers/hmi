import { defineConfig } from "vitest/config";
import { mergeConfig } from "vite";
import viteConfig from "./vite.config";

export default mergeConfig(
    viteConfig,
    defineConfig({
        test: {
            environment: "jsdom",
            environmentOptions: {
                jsdom: {
                    url: "http://localhost/",
                },
            },
            setupFiles: ["./src/test/setup.ts"],
            testTimeout: 10000,
            coverage: {
                provider: "v8",
                reporter: ["text", "html"],
                reportsDirectory: "coverage",
                all: true,
                include: [
                    // T01：基础工具
                    "src/utils/async.ts",
                    "src/utils/error.ts",
                    // T04：TitlePanel 拆分（布局逻辑）
                    "src/components/layout/TitlePanel.tsx",
                    "src/components/layout/TitleSection.tsx",
                    "src/components/layout/InfoSection.tsx",
                    "src/components/layout/CommandSection.tsx",
                    "src/hooks/useCommandHandler.ts",
                    "src/types/semi-e95.ts",
                    // T05：Keep-Alive 副作用 + Zustand 订阅门控
                    "src/hooks/useStoreWhenActive.ts",
                    "src/hooks/useIntervalWhenActive.ts",
                    "src/components/layout/InfoPanel.tsx",
                    "src/components/layout/ViewContext.tsx",
                    // T08：ErrorBoundary + 重试策略
                    "src/components/common/ErrorBoundary.tsx",
                    "src/hooks/useRetry.ts",
                    "src/hooks/useErrorBoundary.ts",
                    "src/platform/invoke.ts",
                    "src/stores/commStore.ts",
                    "src/hooks/useFileTree.ts",
                    "src/hooks/useFilePreview.ts",
                    "src/hooks/useChartData.ts",
                    // T03：Monitor 视图拆分（逻辑 + 数据）
                    "src/hooks/useSpectrumData.ts",
                    "src/hooks/useChartInit.ts",
                    "src/components/views/Monitor/index.tsx",
                    "src/components/views/Monitor/SpectrumAnalyzer.tsx",
                    "src/components/views/Monitor/WaterfallChart.tsx",
                    "src/components/views/Monitor/AlarmList.tsx",
                    "src/components/views/Monitor/SpectrumChart.tsx",
                ],
                exclude: [
                    "**/*.d.ts",
                    "**/*.test.ts",
                    "**/*.test.tsx",
                    "**/*.spec.ts",
                    "**/*.spec.tsx",
                ],
                lines: 90,
                branches: 90,
                functions: 90,
                statements: 90,
            },
        },
    }),
);
