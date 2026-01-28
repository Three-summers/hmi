import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nextProvider } from "react-i18next";

import i18n from "@/i18n";
import { Button, handleButtonClick } from "@/components/common/Button.tsx";
import {
    Dialog,
    getDialogCloseAction,
    getDialogEscapeAction,
    resolveDialogButtons,
} from "@/components/common/Dialog.tsx";
import { Tabs } from "@/components/common/Tabs.tsx";
import { StatusIndicator } from "@/components/common/StatusIndicator.tsx";

const projectRoot = process.cwd();

async function readText(relativePath) {
    const filePath = path.join(projectRoot, relativePath);
    return fs.readFile(filePath, "utf8");
}

describe("T06 UI 设计系统统一（design tokens）", () => {
    it("variables.css：不应包含远程 Google Fonts import，并提供本地 @font-face", async () => {
        const css = await readText("src/styles/variables.css");

        assert.ok(!css.includes("fonts.googleapis.com"));
        assert.ok(!css.includes("fonts.gstatic.com"));
        assert.ok(!css.includes("@import"));

        assert.match(css, /@font-face\s*{[^}]*font-family:\s*\"Ubuntu\"/s);
        assert.match(css, /src:\s*url\(\"..\/assets\/fonts\/Ubuntu-R\.ttf\"\)/);
        assert.match(css, /font-display:\s*swap/);
    });

    it("variables.css：应定义 spacing/typography/transition 核心 tokens（4px 网格）", async () => {
        const css = await readText("src/styles/variables.css");

        // spacing tokens（4px 网格）
        assert.match(css, /--space-1:\s*0\.25rem;\s*\/\*\s*4px\s*\*\//);
        assert.match(css, /--space-4:\s*1rem;\s*\/\*\s*16px\s*\*\//);
        assert.match(css, /--space-8:\s*2rem;\s*\/\*\s*32px\s*\*\//);

        // 兼容旧变量名：sp-*
        assert.match(css, /--sp-md:\s*var\(--space-4\)/);

        // typography tokens
        assert.match(css, /--font-family:\s*\"Ubuntu\"/);
        assert.match(css, /--font-mono:\s*\"Ubuntu Mono\"/);

        // transition tokens
        assert.match(css, /--transition-fast:\s*120ms/);
        assert.match(css, /--transition-normal:\s*200ms/);
    });

    it("variables.css：高性能模式应进一步降低动效与装饰性渲染", async () => {
        const css = await readText("src/styles/variables.css");

        // reduced 模式基础开关
        assert.match(css, /\[data-effects=\"reduced\"\]\s*{/);

        // 关闭过渡（让交互在低端设备上更“硬切”，避免合成开销）
        assert.match(css, /--transition-fast:\s*0ms\s+linear/);
        assert.match(css, /--transition-normal:\s*0ms\s+linear/);

        // 关闭阴影/光晕（减少离屏渲染与模糊成本）
        assert.match(css, /--shadow-md:\s*none/);
        assert.match(css, /--color-processing-glow:\s*transparent/);

        // 关闭背景装饰层
        assert.match(css, /--bg-overlay-opacity:\s*0/);
        assert.match(css, /--vignette-opacity:\s*0/);

        // 玻璃高光降级
        assert.match(css, /--glass-shine:\s*none/);
    });

    it("fonts：本地字体文件应存在（避免运行时网络依赖）", async () => {
        const fontsDir = path.join(projectRoot, "src/assets/fonts");
        const entries = await fs.readdir(fontsDir);

        // 只校验关键文件名，避免不同平台字体子集差异导致误报
        const required = [
            "Ubuntu-R.ttf",
            "Ubuntu-M.ttf",
            "Ubuntu-B.ttf",
            "Ubuntu-C.ttf",
            "UbuntuMono-R.ttf",
            "UbuntuMono-B.ttf",
        ];

        required.forEach((name) => {
            assert.ok(entries.includes(name), `missing font file: ${name}`);
        });
    });

    it("global.css：应优先使用 tokens，而不是散落的常用像素值", async () => {
        const css = await readText("src/styles/global.css");

        // 语义化尺寸/间距来源：variables.css
        assert.match(css, /var\(--input-padding-x\)/);
        assert.match(css, /var\(--input-padding-y\)/);
        assert.match(css, /var\(--badge-height\)/);
        assert.match(css, /var\(--transition-fast\)/);
    });

    it("global.css：高性能模式应强制禁用动画并移除装饰性背景层", async () => {
        const css = await readText("src/styles/global.css");

        // 强制禁用动画/过渡
        assert.match(css, /\[data-effects=\"reduced\"\]\s*\*,/);
        assert.match(css, /animation:\s*none\s*!important/);
        assert.match(css, /transition:\s*none\s*!important/);

        // 移除背景伪元素
        assert.match(css, /\[data-effects=\"reduced\"\]\s*body::before/);
        assert.match(css, /content:\s*none/);
    });
});

function collectElements(node, predicate, out = []) {
    if (node == null) return out;
    if (Array.isArray(node)) {
        node.forEach((child) => collectElements(child, predicate, out));
        return out;
    }

    if (!React.isValidElement(node)) return out;
    if (predicate(node)) out.push(node);
    return collectElements(node.props?.children, predicate, out);
}

describe("T06 UI 设计系统统一（组件一致性）", () => {
    it("Button：应输出统一的 data-* 语义（size/variant/highlight/pressed）", () => {
        const html = renderToStaticMarkup(
            React.createElement(Button, {
                behavior: "toggle",
                pressed: true,
                highlight: "alarm",
                size: "large",
                variant: "danger",
                children: "BTN",
            }),
        );

        assert.match(html, /data-size=\"large\"/);
        assert.match(html, /data-variant=\"danger\"/);
        assert.match(html, /data-highlight=\"alarm\"/);
        assert.match(html, /data-pressed=\"true\"/);
        assert.match(html, />BTN</);
    });

    it("handleButtonClick：disabled 时不应触发任何回调", () => {
        const calls = {
            setInternalPressed: 0,
            onPressedChange: 0,
            onClick: 0,
        };

        handleButtonClick(
            {},
            {
                behavior: "toggle",
                isPressed: false,
                disabled: true,
                setInternalPressed: () => {
                    calls.setInternalPressed += 1;
                },
                onPressedChange: () => {
                    calls.onPressedChange += 1;
                },
                onClick: () => {
                    calls.onClick += 1;
                },
            },
        );

        assert.deepEqual(calls, {
            setInternalPressed: 0,
            onPressedChange: 0,
            onClick: 0,
        });
    });

    it("handleButtonClick：toggle 时应切换 pressed 并通知 onPressedChange", () => {
        const records = [];

        handleButtonClick(
            { type: "click" },
            {
                behavior: "toggle",
                isPressed: false,
                disabled: false,
                setInternalPressed: (pressed) =>
                    records.push(["setInternalPressed", pressed]),
                onPressedChange: (pressed) =>
                    records.push(["onPressedChange", pressed]),
                onClick: (e) => records.push(["onClick", e.type]),
            },
        );

        assert.deepEqual(records, [
            ["setInternalPressed", true],
            ["onPressedChange", true],
            ["onClick", "click"],
        ]);
    });

    it("handleButtonClick：momentary 时不应触发 toggle 逻辑，但仍会调用 onClick", () => {
        const records = [];

        handleButtonClick(
            { type: "click" },
            {
                behavior: "momentary",
                isPressed: false,
                disabled: false,
                setInternalPressed: () => records.push("setInternalPressed"),
                onPressedChange: () => records.push("onPressedChange"),
                onClick: () => records.push("onClick"),
            },
        );

        assert.deepEqual(records, ["onClick"]);
    });

    it("Dialog：resolveDialogButtons/getDialogEscapeAction/getDialogCloseAction 规则应稳定", () => {
        const info = resolveDialogButtons("info", { ok: true, cancel: true });
        assert.equal(info.close, true);
        assert.equal(info.ok, false);
        assert.equal(getDialogEscapeAction(info), "cancel");
        assert.equal(getDialogCloseAction(info), "cancel");

        const input = resolveDialogButtons("input", {});
        assert.equal(input.ok, true);
        assert.equal(input.cancel, true);

        const message = resolveDialogButtons("message", { no: true });
        assert.equal(getDialogEscapeAction(message), "no");
        assert.equal(getDialogCloseAction(message), "close");
    });

    it("Dialog：open=false 时应返回空输出；open=true 时应渲染 message + icon", () => {
        const closed = renderToStaticMarkup(
            React.createElement(I18nextProvider, { i18n }, [
                React.createElement(Dialog, {
                    key: "d",
                    open: false,
                    type: "message",
                    title: "t",
                    message: "m",
                    icon: "information",
                }),
            ]),
        );
        assert.equal(closed, "");

        const opened = renderToStaticMarkup(
            React.createElement(I18nextProvider, { i18n }, [
                React.createElement(Dialog, {
                    key: "d",
                    open: true,
                    type: "message",
                    title: "TITLE",
                    message: "MSG",
                    icon: "information",
                    buttons: { close: true },
                }),
            ]),
        );

        assert.match(opened, /TITLE/);
        assert.match(opened, /MSG/);
        assert.match(opened, /data-type=\"information\"/);
    });

    it("Tabs：默认 keepMounted=true，应渲染全部 panel，并用 hidden 控制可见性", () => {
        const calls = [];
        const tabs = [
            { id: "a", label: "A", content: "AA" },
            { id: "b", label: "B", content: "BB" },
        ];

        const tree = Tabs({
            tabs,
            activeId: "a",
            onChange: (id) => calls.push(id),
        });

        const tabButtons = collectElements(
            tree,
            (el) => el.type === "button" && el.props?.role === "tab",
        );
        assert.equal(tabButtons.length, 2);

        // 手动触发第二个 tab 的 onClick（无 DOM 环境）
        const b = tabButtons.find((el) => el.props?.["aria-controls"] === "panel-b");
        b.props.onClick();
        assert.deepEqual(calls, ["b"]);

        const panels = collectElements(
            tree,
            (el) => el.type === "div" && el.props?.role === "tabpanel",
        );
        assert.equal(panels.length, 2);
        assert.equal(
            panels.filter((p) => p.props?.hidden === true).length,
            1,
        );
    });

    it("Tabs：keepMounted=false 时应只渲染 active panel 的内容", () => {
        const tabs = [
            { id: "a", label: "A", content: "AA" },
            { id: "b", label: "B", content: "BB" },
        ];

        const tree = Tabs({
            tabs,
            activeId: "b",
            onChange: () => {},
            keepMounted: false,
        });

        const panels = collectElements(
            tree,
            (el) => el.type === "div" && el.props?.role === "tabpanel",
        );
        assert.equal(panels.length, 1);

        const html = renderToStaticMarkup(tree);
        assert.match(html, />BB</);
        assert.ok(!html.includes(">AA<"));
    });

    it("StatusIndicator：应渲染 data-status，且 label 可选", () => {
        const withLabel = renderToStaticMarkup(
            React.createElement(StatusIndicator, {
                status: "processing",
                label: "RUN",
            }),
        );
        assert.match(withLabel, /data-status=\"processing\"/);
        assert.match(withLabel, />RUN</);

        const noLabel = renderToStaticMarkup(
            React.createElement(StatusIndicator, { status: "idle" }),
        );
        assert.match(noLabel, /data-status=\"idle\"/);
        assert.ok(!noLabel.includes(">undefined<"));
    });
});
