import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Tabs } from "@/components/common";
import styles from "./Help.module.css";
import sharedStyles from "../shared.module.css";

type HelpSection =
    | "about"
    | "colors"
    | "shortcuts"
    | "semi"
    | "faq"
    | "support";

const icons: Record<string, JSX.Element> = {
    info: (
        <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z" />
        </svg>
    ),
    palette: (
        <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 3c-4.97 0-9 4.03-9 9s4.03 9 9 9c.83 0 1.5-.67 1.5-1.5 0-.39-.15-.74-.39-1.01-.23-.26-.38-.61-.38-.99 0-.83.67-1.5 1.5-1.5H16c2.76 0 5-2.24 5-5 0-4.42-4.03-8-9-8zm-5.5 9c-.83 0-1.5-.67-1.5-1.5S5.67 9 6.5 9 8 9.67 8 10.5 7.33 12 6.5 12zm3-4C8.67 8 8 7.33 8 6.5S8.67 5 9.5 5s1.5.67 1.5 1.5S10.33 8 9.5 8zm5 0c-.83 0-1.5-.67-1.5-1.5S13.67 5 14.5 5s1.5.67 1.5 1.5S15.33 8 14.5 8zm3 4c-.83 0-1.5-.67-1.5-1.5S16.67 9 17.5 9s1.5.67 1.5 1.5-.67 1.5-1.5 1.5z" />
        </svg>
    ),
    keyboard: (
        <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M20 5H4c-1.1 0-1.99.9-1.99 2L2 17c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm-9 3h2v2h-2V8zm0 3h2v2h-2v-2zM8 8h2v2H8V8zm0 3h2v2H8v-2zm-1 2H5v-2h2v2zm0-3H5V8h2v2zm9 7H8v-2h8v2zm0-4h-2v-2h2v2zm0-3h-2V8h2v2zm3 3h-2v-2h2v2zm0-3h-2V8h2v2z" />
        </svg>
    ),
    standard: (
        <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z" />
        </svg>
    ),
    question: (
        <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 17h-2v-2h2v2zm2.07-7.75l-.9.92C13.45 12.9 13 13.5 13 15h-2v-.5c0-1.1.45-2.1 1.17-2.83l1.24-1.26c.37-.36.59-.86.59-1.41 0-1.1-.9-2-2-2s-2 .9-2 2H8c0-2.21 1.79-4 4-4s4 1.79 4 4c0 .88-.36 1.68-.93 2.25z" />
        </svg>
    ),
    support: (
        <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 1c-4.97 0-9 4.03-9 9v7c0 1.66 1.34 3 3 3h3v-8H5v-2c0-3.87 3.13-7 7-7s7 3.13 7 7v2h-4v8h3c1.66 0 3-1.34 3-3v-7c0-4.97-4.03-9-9-9z" />
        </svg>
    ),
};

const helpTabs: {
    id: HelpSection;
    icon: keyof typeof icons;
    labelKey: string;
}[] = [
    { id: "about", icon: "info", labelKey: "help.tabs.about" },
    { id: "colors", icon: "palette", labelKey: "help.tabs.colors" },
    { id: "shortcuts", icon: "keyboard", labelKey: "help.tabs.shortcuts" },
    { id: "semi", icon: "standard", labelKey: "help.tabs.semi" },
    { id: "faq", icon: "question", labelKey: "help.tabs.faq" },
    { id: "support", icon: "support", labelKey: "help.tabs.support" },
];

export default function HelpView() {
    const { t } = useTranslation();
    const [activeTab, setActiveTab] = useState<HelpSection>("about");

    const renderSectionContent = (section: HelpSection) => {
        switch (section) {
            case "about":
                return (
                    <>
                        <h2 className={styles.sectionTitle}>
                            {icons.info}
                            {t("help.about")}
                        </h2>
                        <div className={styles.sectionContent}>
                            <div className={styles.infoCard}>
                                <div className={styles.infoRow}>
                                    <span className={styles.infoLabel}>
                                        {t("help.aboutInfo.applicationLabel")}
                                    </span>
                                    <span className={styles.infoValue}>
                                        {t("help.aboutInfo.applicationValue")}
                                    </span>
                                </div>
                                <div className={styles.infoRow}>
                                    <span className={styles.infoLabel}>
                                        {t("help.version")}
                                    </span>
                                    <span className={styles.infoValue}>
                                        0.1.0
                                    </span>
                                </div>
                                <div className={styles.infoRow}>
                                    <span className={styles.infoLabel}>
                                        {t("help.aboutInfo.frameworkLabel")}
                                    </span>
                                    <span className={styles.infoValue}>
                                        {t("help.aboutInfo.frameworkValue")}
                                    </span>
                                </div>
                                <div className={styles.infoRow}>
                                    <span className={styles.infoLabel}>
                                        {t("help.aboutInfo.standardLabel")}
                                    </span>
                                    <span className={styles.infoValue}>
                                        {t("help.aboutInfo.standardValue")}
                                    </span>
                                </div>
                                <div className={styles.infoRow}>
                                    <span className={styles.infoLabel}>
                                        {t("help.aboutInfo.platformLabel")}
                                    </span>
                                    <span className={styles.infoValue}>
                                        {t("help.aboutInfo.platformValue")}
                                    </span>
                                </div>
                                <div className={styles.infoRow}>
                                    <span className={styles.infoLabel}>
                                        {t("help.aboutInfo.displayLabel")}
                                    </span>
                                    <span className={styles.infoValue}>
                                        {t("help.aboutInfo.displayValue")}
                                    </span>
                                </div>
                            </div>
                            <p
                                style={{
                                    color: "var(--text-secondary)",
                                    fontSize: "13px",
                                    lineHeight: 1.6,
                                }}
                            >
                                {t("help.aboutInfo.description")}
                            </p>
                        </div>
                    </>
                );

            case "colors":
                return (
                    <>
                        <h2 className={styles.sectionTitle}>
                            {icons.palette}
                            {t("help.colors.title")}
                        </h2>
                        <div className={styles.sectionContent}>
                            <p
                                style={{
                                    color: "var(--text-secondary)",
                                    fontSize: "13px",
                                    marginBottom: "16px",
                                }}
                            >
                                {t("help.colors.description")}
                            </p>
                            <div className={styles.colorLegend}>
                                <div className={styles.colorItem}>
                                    <span
                                        className={styles.colorDot}
                                        data-color="alarm"
                                    />
                                    <div className={styles.colorInfo}>
                                        <span className={styles.colorName}>
                                            {t("help.colors.items.alarm.name")}
                                        </span>
                                        <span className={styles.colorDesc}>
                                            {t("help.colors.items.alarm.desc")}
                                        </span>
                                    </div>
                                </div>
                                <div className={styles.colorItem}>
                                    <span
                                        className={styles.colorDot}
                                        data-color="warning"
                                    />
                                    <div className={styles.colorInfo}>
                                        <span className={styles.colorName}>
                                            {t(
                                                "help.colors.items.warning.name",
                                            )}
                                        </span>
                                        <span className={styles.colorDesc}>
                                            {t(
                                                "help.colors.items.warning.desc",
                                            )}
                                        </span>
                                    </div>
                                </div>
                                <div className={styles.colorItem}>
                                    <span
                                        className={styles.colorDot}
                                        data-color="processing"
                                    />
                                    <div className={styles.colorInfo}>
                                        <span className={styles.colorName}>
                                            {t(
                                                "help.colors.items.processing.name",
                                            )}
                                        </span>
                                        <span className={styles.colorDesc}>
                                            {t(
                                                "help.colors.items.processing.desc",
                                            )}
                                        </span>
                                    </div>
                                </div>
                                <div className={styles.colorItem}>
                                    <span
                                        className={styles.colorDot}
                                        data-color="attention"
                                    />
                                    <div className={styles.colorInfo}>
                                        <span className={styles.colorName}>
                                            {t(
                                                "help.colors.items.attention.name",
                                            )}
                                        </span>
                                        <span className={styles.colorDesc}>
                                            {t(
                                                "help.colors.items.attention.desc",
                                            )}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </>
                );

            case "shortcuts":
                return (
                    <>
                        <h2 className={styles.sectionTitle}>
                            {icons.keyboard}
                            {t("help.shortcuts.title")}
                        </h2>
                        <div className={styles.sectionContent}>
                            <div className={styles.shortcutList}>
                                <div className={styles.shortcutItem}>
                                    <span className={styles.shortcutAction}>
                                        {t(
                                            "help.shortcuts.actions.emergencyStop",
                                        )}
                                    </span>
                                    <div className={styles.shortcutKey}>
                                        <span className={styles.key}>ESC</span>
                                    </div>
                                </div>
                                <div className={styles.shortcutItem}>
                                    <span className={styles.shortcutAction}>
                                        {t(
                                            "help.shortcuts.actions.acknowledgeAlarms",
                                        )}
                                    </span>
                                    <div className={styles.shortcutKey}>
                                        <span className={styles.key}>Ctrl</span>
                                        <span className={styles.key}>A</span>
                                    </div>
                                </div>
                                <div className={styles.shortcutItem}>
                                    <span className={styles.shortcutAction}>
                                        {t(
                                            "help.shortcuts.actions.startProcess",
                                        )}
                                    </span>
                                    <div className={styles.shortcutKey}>
                                        <span className={styles.key}>F5</span>
                                    </div>
                                </div>
                                <div className={styles.shortcutItem}>
                                    <span className={styles.shortcutAction}>
                                        {t(
                                            "help.shortcuts.actions.stopProcess",
                                        )}
                                    </span>
                                    <div className={styles.shortcutKey}>
                                        <span className={styles.key}>F6</span>
                                    </div>
                                </div>
                                <div className={styles.shortcutItem}>
                                    <span className={styles.shortcutAction}>
                                        {t(
                                            "help.shortcuts.actions.navigateViews",
                                        )}
                                    </span>
                                    <div className={styles.shortcutKey}>
                                        <span className={styles.key}>F1</span>
                                        <span className={styles.key}>-</span>
                                        <span className={styles.key}>F8</span>
                                    </div>
                                </div>
                                <div className={styles.shortcutItem}>
                                    <span className={styles.shortcutAction}>
                                        {t(
                                            "help.shortcuts.actions.toggleFullscreen",
                                        )}
                                    </span>
                                    <div className={styles.shortcutKey}>
                                        <span className={styles.key}>F11</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </>
                );

            case "semi":
                return (
                    <>
                        <h2 className={styles.sectionTitle}>
                            {icons.standard}
                            {t("help.semi.title")}
                        </h2>
                        <div className={styles.sectionContent}>
                            <p
                                style={{
                                    color: "var(--text-secondary)",
                                    fontSize: "13px",
                                    marginBottom: "16px",
                                }}
                            >
                                {t("help.semi.description")}
                            </p>
                            <div className={styles.specList}>
                                <div className={styles.specCard}>
                                    <h4 className={styles.specTitle}>
                                        {t("help.semi.cards.layout.title")}
                                    </h4>
                                    <p className={styles.specValue}>
                                        {t("help.semi.cards.layout.value")}
                                    </p>
                                </div>
                                <div className={styles.specCard}>
                                    <h4 className={styles.specTitle}>
                                        {t("help.semi.cards.buttonSize.title")}
                                    </h4>
                                    <p className={styles.specValue}>
                                        {t("help.semi.cards.buttonSize.value")}
                                    </p>
                                </div>
                                <div className={styles.specCard}>
                                    <h4 className={styles.specTitle}>
                                        {t("help.semi.cards.fontSize.title")}
                                    </h4>
                                    <p className={styles.specValue}>
                                        {t("help.semi.cards.fontSize.value")}
                                    </p>
                                </div>
                                <div className={styles.specCard}>
                                    <h4 className={styles.specTitle}>
                                        {t("help.semi.cards.colorCoding.title")}
                                    </h4>
                                    <p className={styles.specValue}>
                                        {t("help.semi.cards.colorCoding.value")}
                                    </p>
                                </div>
                                <div className={styles.specCard}>
                                    <h4 className={styles.specTitle}>
                                        {t(
                                            "help.semi.cards.alarmManagement.title",
                                        )}
                                    </h4>
                                    <p className={styles.specValue}>
                                        {t(
                                            "help.semi.cards.alarmManagement.value",
                                        )}
                                    </p>
                                </div>
                                <div className={styles.specCard}>
                                    <h4 className={styles.specTitle}>
                                        {t("help.semi.cards.userLevels.title")}
                                    </h4>
                                    <p className={styles.specValue}>
                                        {t("help.semi.cards.userLevels.value")}
                                    </p>
                                </div>
                            </div>
                        </div>
                    </>
                );

            case "faq":
                return (
                    <>
                        <h2 className={styles.sectionTitle}>
                            {icons.question}
                            {t("help.faq.title")}
                        </h2>
                        <div className={styles.sectionContent}>
                            <div className={styles.faqList}>
                                <div className={styles.faqItem}>
                                    <h4 className={styles.faqQuestion}>
                                        {t("help.faq.items.connect.question")}
                                    </h4>
                                    <p className={styles.faqAnswer}>
                                        {t("help.faq.items.connect.answer")}
                                    </p>
                                </div>
                                <div className={styles.faqItem}>
                                    <h4 className={styles.faqQuestion}>
                                        {t("help.faq.items.colors.question")}
                                    </h4>
                                    <p className={styles.faqAnswer}>
                                        {t("help.faq.items.colors.answer")}
                                    </p>
                                </div>
                                <div className={styles.faqItem}>
                                    <h4 className={styles.faqQuestion}>
                                        {t("help.faq.items.recipe.question")}
                                    </h4>
                                    <p className={styles.faqAnswer}>
                                        {t("help.faq.items.recipe.answer")}
                                    </p>
                                </div>
                                <div className={styles.faqItem}>
                                    <h4 className={styles.faqQuestion}>
                                        {t("help.faq.items.language.question")}
                                    </h4>
                                    <p className={styles.faqAnswer}>
                                        {t("help.faq.items.language.answer")}
                                    </p>
                                </div>
                            </div>
                        </div>
                    </>
                );

            case "support":
                return (
                    <>
                        <h2 className={styles.sectionTitle}>
                            {icons.support}
                            {t("help.support.title")}
                        </h2>
                        <div className={styles.sectionContent}>
                            <div className={styles.contactCard}>
                                <div className={styles.contactIcon}>
                                    {icons.support}
                                </div>
                                <h3 className={styles.contactTitle}>
                                    {t("help.support.needHelpTitle")}
                                </h3>
                                <p className={styles.contactText}>
                                    {t("help.support.needHelpDesc")}
                                </p>
                            </div>
                            <div
                                className={styles.infoCard}
                                style={{ marginTop: "16px" }}
                            >
                                <div className={styles.infoRow}>
                                    <span className={styles.infoLabel}>
                                        {t(
                                            "help.support.info.documentationLabel",
                                        )}
                                    </span>
                                    <span className={styles.infoValue}>
                                        {t(
                                            "help.support.info.documentationValue",
                                        )}
                                    </span>
                                </div>
                                <div className={styles.infoRow}>
                                    <span className={styles.infoLabel}>
                                        {t("help.support.info.logFilesLabel")}
                                    </span>
                                    <span className={styles.infoValue}>
                                        /var/log/hmi/
                                    </span>
                                </div>
                                <div className={styles.infoRow}>
                                    <span className={styles.infoLabel}>
                                        {t(
                                            "help.support.info.configFilesLabel",
                                        )}
                                    </span>
                                    <span className={styles.infoValue}>
                                        ~/.config/hmi/
                                    </span>
                                </div>
                            </div>
                        </div>
                    </>
                );

            default:
                return null;
        }
    };

    return (
        <div className={sharedStyles.view}>
            <Tabs
                activeId={activeTab}
                onChange={setActiveTab}
                tabs={helpTabs.map((tab) => ({
                    id: tab.id,
                    label: (
                        <span className={styles.tabLabel}>
                            <span className={styles.tabIcon}>
                                {icons[tab.icon]}
                            </span>
                            {t(tab.labelKey)}
                        </span>
                    ),
                    content: (
                        <div className={styles.mainContent}>
                            {renderSectionContent(tab.id)}
                        </div>
                    ),
                }))}
            />
        </div>
    );
}
