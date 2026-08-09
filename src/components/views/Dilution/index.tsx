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
    dilutionGetConfig,
    dilutionGetReport,
    dilutionListBatches,
    dilutionRunBatch,
    dilutionScanRawResist,
    dilutionSelectConcentration,
} from "@/platform/dilution";
import type {
    Batch,
    BatchStatus,
    DilutionConfig,
    MeteringKind,
    RawLoadRequest,
} from "@/types/dilution";
import { toErrorMessage } from "@/utils/error";
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

const DEFAULT_SCAN = {
    barcode: "",
    operatorId: "",
};

const DEFAULT_RUN = {
    rawLoad: { mode: "mass", targetMassG: 1000 } as const,
};

type RawLoadMode = RawLoadRequest["mode"];

function statusToStepId(status?: BatchStatus): StepId {
    switch (status) {
        case "draft":
            return "batch";
        case "scanning_raw_resist":
            return "scan";
        case "resist_info_resolved":
        case "recipe_locked":
            return "recipe";
        case "local_process_running":
            return "raw";
        case "local_process_completed":
            return "viscosity";
        case "batch_creating":
            return "barcode";
        case "dispensing":
            return "dispense";
        case "completed":
        case "suspended":
        case "failed":
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

function statusHighlight(status?: BatchStatus): HighlightStatus {
    if (status === "failed") return "alarm";
    if (status === "suspended") return "warning";
    if (status === "completed") return "attention";
    if (status) return "processing";
    return "none";
}

function formatMass(value?: number) {
    return value === undefined ? "--" : `${value.toFixed(1)} g`;
}

function formatRatio(ratio?: { raw: number; solvent: number }) {
    if (!ratio) return "--";
    return `${ratio.raw}:${ratio.solvent}`;
}

function getMeteringMass(batch: Batch | null, kind: MeteringKind) {
    return batch?.meteringRecords.find((record) => record.kind === kind)
        ?.actualMassG;
}

function lastItem<T>(items: T[]): T | undefined {
    return items.length > 0 ? items[items.length - 1] : undefined;
}

function getStepSummary(batch: Batch | null, stepId: StepId) {
    if (!batch) return "--";
    switch (stepId) {
        case "batch":
            return `${batch.machineId} / ${batch.operatorId}`;
        case "scan":
            return lastItem(batch.rawScans)?.barcode ?? "--";
        case "recipe":
            return batch.selectedRecipe
                ? `${batch.selectedRecipe.concentration} / ${batch.selectedRecipe.dilutionResistName}`
                : "waiting";
        case "raw":
            return formatMass(getMeteringMass(batch, "raw"));
        case "solvent":
            return formatMass(getMeteringMass(batch, "solvent"));
        case "mix":
            return batch.selectedRecipe
                ? `${Math.round(batch.selectedRecipe.mixTimeMs / 1000)}s`
                : "--";
        case "settle":
            return batch.selectedRecipe
                ? `${Math.round(batch.selectedRecipe.settleTimeMs / 1000)}s`
                : "--";
        case "viscosity":
            return batch.report?.viscosity
                ? `${batch.report.viscosity.toFixed(1)} cP`
                : "--";
        case "barcode":
            return `${batch.resistBarcodes.length} barcode(s)`;
        case "print":
            return batch.printSuccess ? "ok" : "--";
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
    const [config, setConfig] = useState<DilutionConfig | null>(null);
    const [batch, setBatch] = useState<Batch | null>(null);
    const [machineId, setMachineId] = useState("");
    const [operatorId, setOperatorId] = useState("");
    const [checker, setChecker] = useState("");
    const [bottleCount, setBottleCount] = useState(3);
    const [targetMassG, setTargetMassG] = useState(500);
    const [scanBarcode, setScanBarcode] = useState(DEFAULT_SCAN.barcode);
    const [selectedConcentration, setSelectedConcentration] = useState("");
    const [rawLoadMode, setRawLoadMode] = useState<RawLoadMode>("mass");
    const [targetRawMassG, setTargetRawMassG] = useState<number>(
        DEFAULT_RUN.rawLoad.targetMassG,
    );
    const [rawBottleCount, setRawBottleCount] = useState(2);
    const [browseId, setBrowseId] = useState<StepId | null>(null);
    const [browseCountdown, setBrowseCountdown] = useState(10);
    const [busy, setBusy] = useState(false);

    const execId = statusToStepId(batch?.status);
    const viewStepId = browseId ?? execId;
    const viewStep = selectedStepOrFallback(viewStepId);

    useEffect(() => {
        let cancelled = false;
        dilutionGetConfig()
            .then((loaded) => {
                if (cancelled) return;
                setConfig(loaded);
                setMachineId(loaded.machine?.eqptId ?? "");
                setOperatorId(loaded.personnel?.operator ?? "");
                setChecker(loaded.personnel?.checker ?? "");
            })
            .catch((err) => {
                error(
                    t("dilution.notifications.configLoadFailed"),
                    toErrorMessage(err),
                );
            });
        return () => {
            cancelled = true;
        };
    }, [error, t]);

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
        async (action: () => Promise<Batch>, successTitle: string) => {
            setBusy(true);
            try {
                const nextBatch = await action();
                setBatch(nextBatch);
                success(successTitle, nextBatch.id);
            } catch (err) {
                error(t("dilution.notifications.operationFailed"), toErrorMessage(err));
            } finally {
                setBusy(false);
            }
        },
        [success, error, t],
    );

    const handleCreateBatch = useCallback(
        () =>
            runAction(
                () =>
                    dilutionCreateBatch({
                        machineId: machineId || undefined,
                        operatorId: operatorId || undefined,
                        plannedBottleCount: bottleCount,
                        targetBottleMassG: targetMassG,
                    }),
                t("dilution.notifications.batchCreated"),
            ),
        [runAction, t, machineId, operatorId, bottleCount, targetMassG],
    );

    const handleLoadLatestBatch = useCallback(
        () =>
            runAction(async () => {
                const batches = await dilutionListBatches();
                const latest = batches[batches.length - 1];
                if (!latest) throw new Error(t("dilution.notifications.noBatch"));
                return latest;
            }, t("dilution.notifications.batchLoaded")),
        [runAction, t],
    );

    const handleScan = useCallback(() => {
        if (!batch || !scanBarcode.trim()) return;
        void runAction(
            () =>
                dilutionScanRawResist({
                    batchId: batch.id,
                    barcode: scanBarcode.trim(),
                    operatorId: batch.operatorId,
                }),
            t("dilution.notifications.rawScanned"),
        );
    }, [batch, runAction, scanBarcode, t]);

    const handleSelectConcentration = useCallback(() => {
        if (!batch || !selectedConcentration) return;
        void runAction(
            () =>
                dilutionSelectConcentration({
                    batchId: batch.id,
                    concentration: selectedConcentration,
                }),
            t("dilution.notifications.recipeLocked"),
        );
    }, [batch, runAction, selectedConcentration, t]);

    const handleRunBatch = useCallback(() => {
        if (!batch) return;
        const rawLoad: RawLoadRequest =
            rawLoadMode === "mass"
                ? { mode: "mass", targetMassG: targetRawMassG }
                : { mode: "bottle_count", bottleCount: rawBottleCount };
        void runAction(
            () => dilutionRunBatch({ batchId: batch.id, rawLoad }),
            t("dilution.notifications.batchCompleted"),
        );
    }, [batch, runAction, rawLoadMode, targetRawMassG, rawBottleCount, t]);

    const handleExportReport = useCallback(async () => {
        if (!batch?.report) return;
        try {
            const report = await dilutionGetReport(batch.id);
            info(t("dilution.notifications.reportReady"), report?.reportId ?? "--");
        } catch (err) {
            error(t("dilution.notifications.operationFailed"), toErrorMessage(err));
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
                    !batch?.resistInfo ||
                    batch.resistInfo.dilutionRelationships.length < 2 ||
                    Boolean(batch.selectedRecipe),
                requiresLogin: true,
                highlight:
                    batch?.resistInfo &&
                    batch.resistInfo.dilutionRelationships.length > 1 &&
                    !batch.selectedRecipe
                        ? "warning"
                        : "none",
                onClick: handleSelectConcentration,
            },
            {
                id: "runBatch",
                labelKey: "dilution.commands.runBatch",
                icon: <PlayIcon />,
                disabled: busy || !batch?.selectedRecipe,
                requiresLogin: true,
                highlight:
                    batch?.selectedRecipe && batch.status !== "completed"
                        ? "processing"
                        : "none",
                onClick: handleRunBatch,
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
            handleRunBatch,
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
                            <dd>{(batch?.machineId ?? machineId) || "--"}</dd>
                        </div>
                        <div>
                            <dt>{t("dilution.fields.operator")}</dt>
                            <dd>{(batch?.operatorId ?? operatorId) || "--"}</dd>
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
                        config={config}
                        step={viewStep}
                        machineId={machineId}
                        setMachineId={setMachineId}
                        operatorId={operatorId}
                        setOperatorId={setOperatorId}
                        checker={checker}
                        setChecker={setChecker}
                        bottleCount={bottleCount}
                        setBottleCount={setBottleCount}
                        targetMassG={targetMassG}
                        setTargetMassG={setTargetMassG}
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
                    />
                </section>
            </main>
        </div>
    );
}

function SignalBar({ batch }: { batch: Batch | null }) {
    const { t } = useTranslation();
    const signals = [
        {
            label: t("dilution.signals.prms"),
            value: batch
                ? (lastItem(batch.prmsSync)?.operation ?? "idle")
                : "idle",
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
            value: batch?.report?.viscosity
                ? `${batch.report.viscosity.toFixed(1)} cP`
                : "idle",
            state: batch?.report?.viscosity ? "attention" : "idle",
        },
        {
            label: t("dilution.signals.printer"),
            value:
                batch?.printSuccess === true
                    ? "printed"
                    : batch?.printSuccess === false
                      ? "failed"
                      : "idle",
            state: batch?.printSuccess === true ? "attention" : "idle",
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
    config,
    step,
    machineId,
    setMachineId,
    operatorId,
    setOperatorId,
    checker,
    setChecker,
    bottleCount,
    setBottleCount,
    targetMassG,
    setTargetMassG,
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
}: {
    batch: Batch | null;
    config: DilutionConfig | null;
    step: StepDefinition;
    machineId: string;
    setMachineId: (value: string) => void;
    operatorId: string;
    setOperatorId: (value: string) => void;
    checker: string;
    setChecker: (value: string) => void;
    bottleCount: number;
    setBottleCount: (value: number) => void;
    targetMassG: number;
    setTargetMassG: (value: number) => void;
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
                    config={config}
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
                    machineId={machineId}
                    setMachineId={setMachineId}
                    operatorId={operatorId}
                    setOperatorId={setOperatorId}
                    checker={checker}
                    setChecker={setChecker}
                    bottleCount={bottleCount}
                    setBottleCount={setBottleCount}
                    targetMassG={targetMassG}
                    setTargetMassG={setTargetMassG}
                    rawLoadMode={rawLoadMode}
                    setRawLoadMode={setRawLoadMode}
                    targetRawMassG={targetRawMassG}
                    setTargetRawMassG={setTargetRawMassG}
                    rawBottleCount={rawBottleCount}
                    setRawBottleCount={setRawBottleCount}
                />
            );
    }
}

function BatchContent({
    batch,
    machineId,
    setMachineId,
    operatorId,
    setOperatorId,
    checker,
    setChecker,
    bottleCount,
    setBottleCount,
    targetMassG,
    setTargetMassG,
    rawLoadMode,
    setRawLoadMode,
    targetRawMassG,
    setTargetRawMassG,
    rawBottleCount,
    setRawBottleCount,
}: {
    batch: Batch | null;
    machineId: string;
    setMachineId: (value: string) => void;
    operatorId: string;
    setOperatorId: (value: string) => void;
    checker: string;
    setChecker: (value: string) => void;
    bottleCount: number;
    setBottleCount: (value: number) => void;
    targetMassG: number;
    setTargetMassG: (value: number) => void;
    rawLoadMode: RawLoadMode;
    setRawLoadMode: (value: RawLoadMode) => void;
    targetRawMassG: number;
    setTargetRawMassG: (value: number) => void;
    rawBottleCount: number;
    setRawBottleCount: (value: number) => void;
}) {
    const { t } = useTranslation();
    return (
        <div className={styles.staticGrid}>
            <MetricCard
                label={t("dilution.fields.machine")}
                value={(batch?.machineId ?? machineId) || "--"}
            />
            <MetricCard
                label={t("dilution.fields.operator")}
                value={(batch?.operatorId ?? operatorId) || "--"}
            />
            <MetricCard
                label={t("dilution.fields.plannedBottles")}
                value={`${batch?.plannedBottleCount ?? bottleCount}`}
            />
            <MetricCard
                label={t("dilution.fields.targetMass")}
                value={`${(batch?.targetBottleMassG ?? targetMassG).toFixed(1)} g`}
            />
            <div className={styles.formPanel}>
                <div className={styles.panelHeading}>
                    {t("dilution.panels.batchSettings")}
                </div>
                <div className={styles.compactForm}>
                    <label className={styles.inputLabel}>
                        <span>{t("dilution.fields.machine")}</span>
                        <input
                            value={machineId}
                            disabled={Boolean(batch)}
                            onChange={(event) => setMachineId(event.target.value)}
                            className={styles.input}
                        />
                    </label>
                    <label className={styles.inputLabel}>
                        <span>{t("dilution.fields.operator")}</span>
                        <input
                            value={operatorId}
                            disabled={Boolean(batch)}
                            onChange={(event) => setOperatorId(event.target.value)}
                            className={styles.input}
                        />
                    </label>
                    <label className={styles.inputLabel}>
                        <span>{t("dilution.fields.checker")}</span>
                        <input
                            value={checker}
                            disabled={Boolean(batch)}
                            onChange={(event) => setChecker(event.target.value)}
                            className={styles.input}
                        />
                    </label>
                    <div className={styles.inlineInputs}>
                        <label className={styles.inputLabel}>
                            <span>{t("dilution.fields.plannedBottles")}</span>
                            <input
                                type="number"
                                min="1"
                                step="1"
                                value={bottleCount}
                                disabled={Boolean(batch)}
                                onChange={(event) =>
                                    setBottleCount(Number(event.target.value))
                                }
                                className={styles.input}
                            />
                        </label>
                        <label className={styles.inputLabel}>
                            <span>{t("dilution.fields.targetMass")}</span>
                            <input
                                type="number"
                                min="0"
                                step="0.1"
                                value={targetMassG}
                                disabled={Boolean(batch)}
                                onChange={(event) =>
                                    setTargetMassG(Number(event.target.value))
                                }
                                className={styles.input}
                            />
                        </label>
                    </div>
                </div>
            </div>
            <div className={styles.formPanel}>
                <div className={styles.panelHeading}>
                    {t("dilution.panels.runParameters")}
                </div>
                <div className={styles.compactForm}>
                    <label className={styles.inputLabel}>
                        <span>{t("dilution.fields.rawLoadMode")}</span>
                        <select
                            value={rawLoadMode}
                            disabled={Boolean(batch)}
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
                                disabled={Boolean(batch)}
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
                                disabled={Boolean(batch)}
                                onChange={(event) =>
                                    setRawBottleCount(Number(event.target.value))
                                }
                                className={styles.input}
                            />
                        </label>
                    )}
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
    batch: Batch | null;
    scanBarcode: string;
    setScanBarcode: (value: string) => void;
}) {
    const { t } = useTranslation();
    const info = batch?.resistInfo;
    return (
        <div className={styles.tableLayout}>
            <div className={styles.metricRow}>
                <MetricCard
                    label={t("dilution.metrics.scanned")}
                    value={`${batch?.rawScans.length ?? 0}`}
                />
                <MetricCard
                    label={t("dilution.metrics.rawResist")}
                    value={info?.resistName ?? "--"}
                />
                <MetricCard
                    label={t("dilution.metrics.concentration")}
                    value={info?.concentration ?? "--"}
                />
            </div>
            <label className={styles.inputLabel}>
                <span>{t("dilution.fields.barcode")}</span>
                <input
                    value={scanBarcode}
                    onChange={(event) => setScanBarcode(event.target.value)}
                    className={styles.input}
                />
            </label>
            {info && (
                <InfoPanel
                    title={t("dilution.panels.rawResistInfo")}
                    rows={[
                        [t("dilution.fields.batchNo"), info.defBatchNO || "--"],
                        [t("dilution.fields.expireTime"), info.expireTime || "--"],
                        ["resistNo", info.resistNo || "--"],
                        ["mtrNO", info.mtrNO || "--"],
                    ]}
                />
            )}
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
    config,
    selectedConcentration,
    setSelectedConcentration,
}: {
    batch: Batch | null;
    config: DilutionConfig | null;
    selectedConcentration: string;
    setSelectedConcentration: (value: string) => void;
}) {
    const { t } = useTranslation();
    const relationships = batch?.resistInfo?.dilutionRelationships ?? [];
    const selectedRecipe = batch?.selectedRecipe;

    useEffect(() => {
        if (selectedRecipe && selectedConcentration !== selectedRecipe.concentration) {
            setSelectedConcentration(selectedRecipe.concentration);
        }
    }, [selectedRecipe, selectedConcentration, setSelectedConcentration]);

    return (
        <div className={styles.staticGrid}>
            <MetricCard
                label={t("dilution.metrics.rawResist")}
                value={batch?.resistInfo?.resistName ?? "--"}
            />
            <MetricCard
                label={t("dilution.metrics.concentration")}
                value={(selectedRecipe?.concentration ?? selectedConcentration) || "--"}
            />
            <MetricCard
                label={t("dilution.metrics.ratio")}
                value={formatRatio(selectedRecipe?.ratio)}
            />
            <MetricCard
                label={t("dilution.metrics.recipe")}
                value={selectedRecipe?.recipeId ?? "--"}
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
                    disabled={Boolean(selectedRecipe) || relationships.length < 2}
                >
                    <option value="">--</option>
                    {relationships.map((relationship) => {
                        const configured = config?.dilutionOptions.some(
                            (option) => option.concentration === relationship.concentration,
                        );
                        return (
                            <option
                                key={relationship.sysRrn}
                                value={relationship.concentration}
                                disabled={!configured}
                            >
                                {relationship.concentration} ·{" "}
                                {relationship.resistName}
                                {configured ? "" : " (未配置)"}
                            </option>
                        );
                    })}
                </select>
                <div className={styles.recipeLockText}>
                    {selectedRecipe
                        ? t("dilution.recipeLocked")
                        : t("dilution.recipeWaiting")}
                </div>
            </div>
            <InfoPanel
                title={t("dilution.panels.prmsOptions")}
                rows={relationships.map((relationship) => [
                    relationship.concentration,
                    relationship.resistName,
                ])}
            />
            {selectedRecipe && (
                <InfoPanel
                    title={t("dilution.panels.parameters")}
                    rows={[
                        ["ratio", formatRatio(selectedRecipe.ratio)],
                        [
                            t("dilution.metrics.mixTime"),
                            `${Math.round(selectedRecipe.mixTimeMs / 1000)}s`,
                        ],
                        [
                            t("dilution.metrics.settleTime"),
                            `${Math.round(selectedRecipe.settleTimeMs / 1000)}s`,
                        ],
                        ["recipeId", selectedRecipe.recipeId],
                    ]}
                />
            )}
        </div>
    );
}

function MeteringContent({
    batch,
    kind,
}: {
    batch: Batch | null;
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
                    value={record?.sourceDeviceId ?? "--"}
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
    batch: Batch | null;
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

function ViscosityContent({ batch }: { batch: Batch | null }) {
    const { t } = useTranslation();
    const viscosity = batch?.report?.viscosity;
    return (
        <div className={styles.tableLayout}>
            <div className={styles.metricRow}>
                <MetricCard
                    label={t("dilution.metrics.averageViscosity")}
                    value={viscosity ? `${viscosity.toFixed(1)} cP` : "--"}
                />
                <MetricCard
                    label={t("dilution.metrics.prmsResult")}
                    value={batch?.checkResult?.resistDefRrn ? "check ok" : "--"}
                />
                <MetricCard
                    label={t("dilution.fields.batchNo")}
                    value={batch?.checkResult?.batchNO ?? "--"}
                />
            </div>
            <InfoPanel
                title={t("dilution.panels.viscosityResult")}
                rows={[
                    ["viscosity", viscosity ? `${viscosity.toFixed(1)} cP` : "--"],
                    ["status", batch?.status ?? "--"],
                ]}
            />
        </div>
    );
}

function BarcodeContent({ batch }: { batch: Batch | null }) {
    const { t } = useTranslation();
    return (
        <div className={styles.externalLayout}>
            <InfoPanel
                title={t("dilution.panels.viscosityResult")}
                rows={[
                    ["viscosity", batch?.report?.viscosity ? `${batch.report.viscosity.toFixed(1)} cP` : "--"],
                    ["status", batch?.status ?? "--"],
                ]}
            />
            <div className={styles.waitingBox}>
                <div className={styles.waitingSpinner} />
                <div>
                    {batch?.resistBarcodes.length
                        ? t("dilution.barcodeReady")
                        : t("dilution.barcodeWaiting")}
                </div>
                <strong>{batch?.resistBarcodes.length ?? 0}</strong>
            </div>
        </div>
    );
}

function BottleContent({ batch }: { batch: Batch | null }) {
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

function ReportContent({ batch }: { batch: Batch | null }) {
    const { t } = useTranslation();
    const report = batch?.report;
    return (
        <div className={styles.staticGrid}>
            <MetricCard
                label={t("dilution.metrics.report")}
                value={report?.reportId ?? "--"}
            />
            <MetricCard
                label={t("dilution.metrics.status")}
                value={batch ? t(`dilution.status.${batch.status}`) : "--"}
            />
            <MetricCard
                label={t("dilution.metrics.averageViscosity")}
                value={
                    report?.viscosity ? `${report.viscosity.toFixed(1)} cP` : "--"
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
                    ["raw", report?.sourceResistName ?? "--"],
                    ["dilution", report?.dilutionResistName ?? "--"],
                    ["viscosity", report?.viscosity ? `${report.viscosity.toFixed(1)} cP` : "--"],
                    ["printSuccess", String(report?.printSuccess ?? "--")],
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
