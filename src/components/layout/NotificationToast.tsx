import { useNotificationStore } from "@/stores";
import styles from "./NotificationToast.module.css";

const icons: Record<string, JSX.Element> = {
    success: (
        <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
        </svg>
    ),
    error: (
        <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" />
        </svg>
    ),
    warning: (
        <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z" />
        </svg>
    ),
    info: (
        <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z" />
        </svg>
    ),
};

export function NotificationToast() {
    const { notifications, removeNotification } = useNotificationStore();

    if (notifications.length === 0) return null;

    return (
        <div className={styles.container}>
            {notifications.map((notification) => (
                <div
                    key={notification.id}
                    className={styles.toast}
                    data-type={notification.type}
                >
                    <div className={styles.icon} data-type={notification.type}>
                        {icons[notification.type]}
                    </div>
                    <div className={styles.content}>
                        <h4 className={styles.title}>{notification.title}</h4>
                        {notification.message && (
                            <p className={styles.message}>
                                {notification.message}
                            </p>
                        )}
                    </div>
                    <button
                        className={styles.closeBtn}
                        onClick={() => removeNotification(notification.id)}
                    >
                        <svg viewBox="0 0 24 24" fill="currentColor">
                            <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
                        </svg>
                    </button>
                </div>
            ))}
        </div>
    );
}
