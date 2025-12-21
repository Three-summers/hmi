import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Tabs } from "@/components/common";
import type { CommandButtonConfig } from "@/types";
import { useIsViewActive } from "@/components/layout/ViewContext";
import {
    useRegisterViewCommands,
    useViewCommandActions,
} from "@/components/layout/ViewCommandContext";
import { useNotify } from "@/hooks";
import styles from "./Recipes.module.css";
import sharedStyles from "../shared.module.css";

interface RecipeStep {
    id: string;
    name: string;
    duration: number;
    parameters: Record<string, string | number>;
}

interface Recipe {
    id: string;
    name: string;
    version: string;
    author: string;
    lastModified: Date;
    status: "active" | "draft" | "archived";
    steps: RecipeStep[];
    description: string;
}

const demoRecipes: Recipe[] = [
    {
        id: "1",
        name: "ETCH-STD-01",
        version: "2.3",
        author: "Engineer",
        lastModified: new Date(Date.now() - 86400000),
        status: "active",
        description: "Standard silicon etch process",
        steps: [
            {
                id: "s1",
                name: "Pump Down",
                duration: 60,
                parameters: { pressure: "1e-5 Torr" },
            },
            {
                id: "s2",
                name: "Gas Stabilize",
                duration: 30,
                parameters: { CF4: "50 sccm", O2: "10 sccm" },
            },
            {
                id: "s3",
                name: "Etch",
                duration: 120,
                parameters: { power: "500 W", pressure: "10 mTorr" },
            },
            {
                id: "s4",
                name: "Purge",
                duration: 45,
                parameters: { N2: "100 sccm" },
            },
        ],
    },
    {
        id: "2",
        name: "DEP-OXIDE-02",
        version: "1.5",
        author: "Admin",
        lastModified: new Date(Date.now() - 172800000),
        status: "active",
        description: "PECVD oxide deposition",
        steps: [
            {
                id: "s1",
                name: "Preheat",
                duration: 90,
                parameters: { temp: "300°C" },
            },
            {
                id: "s2",
                name: "Deposit",
                duration: 180,
                parameters: { SiH4: "100 sccm", N2O: "500 sccm" },
            },
            {
                id: "s3",
                name: "Cool Down",
                duration: 60,
                parameters: { N2: "200 sccm" },
            },
        ],
    },
    {
        id: "3",
        name: "CLEAN-PRE-01",
        version: "3.0",
        author: "Engineer",
        lastModified: new Date(Date.now() - 604800000),
        status: "active",
        description: "Pre-process cleaning recipe",
        steps: [
            {
                id: "s1",
                name: "O2 Clean",
                duration: 60,
                parameters: { O2: "200 sccm", power: "300 W" },
            },
        ],
    },
    {
        id: "4",
        name: "ETCH-DEEP-03",
        version: "0.9",
        author: "Engineer",
        lastModified: new Date(),
        status: "draft",
        description: "Deep silicon etch (experimental)",
        steps: [],
    },
];

export default function RecipesView() {
    const { t, i18n } = useTranslation();
    const isViewActive = useIsViewActive();
    const { showConfirm } = useViewCommandActions();
    const { success, warning, info } = useNotify();

    const commands = useMemo<CommandButtonConfig[]>(
        () => [
            {
                id: "newRecipe",
                labelKey: "recipes.newRecipe",
                onClick: () =>
                    info(
                        t("notification.newRecipe"),
                        t("notification.creatingRecipe"),
                    ),
            },
            {
                id: "loadRecipe",
                labelKey: "recipes.loadRecipe",
                highlight: "processing",
                onClick: () =>
                    success(
                        t("notification.recipeLoaded"),
                        t("notification.recipeReadyForExecution"),
                    ),
            },
            {
                id: "editRecipe",
                labelKey: "recipes.editRecipe",
                onClick: () =>
                    info(
                        t("notification.editMode"),
                        t("notification.recipeEditorOpened"),
                    ),
            },
            {
                id: "deleteRecipe",
                labelKey: "recipes.deleteRecipe",
                highlight: "warning",
                onClick: () =>
                    showConfirm(
                        t("recipes.deleteRecipe"),
                        t("recipes.deleteConfirm"),
                        () =>
                            warning(
                                t("notification.recipeDeleted"),
                                t("notification.recipeRemoved"),
                            ),
                    ),
            },
        ],
        [info, showConfirm, success, t, warning],
    );

    useRegisterViewCommands("recipes", commands, isViewActive);

    const [activeTab, setActiveTab] = useState<"overview" | "info">("overview");
    const [selectedRecipe, setSelectedRecipe] = useState<string | null>(
        demoRecipes[0]?.id || null,
    );
    const [recipes] = useState<Recipe[]>(demoRecipes);

    const selectedRecipeData = recipes.find((r) => r.id === selectedRecipe);

    const formatDate = (date: Date) => {
        return date.toLocaleDateString(
            i18n.language === "zh" ? "zh-CN" : "en-US",
            {
                year: "numeric",
                month: "2-digit",
                day: "2-digit",
            },
        );
    };

    const formatDuration = (seconds: number) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
    };

    const getTotalDuration = (steps: RecipeStep[]) => {
        return steps.reduce((sum, step) => sum + step.duration, 0);
    };

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
                            <div className={styles.recipesLayout}>
                                <div className={styles.recipeList}>
                                    <div className={styles.listHeader}>
                                        <span className={styles.listTitle}>
                                            {t("recipes.listTitle", {
                                                count: recipes.length,
                                            })}
                                        </span>
                                    </div>
                                    <div className={styles.listContent}>
                                        {recipes.map((recipe) => (
                                            <div
                                                key={recipe.id}
                                                className={styles.recipeItem}
                                                data-selected={
                                                    selectedRecipe === recipe.id
                                                }
                                                data-status={recipe.status}
                                                onClick={() =>
                                                    setSelectedRecipe(recipe.id)
                                                }
                                            >
                                                <div
                                                    className={
                                                        styles.recipeIcon
                                                    }
                                                    data-status={recipe.status}
                                                >
                                                    <svg
                                                        viewBox="0 0 24 24"
                                                        fill="currentColor"
                                                    >
                                                        <path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z" />
                                                    </svg>
                                                </div>
                                                <div
                                                    className={
                                                        styles.recipeInfo
                                                    }
                                                >
                                                    <span
                                                        className={
                                                            styles.recipeName
                                                        }
                                                    >
                                                        {recipe.name}
                                                    </span>
                                                    <span
                                                        className={
                                                            styles.recipeMeta
                                                        }
                                                    >
                                                        {t("recipes.meta", {
                                                            version:
                                                                recipe.version,
                                                            steps: recipe.steps
                                                                .length,
                                                        })}
                                                    </span>
                                                </div>
                                                <div
                                                    className={
                                                        styles.recipeStatus
                                                    }
                                                    data-status={recipe.status}
                                                >
                                                    {t(
                                                        `recipes.status.${recipe.status}`,
                                                    )}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                <div className={styles.recipeDetails}>
                                    {selectedRecipeData ? (
                                        <>
                                            <div
                                                className={styles.detailsHeader}
                                            >
                                                <div
                                                    className={
                                                        styles.headerInfo
                                                    }
                                                >
                                                    <h3
                                                        className={
                                                            styles.detailsTitle
                                                        }
                                                    >
                                                        {
                                                            selectedRecipeData.name
                                                        }
                                                    </h3>
                                                    <p
                                                        className={
                                                            styles.detailsDesc
                                                        }
                                                    >
                                                        {
                                                            selectedRecipeData.description
                                                        }
                                                    </p>
                                                </div>
                                                <div
                                                    className={
                                                        styles.headerBadge
                                                    }
                                                    data-status={
                                                        selectedRecipeData.status
                                                    }
                                                >
                                                    {t(
                                                        `recipes.status.${selectedRecipeData.status}`,
                                                    )}
                                                </div>
                                            </div>

                                            <div
                                                className={styles.detailsStats}
                                            >
                                                <div className={styles.statBox}>
                                                    <span
                                                        className={
                                                            styles.statLabel
                                                        }
                                                    >
                                                        {t(
                                                            "recipes.fields.version",
                                                        )}
                                                    </span>
                                                    <span
                                                        className={
                                                            styles.statValue
                                                        }
                                                    >
                                                        {
                                                            selectedRecipeData.version
                                                        }
                                                    </span>
                                                </div>
                                                <div className={styles.statBox}>
                                                    <span
                                                        className={
                                                            styles.statLabel
                                                        }
                                                    >
                                                        {t(
                                                            "recipes.fields.steps",
                                                        )}
                                                    </span>
                                                    <span
                                                        className={
                                                            styles.statValue
                                                        }
                                                    >
                                                        {
                                                            selectedRecipeData
                                                                .steps.length
                                                        }
                                                    </span>
                                                </div>
                                                <div className={styles.statBox}>
                                                    <span
                                                        className={
                                                            styles.statLabel
                                                        }
                                                    >
                                                        {t(
                                                            "recipes.fields.duration",
                                                        )}
                                                    </span>
                                                    <span
                                                        className={
                                                            styles.statValue
                                                        }
                                                    >
                                                        {formatDuration(
                                                            getTotalDuration(
                                                                selectedRecipeData.steps,
                                                            ),
                                                        )}
                                                    </span>
                                                </div>
                                                <div className={styles.statBox}>
                                                    <span
                                                        className={
                                                            styles.statLabel
                                                        }
                                                    >
                                                        {t(
                                                            "recipes.fields.modified",
                                                        )}
                                                    </span>
                                                    <span
                                                        className={
                                                            styles.statValue
                                                        }
                                                    >
                                                        {formatDate(
                                                            selectedRecipeData.lastModified,
                                                        )}
                                                    </span>
                                                </div>
                                            </div>

                                            <div
                                                className={styles.stepsSection}
                                            >
                                                <h4
                                                    className={
                                                        styles.sectionTitle
                                                    }
                                                >
                                                    {t("recipes.steps.title")}
                                                </h4>
                                                {selectedRecipeData.steps
                                                    .length === 0 ? (
                                                    <div
                                                        className={
                                                            styles.noSteps
                                                        }
                                                    >
                                                        {t(
                                                            "recipes.steps.empty",
                                                        )}
                                                    </div>
                                                ) : (
                                                    <div
                                                        className={
                                                            styles.stepsList
                                                        }
                                                    >
                                                        {selectedRecipeData.steps.map(
                                                            (step, index) => (
                                                                <div
                                                                    key={
                                                                        step.id
                                                                    }
                                                                    className={
                                                                        styles.stepCard
                                                                    }
                                                                >
                                                                    <div
                                                                        className={
                                                                            styles.stepNumber
                                                                        }
                                                                    >
                                                                        {index +
                                                                            1}
                                                                    </div>
                                                                    <div
                                                                        className={
                                                                            styles.stepContent
                                                                        }
                                                                    >
                                                                        <div
                                                                            className={
                                                                                styles.stepHeader
                                                                            }
                                                                        >
                                                                            <span
                                                                                className={
                                                                                    styles.stepName
                                                                                }
                                                                            >
                                                                                {
                                                                                    step.name
                                                                                }
                                                                            </span>
                                                                            <span
                                                                                className={
                                                                                    styles.stepDuration
                                                                                }
                                                                            >
                                                                                {formatDuration(
                                                                                    step.duration,
                                                                                )}
                                                                            </span>
                                                                        </div>
                                                                        <div
                                                                            className={
                                                                                styles.stepParams
                                                                            }
                                                                        >
                                                                            {Object.entries(
                                                                                step.parameters,
                                                                            ).map(
                                                                                ([
                                                                                    key,
                                                                                    value,
                                                                                ]) => (
                                                                                    <span
                                                                                        key={
                                                                                            key
                                                                                        }
                                                                                        className={
                                                                                            styles.param
                                                                                        }
                                                                                    >
                                                                                        {
                                                                                            key
                                                                                        }
                                                                                        :{" "}
                                                                                        <strong>
                                                                                            {
                                                                                                value
                                                                                            }
                                                                                        </strong>
                                                                                    </span>
                                                                                ),
                                                                            )}
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            ),
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        </>
                                    ) : (
                                        <div className={styles.noSelection}>
                                            <svg
                                                viewBox="0 0 24 24"
                                                fill="currentColor"
                                            >
                                                <path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z" />
                                            </svg>
                                            <span>
                                                {t("recipes.selectRecipe")}
                                            </span>
                                        </div>
                                    )}
                                </div>
                            </div>
                        ),
                    },
                    {
                        id: "info",
                        label: t("common.tabs.info"),
                        content: (
                            <div className={styles.recipesInfo}>
                                {t("recipes.title")}
                            </div>
                        ),
                    },
                ]}
            />
        </div>
    );
}
