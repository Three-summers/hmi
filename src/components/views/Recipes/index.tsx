import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Tabs } from "@/components/common";
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
    const { t } = useTranslation();
    const [activeTab, setActiveTab] = useState<"overview" | "info">("overview");
    const [selectedRecipe, setSelectedRecipe] = useState<string | null>(
        demoRecipes[0]?.id || null,
    );
    const [recipes] = useState<Recipe[]>(demoRecipes);

    const selectedRecipeData = recipes.find((r) => r.id === selectedRecipe);

    const formatDate = (date: Date) => {
        return date.toLocaleDateString("zh-CN", {
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
        });
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
                                            Recipes ({recipes.length})
                                        </span>
                                    </div>
                                    <div className={styles.listContent}>
                                        {recipes.map((recipe) => (
                                            <div
                                                key={recipe.id}
                                                className={styles.recipeItem}
                                                data-selected={
                                                    selectedRecipe ===
                                                    recipe.id
                                                }
                                                data-status={recipe.status}
                                                onClick={() =>
                                                    setSelectedRecipe(
                                                        recipe.id,
                                                    )
                                                }
                                            >
                                                <div
                                                    className={styles.recipeIcon}
                                                    data-status={recipe.status}
                                                >
                                                    <svg
                                                        viewBox="0 0 24 24"
                                                        fill="currentColor"
                                                    >
                                                        <path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z" />
                                                    </svg>
                                                </div>
                                                <div className={styles.recipeInfo}>
                                                    <span
                                                        className={styles.recipeName}
                                                    >
                                                        {recipe.name}
                                                    </span>
                                                    <span
                                                        className={styles.recipeMeta}
                                                    >
                                                        v{recipe.version} •{" "}
                                                        {recipe.steps.length}{" "}
                                                        steps
                                                    </span>
                                                </div>
                                                <div
                                                    className={
                                                        styles.recipeStatus
                                                    }
                                                    data-status={recipe.status}
                                                >
                                                    {recipe.status.toUpperCase()}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                <div className={styles.recipeDetails}>
                                    {selectedRecipeData ? (
                                        <>
                                            <div
                                                className={
                                                    styles.detailsHeader
                                                }
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
                                                        {selectedRecipeData.name}
                                                    </h3>
                                                    <p
                                                        className={
                                                            styles.detailsDesc
                                                        }
                                                    >
                                                        {selectedRecipeData.description}
                                                    </p>
                                                </div>
                                                <div
                                                    className={styles.headerBadge}
                                                    data-status={
                                                        selectedRecipeData.status
                                                    }
                                                >
                                                    {selectedRecipeData.status.toUpperCase()}
                                                </div>
                                            </div>

                                            <div className={styles.detailsStats}>
                                                <div className={styles.statBox}>
                                                    <span
                                                        className={styles.statLabel}
                                                    >
                                                        Version
                                                    </span>
                                                    <span
                                                        className={styles.statValue}
                                                    >
                                                        {selectedRecipeData.version}
                                                    </span>
                                                </div>
                                                <div className={styles.statBox}>
                                                    <span
                                                        className={styles.statLabel}
                                                    >
                                                        Steps
                                                    </span>
                                                    <span
                                                        className={styles.statValue}
                                                    >
                                                        {selectedRecipeData.steps.length}
                                                    </span>
                                                </div>
                                                <div className={styles.statBox}>
                                                    <span
                                                        className={styles.statLabel}
                                                    >
                                                        Duration
                                                    </span>
                                                    <span
                                                        className={styles.statValue}
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
                                                        className={styles.statLabel}
                                                    >
                                                        Modified
                                                    </span>
                                                    <span
                                                        className={styles.statValue}
                                                    >
                                                        {formatDate(
                                                            selectedRecipeData.lastModified,
                                                        )}
                                                    </span>
                                                </div>
                                            </div>

                                            <div className={styles.stepsSection}>
                                                <h4 className={styles.sectionTitle}>
                                                    Process Steps
                                                </h4>
                                                {selectedRecipeData.steps.length ===
                                                0 ? (
                                                    <div className={styles.noSteps}>
                                                        No steps defined
                                                    </div>
                                                ) : (
                                                    <div className={styles.stepsList}>
                                                        {selectedRecipeData.steps.map(
                                                            (step, index) => (
                                                                <div
                                                                    key={step.id}
                                                                    className={styles.stepCard}
                                                                >
                                                                    <div
                                                                        className={styles.stepNumber}
                                                                    >
                                                                        {index + 1}
                                                                    </div>
                                                                    <div
                                                                        className={styles.stepContent}
                                                                    >
                                                                        <div
                                                                            className={styles.stepHeader}
                                                                        >
                                                                            <span
                                                                                className={styles.stepName}
                                                                            >
                                                                                {step.name}
                                                                            </span>
                                                                            <span
                                                                                className={styles.stepDuration}
                                                                            >
                                                                                {formatDuration(
                                                                                    step.duration,
                                                                                )}
                                                                            </span>
                                                                        </div>
                                                                        <div
                                                                            className={styles.stepParams}
                                                                        >
                                                                            {Object.entries(
                                                                                step.parameters,
                                                                            ).map(
                                                                                ([key, value]) => (
                                                                                    <span
                                                                                        key={key}
                                                                                        className={styles.param}
                                                                                    >
                                                                                        {key}:{" "}
                                                                                        <strong>
                                                                                            {value}
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
                                                Select a recipe to view details
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
