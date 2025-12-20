function pad2(value: number): string {
    return value.toString().padStart(2, "0");
}

function buildTimestamp(now: Date): string {
    const year = now.getFullYear();
    const month = pad2(now.getMonth() + 1);
    const day = pad2(now.getDate());
    const hours = pad2(now.getHours());
    const minutes = pad2(now.getMinutes());
    const seconds = pad2(now.getSeconds());
    return `${year}-${month}-${day}-${hours}-${minutes}-${seconds}`;
}

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
