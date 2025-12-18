#!/bin/bash
# HMI 开发启动脚本
# 设置 WSLg 显示环境变量，避免 WebKitGTK 崩溃

export DISPLAY=:0

# 指定使用 NVIDIA 独显进行 D3D12 渲染，避免 WSL2 下多 GPU 选择导致的不稳定
export MESA_D3D12_DEFAULT_ADAPTER_NAME=NVIDIA

# 备选方案：禁用 WebKitGTK GPU 合成模式（性能较低，但兼容性更好）
# export WEBKIT_DISABLE_COMPOSITING_MODE=1

# 启动 Tauri 开发服务器
npm run tauri dev
