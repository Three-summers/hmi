import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import styles from "./System.module.css";
import sharedStyles from "../shared.module.css";

interface Subsystem {
  id: string;
  name: string;
  status: "online" | "offline" | "warning" | "error";
  value?: string | number;
  unit?: string;
}

interface SystemInfo {
  uptime: number;
  cpuUsage: number;
  memoryUsage: number;
  diskUsage: number;
  temperature: number;
}

const demoSubsystems: Subsystem[] = [
  { id: "chamber", name: "Process Chamber", status: "online", value: "Ready" },
  { id: "vacuum", name: "Vacuum System", status: "online", value: 2.5e-6, unit: "Torr" },
  { id: "rf", name: "RF Generator", status: "online", value: 500, unit: "W" },
  { id: "gas", name: "Gas Delivery", status: "online", value: "Active" },
  { id: "exhaust", name: "Exhaust System", status: "online", value: 85, unit: "%" },
  { id: "cooling", name: "Cooling System", status: "warning", value: 42, unit: "°C" },
  { id: "loader", name: "Wafer Loader", status: "online", value: "Home" },
  { id: "plc", name: "PLC Controller", status: "online", value: "Run" },
];

export default function SystemView() {
  const { t } = useTranslation();
  const [systemInfo, setSystemInfo] = useState<SystemInfo>({
    uptime: 86400,
    cpuUsage: 45,
    memoryUsage: 62,
    diskUsage: 35,
    temperature: 48,
  });

  useEffect(() => {
    const interval = setInterval(() => {
      setSystemInfo(prev => ({
        ...prev,
        cpuUsage: Math.min(100, Math.max(20, prev.cpuUsage + (Math.random() - 0.5) * 10)),
        memoryUsage: Math.min(100, Math.max(40, prev.memoryUsage + (Math.random() - 0.5) * 5)),
        temperature: Math.min(80, Math.max(35, prev.temperature + (Math.random() - 0.5) * 2)),
        uptime: prev.uptime + 1,
      }));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const formatUptime = (seconds: number) => {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    return `${days}d ${hours}h ${mins}m`;
  };

  const formatValue = (sub: Subsystem) => {
    if (typeof sub.value === "number") {
      if (sub.value < 0.001) {
        return sub.value.toExponential(1) + (sub.unit ? ` ${sub.unit}` : "");
      }
      return sub.value.toFixed(1) + (sub.unit ? ` ${sub.unit}` : "");
    }
    return sub.value || "--";
  };

  const getStatusColor = (status: Subsystem["status"]) => {
    switch (status) {
      case "online": return "attention";
      case "warning": return "warning";
      case "error": return "alarm";
      default: return "none";
    }
  };

  const onlineCount = demoSubsystems.filter(s => s.status === "online").length;

  return (
    <div className={sharedStyles.view}>
      <div className={styles.systemGrid}>
        {/* System Overview */}
        <div className={styles.overviewPanel}>
          <h3 className={styles.panelTitle}>{t("system.overview")}</h3>
          <div className={styles.overviewStats}>
            <div className={styles.overviewItem}>
              <div className={styles.overviewIcon}>
                <svg viewBox="0 0 24 24" fill="currentColor">
                  <path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z"/>
                </svg>
              </div>
              <div className={styles.overviewInfo}>
                <span className={styles.overviewLabel}>Uptime</span>
                <span className={styles.overviewValue}>{formatUptime(systemInfo.uptime)}</span>
              </div>
            </div>

            <div className={styles.overviewItem}>
              <div className={styles.overviewIcon} data-status="attention">
                <svg viewBox="0 0 24 24" fill="currentColor">
                  <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
                </svg>
              </div>
              <div className={styles.overviewInfo}>
                <span className={styles.overviewLabel}>Subsystems</span>
                <span className={styles.overviewValue}>{onlineCount}/{demoSubsystems.length} Online</span>
              </div>
            </div>
          </div>

          <div className={styles.resourceBars}>
            <div className={styles.resourceItem}>
              <div className={styles.resourceHeader}>
                <span className={styles.resourceLabel}>CPU</span>
                <span className={styles.resourceValue}>{systemInfo.cpuUsage.toFixed(0)}%</span>
              </div>
              <div className={styles.resourceBar}>
                <div
                  className={styles.resourceFill}
                  style={{ width: `${systemInfo.cpuUsage}%` }}
                  data-level={systemInfo.cpuUsage > 80 ? "high" : systemInfo.cpuUsage > 60 ? "medium" : "low"}
                />
              </div>
            </div>

            <div className={styles.resourceItem}>
              <div className={styles.resourceHeader}>
                <span className={styles.resourceLabel}>Memory</span>
                <span className={styles.resourceValue}>{systemInfo.memoryUsage.toFixed(0)}%</span>
              </div>
              <div className={styles.resourceBar}>
                <div
                  className={styles.resourceFill}
                  style={{ width: `${systemInfo.memoryUsage}%` }}
                  data-level={systemInfo.memoryUsage > 80 ? "high" : systemInfo.memoryUsage > 60 ? "medium" : "low"}
                />
              </div>
            </div>

            <div className={styles.resourceItem}>
              <div className={styles.resourceHeader}>
                <span className={styles.resourceLabel}>Disk</span>
                <span className={styles.resourceValue}>{systemInfo.diskUsage.toFixed(0)}%</span>
              </div>
              <div className={styles.resourceBar}>
                <div
                  className={styles.resourceFill}
                  style={{ width: `${systemInfo.diskUsage}%` }}
                  data-level={systemInfo.diskUsage > 80 ? "high" : systemInfo.diskUsage > 60 ? "medium" : "low"}
                />
              </div>
            </div>

            <div className={styles.resourceItem}>
              <div className={styles.resourceHeader}>
                <span className={styles.resourceLabel}>Temp</span>
                <span className={styles.resourceValue}>{systemInfo.temperature.toFixed(0)}°C</span>
              </div>
              <div className={styles.resourceBar}>
                <div
                  className={styles.resourceFill}
                  style={{ width: `${(systemInfo.temperature / 80) * 100}%` }}
                  data-level={systemInfo.temperature > 70 ? "high" : systemInfo.temperature > 55 ? "medium" : "low"}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Subsystems Panel */}
        <div className={styles.subsystemsPanel}>
          <h3 className={styles.panelTitle}>{t("system.subsystems")}</h3>
          <div className={styles.subsystemsList}>
            {demoSubsystems.map((sub) => (
              <div key={sub.id} className={styles.subsystemCard} data-status={getStatusColor(sub.status)}>
                <div className={styles.subsystemIndicator} data-status={getStatusColor(sub.status)} />
                <div className={styles.subsystemInfo}>
                  <span className={styles.subsystemName}>{sub.name}</span>
                  <span className={styles.subsystemValue}>{formatValue(sub)}</span>
                </div>
                <div className={styles.subsystemStatus} data-status={getStatusColor(sub.status)}>
                  {sub.status.toUpperCase()}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
