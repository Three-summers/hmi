use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tokio::sync::Notify;

/// 频谱数据结构
#[derive(Debug, Clone, Serialize)]
pub struct SpectrumData {
    /// 时间戳（毫秒）
    pub timestamp: u64,
    /// 频率点数组 (Hz)
    pub frequencies: Vec<f64>,
    /// 幅值数组 (dB)
    pub amplitudes: Vec<f64>,
    /// 峰值频率 (Hz)
    pub peak_frequency: f64,
    /// 峰值幅值 (dB)
    pub peak_amplitude: f64,
    /// 平均幅值 (dB)
    pub average_amplitude: f64,
}

/// 波形参数结构
struct WaveComponent {
    base_frequency: f64,  // 基础中心频率 (Hz) - 不变
    frequency: f64,       // 当前中心频率 (Hz)
    amplitude: f64,       // 基础幅值 (dB)
    bandwidth: f64,       // 带宽 (Hz)
    drift_speed: f64,     // 漂移速度
    phase: f64,           // 相位
}

pub struct SensorSimulator {
    running: Arc<AtomicBool>,
    stopped: Arc<Notify>,
}

impl Default for SensorSimulator {
    fn default() -> Self {
        Self {
            running: Arc::new(AtomicBool::new(false)),
            stopped: Arc::new(Notify::new()),
        }
    }
}

impl SensorSimulator {
    #[allow(dead_code)]
    pub fn is_running(&self) -> bool {
        self.running.load(Ordering::SeqCst)
    }

    pub fn start(&self, app: AppHandle) {
        // 如果已经在运行，直接返回
        if self.running.load(Ordering::SeqCst) {
            log::info!("Sensor simulation already running");
            return;
        }

        // 设置运行标志
        self.running.store(true, Ordering::SeqCst);
        log::info!("Starting sensor simulation");

        let running = self.running.clone();
        let stopped = self.stopped.clone();

        tauri::async_runtime::spawn(async move {
            // 频谱参数：256 个频率点，范围 0-10000 Hz
            let num_points: usize = 256;
            let max_freq: f64 = 10000.0;
            let freq_step: f64 = max_freq / num_points as f64;

            // 生成频率数组
            let frequencies: Vec<f64> = (0..num_points)
                .map(|i| i as f64 * freq_step)
                .collect();

            // 定义多个波形分量（模拟真实频谱的多个峰值）
            let mut wave_components = vec![
                WaveComponent {
                    base_frequency: 500.0,
                    frequency: 500.0,
                    amplitude: -20.0,
                    bandwidth: 200.0,
                    drift_speed: 0.02,
                    phase: 0.0,
                },
                WaveComponent {
                    base_frequency: 1500.0,
                    frequency: 1500.0,
                    amplitude: -35.0,
                    bandwidth: 150.0,
                    drift_speed: 0.03,
                    phase: 0.0,
                },
                WaveComponent {
                    base_frequency: 2800.0,
                    frequency: 2800.0,
                    amplitude: -45.0,
                    bandwidth: 180.0,
                    drift_speed: 0.025,
                    phase: 0.0,
                },
                WaveComponent {
                    base_frequency: 4200.0,
                    frequency: 4200.0,
                    amplitude: -55.0,
                    bandwidth: 250.0,
                    drift_speed: 0.015,
                    phase: 0.0,
                },
                WaveComponent {
                    base_frequency: 6000.0,
                    frequency: 6000.0,
                    amplitude: -50.0,
                    bandwidth: 300.0,
                    drift_speed: 0.04,
                    phase: 0.0,
                },
                WaveComponent {
                    base_frequency: 7500.0,
                    frequency: 7500.0,
                    amplitude: -60.0,
                    bandwidth: 350.0,
                    drift_speed: 0.018,
                    phase: 0.0,
                },
                WaveComponent {
                    base_frequency: 9000.0,
                    frequency: 9000.0,
                    amplitude: -65.0,
                    bandwidth: 400.0,
                    drift_speed: 0.022,
                    phase: 0.0,
                },
            ];

            let mut time_counter: f64 = 0.0;
            let mut seed: u64 = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos() as u64;

            log::info!("Sensor simulation loop started");

            while running.load(Ordering::SeqCst) {
                tokio::time::sleep(Duration::from_millis(50)).await;

                // 再次检查是否应该停止
                if !running.load(Ordering::SeqCst) {
                    break;
                }

                time_counter += 0.05;

                // 更新波形分量的相位和轻微漂移
                for component in &mut wave_components {
                    component.phase += component.drift_speed;
                    seed = lcg_random(seed);
                    let drift = ((seed % 1000) as f64 / 1000.0 - 0.5) * 10.0;
                    let min_freq = component.base_frequency * 0.9;
                    let max_freq_val = component.base_frequency * 1.1;
                    component.frequency = (component.frequency + drift).clamp(min_freq, max_freq_val);
                    seed = lcg_random(seed);
                    let amp_variation = ((seed % 1000) as f64 / 1000.0 - 0.5) * 0.3;
                    component.amplitude += amp_variation;
                    component.amplitude = component.amplitude.clamp(-70.0, -15.0);
                }

                // 生成频谱幅值
                let noise_floor = -90.0_f64;
                let mut amplitudes: Vec<f64> = vec![noise_floor; num_points];

                for (i, freq) in frequencies.iter().enumerate() {
                    // 底噪随机波动
                    seed = lcg_random(seed);
                    let noise = ((seed % 1000) as f64 / 1000.0 - 0.5) * 6.0;
                    amplitudes[i] = noise_floor + noise.abs();

                    // 叠加每个波形分量
                    for component in &wave_components {
                        let sigma = component.bandwidth / 2.355;
                        let diff = freq - component.frequency;
                        let gaussian = (-diff * diff / (2.0 * sigma * sigma)).exp();

                        // 只在峰值附近添加贡献
                        if gaussian > 0.001 {
                            // 时变调制
                            let time_modulation = 1.0 + 0.2 * (time_counter * 2.0 + component.phase).sin();

                            // 计算该频率点的幅值：从底噪平滑过渡到峰值幅值
                            // gaussian = 1 时，幅值 = component.amplitude
                            // gaussian = 0 时，幅值 = noise_floor
                            let peak_amp = component.amplitude * time_modulation;
                            let contribution = noise_floor + (peak_amp - noise_floor) * gaussian;

                            // 取最大值（多个峰可能重叠）
                            if contribution > amplitudes[i] {
                                amplitudes[i] = contribution;
                            }
                        }
                    }

                    // 添加随机杂散信号
                    seed = lcg_random(seed);
                    if seed % 500 == 0 {
                        seed = lcg_random(seed);
                        let spike = -50.0 - (seed % 200) as f64 / 10.0;
                        if spike > amplitudes[i] {
                            amplitudes[i] = spike;
                        }
                    }
                }

                let smoothed = smooth_spectrum(&amplitudes, 3);

                let mut peak_idx = 0;
                let mut peak_amp = f64::MIN;
                for (i, &amp) in smoothed.iter().enumerate() {
                    if amp > peak_amp {
                        peak_amp = amp;
                        peak_idx = i;
                    }
                }
                let peak_frequency = frequencies[peak_idx];
                let peak_amplitude = peak_amp;
                let average_amplitude = smoothed.iter().sum::<f64>() / smoothed.len() as f64;

                let data = SpectrumData {
                    timestamp: std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_millis() as u64,
                    frequencies: frequencies.clone(),
                    amplitudes: smoothed,
                    peak_frequency,
                    peak_amplitude,
                    average_amplitude,
                };

                // 尝试发送数据，如果失败则退出循环
                match app.emit("spectrum-data", &data) {
                    Ok(_) => {}
                    Err(e) => {
                        log::warn!("Failed to emit spectrum data (window may be closed): {}", e);
                        break;
                    }
                }
            }

            log::info!("Sensor simulation loop ended");
            // 通知已停止
            stopped.notify_waiters();
        });
    }

    pub fn stop(&self) {
        log::info!("Stopping sensor simulation");
        self.running.store(false, Ordering::SeqCst);
    }
}

/// 简单移动平均平滑
fn smooth_spectrum(data: &[f64], window: usize) -> Vec<f64> {
    let mut result = vec![0.0; data.len()];
    let half_window = window / 2;

    for i in 0..data.len() {
        let start = i.saturating_sub(half_window);
        let end = (i + half_window + 1).min(data.len());
        let sum: f64 = data[start..end].iter().sum();
        result[i] = sum / (end - start) as f64;
    }

    result
}

/// 线性同余随机数生成器 (LCG)
#[inline]
fn lcg_random(seed: u64) -> u64 {
    seed.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407)
}
