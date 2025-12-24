/**
 * TitleSection（标题区）
 *
 * 顶部栏中间区域：展示当前主视图名称。
 *
 * @module TitleSection
 */

import { useTranslation } from "react-i18next";
import type { ViewId } from "@/types";
import styles from "./TitlePanel.module.css";

interface TitleSectionProps {
    /** 当前激活视图 */
    currentView: ViewId;
}

export function TitleSection({ currentView }: TitleSectionProps) {
    const { t } = useTranslation();

    return (
        <div className={styles.centerSection}>
            <h1 className={styles.viewName}>{t(`nav.${currentView}`)}</h1>
        </div>
    );
}

