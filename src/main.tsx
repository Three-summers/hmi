/**
 * 应用入口文件
 *
 * 负责：
 * - 初始化 React 应用并挂载到 DOM
 * - 加载国际化配置（i18n）
 * - 引入全局样式（CSS 变量和基础样式）
 *
 * @module main
 */

import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./i18n"; // 初始化 i18next 国际化
import "./styles/variables.css"; // 加载 CSS 变量（主题色、字体等）
import "./styles/global.css"; // 加载全局基础样式

// 获取 HTML 中的 root 元素并创建 React 根节点
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    // 严格模式：检测潜在问题（如副作用、过时 API 等）
    <React.StrictMode>
        <App />
    </React.StrictMode>,
);
