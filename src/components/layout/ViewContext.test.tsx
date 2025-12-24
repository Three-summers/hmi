import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { render } from "@/test/utils";
import { ViewContextProvider, useIsViewActive } from "./ViewContext";

describe("ViewContext", () => {
    it("未提供上下文时默认视图为激活态（避免破坏独立渲染）", () => {
        function Comp() {
            const isActive = useIsViewActive();
            return <div>{isActive ? "active" : "inactive"}</div>;
        }

        render(<Comp />);
        expect(screen.getByText("active")).toBeInTheDocument();
    });

    it("在 ViewContextProvider 内会读取 isActive", () => {
        function Comp() {
            const isActive = useIsViewActive();
            return <div>{isActive ? "active" : "inactive"}</div>;
        }

        render(
            <ViewContextProvider value={{ viewId: "jobs", isActive: false }}>
                <Comp />
            </ViewContextProvider>,
        );
        expect(screen.getByText("inactive")).toBeInTheDocument();
    });
});

