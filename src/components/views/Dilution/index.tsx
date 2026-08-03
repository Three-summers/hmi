import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
    AddIcon,
    CheckAllIcon,
    ExportIcon,
    PlayIcon,
    RefreshIcon,
} from "@/components/common";
import type { CommandButtonConfig, HighlightStatus } from "@/types";
import { useIsViewActive } from "@/components/layout/ViewContext";
import { useRegisterViewCommands } from "@/components/layout/ViewCommandContext";
import { useNotify } from "@/hooks";
import {
    dilutionCreateBatch,
    dilutionGetReport,
    dilutionListBatches,
    dilutionRunMockBatch,
    dilutionScanRawResist,
    dilutionSelectConcentration,
    type DilutionBatch,
    type DilutionBatchStatus,
    type DilutionOption,
    type MeteringKind,
    type RawLoadRequest,
} from "@/platform/dilution";
import styles from "./Dilution.module.css";

type StepId =
    | "batch"
    | "scan"
    | "recipe"
    | "raw"
    | "solvent"
    | "mix"
    | "settle"
    | "viscosity"
    | "barcode"
    | "print"
    | "dispense"
    | "report";

type StepKind = "static" | "metering" | "countdown" | "table" | "external";
type StepState = "completed" | "executing" | "pending";

interface StepDefinition {
    id: StepId;
    nameKey: string;
    kind: StepKind;
}

const STEPS: StepDefinition[] = [
    { id: "batch", nameKey: "dilution.steps.batch", kind: "static" },
    { id: "scan", nameKey: "dilution.steps.scan", kind: "table" },
    { id: "recipe", nameKey: "dilution.steps.recipe", kind: "static" },
    { id: "raw", nameKey: "dilution.steps.raw", kind: "metering" },
    { id: "solvent", nameKey: "dilution.steps.solvent", kind: "metering" },
    { id: "mix", nameKey: "dilution.steps.mix", kind: "countdown" },
    { id: "settle", nameKey: "dilution.steps.settle", kind: "countdown" },
    { id: "viscosity", nameKey: "dilution.steps.viscosity", kind: "table" },
    { id: "barcode", nameKey: "dilution.steps.barcode", kind: "external" },
    { id: "print", nameKey: "dilution.steps.print", kind: "table" },
    { id: "dispense", nameKey: "dilution.steps.dispense", kind: "table" },
    { id: "report", nameKey: "dilution.steps.report", kind: "static" },
];

const STEP_INDEX = new Map(STEPS.map((step, index) => [step.id, index]));

const DEFAULT_BATCH = {
    machineId: "MCP-03",
    operatorId: "op-001",
    reviewerIds: ["qa-001"],
    plannedBottleCount: 3,
    targetBottleMassG: 500,
};

const DEFAULT_SCAN = {
    barcode: "RAW-IK02-LOT01-B01",
    operatorId: "op-001",
};

const DEFAULT_RUN = {
    rawLoad: { mode: "mass", targetMassG: 1000 } as const,
    viscosityReadingsCp: [5.2, 5.4],
};

type RawLoadMode = RawLoadRequest["mode"];

function statusToStepId(status?: DilutionBatchStatus): StepId {
    switch (status) {
        case "draft":
        case "scanning_raw_resist":
            return "scan";
        case "mapping_resolved":
        case "recipe_locked":
            return "recipe";
        case "raw_loading":
            return "raw";
        case "solvent_loading":
            return "solvent";
        case "mixing":
            return "mix";
        case "settling":
            return "settle";
        case "viscosity_testing":
        case "viscosity_synced":
            return "viscosity";
        case "barcode_requested":
            return "barcode";
        case "printing":
            return "print";
        case "dispensing":
            return "dispense";
        case "report_pending":
        case "completed":
            return "report";
        case "failed":
        case "suspended":
            return "report";
        default:
            return "batch";
    }
}

function getStepState(stepId: StepId, execId: StepId): StepState {
    const stepIndex = STEP_INDEX.get(stepId) ?? 0;
    const execIndex = STEP_INDEX.get(execId) ?? 0;
    if (stepIndex < execIndex) return "completed";
    if (stepIndex === execIndex) return "executing";
    return "pending";
}

function statusHighlight(status?: DilutionBatchStatus): HighlightStatus {
    if (status === "failed") return "alarm";
    if (status === "suspended") return "warning";
    if (status === "completed") return "attention";
    if (status) return "processing";
    return "none";
}

function formatMass(value?: number) {
    return value === undefined ? "--" : `${value.toFixed(1)} g`;
}

function formatRatio(option?: DilutionOption) {
    if (!option) return "--";
    return `${option.ratio.raw}:${option.ratio.solvent}`;
}

function getMeteringMass(batch: DilutionBatch | null, kind: MeteringKind) {
    return batch?.meteringRecords.find((record) => record.kind === kind)
        ?.actualMassG;
}

function lastItem<T>(items: T[]): T | undefined {
    return items.length > 0 ? items[items.length - 1] : undefined;
}

function getStepSummary(batch: DilutionBatch | null, stepId: StepId) {
    if (!batch) return "--";
    switch (stepId) {
        case "batch":
            return `${batch.machineId} / ${batch.operatorId}`;
        case "scan":
            return lastItem(batch.rawScans)?.barcode ?? "RAW-IK02";
        case "recipe":
            return batch.selectedRecipe
                ? `${batch.selectedRecipe.concentration} / ${batch.selectedRecipe.dilutionResistName}`
                : "waiting";
        case "raw":
            return formatMass(getMeteringMass(batch, "raw"));
        case "solvent":
            return formatMass(getMeteringMass(batch, "solvent"));
        case "mix":
            return batch.selectedRecipe ? "300s" : "--";
        case "settle":
            return batch.selectedRecipe ? "120s" : "--";
        case "viscosity":
            return batch.viscosity?.averageCp
                ? `${batch.viscosity.averageCp.toFixed(1)} cP`
                : "--";
        case "barcode":
            return `${batch.prmsSync.length} PRMS`;
        case "print":
            return `${batch.outputBottles.filter((b) => b.printStatus === "printed").length}/${batch.plannedBottleCount}`;
        case "dispense":
            return `${batch.outputBottles.length}/${batch.plannedBottleCount}`;
        case "report":
            return batch.report?.reportId ?? "report";
    }
}

function selectedStepOrFallback(stepId: StepId) {
    return STEPS.find((step) => step.id === stepId) ?? STEPS[0];
}

export default function DilutionView() {
    const { t } = useTranslation();
    const isViewActive = useIsViewActive();
    const { success, error, info } = useNotify();
    const [batch, setBatch] = useState<DilutionBatch | null>(null);
    const [scanBarcode, setScanBarcode] = useState(DEFAULT_SCAN.barcode);
    const [selectedConcentration, setSelectedConcentration] = useState("70%");
    const [rawLoadMode, setRawLoadMode] = useState<RawLoadMode>("mass");
    const [targetRawMassG, setTargetRawMassG] = useState<number>(
        DEFAULT_RUN.rawLoad.targetMassG,
    );
    const [rawBottleCount, setRawBottleCount] = useState(2);
    const [viscosityA, setViscosityA] = useState(DEFAULT_RUN.viscosityReadingsCp[0]);
    const [viscosityB, setViscosityB] = useState(DEFAULT_RUN.viscosityReadingsCp[1]);
    const [browseId, setBrowseId] = useState<StepId | null>(null);
    const [browseCountdown, setBrowseCountdown] = useState(10);
    const [busy, setBusy] = useState(false);

    const execId = statusToStepId(batch?.status);
    const viewStepId = browseId ?? execId;
    const viewStep = selectedStepOrFallback(viewStepId);

    useEffect(() => {
        setBrowseId(null);
        setBrowseCountdown(10);
    }, [execId]);

    useEffect(() => {
        if (!browseId) return;
        setBrowseCountdown(10);
        const timer = window.setInterval(() => {
            setBrowseCountdown((value) => {
                if (value <= 1) {
                    window.clearInterval(timer);
                    setBrowseId(null);
                    return 10;
                }
                return value - 1;
            });
        }, 1000);

        return () => window.clearInterval(timer);
    }, [browseId]);

    const runAction = useCallback(
        async (action: () => Promise<DilutionBatch>, successTitle: string) => {
            setBusy(true);
            try {
                const nextBatch = await action();
                setBatch(nextBatch);
                success(successTitle, nextBatch.id);
            } catch (err) {
                const message =
                    err instanceof Error ? err.message : String(err);
                error(t("dilution.notifications.operationFailed"), message);
            } finally {
                setBusy(false);
            }
        },
        [success, error, t],
    );

    const handleCreateBatch = useCallback(
        () =>
            runAction(
                () => dilutionCreateBatch(DEFAULT_BATCH),
                t("dilution.notifications.batchCreated"),
            ),
        [runAction, t],
    );

    const handleLoadLatestBatch = useCallback(
        () =>
            runAction(async () => {
                const batches = await dilutionListBatches();
                const latest = batches[batches.length - 1];
                if (!latest)
                    throw new Error(t("dilution.notifications.noBatch"));
                return latest;
            }, t("dilution.notifications.batchLoaded")),
        [runAction, t],
    );

    const handleScan = useCallback(() => {
        if (!batch) return;
        void runAction(
            () =>
                dilutionScanRawResist({
                    batchId: batch.id,
                    barcode: scanBarcode,
                    operatorId: DEFAULT_SCAN.operatorId,
                }),
            t("dilution.notifications.rawScanned"),
        );
    }, [batch, runAction, scanBarcode, t]);

    const handleSelectConcentration = useCallback(() => {
        if (!batch) return;
        void runAction(
            () =>
                dilutionSelectConcentration({
                    batchId: batch.id,
                    concentration: selectedConcentration,
                }),
            t("dilution.notifications.recipeLocked"),
        );
    }, [batch, runAction, selectedConcentration, t]);

    const handleRunMock = useCallback(() => {
        if (!batch) return;
        const rawLoad: RawLoadRequest =
            rawLoadMode === "mass"
                ? { mode: "mass", targetMassG: targetRawMassG }
                : { mode: "bottle_count", bottleCount: rawBottleCount };
        void runAction(
            () =>
                dilutionRunMockBatch({
                    batchId: batch.id,
                    rawLoad,
                    viscosityReadingsCp: [viscosityA, viscosityB],
                }),
            t("dilution.notifications.mockCompleted"),
        );
    }, [
        batch,
        rawBottleCount,
        rawLoadMode,
        runAction,
        t,
        targetRawMassG,
        viscosityA,
        viscosityB,
    ]);

    const handleExportReport = useCallback(async () => {
        if (!batch?.report) return;
        try {
            const report = await dilutionGetReport(batch.id);
            info(t("dilution.notifications.reportReady"), report.reportId);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            error(t("dilution.notifications.operationFailed"), message);
        }
    }, [batch, error, info, t]);

    const commandList = useMemo<CommandButtonConfig[]>(
        () => [
            {
                id: "createBatch",
                labelKey: "dilution.commands.createBatch",
                icon: <AddIcon />,
                disabled: busy,
                requiresLogin: true,
                onClick: handleCreateBatch,
            },
            {
                id: "loadLatestBatch",
                labelKey: "dilution.commands.loadLatestBatch",
                icon: <RefreshIcon />,
                disabled: busy,
                onClick: handleLoadLatestBatch,
            },
            {
                id: "scanRaw",
                labelKey: "dilution.commands.scanRaw",
                icon: <RefreshIcon />,
                disabled: busy || !batch,
                requiresLogin: true,
                highlight: batch && batch.rawScans.length === 0 ? "processing" : "none",
                onClick: handleScan,
            },
            {
                id: "selectConcentration",
                labelKey: "dilution.commands.selectConcentration",
                icon: <CheckAllIcon />,
                disabled:
                    busy ||
                    !batch?.prmsMapping ||
                    batch.prmsMapping.dilutionOptions.length < 2 ||
                    Boolean(batch.selectedRecipe),
                requiresLogin: true,
                highlight:
                    batch?.prmsMapping &&
                    batch.prmsMapping.dilutionOptions.length > 1 &&
                    !batch.selectedRecipe
                        ? "warning"
                        : "none",
                onClick: handleSelectConcentration,
            },
            {
                id: "runMock",
                labelKey: "dilution.commands.runMock",
                icon: <PlayIcon />,
                disabled: busy || !batch?.selectedRecipe,
                requiresLogin: true,
                highlight: batch?.selectedRecipe && batch.status !== "completed"
                    ? "processing"
                    : "none",
                onClick: handleRunMock,
            },
            {
                id: "export",
                labelKey: "dilution.commands.exportReport",
                icon: <ExportIcon />,
                disabled: !batch?.report,
                onClick: handleExportReport,
            },
        ],
        [
            batch,
            busy,
            handleCreateBatch,
            handleLoadLatestBatch,
            handleRunMock,
            handleScan,
            handleSelectConcentration,
            handleExportReport,
            info,
            t,
        ],
    );

    useRegisterViewCommands("run", commandList, isViewActive);

    const stepStatus = getStepState(viewStepId, execId);
    const statusLabel =
        batch?.status === "completed"
            ? t("dilution.stepState.completed")
            : t(`dilution.stepState.${stepStatus}`);

    return (
        <div className={styles.view}>
            <aside className={styles.leftPanel}>
                <section className={styles.batchSummary}>
                    <div className={styles.panelTitle}>
                        {t("dilution.batchSummary")}
                    </div>
                    <dl className={styles.summaryGrid}>
                        <div>
                            <dt>{t("dilution.fields.batchId")}</dt>
                            <dd>{batch?.id ?? "--"}</dd>
                        </div>
                        <div>
                            <dt>{t("dilution.fields.machine")}</dt>
                            <dd>{batch?.machineId ?? DEFAULT_BATCH.machineId}</dd>
                        </div>
                        <div>
                            <dt>{t("dilution.fields.operator")}</dt>
                            <dd>{batch?.operatorId ?? DEFAULT_BATCH.operatorId}</dd>
                        </div>
                        <div>
                            <dt>{t("dilution.fields.runtime")}</dt>
                            <dd>{batch?.completedAtMs ? "00:00:01" : "00:00:00"}</dd>
                        </div>
                    </dl>
                </section>

                <section className={styles.stepListSection}>
                    <div className={styles.panelTitle}>{t("dilution.stepsTitle")}</div>
                    <div className={styles.stepList}>
                        {STEPS.map((step, index) => {
                            const state = getStepState(step.id, execId);
                            const isExecuting = step.id === execId;
                            const isBrowsing = step.id === browseId;
                            return (
                                <button
                                    key={step.id}
                                    type="button"
                                    className={styles.stepItem}
                                    data-state={state}
                                    data-executing={isExecuting}
                                    data-browsing={isBrowsing}
                                    onClick={() =>
                                        setBrowseId(isExecuting ? null : step.id)
                                    }
                                >
                                    <span className={styles.stepMark}>
                                        {state === "completed" ? "✓" : index + 1}
                                    </span>
                                    <span className={styles.stepText}>
                                        <span className={styles.stepName}>
                                            {t(step.nameKey)}
                                        </span>
                                        <span className={styles.stepSummary}>
                                            {getStepSummary(batch, step.id)}
                                        </span>
                                    </span>
                                    {isExecuting && (
                                        <span className={styles.execTag}>
                                            {t("dilution.badges.exec")}
                                        </span>
                                    )}
                                    {isBrowsing && (
                                        <span className={styles.browseTag}>
                                            {t("dilution.badges.browse")}
                                        </span>
                                    )}
                                </button>
                            );
                        })}
                    </div>
                </section>

                <div className={styles.browseTimer} data-visible={Boolean(browseId)}>
                    {browseId
                        ? t("dilution.browseTimer", { seconds: browseCountdown })
                        : t("dilution.autoFollow")}
                </div>
            </aside>

            <main className={styles.rightPanel}>
                <header className={styles.stepStatusBar}>
                    <div>
                        <div className={styles.stepEyebrow}>
                            {browseId
                                ? t("dilution.badges.manualBrowse")
                                : t("dilution.badges.autoFollow")}
                        </div>
                        <h2 className={styles.currentStepTitle}>
                            {t(viewStep.nameKey)}
                        </h2>
                    </div>
                    <div
                        className={styles.statusPill}
                        data-highlight={statusHighlight(batch?.status)}
                    >
                        {statusLabel}
                    </div>
                    <div className={styles.elapsed}>
                        {t("dilution.elapsed")} ·{" "}
                        {batch?.completedAtMs ? "00:00:01" : "00:00:00"}
                    </div>
                </header>

                <SignalBar batch={batch} />

                <section className={styles.stepContent} data-kind={viewStep.kind}>
                    <StepContent
                        batch={batch}
                        step={viewStep}
                        scanBarcode={scanBarcode}
                        setScanBarcode={setScanBarcode}
                        selectedConcentration={selectedConcentration}
                        setSelectedConcentration={setSelectedConcentration}
                        rawLoadMode={rawLoadMode}
                        setRawLoadMode={setRawLoadMode}
                        targetRawMassG={targetRawMassG}
                        setTargetRawMassG={setTargetRawMassG}
                        rawBottleCount={rawBottleCount}
                        setRawBottleCount={setRawBottleCount}
                        viscosityA={viscosityA}
                        setViscosityA={setViscosityA}
                        viscosityB={viscosityB}
                        setViscosityB={setViscosityB}
                    />
                </section>
            </main>
        </div>
    );
}

function SignalBar({ batch }: { batch: DilutionBatch | null }) {
    const { t } = useTranslation();
    const signals = [
        {
            label: t("dilution.signals.prms"),
            value: batch ? (lastItem(batch.prmsSync)?.status ?? "idle") : "idle",
            state: batch?.prmsSync.length ? "attention" : "idle",
        },
        {
            label: t("dilution.signals.meter"),
            value: batch
                ? (lastItem(batch.meteringRecords)?.sourceDeviceId ?? "idle")
                : "idle",
            state: batch?.meteringRecords.length ? "processing" : "idle",
        },
        {
            label: t("dilution.signals.viscometer"),
            value: batch?.viscosity?.prmsResult ?? "idle",
            state: batch?.viscosity ? "attention" : "idle",
        },
        {
            label: t("dilution.signals.printer"),
            value: batch?.outputBottles.some((bottle) => bottle.printStatus === "printed")
                ? "printed"
                : "idle",
            state: batch?.outputBottles.length ? "attention" : "idle",
        },
        {
            label: "EMO",
            value: "normal",
            state: "attention",
        },
    ] as const;

    return (
        <div className={styles.signalBar}>
            {signals.map((signal) => (
                <span
                    key={signal.label}
                    className={styles.signalChip}
                    data-state={signal.state}
                >
                    <span className={styles.signalDot} />
                    <span>{signal.label}</span>
                    <strong>{signal.value}</strong>
                </span>
            ))}
        </div>
    );
}

function StepContent({
    batch,
    step,
    scanBarcode,
    setScanBarcode,
    selectedConcentration,
    setSelectedConcentration,
    rawLoadMode,
    setRawLoadMode,
    targetRawMassG,
    setTargetRawMassG,
    rawBottleCount,
    setRawBottleCount,
    viscosityA,
    setViscosityA,
    viscosityB,
    setViscosityB,
}: {
    batch: DilutionBatch | null;
    step: StepDefinition;
    scanBarcode: string;
    setScanBarcode: (value: string) => void;
    selectedConcentration: string;
    setSelectedConcentration: (value: string) => void;
    rawLoadMode: RawLoadMode;
    setRawLoadMode: (value: RawLoadMode) => void;
    targetRawMassG: number;
    setTargetRawMassG: (value: number) => void;
    rawBottleCount: number;
    setRawBottleCount: (value: number) => void;
    viscosityA: number;
    setViscosityA: (value: number) => void;
    viscosityB: number;
    setViscosityB: (value: number) => void;
}) {
    switch (step.id) {
        case "scan":
            return (
                <ScanContent
                    batch={batch}
                    scanBarcode={scanBarcode}
                    setScanBarcode={setScanBarcode}
                />
            );
        case "recipe":
            return (
                <RecipeContent
                    batch={batch}
                    selectedConcentration={selectedConcentration}
                    setSelectedConcentration={setSelectedConcentration}
                />
            );
        case "raw":
        case "solvent":
            return <MeteringContent batch={batch} kind={step.id} />;
        case "mix":
        case "settle":
            return <CountdownContent batch={batch} stepId={step.id} />;
        case "viscosity":
            return <ViscosityContent batch={batch} />;
        case "barcode":
            return <BarcodeContent batch={batch} />;
        case "print":
        case "dispense":
            return <BottleContent batch={batch} />;
        case "report":
            return <ReportContent batch={batch} />;
        case "batch":
        default:
            return (
                <BatchContent
                    batch={batch}
                    rawLoadMode={rawLoadMode}
                    setRawLoadMode={setRawLoadMode}
                    targetRawMassG={targetRawMassG}
                    setTargetRawMassG={setTargetRawMassG}
                    rawBottleCount={rawBottleCount}
                    setRawBottleCount={setRawBottleCount}
                    viscosityA={viscosityA}
                    setViscosityA={setViscosityA}
                    viscosityB={viscosityB}
                    setViscosityB={setViscosityB}
                />
            );
    }
}

function BatchContent({
    batch,
    rawLoadMode,
    setRawLoadMode,
    targetRawMassG,
    setTargetRawMassG,
    rawBottleCount,
    setRawBottleCount,
    viscosityA,
    setViscosityA,
    viscosityB,
    setViscosityB,
}: {
    batch: DilutionBatch | null;
    rawLoadMode: RawLoadMode;
    setRawLoadMode: (value: RawLoadMode) => void;
    targetRawMassG: number;
    setTargetRawMassG: (value: number) => void;
    rawBottleCount: number;
    setRawBottleCount: (value: number) => void;
    viscosityA: number;
    setViscosityA: (value: number) => void;
    viscosityB: number;
    setViscosityB: (value: number) => void;
}) {
    const { t } = useTranslation();
    return (
        <div className={styles.staticGrid}>
            <MetricCard label={t("dilution.fields.machine")} value={batch?.machineId ?? "MCP-03"} />
            <MetricCard
                label={t("dilution.fields.operator")}
                value={batch?.operatorId ?? "op-001"}
            />
            <MetricCard
                label={t("dilution.fields.plannedBottles")}
                value={`${batch?.plannedBottleCount ?? 3}`}
            />
            <MetricCard
                label={t("dilution.fields.targetMass")}
                value={`${(batch?.targetBottleMassG ?? 500).toFixed(1)} g`}
            />
            <InfoPanel
                title={t("dilution.panels.defaultBatch")}
                rows={[
                    ["machineId", "MCP-03"],
                    ["operatorId", "op-001"],
                    ["reviewer", "qa-001"],
                    ["target", "3 x 500.0 g"],
                ]}
            />
            <InfoPanel
                title={t("dilution.panels.mockInputs")}
                rows={[
                    ["barcode", "RAW-IK02-LOT01-B01"],
                    [
                        "rawLoad",
                        rawLoadMode === "mass"
                            ? `${targetRawMassG.toFixed(1)} g`
                            : `${rawBottleCount} bottle(s)`,
                    ],
                    ["viscosity", `${viscosityA.toFixed(1)} cP / ${viscosityB.toFixed(1)} cP`],
                    ["solvent", "PGMEA"],
                ]}
            />
            <div className={styles.formPanel}>
                <div className={styles.panelHeading}>
                    {t("dilution.panels.runParameters")}
                </div>
                <div className={styles.compactForm}>
                    <label className={styles.inputLabel}>
                        <span>{t("dilution.fields.rawLoadMode")}</span>
                        <select
                            value={rawLoadMode}
                            onChange={(event) =>
                                setRawLoadMode(event.target.value as RawLoadMode)
                            }
                            className={styles.select}
                        >
                            <option value="mass">
                                {t("dilution.rawLoadModes.mass")}
                            </option>
                            <option value="bottle_count">
                                {t("dilution.rawLoadModes.bottleCount")}
                            </option>
                        </select>
                    </label>
                    {rawLoadMode === "mass" ? (
                        <label className={styles.inputLabel}>
                            <span>{t("dilution.fields.rawMass")}</span>
                            <input
                                type="number"
                                min="0"
                                step="0.1"
                                value={targetRawMassG}
                                onChange={(event) =>
                                    setTargetRawMassG(Number(event.target.value))
                                }
                                className={styles.input}
                            />
                        </label>
                    ) : (
                        <label className={styles.inputLabel}>
                            <span>{t("dilution.fields.rawBottleCount")}</span>
                            <input
                                type="number"
                                min="1"
                                step="1"
                                value={rawBottleCount}
                                onChange={(event) =>
                                    setRawBottleCount(Number(event.target.value))
                                }
                                className={styles.input}
                            />
                        </label>
                    )}
                    <div className={styles.inlineInputs}>
                        <label className={styles.inputLabel}>
                            <span>{t("dilution.fields.viscosityA")}</span>
                            <input
                                type="number"
                                min="0"
                                step="0.1"
                                value={viscosityA}
                                onChange={(event) =>
                                    setViscosityA(Number(event.target.value))
                                }
                                className={styles.input}
                            />
                        </label>
                        <label className={styles.inputLabel}>
                            <span>{t("dilution.fields.viscosityB")}</span>
                            <input
                                type="number"
                                min="0"
                                step="0.1"
                                value={viscosityB}
                                onChange={(event) =>
                                    setViscosityB(Number(event.target.value))
                                }
                                className={styles.input}
                            />
                        </label>
                    </div>
                </div>
            </div>
        </div>
    );
}

function ScanContent({
    batch,
    scanBarcode,
    setScanBarcode,
}: {
    batch: DilutionBatch | null;
    scanBarcode: string;
    setScanBarcode: (value: string) => void;
}) {
    const { t } = useTranslation();
    return (
        <div className={styles.tableLayout}>
            <div className={styles.metricRow}>
                <MetricCard
                    label={t("dilution.metrics.scanned")}
                    value={`${batch?.rawScans.length ?? 0}`}
                />
                <MetricCard
                    label={t("dilution.metrics.rawResist")}
                    value={batch?.prmsMapping?.rawResistName ?? "--"}
                />
                <MetricCard
                    label={t("dilution.metrics.mapping")}
                    value={batch?.prmsMapping?.mappingId ?? "--"}
                />
            </div>
            <label className={styles.inputLabel}>
                <span>{t("dilution.fields.mockBarcode")}</span>
                <input
                    value={scanBarcode}
                    onChange={(event) => setScanBarcode(event.target.value)}
                    className={styles.input}
                />
            </label>
            <div className={styles.dataTable}>
                <div className={styles.tableHeader}>
                    <span>{t("dilution.fields.barcode")}</span>
                    <span>{t("dilution.fields.material")}</span>
                    <span>{t("dilution.fields.result")}</span>
                </div>
                {(batch?.rawScans ?? []).map((scan) => (
                    <div key={scan.scanId} className={styles.tableRow}>
                        <span>{scan.barcode}</span>
                        <span>{scan.materialName ?? "--"}</span>
                        <span>{scan.validationStatus}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}

function RecipeContent({
    batch,
    selectedConcentration,
    setSelectedConcentration,
}: {
    batch: DilutionBatch | null;
    selectedConcentration: string;
    setSelectedConcentration: (value: string) => void;
}) {
    const { t } = useTranslation();
    const options = batch?.prmsMapping?.dilutionOptions ?? [];
    const activeOption =
        options.find((option) => option.concentration === selectedConcentration) ??
        options[0];
    const selectedRecipe = batch?.selectedRecipe;

    return (
        <div className={styles.staticGrid}>
            <MetricCard
                label={t("dilution.metrics.rawResist")}
                value={batch?.prmsMapping?.rawResistName ?? "--"}
            />
            <MetricCard
                label={t("dilution.metrics.concentration")}
                value={selectedRecipe?.concentration ?? activeOption?.concentration ?? "--"}
            />
            <MetricCard
                label={t("dilution.metrics.ratio")}
                value={
                    selectedRecipe
                        ? `${selectedRecipe.ratio.raw}:${selectedRecipe.ratio.solvent}`
                        : formatRatio(activeOption)
                }
            />
            <MetricCard
                label={t("dilution.metrics.recipe")}
                value={selectedRecipe?.id ?? activeOption?.recipeKey ?? "--"}
            />
            <div className={styles.formPanel}>
                <div className={styles.panelHeading}>
                    {selectedRecipe
                        ? t("dilution.recipeLocked")
                        : t("dilution.selectConcentration")}
                </div>
                <select
                    value={selectedConcentration}
                    onChange={(event) => setSelectedConcentration(event.target.value)}
                    className={styles.select}
                    disabled={Boolean(selectedRecipe) || options.length < 2}
                >
                    {options.map((option) => (
                        <option key={option.concentration} value={option.concentration}>
                            {option.concentration} · {option.dilutionResistName}
                        </option>
                    ))}
                </select>
                <div className={styles.recipeLockText}>
                    {selectedRecipe
                        ? t("dilution.recipeLocked")
                        : t("dilution.recipeWaiting")}
                </div>
            </div>
            <InfoPanel
                title={t("dilution.panels.prmsOptions")}
                rows={options.map((option) => [
                    option.concentration,
                    `${option.dilutionResistName} / ${formatRatio(option)}`,
                ])}
            />
        </div>
    );
}

function MeteringContent({
    batch,
    kind,
}: {
    batch: DilutionBatch | null;
    kind: "raw" | "solvent";
}) {
    const { t } = useTranslation();
    const record = batch?.meteringRecords.find((item) => item.kind === kind);
    const target = record?.targetMassG ?? record?.actualMassG ?? 0;
    const actual = record?.actualMassG ?? 0;
    const progress = target > 0 ? Math.min(100, Math.round((actual / target) * 100)) : 0;

    return (
        <div className={styles.meteringLayout}>
            <div className={styles.metricRow}>
                <MetricCard label={t("dilution.metrics.target")} value={formatMass(target)} />
                <MetricCard label={t("dilution.metrics.actual")} value={formatMass(actual)} />
                <MetricCard
                    label={t("dilution.metrics.deviation")}
                    value={formatMass(record?.deviationG)}
                />
                <MetricCard
                    label={t("dilution.metrics.device")}
                    value={record?.sourceDeviceId ?? "mock-meter"}
                />
            </div>
            <div className={styles.progressTrack}>
                <div className={styles.progressFill} style={{ width: `${progress}%` }} />
            </div>
            <div className={styles.twoColumn}>
                <InfoPanel
                    title={t("dilution.panels.parameters")}
                    rows={[
                        ["density", `${record?.densityGPerMl ?? 1.0} g/ml`],
                        ["tolerance", `${record?.toleranceG ?? 2.0} g`],
                        ["status", record?.status ?? "pending"],
                    ]}
                />
                <InfoPanel
                    title={t("dilution.panels.records")}
                    rows={(batch?.meteringRecords ?? [])
                        .filter((item) => item.kind === kind)
                        .map((item) => [item.id, formatMass(item.actualMassG)])}
                />
            </div>
        </div>
    );
}

function CountdownContent({
    batch,
    stepId,
}: {
    batch: DilutionBatch | null;
    stepId: "mix" | "settle";
}) {
    const { t } = useTranslation();
    const ms =
        stepId === "mix"
            ? batch?.selectedRecipe?.mixTimeMs
            : batch?.selectedRecipe?.settleTimeMs;
    const seconds = Math.round((ms ?? (stepId === "mix" ? 300_000 : 120_000)) / 1000);

    return (
        <div className={styles.countdownLayout}>
            <div className={styles.countdownCard}>
                <div className={styles.countdownIcon} />
                <div className={styles.countdownValue}>{seconds}s</div>
                <div className={styles.countdownLabel}>
                    {stepId === "mix"
                        ? t("dilution.countdown.mixing")
                        : t("dilution.countdown.settling")}
                </div>
                <div className={styles.progressTrack}>
                    <div className={styles.progressFill} style={{ width: "100%" }} />
                </div>
                <div className={styles.deviceState}>{t("dilution.countdown.ready")}</div>
            </div>
        </div>
    );
}

function ViscosityContent({ batch }: { batch: DilutionBatch | null }) {
    const { t } = useTranslation();
    return (
        <div className={styles.tableLayout}>
            <div className={styles.metricRow}>
                <MetricCard
                    label={t("dilution.metrics.averageViscosity")}
                    value={
                        batch?.viscosity?.averageCp
                            ? `${batch.viscosity.averageCp.toFixed(1)} cP`
                            : "--"
                    }
                />
                <MetricCard
                    label={t("dilution.metrics.prmsResult")}
                    value={batch?.viscosity?.prmsResult ?? "--"}
                />
                <MetricCard
                    label={t("dilution.metrics.sync")}
                    value={batch?.viscosity?.syncRecordId ?? "--"}
                />
            </div>
            <div className={styles.dataTable}>
                <div className={styles.tableHeader}>
                    <span>#</span>
                    <span>{t("dilution.fields.value")}</span>
                    <span>{t("dilution.fields.device")}</span>
                </div>
                {(batch?.viscosity?.readingsCp ?? []).map((reading) => (
                    <div key={reading.index} className={styles.tableRow}>
                        <span>{reading.index}</span>
                        <span>{reading.valueCp.toFixed(1)} cP</span>
                        <span>{reading.sourceDeviceId}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}

function BarcodeContent({ batch }: { batch: DilutionBatch | null }) {
    const { t } = useTranslation();
    const record = batch?.prmsSync.find(
        (sync) => sync.operation === "request_dilution_barcodes",
    );
    return (
        <div className={styles.externalLayout}>
            <InfoPanel
                title={t("dilution.panels.viscosityResult")}
                rows={[
                    ["average", `${batch?.viscosity?.averageCp?.toFixed(1) ?? "--"} cP`],
                    ["result", batch?.viscosity?.prmsResult ?? "--"],
                    ["sync", batch?.viscosity?.syncRecordId ?? "--"],
                ]}
            />
            <div className={styles.waitingBox}>
                <div className={styles.waitingSpinner} />
                <div>{record ? t("dilution.barcodeReady") : t("dilution.barcodeWaiting")}</div>
                <strong>{record?.id ?? "PRMS"}</strong>
            </div>
        </div>
    );
}

function BottleContent({ batch }: { batch: DilutionBatch | null }) {
    const { t } = useTranslation();
    return (
        <div className={styles.tableLayout}>
            <div className={styles.metricRow}>
                <MetricCard
                    label={t("dilution.metrics.bottles")}
                    value={`${batch?.outputBottles.length ?? 0}/${batch?.plannedBottleCount ?? 3}`}
                />
                <MetricCard
                    label={t("dilution.metrics.printed")}
                    value={`${batch?.outputBottles.filter((b) => b.printStatus === "printed").length ?? 0}`}
                />
                <MetricCard
                    label={t("dilution.metrics.totalOutput")}
                    value={formatMass(
                        batch?.outputBottles.reduce(
                            (sum, bottle) => sum + (bottle.actualMassG ?? 0),
                            0,
                        ),
                    )}
                />
            </div>
            <div className={styles.dataTable}>
                <div className={styles.tableHeader}>
                    <span>#</span>
                    <span>{t("dilution.fields.barcode")}</span>
                    <span>{t("dilution.fields.mass")}</span>
                    <span>{t("dilution.fields.print")}</span>
                </div>
                {(batch?.outputBottles ?? []).map((bottle) => (
                    <div key={bottle.index} className={styles.tableRow}>
                        <span>{bottle.index}</span>
                        <span>{bottle.dilutionBarcode ?? "--"}</span>
                        <span>{formatMass(bottle.actualMassG)}</span>
                        <span>{bottle.printStatus}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}

function ReportContent({ batch }: { batch: DilutionBatch | null }) {
    const { t } = useTranslation();
    const report = batch?.report;
    return (
        <div className={styles.staticGrid}>
            <MetricCard
                label={t("dilution.metrics.report")}
                value={report ? "report" : "--"}
            />
            <MetricCard
                label={t("dilution.metrics.status")}
                value={
                    batch?.status === "completed"
                        ? t("dilution.stepState.completed")
                        : (batch?.status ?? "--")
                }
            />
            <MetricCard
                label={t("dilution.metrics.averageViscosity")}
                value={
                    report?.viscosityAverageCp
                        ? `${report.viscosityAverageCp.toFixed(1)} cP`
                        : "--"
                }
            />
            <MetricCard
                label={t("dilution.metrics.outputLines")}
                value={`${report?.outputBottles.length ?? 0}`}
            />
            <InfoPanel
                title={t("dilution.reportCompleted")}
                rows={[
                    ["report", report?.reportId ?? "--"],
                    ["raw", report?.rawResistName ?? "--"],
                    ["dilution", report?.dilutionResistName ?? "--"],
                    ["comment", report?.comment ?? "--"],
                ]}
            />
            <InfoPanel
                title={t("dilution.panels.reportBottles")}
                rows={(report?.outputBottles ?? []).map((line) => [
                    `#${line.index}`,
                    `${line.dilutionBarcode} / ${line.actualMassG.toFixed(1)} g`,
                ])}
            />
        </div>
    );
}

function MetricCard({ label, value }: { label: string; value: string }) {
    return (
        <div className={styles.metricCard}>
            <span>{label}</span>
            <strong>{value}</strong>
        </div>
    );
}

function InfoPanel({
    title,
    rows,
}: {
    title: string;
    rows: Array<[string, string]>;
}) {
    return (
        <div className={styles.infoBox}>
            <div className={styles.panelHeading}>{title}</div>
            <div className={styles.infoRows}>
                {rows.length === 0 ? (
                    <div className={styles.infoRow}>
                        <span>--</span>
                        <strong>--</strong>
                    </div>
                ) : (
                    rows.map(([label, value]) => (
                        <div key={`${label}:${value}`} className={styles.infoRow}>
                            <span>{label}</span>
                            <strong>{value}</strong>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}
