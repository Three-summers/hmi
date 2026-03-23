use serde::Serialize;
use std::fs;
use std::path::Path;
use std::process::Command;
use std::time::Duration;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemOverview {
    pub uptime: u64,
    pub cpu_usage: f64,
    pub memory_usage: f64,
    pub disk_usage: f64,
    pub temperature: Option<f64>,
}

pub fn read_system_overview() -> Result<SystemOverview, String> {
    #[cfg(target_os = "linux")]
    {
        return linux::read_system_overview();
    }

    #[allow(unreachable_code)]
    Err("System overview is only supported on Linux".to_string())
}

#[cfg(target_os = "linux")]
mod linux {
    use super::*;

    #[derive(Debug, Clone, Copy)]
    struct CpuTimes {
        idle: u64,
        total: u64,
    }

    pub fn read_system_overview() -> Result<SystemOverview, String> {
        Ok(SystemOverview {
            uptime: read_uptime_seconds()?,
            cpu_usage: read_cpu_usage_percent()?,
            memory_usage: read_memory_usage_percent()?,
            disk_usage: read_disk_usage_percent("/")?,
            temperature: read_temperature_celsius(),
        })
    }

    fn read_uptime_seconds() -> Result<u64, String> {
        let raw = fs::read_to_string("/proc/uptime")
            .map_err(|error| format!("Failed to read /proc/uptime: {}", error))?;
        let first = raw
            .split_whitespace()
            .next()
            .ok_or_else(|| "Missing uptime field in /proc/uptime".to_string())?;
        let seconds = first
            .parse::<f64>()
            .map_err(|error| format!("Invalid uptime value: {}", error))?;

        Ok(seconds.floor() as u64)
    }

    fn read_cpu_usage_percent() -> Result<f64, String> {
        let start = read_cpu_times()?;
        std::thread::sleep(Duration::from_millis(120));
        let end = read_cpu_times()?;

        let delta_total = end.total.saturating_sub(start.total);
        let delta_idle = end.idle.saturating_sub(start.idle);

        if delta_total == 0 {
            return Ok(0.0);
        }

        let busy = delta_total.saturating_sub(delta_idle) as f64;
        let total = delta_total as f64;
        Ok((busy / total) * 100.0)
    }

    fn read_cpu_times() -> Result<CpuTimes, String> {
        let raw = fs::read_to_string("/proc/stat")
            .map_err(|error| format!("Failed to read /proc/stat: {}", error))?;
        let cpu_line = raw
            .lines()
            .find(|line| line.starts_with("cpu "))
            .ok_or_else(|| "Missing aggregate CPU line in /proc/stat".to_string())?;

        let values = cpu_line
            .split_whitespace()
            .skip(1)
            .map(|value| {
                value
                    .parse::<u64>()
                    .map_err(|error| format!("Invalid CPU stat value: {}", error))
            })
            .collect::<Result<Vec<_>, _>>()?;

        if values.len() < 5 {
            return Err("Aggregate CPU line does not contain enough fields".to_string());
        }

        let idle = values[3].saturating_add(values[4]);
        let total = values.iter().copied().sum();

        Ok(CpuTimes { idle, total })
    }

    fn read_memory_usage_percent() -> Result<f64, String> {
        let raw = fs::read_to_string("/proc/meminfo")
            .map_err(|error| format!("Failed to read /proc/meminfo: {}", error))?;

        let mut total_kib: Option<u64> = None;
        let mut available_kib: Option<u64> = None;

        for line in raw.lines() {
            if line.starts_with("MemTotal:") {
                total_kib = parse_meminfo_kib(line);
            }
            if line.starts_with("MemAvailable:") {
                available_kib = parse_meminfo_kib(line);
            }
        }

        let total = total_kib.ok_or_else(|| "Missing MemTotal in /proc/meminfo".to_string())?;
        let available =
            available_kib.ok_or_else(|| "Missing MemAvailable in /proc/meminfo".to_string())?;

        if total == 0 {
            return Err("MemTotal is zero".to_string());
        }

        let used = total.saturating_sub(available) as f64;
        Ok((used / total as f64) * 100.0)
    }

    fn parse_meminfo_kib(line: &str) -> Option<u64> {
        line.split_whitespace().nth(1)?.parse::<u64>().ok()
    }

    fn read_disk_usage_percent(target: &str) -> Result<f64, String> {
        let output = Command::new("df")
            .args(["-P", target])
            .output()
            .map_err(|error| format!("Failed to execute df: {}", error))?;

        if !output.status.success() {
            return Err(format!("df exited with status {}", output.status));
        }

        let stdout = String::from_utf8(output.stdout)
            .map_err(|error| format!("Invalid df stdout encoding: {}", error))?;
        let line = stdout
            .lines()
            .nth(1)
            .ok_or_else(|| "Missing disk usage line in df output".to_string())?;
        let percent = line
            .split_whitespace()
            .nth(4)
            .ok_or_else(|| "Missing disk usage percentage in df output".to_string())?;
        let value = percent
            .trim_end_matches('%')
            .parse::<f64>()
            .map_err(|error| format!("Invalid disk usage percentage: {}", error))?;

        Ok(value)
    }

    fn read_temperature_celsius() -> Option<f64> {
        let thermal_dir = fs::read_dir("/sys/class/thermal").ok()?;

        for entry in thermal_dir.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }

            let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
                continue;
            };
            if !name.starts_with("thermal_zone") {
                continue;
            }

            let temp_path = path.join("temp");
            if !Path::new(&temp_path).exists() {
                continue;
            }

            let Ok(raw) = fs::read_to_string(temp_path) else {
                continue;
            };
            let Ok(milli_celsius) = raw.trim().parse::<f64>() else {
                continue;
            };
            if milli_celsius > 0.0 {
                return Some(milli_celsius / 1000.0);
            }
        }

        None
    }
}
