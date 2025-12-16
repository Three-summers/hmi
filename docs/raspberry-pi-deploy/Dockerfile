# 用于交叉编译 Tauri HMI 到树莓派 (ARM64) 的 Dockerfile
# 目标架构: aarch64-unknown-linux-gnu (Debian 12 bookworm)
# 已测试设备: Raspberry Pi Compute Module 5

FROM ubuntu:22.04 AS builder

# 禁止交互式提示
ENV DEBIAN_FRONTEND=noninteractive

# 安装基础依赖
RUN apt-get update && apt-get install -y \
    curl \
    wget \
    git \
    build-essential \
    pkg-config \
    libssl-dev \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# 启用 ARM64 多架构支持
RUN dpkg --add-architecture arm64

# 添加 ARM64 软件源
RUN sed -i 's/^deb /deb [arch=amd64] /' /etc/apt/sources.list && \
    echo "deb [arch=arm64] http://ports.ubuntu.com/ubuntu-ports jammy main restricted universe multiverse" >> /etc/apt/sources.list && \
    echo "deb [arch=arm64] http://ports.ubuntu.com/ubuntu-ports jammy-updates main restricted universe multiverse" >> /etc/apt/sources.list && \
    echo "deb [arch=arm64] http://ports.ubuntu.com/ubuntu-ports jammy-security main restricted universe multiverse" >> /etc/apt/sources.list

# 安装 ARM64 交叉编译工具链和库
RUN apt-get update && apt-get install -y \
    gcc-aarch64-linux-gnu \
    g++-aarch64-linux-gnu \
    libc6-dev-arm64-cross \
    # Tauri/GTK 所需的 ARM64 库
    libgtk-3-dev:arm64 \
    libwebkit2gtk-4.1-dev:arm64 \
    libayatana-appindicator3-dev:arm64 \
    librsvg2-dev:arm64 \
    libssl-dev:arm64 \
    libudev-dev:arm64 \
    && rm -rf /var/lib/apt/lists/*

# 安装 Node.js 20 LTS
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y nodejs && \
    rm -rf /var/lib/apt/lists/*

# 安装 Rust
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
ENV PATH="/root/.cargo/bin:${PATH}"

# 添加 ARM64 Rust 编译目标
RUN rustup target add aarch64-unknown-linux-gnu

# 配置 Cargo 交叉编译参数
RUN mkdir -p /root/.cargo && \
    echo '[target.aarch64-unknown-linux-gnu]' >> /root/.cargo/config.toml && \
    echo 'linker = "aarch64-linux-gnu-gcc"' >> /root/.cargo/config.toml && \
    echo '' >> /root/.cargo/config.toml && \
    echo '[env]' >> /root/.cargo/config.toml && \
    echo 'PKG_CONFIG_ALLOW_CROSS = "1"' >> /root/.cargo/config.toml && \
    echo 'PKG_CONFIG_PATH = "/usr/lib/aarch64-linux-gnu/pkgconfig"' >> /root/.cargo/config.toml && \
    echo 'PKG_CONFIG_SYSROOT_DIR = "/"' >> /root/.cargo/config.toml

# 设置交叉编译环境变量
ENV CC_aarch64_unknown_linux_gnu=aarch64-linux-gnu-gcc
ENV CXX_aarch64_unknown_linux_gnu=aarch64-linux-gnu-g++
ENV AR_aarch64_unknown_linux_gnu=aarch64-linux-gnu-ar
ENV CARGO_TARGET_AARCH64_UNKNOWN_LINUX_GNU_LINKER=aarch64-linux-gnu-gcc
ENV PKG_CONFIG_ALLOW_CROSS=1
ENV PKG_CONFIG_PATH=/usr/lib/aarch64-linux-gnu/pkgconfig
ENV PKG_CONFIG_SYSROOT_DIR=/

# 创建工作目录
WORKDIR /app

# 复制项目文件
COPY . .

# 安装 npm 依赖
RUN npm install

# 构建前端
RUN npm run build

# 构建 ARM64 版本的 Tauri 应用（仅生成 deb 包，AppImage 需要本机架构无法交叉编译）
RUN npx tauri build --target aarch64-unknown-linux-gnu --bundles deb

# 输出阶段 - 复制编译产物
FROM scratch AS export
COPY --from=builder /app/src-tauri/target/aarch64-unknown-linux-gnu/release/hmi /hmi
COPY --from=builder /app/src-tauri/target/aarch64-unknown-linux-gnu/release/bundle/deb/*.deb /
