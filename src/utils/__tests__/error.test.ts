import { describe, expect, it } from "vitest";
import type { ErrorHandler } from "@/types/common";
import { invokeErrorHandler, reportError, toErrorMessage } from "../error";

describe("utils/error", () => {
    it("toErrorMessage：应处理常见输入", () => {
        expect(toErrorMessage("hello")).toBe("hello");
        expect(toErrorMessage(new Error("boom"))).toBe("boom");

        const err = new Error("");
        err.name = "CustomError";
        expect(toErrorMessage(err)).toBe("CustomError");

        expect(toErrorMessage({ message: "from object" })).toBe("from object");
        expect(toErrorMessage({ message: "   " })).toBe("[object Object]");
        expect(toErrorMessage(null)).toBe("null");
        expect(toErrorMessage(undefined)).toBe("undefined");
    });

    it("toErrorMessage：toString 抛错时应返回 Unknown error", () => {
        const bad = {
            toString() {
                throw new Error("no");
            },
        };

        expect(toErrorMessage(bad)).toBe("Unknown error");
    });

    it("invokeErrorHandler：handler 为 undefined 时应无副作用", async () => {
        await expect(
            invokeErrorHandler(undefined, "m", new Error("e")),
        ).resolves.toBeUndefined();
    });

    it("invokeErrorHandler：应支持同步/异步 handler", async () => {
        const calls: Array<{ message: string; error: unknown }> = [];

        const syncHandler: ErrorHandler = (message, error) => {
            calls.push({ message, error });
        };
        const asyncHandler: ErrorHandler = async (message, error) => {
            calls.push({ message, error });
        };

        const err = new Error("boom");
        await invokeErrorHandler(syncHandler, "m1", err);
        await invokeErrorHandler(asyncHandler, "m2", err);

        expect(calls.map((c) => c.message)).toEqual(["m1", "m2"]);
    });

    it("reportError：应生成 message 并调用 handler", async () => {
        const received: string[] = [];
        const handler: ErrorHandler = (message) => {
            received.push(message);
        };

        const err = new Error("boom");
        await expect(reportError(err, handler)).resolves.toBe("boom");
        expect(received).toEqual(["boom"]);

        await expect(reportError(err, handler, "override")).resolves.toBe(
            "override",
        );
        expect(received).toEqual(["boom", "override"]);
    });
});

