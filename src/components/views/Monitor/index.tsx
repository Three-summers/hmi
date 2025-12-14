import { useEffect, useRef, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import styles from "../shared.module.css";
import monitorStyles from "./Monitor.module.css";

// Check if running in Tauri environment
const isTauri = () => {
    return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
};

interface ChartData {
    timestamp: number;
    temperature: number;
    pressure: number;
    humidity: number;
}

interface SensorStats {
    current: number;
    min: number;
    max: number;
    avg: number;
    status: "normal" | "warning" | "alarm";
}

const getSensorStatus = (
    value: number,
    type: string,
): "normal" | "warning" | "alarm" => {
    if (type === "temperature") {
        if (value > 85) return "alarm";
        if (value > 75) return "warning";
        return "normal";
    }
    if (type === "pressure") {
        if (value > 115 || value < 95) return "alarm";
        if (value > 110 || value < 98) return "warning";
        return "normal";
    }
    if (type === "humidity") {
        if (value > 80 || value < 20) return "alarm";
        if (value > 70 || value < 30) return "warning";
        return "normal";
    }
    return "normal";
};

export default function MonitorView() {
    const chartRef = useRef<HTMLDivElement>(null);
    const uplotRef = useRef<uPlot | null>(null);
    const dataRef = useRef<[number[], number[], number[], number[]]>([
        [],
        [],
        [],
        [],
    ]);
    const [latestData, setLatestData] = useState<ChartData | null>(null);
    const [isPaused, setIsPaused] = useState(false);
    const [timeRange, setTimeRange] = useState<60 | 120 | 300>(60);
    const [stats, setStats] = useState<{
        temperature: SensorStats;
        pressure: SensorStats;
        humidity: SensorStats;
    }>({
        temperature: { current: 0, min: 0, max: 0, avg: 0, status: "normal" },
        pressure: { current: 0, min: 0, max: 0, avg: 0, status: "normal" },
        humidity: { current: 0, min: 0, max: 0, avg: 0, status: "normal" },
    });

    // Calculate statistics
    const calculateStats = useCallback(
        (data: number[], type: string, current: number): SensorStats => {
            if (data.length === 0)
                return {
                    current,
                    min: current,
                    max: current,
                    avg: current,
                    status: "normal",
                };
            const min = Math.min(...data);
            const max = Math.max(...data);
            const avg = data.reduce((a, b) => a + b, 0) / data.length;
            return {
                current,
                min,
                max,
                avg,
                status: getSensorStatus(current, type),
            };
        },
        [],
    );

    // Initialize chart
    useEffect(() => {
        if (!chartRef.current) return;

        const opts: uPlot.Options = {
            width: chartRef.current.clientWidth,
            height: 350,
            scales: {
                x: { time: true },
                y: { auto: true },
            },
            series: [
                {},
                {
                    label: "Temperature (°C)",
                    stroke: "#ff6b6b",
                    width: 2,
                    scale: "y",
                    fill: "rgba(255, 107, 107, 0.1)",
                },
                {
                    label: "Pressure (kPa)",
                    stroke: "#4ecdc4",
                    width: 2,
                    scale: "y",
                    fill: "rgba(78, 205, 196, 0.1)",
                },
                {
                    label: "Humidity (%)",
                    stroke: "#45b7d1",
                    width: 2,
                    scale: "y",
                    fill: "rgba(69, 183, 209, 0.1)",
                },
            ],
            axes: [
                {
                    stroke: "#b0b0b0",
                    grid: { stroke: "rgba(255,255,255,0.1)", width: 1 },
                    ticks: { stroke: "rgba(255,255,255,0.2)" },
                },
                {
                    stroke: "#b0b0b0",
                    grid: { stroke: "rgba(255,255,255,0.1)", width: 1 },
                    ticks: { stroke: "rgba(255,255,255,0.2)" },
                    scale: "y",
                },
            ],
            legend: {
                show: true,
            },
            cursor: {
                show: true,
                sync: { key: "sync1" },
            },
        };

        const initialData: [number[], number[], number[], number[]] = [
            [],
            [],
            [],
            [],
        ];
        uplotRef.current = new uPlot(opts, initialData, chartRef.current);

        // Handle resize
        const handleResize = () => {
            if (chartRef.current && uplotRef.current) {
                uplotRef.current.setSize({
                    width: chartRef.current.clientWidth,
                    height: 350,
                });
            }
        };

        const resizeObserver = new ResizeObserver(handleResize);
        resizeObserver.observe(chartRef.current);

        return () => {
            resizeObserver.disconnect();
            uplotRef.current?.destroy();
        };
    }, []);

    // Update chart with new data
    const updateChart = useCallback(
        (data: ChartData) => {
            if (isPaused) return;

            const [times, temps, pressures, humidities] = dataRef.current;

            times.push(data.timestamp / 1000);
            temps.push(data.temperature);
            pressures.push(data.pressure);
            humidities.push(data.humidity);

            // Keep only last MAX_POINTS based on time range
            const maxPoints = timeRange;
            if (times.length > maxPoints) {
                times.shift();
                temps.shift();
                pressures.shift();
                humidities.shift();
            }

            if (uplotRef.current) {
                uplotRef.current.setData([times, temps, pressures, humidities]);
            }

            setLatestData(data);
            setStats({
                temperature: calculateStats(
                    temps,
                    "temperature",
                    data.temperature,
                ),
                pressure: calculateStats(pressures, "pressure", data.pressure),
                humidity: calculateStats(humidities, "humidity", data.humidity),
            });
        },
        [isPaused, timeRange, calculateStats],
    );

    // Store updateChart in ref so we don't need it as a dependency
    const updateChartRef = useRef(updateChart);
    useEffect(() => {
        updateChartRef.current = updateChart;
    }, [updateChart]);

    // Listen for data from Rust - only setup once
    useEffect(() => {
        // Skip if not in Tauri environment (e.g., running in browser)
        if (!isTauri()) {
            console.warn(
                "Not running in Tauri environment - sensor data will not be available",
            );
            return;
        }

        let unlisten: (() => void) | null = null;
        let mounted = true;

        const setup = async () => {
            try {
                // First setup the listener
                unlisten = await listen<ChartData>("sensor-data", (event) => {
                    if (mounted) {
                        console.log("Received sensor data:", event.payload);
                        updateChartRef.current(event.payload);
                    }
                });
                console.log("Listener setup complete");

                // Then start data generation in Rust
                await invoke("start_sensor_simulation");
                console.log("Sensor simulation started");
            } catch (err) {
                console.error("Failed to setup sensor monitoring:", err);
            }
        };

        setup();

        return () => {
            mounted = false;
            if (isTauri()) {
                invoke("stop_sensor_simulation").catch(console.error);
            }
            unlisten?.();
        };
    }, []); // Empty dependency array - only run once

    const handleClearData = () => {
        dataRef.current = [[], [], [], []];
        if (uplotRef.current) {
            uplotRef.current.setData([[], [], [], []]);
        }
    };

    return (
        <div className={styles.view}>
            {/* Sensor Cards */}
            <div className={monitorStyles.statsGrid}>
                <div
                    className={monitorStyles.statCard}
                    data-type="temperature"
                    data-status={stats.temperature.status}
                >
                    <div className={monitorStyles.cardHeader}>
                        <div className={monitorStyles.cardIcon}>
                            <svg viewBox="0 0 24 24" fill="currentColor">
                                <path d="M15 13V5c0-1.66-1.34-3-3-3S9 3.34 9 5v8c-1.21.91-2 2.37-2 4 0 2.76 2.24 5 5 5s5-2.24 5-5c0-1.63-.79-3.09-2-4zm-4-2V5c0-.55.45-1 1-1s1 .45 1 1v6h-2z" />
                            </svg>
                        </div>
                        <span
                            className={monitorStyles.statusBadge}
                            data-status={stats.temperature.status}
                        >
                            {stats.temperature.status.toUpperCase()}
                        </span>
                    </div>
                    <span className={monitorStyles.statLabel}>Temperature</span>
                    <span className={monitorStyles.statValue}>
                        {latestData?.temperature.toFixed(1) ?? "--"} °C
                    </span>
                    <div className={monitorStyles.statMeta}>
                        <span>Min: {stats.temperature.min.toFixed(1)}</span>
                        <span>Max: {stats.temperature.max.toFixed(1)}</span>
                        <span>Avg: {stats.temperature.avg.toFixed(1)}</span>
                    </div>
                </div>

                <div
                    className={monitorStyles.statCard}
                    data-type="pressure"
                    data-status={stats.pressure.status}
                >
                    <div className={monitorStyles.cardHeader}>
                        <div className={monitorStyles.cardIcon}>
                            <svg viewBox="0 0 24 24" fill="currentColor">
                                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-1-4h2v2h-2zm0-2h2V7h-2z" />
                            </svg>
                        </div>
                        <span
                            className={monitorStyles.statusBadge}
                            data-status={stats.pressure.status}
                        >
                            {stats.pressure.status.toUpperCase()}
                        </span>
                    </div>
                    <span className={monitorStyles.statLabel}>Pressure</span>
                    <span className={monitorStyles.statValue}>
                        {latestData?.pressure.toFixed(1) ?? "--"} kPa
                    </span>
                    <div className={monitorStyles.statMeta}>
                        <span>Min: {stats.pressure.min.toFixed(1)}</span>
                        <span>Max: {stats.pressure.max.toFixed(1)}</span>
                        <span>Avg: {stats.pressure.avg.toFixed(1)}</span>
                    </div>
                </div>

                <div
                    className={monitorStyles.statCard}
                    data-type="humidity"
                    data-status={stats.humidity.status}
                >
                    <div className={monitorStyles.cardHeader}>
                        <div className={monitorStyles.cardIcon}>
                            <svg viewBox="0 0 24 24" fill="currentColor">
                                <path d="M12 2c-5.33 4.55-8 8.48-8 11.8 0 4.98 3.8 8.2 8 8.2s8-3.22 8-8.2c0-3.32-2.67-7.25-8-11.8zm0 18c-3.35 0-6-2.57-6-6.2 0-2.34 1.95-5.44 6-9.14 4.05 3.7 6 6.79 6 9.14 0 3.63-2.65 6.2-6 6.2z" />
                            </svg>
                        </div>
                        <span
                            className={monitorStyles.statusBadge}
                            data-status={stats.humidity.status}
                        >
                            {stats.humidity.status.toUpperCase()}
                        </span>
                    </div>
                    <span className={monitorStyles.statLabel}>Humidity</span>
                    <span className={monitorStyles.statValue}>
                        {latestData?.humidity.toFixed(1) ?? "--"} %
                    </span>
                    <div className={monitorStyles.statMeta}>
                        <span>Min: {stats.humidity.min.toFixed(1)}</span>
                        <span>Max: {stats.humidity.max.toFixed(1)}</span>
                        <span>Avg: {stats.humidity.avg.toFixed(1)}</span>
                    </div>
                </div>
            </div>

            {/* Chart */}
            <div className={monitorStyles.chartContainer}>
                <div className={monitorStyles.chartHeader}>
                    <div className={monitorStyles.chartTitle}>
                        <svg viewBox="0 0 24 24" fill="currentColor">
                            <path d="M3.5 18.49l6-6.01 4 4L22 6.92l-1.41-1.41-7.09 7.97-4-4L2 16.99z" />
                        </svg>
                        Real-Time Sensor Data
                    </div>
                    <div className={monitorStyles.chartControls}>
                        <div className={monitorStyles.timeRangeGroup}>
                            {[60, 120, 300].map((range) => (
                                <button
                                    key={range}
                                    className={monitorStyles.timeRangeBtn}
                                    data-active={timeRange === range}
                                    onClick={() =>
                                        setTimeRange(range as 60 | 120 | 300)
                                    }
                                >
                                    {range === 60
                                        ? "1m"
                                        : range === 120
                                          ? "2m"
                                          : "5m"}
                                </button>
                            ))}
                        </div>
                        <button
                            className={monitorStyles.controlBtn}
                            data-active={isPaused}
                            onClick={() => setIsPaused(!isPaused)}
                        >
                            {isPaused ? (
                                <svg viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M8 5v14l11-7z" />
                                </svg>
                            ) : (
                                <svg viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
                                </svg>
                            )}
                            {isPaused ? "Resume" : "Pause"}
                        </button>
                        <button
                            className={monitorStyles.controlBtn}
                            onClick={handleClearData}
                        >
                            <svg viewBox="0 0 24 24" fill="currentColor">
                                <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
                            </svg>
                            Clear
                        </button>
                    </div>
                </div>
                <div ref={chartRef} className={monitorStyles.chart} />
                <div className={monitorStyles.chartLegend}>
                    <div
                        className={monitorStyles.legendItem}
                        data-type="temperature"
                    >
                        <span className={monitorStyles.legendDot} />
                        Temperature
                    </div>
                    <div
                        className={monitorStyles.legendItem}
                        data-type="pressure"
                    >
                        <span className={monitorStyles.legendDot} />
                        Pressure
                    </div>
                    <div
                        className={monitorStyles.legendItem}
                        data-type="humidity"
                    >
                        <span className={monitorStyles.legendDot} />
                        Humidity
                    </div>
                </div>
            </div>
        </div>
    );
}
