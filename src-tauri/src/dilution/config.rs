//! 稀释流程配置：workspace/system/dilution.json

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

pub const DILUTION_CONFIG_ENV: &str = "HMI_WORKSPACE_ROOT";
pub const DEFAULT_PROJECT_ID: &str = "dilution-machine";
pub const DILUTION_CONFIG_RELATIVE_PATH: &str = "system/dilution.json";

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct MachineConfig {
    pub eqpt_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct PersonnelConfig {
    pub operator: Option<String>,
    pub checker: Option<String>,
}

const DEFAULT_MIX_TIME_MS: u64 = 300_000;
const DEFAULT_SETTLE_TIME_MS: u64 = 120_000;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct ProcessDefaultsConfig {
    pub mix_time_ms: u64,
    pub settle_time_ms: u64,
}

impl Default for ProcessDefaultsConfig {
    fn default() -> Self {
        Self {
            mix_time_ms: DEFAULT_MIX_TIME_MS,
            settle_time_ms: DEFAULT_SETTLE_TIME_MS,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct DilutionOptionConfig {
    pub concentration: String,
    pub recipe_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct DilutionConfig {
    pub machine: Option<MachineConfig>,
    pub personnel: Option<PersonnelConfig>,
    pub label_print_url: Option<String>,
    pub process_defaults: ProcessDefaultsConfig,
    pub dilution_options: Vec<DilutionOptionConfig>,
}

impl DilutionConfig {
    pub fn eqpt_id(&self) -> Option<&str> {
        self.machine
            .as_ref()
            .and_then(|machine| machine.eqpt_id.as_deref())
    }

    pub fn operator(&self) -> Option<&str> {
        self.personnel
            .as_ref()
            .and_then(|personnel| personnel.operator.as_deref())
    }

    pub fn checker(&self) -> Option<&str> {
        self.personnel
            .as_ref()
            .and_then(|personnel| personnel.checker.as_deref())
    }

    pub fn option_for_concentration(&self, concentration: &str) -> Option<&DilutionOptionConfig> {
        self.dilution_options
            .iter()
            .find(|option| option.concentration == concentration)
    }
}

pub fn parse_concentration_ratio(concentration: &str) -> Result<(f64, f64), String> {
    let value = concentration.trim();
    if let Some(percent) = value.strip_suffix('%') {
        let raw = percent
            .trim()
            .parse::<f64>()
            .map_err(|_| format!("invalid concentration ratio `{concentration}`"))?;
        if !raw.is_finite() || !(0.0 < raw && raw <= 100.0) {
            return Err(format!("invalid concentration ratio `{concentration}`"));
        }
        return Ok((raw, 100.0 - raw));
    }

    let (raw, solvent) = value
        .split_once(':')
        .ok_or_else(|| format!("invalid concentration ratio `{concentration}`"))?;
    let raw = raw
        .trim()
        .parse::<f64>()
        .map_err(|_| format!("invalid concentration ratio `{concentration}`"))?;
    let solvent = solvent
        .trim()
        .parse::<f64>()
        .map_err(|_| format!("invalid concentration ratio `{concentration}`"))?;
    if !raw.is_finite() || !solvent.is_finite() || raw <= 0.0 || solvent < 0.0 {
        return Err(format!("invalid concentration ratio `{concentration}`"));
    }
    Ok((raw, solvent))
}

/// 解析默认 workspace root：
/// 1) env HMI_WORKSPACE_ROOT
/// 2) debug：仓库根 workspace/（CARGO_MANIFEST_DIR 父目录）
/// 3) release：可执行文件同目录 workspace/
pub fn default_workspace_root() -> PathBuf {
    if let Some(value) = std::env::var_os(DILUTION_CONFIG_ENV) {
        let value = value.to_string_lossy().trim().to_string();
        if !value.is_empty() {
            return PathBuf::from(value);
        }
    }
    if cfg!(debug_assertions) {
        let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        return manifest_dir
            .parent()
            .map(|path| path.join("workspace"))
            .unwrap_or_else(|| manifest_dir.join("workspace"));
    }
    std::env::current_exe()
        .map(|exe| {
            exe.parent()
                .map(|path| path.join("workspace"))
                .unwrap_or_else(|| PathBuf::from("workspace"))
        })
        .unwrap_or_else(|_| PathBuf::from("workspace"))
}

/// 读取 system/dilution.json；文件缺失时返回默认空配置
pub fn load_dilution_config(workspace_root: &PathBuf) -> Result<DilutionConfig, String> {
    let path = workspace_root.join(DILUTION_CONFIG_RELATIVE_PATH);
    if !path.exists() {
        return Ok(DilutionConfig::default());
    }
    let raw = std::fs::read_to_string(&path)
        .map_err(|error| format!("failed to read dilution config `{}`: {error}", path.display()))?;
    serde_json::from_str(&raw)
        .map_err(|error| format!("failed to parse dilution config `{}`: {error}", path.display()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn temp_workspace(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "hmi-dilution-config-test-{}-{}",
            std::process::id(),
            name
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("system")).unwrap();
        dir
    }

    #[test]
    fn load_config_should_parse_full_file() {
        let workspace = temp_workspace("t1");
        fs::write(
            workspace.join("system/dilution.json"),
            r#"{
              "machine": { "eqptId": "EQPT-001" },
              "personnel": { "operator": "张工", "checker": "李工" },
              "labelPrintUrl": "http://print-server/bartender/api",
              "dilutionOptions": [
                {
                  "concentration": "0.01:5",
                  "recipeId": "dilute-0.01-5",
                  "legacyIgnoredField": true
                }
              ],
              "processDefaults": { "mixTimeMs": 300000, "settleTimeMs": 120000 }
            }"#,
        )
        .unwrap();
        let config = load_dilution_config(&workspace).unwrap();
        assert_eq!(config.eqpt_id(), Some("EQPT-001"));
        assert_eq!(config.operator(), Some("张工"));
        assert_eq!(config.checker(), Some("李工"));
        assert_eq!(
            config.label_print_url.as_deref(),
            Some("http://print-server/bartender/api")
        );
        let option = config.option_for_concentration("0.01:5").unwrap();
        assert_eq!(option.recipe_id, "dilute-0.01-5");
        assert_eq!(config.process_defaults.mix_time_ms, 300_000);
        assert_eq!(config.process_defaults.settle_time_ms, 120_000);
    }

    #[test]
    fn load_config_should_return_defaults_when_file_missing() {
        let workspace = temp_workspace("t2");
        let config = load_dilution_config(&workspace).unwrap();
        assert_eq!(config, DilutionConfig::default());
        assert_eq!(config.eqpt_id(), None);
        assert!(config.option_for_concentration("0.01:5").is_none());
        assert_eq!(config.process_defaults.mix_time_ms, 300_000);
        assert_eq!(config.process_defaults.settle_time_ms, 120_000);
    }

    #[test]
    fn option_lookup_should_return_none_for_unknown_concentration() {
        let workspace = temp_workspace("t3");
        fs::write(
            workspace.join("system/dilution.json"),
            r#"{"dilutionOptions":[{"concentration":"70%","recipeId":"r1"}]}"#,
        )
        .unwrap();
        let config = load_dilution_config(&workspace).unwrap();
        assert!(config.option_for_concentration("60%").is_none());
        assert_eq!(config.option_for_concentration("70%").unwrap().recipe_id, "r1");
    }

    #[test]
    fn parse_concentration_ratio_should_support_ratio_and_percent_forms() {
        assert_eq!(parse_concentration_ratio("0.01:5").unwrap(), (0.01, 5.0));
        assert_eq!(parse_concentration_ratio("70%").unwrap(), (70.0, 30.0));
        assert!(parse_concentration_ratio("0:5").is_err());
        assert!(parse_concentration_ratio("invalid").is_err());
    }
}
