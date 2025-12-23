/**
 * 频谱分析仪截图工具
 *
 * 提供将频谱图和瀑布图合成为一张图片并下载的功能。
 * 核心特性：
 * - Canvas 合成：将两个 Canvas（频谱图 + 瀑布图）垂直堆叠为一张图片
 * - 高清适配：使用 Canvas backing store 尺寸，避免截图模糊
 * - 自动居中：宽度不一致时居中放置，保持美观
 * - 文件命名：自动生成带时间戳的文件名（spectrum-YYYY-MM-DD-HH-mm-ss.png）
 *
 * @module Screenshot
 */

/**
 * 补齐两位数字（时间格式化辅助函数）
 *
 * @param value - 数字值
 * @returns 补齐后的字符串（如 1 -> "01"）
 */
function pad2(value: number): string {
    return value.toString().padStart(2, "0");
}

/**
 * 构建时间戳字符串（YYYY-MM-DD-HH-mm-ss 格式）
 *
 * @param now - 日期对象
 * @returns 格式化后的时间戳字符串
 */
function buildTimestamp(now: Date): string {
    const year = now.getFullYear();
    const month = pad2(now.getMonth() + 1);
    const day = pad2(now.getDate());
    const hours = pad2(now.getHours());
    const minutes = pad2(now.getMinutes());
    const seconds = pad2(now.getSeconds());
    return `${year}-${month}-${day}-${hours}-${minutes}-${seconds}`;
}

/**
 * 触发 PNG 图片下载（通过临时 <a> 元素）
 *
 * @param dataUrl - Data URL（base64 编码的 PNG 图片）
 * @param filename - 下载文件名
 */
function downloadPng(dataUrl: string, filename: string): void {
    const link = document.createElement("a");
    link.href = dataUrl;
    link.download = filename;
    link.rel = "noopener";
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    link.remove();
}

/**
 * 捕获频谱分析仪截图（频谱图 + 瀑布图合成）
 *
 * 合成流程：
 * 1. 创建合成 Canvas，尺寸为两图表的最大宽度和高度之和
 * 2. 填充深色背景（与应用主题一致）
 * 3. 将频谱图和瀑布图垂直堆叠（宽度不一致时居中放置）
 * 4. 转为 PNG Data URL
 * 5. 触发下载，文件名带时间戳
 *
 * @param chartCanvas - 频谱图 Canvas 元素（uPlot 生成）
 * @param waterfallCanvas - 瀑布图 Canvas 元素（自定义绘制）
 */
export async function captureSpectrumAnalyzer(
    chartCanvas: HTMLCanvasElement,
    waterfallCanvas: HTMLCanvasElement,
): Promise<void> {
    // 1) 创建合成 Canvas（使用 backing store 尺寸，避免截图模糊）
    const width = Math.max(chartCanvas.width, waterfallCanvas.width);
    const height = chartCanvas.height + waterfallCanvas.height;

    const composite = document.createElement("canvas");
    composite.width = Math.max(1, width);
    composite.height = Math.max(1, height);

    const ctx = composite.getContext("2d");
    if (!ctx) return;

    // 2) 垂直堆叠两个图表（宽度不一致时居中放置）
    ctx.fillStyle = "rgba(8, 15, 30, 1)";
    ctx.fillRect(0, 0, composite.width, composite.height);

    const chartX = Math.max(
        0,
        Math.floor((composite.width - chartCanvas.width) / 2),
    );
    const waterfallX = Math.max(
        0,
        Math.floor((composite.width - waterfallCanvas.width) / 2),
    );

    ctx.drawImage(chartCanvas, chartX, 0);
    ctx.drawImage(waterfallCanvas, waterfallX, chartCanvas.height);

    // 3) toDataURL 转 PNG
    const dataUrl = composite.toDataURL("image/png");

    // 4) 触发下载，文件名带时间戳
    const timestamp = buildTimestamp(new Date());
    downloadPng(dataUrl, `spectrum-${timestamp}.png`);
}
