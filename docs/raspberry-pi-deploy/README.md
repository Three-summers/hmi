# 树莓派 ARM64 部署指南

本指南介绍如何将 HMI 应用交叉编译并部署到树莓派 ARM64 设备。

## 支持的设备

- Raspberry Pi Compute Module 5
- Raspberry Pi 5
- Raspberry Pi 4 (64位系统)
- 其他运行 Debian 12 (bookworm) 或兼容系统的 ARM64 设备

## 环境要求

### 构建机器 (x86_64)

- 已安装并运行 Docker
- 建议至少 8GB 内存
- 约 10GB 磁盘空间用于 Docker 镜像

### 目标设备 (树莓派)

- 64位操作系统 (Debian 12 / Raspberry Pi OS 64-bit)
- GPU 内存分配至少 128MB（建议 256MB）

## 构建步骤

### 1. 运行构建脚本

```bash
cd docs/raspberry-pi-deploy
chmod +x build.sh
./build.sh
```

### 2. 构建产物

构建成功后，文件位于 `docs/raspberry-pi-deploy/output/`：

| 文件 | 说明 |
|------|------|
| `hmi` | 独立的 ARM64 可执行文件 |
| `hmi_x.x.x_arm64.deb` | 包含依赖信息的 Debian 安装包 |

## 部署方式

### 方式一：DEB 安装包（推荐）

```bash
# 复制到树莓派
scp output/hmi_*.deb 用户名@树莓派IP:~/

# 在树莓派上执行
sudo dpkg -i ~/hmi_*.deb
sudo apt-get install -f  # 自动安装缺失的依赖
```

### 方式二：独立可执行文件

```bash
# 复制到树莓派
scp output/hmi 用户名@树莓派IP:~/

# 在树莓派上先安装依赖
sudo apt install libwebkit2gtk-4.1-0 libgtk-3-0 libayatana-appindicator3-1

# 运行
chmod +x ~/hmi
./hmi
```

## 重要注意事项

### 1. WebKitGTK DMABUF 渲染问题

在树莓派上可能遇到画面撕裂或渲染异常，需要设置环境变量：

```bash
WEBKIT_DISABLE_DMABUF_RENDERER=1 ./hmi
```

如需永久生效，可创建启动脚本：

```bash
#!/bin/bash
export WEBKIT_DISABLE_DMABUF_RENDERER=1
exec /path/to/hmi "$@"
```

### 2. GPU 内存配置

确保分配足够的 GPU 内存。编辑 `/boot/firmware/config.txt`：

```ini
gpu_mem=256
```

修改后需要重启。

### 3. 字体要求

应用使用系统字体。为获得最佳显示效果，建议安装 Noto 字体：

```bash
sudo apt install fonts-noto-core fonts-noto-cjk
```

**注意**：项目已配置使用跨平台兼容的字体栈，避免使用 Windows 专有字体（如 Segoe UI、Microsoft YaHei），否则会导致字体渲染闪烁问题。

### 4. 显示环境

应用需要图形环境（X11 或 Wayland）。如果是无头模式运行：

```bash
# 安装最小化 X 服务器
sudo apt install --no-install-recommends xserver-xorg x11-xserver-utils xinit openbox

# 启动 X 并运行应用
startx ./hmi
```

### 5. 串口访问权限

如需使用串口通信功能，将用户添加到 `dialout` 组：

```bash
sudo usermod -aG dialout $USER
# 需要注销并重新登录才能生效
```

### 6. AppImage 不支持

交叉编译无法生成 AppImage 包，因为 AppImage 打包工具需要在目标架构上运行。仅支持生成 DEB 包和独立可执行文件。

## 故障排除

### 构建时网络错误

构建过程需要下载大量 Rust 依赖包。如遇到超时：

1. 确保网络连接稳定
2. 重试构建（Docker 会缓存已成功的步骤）
3. 国内用户可考虑配置 Rust 镜像源

### 应用无法启动

检查缺失的库：

```bash
ldd ./hmi | grep "not found"
```

使用 `apt` 安装缺失的依赖。

### 画面闪烁或字体问题

1. 确保设置了 `WEBKIT_DISABLE_DMABUF_RENDERER=1`
2. 安装系统字体：`sudo apt install fonts-noto-core`
3. 将 GPU 内存增加到 256MB

### 性能不佳

1. 确保在 `/boot/firmware/config.txt` 中启用了硬件加速：
   ```ini
   dtoverlay=vc4-kms-v3d
   ```
2. 关闭其他占用 GPU 的应用
3. 考虑减小窗口尺寸或禁用动画效果

## 环境变量参考

| 变量 | 说明 |
|------|------|
| `WEBKIT_DISABLE_DMABUF_RENDERER=1` | 修复树莓派上的渲染问题 |
| `GDK_BACKEND=x11` | 强制使用 X11 后端 |
| `DISPLAY=:0` | 无头模式下设置显示 |
