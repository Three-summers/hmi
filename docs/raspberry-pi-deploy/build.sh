#!/bin/bash
# HMI ARM64 交叉编译构建脚本
# 目标设备: 树莓派 CM5 / Pi 4/5 (aarch64, Debian 12)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
OUTPUT_DIR="${SCRIPT_DIR}/output"

echo "=========================================="
echo "HMI ARM64 交叉编译构建"
echo "目标平台: 树莓派 (aarch64)"
echo "=========================================="
echo "项目目录: ${PROJECT_DIR}"
echo ""

# 创建输出目录
mkdir -p "${OUTPUT_DIR}"

# 检查 Docker 是否运行
if ! docker info > /dev/null 2>&1; then
    echo "错误: Docker 未运行，请先启动 Docker。"
    exit 1
fi

echo "[1/3] 构建 Docker 镜像..."
docker build \
    -f "${SCRIPT_DIR}/Dockerfile" \
    -t hmi-arm64-builder \
    --target builder \
    "${PROJECT_DIR}"

echo ""
echo "[2/3] 提取构建产物..."
# 创建临时容器用于复制文件
CONTAINER_ID=$(docker create hmi-arm64-builder)

# 复制构建产物
docker cp "${CONTAINER_ID}:/app/src-tauri/target/aarch64-unknown-linux-gnu/release/hmi" "${OUTPUT_DIR}/" 2>/dev/null || echo "警告: 未找到二进制文件"
docker cp "${CONTAINER_ID}:/app/src-tauri/target/aarch64-unknown-linux-gnu/release/bundle/deb/." "${OUTPUT_DIR}/" 2>/dev/null || echo "警告: 未找到 DEB 包"

# 删除临时容器
docker rm "${CONTAINER_ID}" > /dev/null

echo ""
echo "[3/3] 构建完成!"
echo ""
echo "输出文件:"
ls -la "${OUTPUT_DIR}/"

echo ""
echo "=========================================="
echo "部署到树莓派:"
echo "  scp ${OUTPUT_DIR}/hmi 用户名@树莓派IP:~/"
echo "  scp ${OUTPUT_DIR}/*.deb 用户名@树莓派IP:~/"
echo ""
echo "在树莓派上安装:"
echo "  sudo dpkg -i ~/hmi_*.deb"
echo "  sudo apt-get install -f  # 安装依赖"
echo "=========================================="
