import { act } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useAppStore } from "@/stores";
import { render } from "@/test/utils";
import { DocumentChromeSync } from "../DocumentChromeSync";

describe("DocumentChromeSync", () => {
    beforeEach(() => {
        useAppStore.setState({ theme: "dark", visualEffects: "full" });
        delete document.documentElement.dataset.theme;
        delete document.documentElement.dataset.effects;
    });

    it("syncs theme and visual effects onto the document dataset", () => {
        render(<DocumentChromeSync />);

        expect(document.documentElement.dataset.theme).toBe("dark");
        expect(document.documentElement.dataset.effects).toBe("full");

        act(() => {
            useAppStore.setState({ theme: "light", visualEffects: "reduced" });
        });

        expect(document.documentElement.dataset.theme).toBe("light");
        expect(document.documentElement.dataset.effects).toBe("reduced");
    });
});
