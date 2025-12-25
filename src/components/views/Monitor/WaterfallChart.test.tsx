import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { render } from "@/test/utils";
import { useSpectrumData } from "@/hooks";
import { WaterfallChart } from "./WaterfallChart";

vi.mock("@/hooks", () => ({
    useSpectrumData: vi.fn(),
    useCanvasScale: vi.fn(() => ({
        scale: 1,
        scaledCanvas: { width: 800, height: 600 },
    })),
}));

function mockResult(overrides: Partial<ReturnType<typeof useSpectrumData>>) {
    return {
        status: "loading",
        error: null,
        latestRef: { current: null },
        stats: {
            peak_frequency: 0,
            peak_amplitude: -90,
            average_amplitude: -90,
            bandwidth: 0,
        },
        clear: vi.fn(),
        retry: vi.fn(),
        ...overrides,
    } as ReturnType<typeof useSpectrumData>;
}

describe("Monitor/WaterfallChart", () => {
    it("status=loading：应显示加载态", () => {
        vi.mocked(useSpectrumData).mockReturnValue(mockResult({}));

        render(<WaterfallChart isActive />);
        expect(screen.getByText("加载中...")).toBeInTheDocument();
    });

    it("status=error：应显示错误与重试按钮", () => {
        const retry = vi.fn();
        vi.mocked(useSpectrumData).mockReturnValue(
            mockResult({ status: "error", error: "boom", retry }),
        );

        render(<WaterfallChart isActive />);
        expect(screen.getByText("数据获取失败")).toBeInTheDocument();
        expect(screen.getByText("boom")).toBeInTheDocument();

        fireEvent.click(screen.getByRole("button", { name: "重试" }));
        expect(retry).toHaveBeenCalledTimes(1);
    });

    it("status=ready：应渲染 canvas", () => {
        vi.mocked(useSpectrumData).mockReturnValue(
            mockResult({ status: "ready" }),
        );

        const { container } = render(<WaterfallChart isActive />);
        expect(container.querySelector("canvas")).toBeTruthy();
    });
});

