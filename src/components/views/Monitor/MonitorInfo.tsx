import { useTranslation } from "react-i18next";
import monitorStyles from "./Monitor.module.css";

/**
 * Monitor 说明子页（拆分自 Monitor/index.tsx）
 */
export function MonitorInfo() {
    const { t } = useTranslation();

    return (
        <div className={monitorStyles.monitorInfo}>
            <h3 className={monitorStyles.monitorInfoTitle}>
                {t("nav.monitor")}
            </h3>
            <ul className={monitorStyles.monitorInfoList}>
                <li>{t("monitor.info.autoPause")}</li>
                <li>{t("monitor.info.displayModeTip")}</li>
                <li>{t("monitor.info.browserModeTip")}</li>
            </ul>
        </div>
    );
}
