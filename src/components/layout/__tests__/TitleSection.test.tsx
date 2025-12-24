import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { render } from "@/test/utils";
import { TitleSection } from "../TitleSection";

vi.mock("react-i18next", () => ({
    useTranslation: () => ({
        t: (key: string) => key,
        i18n: { language: "zh" },
    }),
}));

describe("TitleSection", () => {
    it("渲染当前视图标题", () => {
        render(<TitleSection currentView="monitor" />);
        expect(screen.getByText("nav.monitor")).toBeInTheDocument();
    });
});

