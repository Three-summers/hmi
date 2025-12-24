import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { ErrorBoundary } from "../ErrorBoundary";

function Boom({ shouldThrow }: { shouldThrow: boolean }) {
    if (shouldThrow) {
        throw new Error("boom");
    }
    return <div>ok</div>;
}

describe("components/common/ErrorBoundary", () => {
    it("未出错时应正常渲染 children", () => {
        render(
            <ErrorBoundary>
                <div>hello</div>
            </ErrorBoundary>,
        );
        expect(screen.getByText("hello")).toBeInTheDocument();
    });

    it("捕获渲染错误后应渲染 fallback，并支持 reset", () => {
        const onError = vi.fn();

        function Wrapper() {
            const [shouldThrow, setShouldThrow] = useState(true);

            return (
                <ErrorBoundary
                    onError={onError}
                    fallback={({ error, reset }) => (
                        <div>
                            <div data-testid="err">{error.message}</div>
                            <button
                                type="button"
                                onClick={() => {
                                    setShouldThrow(false);
                                    reset();
                                }}
                            >
                                retry
                            </button>
                        </div>
                    )}
                >
                    <Boom shouldThrow={shouldThrow} />
                </ErrorBoundary>
            );
        }

        render(<Wrapper />);

        expect(screen.getByTestId("err")).toHaveTextContent("boom");
        expect(onError).toHaveBeenCalledTimes(1);

        fireEvent.click(screen.getByText("retry"));
        expect(screen.getByText("ok")).toBeInTheDocument();
    });

    it("resetKeys 变化时应自动 reset", () => {
        function Wrapper() {
            const [key, setKey] = useState(0);
            const [shouldThrow, setShouldThrow] = useState(true);

            return (
                <div>
                    <button
                        type="button"
                        onClick={() => {
                            setShouldThrow(false);
                            setKey(1);
                        }}
                    >
                        change
                    </button>
                    <ErrorBoundary
                        resetKeys={[key]}
                        fallback={({ error }) => (
                            <div data-testid="err">{error.message}</div>
                        )}
                    >
                        <Boom shouldThrow={shouldThrow} />
                    </ErrorBoundary>
                </div>
            );
        }

        render(<Wrapper />);

        expect(screen.getByTestId("err")).toHaveTextContent("boom");
        fireEvent.click(screen.getByText("change"));
        expect(screen.getByText("ok")).toBeInTheDocument();
    });
});

