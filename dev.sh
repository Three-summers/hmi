#!/bin/bash
# HMI 开发启动脚本
# 设置 WSLg 显示环境变量，避免 WebKitGTK 崩溃

export DISPLAY=:0
# 禁用 WebKitGTK GPU 合成模式，避免 WSL2 下 "pure virtual method called" 崩溃
export WEBKIT_DISABLE_COMPOSITING_MODE=1

# 启动 Tauri 开发服务器
npm run tauri dev
