import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore, useCommStore } from "@/stores";
import styles from "./Setup.module.css";
import sharedStyles from "../shared.module.css";

export default function SetupView() {
    const { t } = useTranslation();
    const {
        language,
        setLanguage,
        commandPanelPosition,
        setCommandPanelPosition,
    } = useAppStore();
    const {
        serialConnected,
        tcpConnected,
        getSerialPorts,
        connectSerial,
        disconnectSerial,
        connectTcp,
        disconnectTcp,
    } = useCommStore();

    const [availablePorts, setAvailablePorts] = useState<string[]>([]);
    const [selectedPort, setSelectedPort] = useState("");
    const [baudRate, setBaudRate] = useState(9600);
    const [tcpHost, setTcpHost] = useState("127.0.0.1");
    const [tcpPort, setTcpPort] = useState("502");

    useEffect(() => {
        getSerialPorts().then(setAvailablePorts);
    }, [getSerialPorts]);

    const handleSerialConnect = async () => {
        if (serialConnected) {
            await disconnectSerial();
        } else if (selectedPort) {
            await connectSerial({
                port: selectedPort,
                baudRate,
                dataBits: 8,
                stopBits: 1,
                parity: "none",
            });
        }
    };

    const handleTcpConnect = async () => {
        if (tcpConnected) {
            await disconnectTcp();
        } else {
            const portNum = parseInt(tcpPort, 10);
            if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
                console.error("Invalid port number");
                return;
            }
            await connectTcp({
                host: tcpHost,
                port: portNum,
                timeoutMs: 5000,
            });
        }
    };

    return (
        <div className={sharedStyles.view}>
            <div className={styles.setupGrid}>
                {/* Language Section */}
                <div className={styles.section}>
                    <div className={styles.sectionHeader}>
                        <div className={styles.sectionIcon}>
                            <svg viewBox="0 0 24 24" fill="currentColor">
                                <path d="M12.87 15.07l-2.54-2.51.03-.03c1.74-1.94 2.98-4.17 3.71-6.53H17V4h-7V2H8v2H1v1.99h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7l1.62-4.33L19.12 17h-3.24z" />
                            </svg>
                        </div>
                        <div>
                            <h3 className={styles.sectionTitle}>
                                {t("setup.language")}
                            </h3>
                            <p className={styles.sectionDesc}>
                                Select display language
                            </p>
                        </div>
                    </div>
                    <div className={styles.optionRow}>
                        <button
                            className={styles.optionButton}
                            data-selected={language === "zh"}
                            onClick={() => setLanguage("zh")}
                        >
                            <span className={styles.optionIcon}>🇨🇳</span>
                            中文
                        </button>
                        <button
                            className={styles.optionButton}
                            data-selected={language === "en"}
                            onClick={() => setLanguage("en")}
                        >
                            <span className={styles.optionIcon}>🇺🇸</span>
                            English
                        </button>
                    </div>
                </div>

                {/* Layout Section */}
                <div className={styles.section}>
                    <div className={styles.sectionHeader}>
                        <div className={styles.sectionIcon}>
                            <svg viewBox="0 0 24 24" fill="currentColor">
                                <path d="M3 5v14h18V5H3zm4 12H5v-2h2v2zm0-4H5v-2h2v2zm0-4H5V7h2v2zm12 8H9V7h10v10z" />
                            </svg>
                        </div>
                        <div>
                            <h3 className={styles.sectionTitle}>Layout</h3>
                            <p className={styles.sectionDesc}>
                                Command panel position
                            </p>
                        </div>
                    </div>
                    <div className={styles.optionRow}>
                        <button
                            className={styles.optionButton}
                            data-selected={commandPanelPosition === "right"}
                            onClick={() => setCommandPanelPosition("right")}
                        >
                            <svg
                                className={styles.optionIcon}
                                viewBox="0 0 24 24"
                                fill="currentColor"
                            >
                                <path d="M3 5v14h18V5H3zm14 12H5V7h12v10zm2 0v-2h2v2h-2zm0-4v-2h2v2h-2zm0-4V7h2v2h-2z" />
                            </svg>
                            Right
                        </button>
                        <button
                            className={styles.optionButton}
                            data-selected={commandPanelPosition === "left"}
                            onClick={() => setCommandPanelPosition("left")}
                        >
                            <svg
                                className={styles.optionIcon}
                                viewBox="0 0 24 24"
                                fill="currentColor"
                            >
                                <path d="M3 5v14h18V5H3zm4 12H5v-2h2v2zm0-4H5v-2h2v2zm0-4H5V7h2v2zm12 8H9V7h10v10z" />
                            </svg>
                            Left
                        </button>
                    </div>
                </div>

                {/* Serial Connection */}
                <div className={styles.section}>
                    <div className={styles.sectionHeader}>
                        <div className={styles.sectionIcon}>
                            <svg viewBox="0 0 24 24" fill="currentColor">
                                <path d="M17 16l-4-4V8.82C14.16 8.4 15 7.3 15 6c0-1.66-1.34-3-3-3S9 4.34 9 6c0 1.3.84 2.4 2 2.82V12l-4 4H3v5h5v-3.05l4-4.2 4 4.2V21h5v-5h-4z" />
                            </svg>
                        </div>
                        <div>
                            <h3 className={styles.sectionTitle}>
                                {t("setup.serial")}
                            </h3>
                            <p className={styles.sectionDesc}>
                                Serial port configuration
                            </p>
                        </div>
                    </div>

                    <div className={styles.statusIndicator}>
                        <span
                            className={styles.statusDot}
                            data-connected={serialConnected}
                        />
                        <span
                            className={styles.statusText}
                            data-connected={serialConnected}
                        >
                            {serialConnected ? "Connected" : "Disconnected"}
                        </span>
                    </div>

                    <div className={styles.formGroup}>
                        <label className={styles.formLabel}>
                            {t("setup.port")}
                        </label>
                        <select
                            value={selectedPort}
                            onChange={(e) => setSelectedPort(e.target.value)}
                            className={styles.select}
                            disabled={serialConnected}
                        >
                            <option value="">Select port...</option>
                            {availablePorts.map((port) => (
                                <option key={port} value={port}>
                                    {port}
                                </option>
                            ))}
                        </select>
                    </div>

                    <div className={styles.formGroup}>
                        <label className={styles.formLabel}>
                            {t("setup.baudRate")}
                        </label>
                        <select
                            value={baudRate}
                            onChange={(e) =>
                                setBaudRate(Number(e.target.value))
                            }
                            className={styles.select}
                            disabled={serialConnected}
                        >
                            {[9600, 19200, 38400, 57600, 115200].map((rate) => (
                                <option key={rate} value={rate}>
                                    {rate}
                                </option>
                            ))}
                        </select>
                    </div>

                    <button
                        className={styles.connectButton}
                        onClick={handleSerialConnect}
                        data-connected={serialConnected}
                    >
                        {serialConnected ? (
                            <>
                                <svg viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
                                </svg>
                                {t("setup.disconnect")}
                            </>
                        ) : (
                            <>
                                <svg viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M21 3L3 10.53v.98l6.84 2.65L12.48 21h.98L21 3z" />
                                </svg>
                                {t("setup.connect")}
                            </>
                        )}
                    </button>
                </div>

                {/* TCP Connection */}
                <div className={styles.section}>
                    <div className={styles.sectionHeader}>
                        <div className={styles.sectionIcon}>
                            <svg viewBox="0 0 24 24" fill="currentColor">
                                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" />
                            </svg>
                        </div>
                        <div>
                            <h3 className={styles.sectionTitle}>
                                {t("setup.tcp")}
                            </h3>
                            <p className={styles.sectionDesc}>
                                TCP/IP connection settings
                            </p>
                        </div>
                    </div>

                    <div className={styles.statusIndicator}>
                        <span
                            className={styles.statusDot}
                            data-connected={tcpConnected}
                        />
                        <span
                            className={styles.statusText}
                            data-connected={tcpConnected}
                        >
                            {tcpConnected ? "Connected" : "Disconnected"}
                        </span>
                    </div>

                    <div className={styles.formGroup}>
                        <label className={styles.formLabel}>
                            {t("setup.host")}
                        </label>
                        <input
                            type="text"
                            value={tcpHost}
                            onChange={(e) => setTcpHost(e.target.value)}
                            className={styles.input}
                            disabled={tcpConnected}
                            placeholder="192.168.1.100"
                        />
                    </div>

                    <div className={styles.formGroup}>
                        <label className={styles.formLabel}>
                            {t("setup.port")}
                        </label>
                        <input
                            type="text"
                            inputMode="numeric"
                            pattern="[0-9]*"
                            value={tcpPort}
                            onChange={(e) => {
                                const val = e.target.value;
                                // 只允许数字输入
                                if (val === "" || /^\d+$/.test(val)) {
                                    setTcpPort(val);
                                }
                            }}
                            className={styles.input}
                            disabled={tcpConnected}
                            placeholder="9000"
                        />
                    </div>

                    <button
                        className={styles.connectButton}
                        onClick={handleTcpConnect}
                        data-connected={tcpConnected}
                    >
                        {tcpConnected ? (
                            <>
                                <svg viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
                                </svg>
                                {t("setup.disconnect")}
                            </>
                        ) : (
                            <>
                                <svg viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M21 3L3 10.53v.98l6.84 2.65L12.48 21h.98L21 3z" />
                                </svg>
                                {t("setup.connect")}
                            </>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
}
