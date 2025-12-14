use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

#[derive(Debug, Clone, Serialize)]
pub struct SensorData {
    pub timestamp: u64,
    pub temperature: f64,
    pub pressure: f64,
    pub humidity: f64,
}

pub struct SensorSimulator {
    running: Arc<AtomicBool>,
}

impl Default for SensorSimulator {
    fn default() -> Self {
        Self {
            running: Arc::new(AtomicBool::new(false)),
        }
    }
}

impl SensorSimulator {
    pub fn is_running(&self) -> bool {
        self.running.load(Ordering::SeqCst)
    }

    pub fn start(&self, app: AppHandle) {
        if self.running.swap(true, Ordering::SeqCst) {
            return; // Already running
        }

        let running = self.running.clone();

        // Use tauri's async runtime instead of tokio::spawn
        tauri::async_runtime::spawn(async move {
            let mut temp_base = 25.0_f64;
            let mut pressure_base = 101.3_f64;
            let mut humidity_base = 50.0_f64;

            while running.load(Ordering::SeqCst) {
                // Async sleep for 500ms
                tokio::time::sleep(Duration::from_millis(500)).await;

                // Generate random variations
                let temp_variation = (rand_simple() - 0.5) * 2.0;
                let pressure_variation = (rand_simple() - 0.5) * 1.0;
                let humidity_variation = (rand_simple() - 0.5) * 3.0;

                // Add slow drift
                temp_base += (rand_simple() - 0.5) * 0.1;
                pressure_base += (rand_simple() - 0.5) * 0.05;
                humidity_base += (rand_simple() - 0.5) * 0.2;

                // Clamp values to realistic ranges
                temp_base = temp_base.clamp(15.0, 35.0);
                pressure_base = pressure_base.clamp(95.0, 105.0);
                humidity_base = humidity_base.clamp(30.0, 80.0);

                let data = SensorData {
                    timestamp: std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap()
                        .as_millis() as u64,
                    temperature: temp_base + temp_variation,
                    pressure: pressure_base + pressure_variation,
                    humidity: humidity_base + humidity_variation,
                };

                log::info!("Emitting sensor data: temp={:.1}, pressure={:.1}, humidity={:.1}",
                    data.temperature, data.pressure, data.humidity);
                if let Err(e) = app.emit("sensor-data", &data) {
                    log::error!("Failed to emit sensor data: {}", e);
                    break;
                }
            }
        });
    }

    pub fn stop(&self) {
        self.running.store(false, Ordering::SeqCst);
    }
}

// Simple pseudo-random number generator (0.0 to 1.0)
fn rand_simple() -> f64 {
    use std::collections::hash_map::RandomState;
    use std::hash::{BuildHasher, Hasher};

    let state = RandomState::new();
    let mut hasher = state.build_hasher();
    hasher.write_u64(
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos() as u64,
    );
    (hasher.finish() % 10000) as f64 / 10000.0
}
