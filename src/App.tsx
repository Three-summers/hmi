/**
 * 应用根组件
 *
 * 作为应用的最顶层组件，负责渲染主布局容器。
 * 所有的状态管理、路由、主题等全局逻辑都在 MainLayout 中初始化。
 *
 * @module App
 */

import { MainLayout } from "./components/layout/MainLayout";

function App() {
    // 直接渲染主布局，所有业务逻辑由 MainLayout 及其子组件处理
    return <MainLayout />;
}

export default App;
