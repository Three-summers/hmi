import { useTranslation } from "react-i18next";
import styles from "../shared.module.css";

export default function DatalogView() {
    const { t } = useTranslation();

    return (
        <div className={styles.view}>
            <div className={styles.header}>
                <h2 className={styles.title}>{t("nav.datalog")}</h2>
            </div>

            <div className={styles.content}>
                <div className={styles.emptyState}>
                    <span className={styles.emptyIcon}>📊</span>
                    <span>Data logging view - Coming soon</span>
                </div>
            </div>
        </div>
    );
}
