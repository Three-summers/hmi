import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useEffect } from "react";
import { ErrorBoundary } from "@/components/common/ErrorBoundary";
import { useErrorBoundary } from "./useErrorBoundary";
import { render, screen } from "@testing-library/react";

describe("hooks/useErrorBoundary", () => {
    it("throwOnRender=false 时应仅记录错误，不应抛出", () => {
        const { result } = renderHook(() =>
            useErrorBoundary({ throwOnRender: false }),
        );

        act(() => {
            result.current.showBoundary(new Error("boom"));
        });

        expect(result.current.error?.message).toBe("boom");

        act(() => {
            result.current.resetBoundary();
        });

        expect(result.current.error).toBeNull();
    });

    it("默认 throwOnRender=true：showBoundary 后应被最近的 ErrorBoundary 捕获", async () => {
        function Trigger() {
            const { showBoundary } = useErrorBoundary();

            useEffect(() => {
                showBoundary(new Error("boom"));
            }, [showBoundary]);

            return <div>ok</div>;
        }

        render(
            <ErrorBoundary fallback={({ error }) => <div>{error.message}</div>}>
                <Trigger />
            </ErrorBoundary>,
        );

        expect(await screen.findByText("boom")).toBeInTheDocument();
    });
});

