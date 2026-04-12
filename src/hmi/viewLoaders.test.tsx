import { describe, expect, it } from "vitest";
import { HMI_VIEW_COMPONENTS } from "./viewLoaders";

describe("HMI_VIEW_COMPONENTS", () => {
    it("exposes loaders for every HMI view", () => {
        expect(Object.keys(HMI_VIEW_COMPONENTS)).toEqual([
            "jobs",
            "recipes",
            "files",
            "setup",
            "alarms",
            "help",
        ]);
    });
});
