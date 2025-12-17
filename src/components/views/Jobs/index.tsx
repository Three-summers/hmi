import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Tabs } from "@/components/common";
import styles from "./Jobs.module.css";
import sharedStyles from "../shared.module.css";

interface Job {
    id: string;
    name: string;
    recipe: string;
    status: "idle" | "running" | "completed" | "error" | "paused";
    progress: number;
    startTime?: Date;
    estimatedEnd?: Date;
    waferCount: number;
    completedWafers: number;
}

const demoJobs: Job[] = [
    {
        id: "1",
        name: "LOT-2024-001",
        recipe: "ETCH-STD-01",
        status: "running",
        progress: 67,
        startTime: new Date(Date.now() - 3600000),
        estimatedEnd: new Date(Date.now() + 1800000),
        waferCount: 25,
        completedWafers: 17,
    },
    {
        id: "2",
        name: "LOT-2024-002",
        recipe: "DEP-OXIDE-02",
        status: "idle",
        progress: 0,
        waferCount: 50,
        completedWafers: 0,
    },
    {
        id: "3",
        name: "LOT-2024-003",
        recipe: "CLEAN-PRE-01",
        status: "completed",
        progress: 100,
        waferCount: 25,
        completedWafers: 25,
    },
    {
        id: "4",
        name: "LOT-2024-004",
        recipe: "ETCH-DEEP-03",
        status: "error",
        progress: 34,
        waferCount: 30,
        completedWafers: 10,
    },
    {
        id: "5",
        name: "LOT-2024-005",
        recipe: "DEP-NITRIDE-01",
        status: "paused",
        progress: 50,
        waferCount: 40,
        completedWafers: 20,
    },
];

const StatusIcons: Record<Job["status"], JSX.Element> = {
    idle: (
        <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8z" />
        </svg>
    ),
    running: (
        <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M8 5v14l11-7z" />
        </svg>
    ),
    completed: (
        <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
        </svg>
    ),
    error: (
        <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" />
        </svg>
    ),
    paused: (
        <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
        </svg>
    ),
};

export default function JobsView() {
    const { t } = useTranslation();
    const [activeTab, setActiveTab] = useState<"overview" | "details">(
        "overview",
    );
    const [selectedJob, setSelectedJob] = useState<string | null>(null);
    const [jobs] = useState<Job[]>(demoJobs);
    const selectedJobData = jobs.find((job) => job.id === selectedJob) || null;

    const formatTime = (date?: Date) => {
        if (!date) return "--:--";
        return date.toLocaleTimeString("zh-CN", {
            hour: "2-digit",
            minute: "2-digit",
        });
    };

    const getStatusColor = (status: Job["status"]) => {
        switch (status) {
            case "running":
                return "processing";
            case "error":
                return "alarm";
            case "completed":
                return "attention";
            case "paused":
                return "warning";
            default:
                return "none";
        }
    };

    const runningJobs = jobs.filter((j) => j.status === "running").length;
    const completedJobs = jobs.filter((j) => j.status === "completed").length;
    const errorJobs = jobs.filter((j) => j.status === "error").length;

    return (
        <div className={sharedStyles.view}>
            <Tabs
                activeId={activeTab}
                onChange={setActiveTab}
                tabs={[
                    {
                        id: "overview",
                        label: t("common.tabs.overview"),
                        content: (
                            <>
                                <div className={styles.statsBar}>
                                    <div className={styles.statItem}>
                                        <span className={styles.statValue}>
                                            {jobs.length}
                                        </span>
                                        <span className={styles.statLabel}>
                                            {t("jobs.total")}
                                        </span>
                                    </div>
                                    <div
                                        className={styles.statItem}
                                        data-status="processing"
                                    >
                                        <span className={styles.statValue}>
                                            {runningJobs}
                                        </span>
                                        <span className={styles.statLabel}>
                                            {t("jobs.running")}
                                        </span>
                                    </div>
                                    <div
                                        className={styles.statItem}
                                        data-status="attention"
                                    >
                                        <span className={styles.statValue}>
                                            {completedJobs}
                                        </span>
                                        <span className={styles.statLabel}>
                                            {t("jobs.completed")}
                                        </span>
                                    </div>
                                    <div
                                        className={styles.statItem}
                                        data-status="alarm"
                                    >
                                        <span className={styles.statValue}>
                                            {errorJobs}
                                        </span>
                                        <span className={styles.statLabel}>
                                            {t("jobs.errors")}
                                        </span>
                                    </div>
                                </div>

                                <div className={styles.jobsContent}>
                                    <div className={styles.jobsList}>
                                        {jobs.map((job) => (
                                            <div
                                                key={job.id}
                                                className={styles.jobCard}
                                                data-status={getStatusColor(
                                                    job.status,
                                                )}
                                                data-selected={
                                                    selectedJob === job.id
                                                }
                                                onClick={() =>
                                                    setSelectedJob(job.id)
                                                }
                                            >
                                                <div
                                                    className={styles.jobHeader}
                                                >
                                                    <div
                                                        className={
                                                            styles.jobStatus
                                                        }
                                                        data-status={getStatusColor(
                                                            job.status,
                                                        )}
                                                    >
                                                        {StatusIcons[job.status]}
                                                    </div>
                                                    <div
                                                        className={
                                                            styles.jobTitle
                                                        }
                                                    >
                                                        <span
                                                            className={
                                                                styles.jobName
                                                            }
                                                        >
                                                            {job.name}
                                                        </span>
                                                        <span
                                                            className={
                                                                styles.jobRecipe
                                                            }
                                                        >
                                                            {job.recipe}
                                                        </span>
                                                    </div>
                                                    <div
                                                        className={
                                                            styles.jobProgress
                                                        }
                                                    >
                                                        <span
                                                            className={
                                                                styles.progressValue
                                                            }
                                                        >
                                                            {job.progress}%
                                                        </span>
                                                    </div>
                                                </div>

                                                <div
                                                    className={styles.progressBar}
                                                >
                                                    <div
                                                        className={
                                                            styles.progressFill
                                                        }
                                                        style={{
                                                            width: `${job.progress}%`,
                                                        }}
                                                        data-status={getStatusColor(
                                                            job.status,
                                                        )}
                                                    />
                                                </div>

                                                <div
                                                    className={styles.jobDetails}
                                                >
                                                    <div
                                                        className={
                                                            styles.detailItem
                                                        }
                                                    >
                                                        <span
                                                            className={
                                                                styles.detailLabel
                                                            }
                                                        >
                                                            Wafers
                                                        </span>
                                                        <span
                                                            className={
                                                                styles.detailValue
                                                            }
                                                        >
                                                            {
                                                                job.completedWafers
                                                            }
                                                            /{job.waferCount}
                                                        </span>
                                                    </div>
                                                    <div
                                                        className={
                                                            styles.detailItem
                                                        }
                                                    >
                                                        <span
                                                            className={
                                                                styles.detailLabel
                                                            }
                                                        >
                                                            Start
                                                        </span>
                                                        <span
                                                            className={
                                                                styles.detailValue
                                                            }
                                                        >
                                                            {formatTime(
                                                                job.startTime,
                                                            )}
                                                        </span>
                                                    </div>
                                                    <div
                                                        className={
                                                            styles.detailItem
                                                        }
                                                    >
                                                        <span
                                                            className={
                                                                styles.detailLabel
                                                            }
                                                        >
                                                            ETA
                                                        </span>
                                                        <span
                                                            className={
                                                                styles.detailValue
                                                            }
                                                        >
                                                            {formatTime(
                                                                job.estimatedEnd,
                                                            )}
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </>
                        ),
                    },
                    {
                        id: "details",
                        label: t("common.tabs.details"),
                        content: (
                            <div className={styles.detailsPanel}>
                                {!selectedJobData ? (
                                    <div className={styles.detailsEmpty}>
                                        {t("jobs.selectJob")}
                                    </div>
                                ) : (
                                    <>
                                        <div className={styles.detailsHeader}>
                                            <div className={styles.detailsTitle}>
                                                {selectedJobData.name}
                                            </div>
                                            <div
                                                className={styles.detailsBadge}
                                                data-status={getStatusColor(
                                                    selectedJobData.status,
                                                )}
                                            >
                                                {selectedJobData.status.toUpperCase()}
                                            </div>
                                        </div>

                                        <div className={styles.detailsGrid}>
                                            <div className={styles.detailsRow}>
                                                <span
                                                    className={
                                                        styles.detailsLabel
                                                    }
                                                >
                                                    Recipe
                                                </span>
                                                <span
                                                    className={
                                                        styles.detailsValue
                                                    }
                                                >
                                                    {selectedJobData.recipe}
                                                </span>
                                            </div>
                                            <div className={styles.detailsRow}>
                                                <span
                                                    className={
                                                        styles.detailsLabel
                                                    }
                                                >
                                                    Progress
                                                </span>
                                                <span
                                                    className={
                                                        styles.detailsValue
                                                    }
                                                >
                                                    {selectedJobData.progress}%
                                                </span>
                                            </div>
                                            <div className={styles.detailsRow}>
                                                <span
                                                    className={
                                                        styles.detailsLabel
                                                    }
                                                >
                                                    Wafers
                                                </span>
                                                <span
                                                    className={
                                                        styles.detailsValue
                                                    }
                                                >
                                                    {
                                                        selectedJobData.completedWafers
                                                    }
                                                    /{selectedJobData.waferCount}
                                                </span>
                                            </div>
                                            <div className={styles.detailsRow}>
                                                <span
                                                    className={
                                                        styles.detailsLabel
                                                    }
                                                >
                                                    Start
                                                </span>
                                                <span
                                                    className={
                                                        styles.detailsValue
                                                    }
                                                >
                                                    {formatTime(
                                                        selectedJobData.startTime,
                                                    )}
                                                </span>
                                            </div>
                                            <div className={styles.detailsRow}>
                                                <span
                                                    className={
                                                        styles.detailsLabel
                                                    }
                                                >
                                                    ETA
                                                </span>
                                                <span
                                                    className={
                                                        styles.detailsValue
                                                    }
                                                >
                                                    {formatTime(
                                                        selectedJobData.estimatedEnd,
                                                    )}
                                                </span>
                                            </div>
                                        </div>
                                    </>
                                )}
                            </div>
                        ),
                    },
                ]}
            />
        </div>
    );
}
