use super::manager::{now_ms, LoadedRecipeRuntime, RecipeRuntimeManager, RuntimeRunControl};
use super::types::{
    safe_stop_step_id, RecipeRuntimeFailure, RecipeRuntimePhase, RecipeRuntimeStatus,
};
use crate::craftsmanship::{ActionDefinition, InterlockCondition, RecipeStep, SafeStopStep};
use serde_json::Value;
use std::time::{Duration, Instant};
use tauri::AppHandle;

pub(super) async fn run_recipe(
    manager: RecipeRuntimeManager,
    app: Option<AppHandle>,
    loaded: LoadedRecipeRuntime,
    run_control: RuntimeRunControl,
) {
    let result = execute_recipe_steps(
        &manager,
        app.as_ref(),
        &loaded,
        &run_control,
        &loaded.bundle.recipe.steps,
    )
    .await;

    match result {
        Ok(()) => {
            manager
                .finish_run(
                    app.as_ref(),
                    RecipeRuntimeStatus::Completed,
                    RecipeRuntimePhase::Recipe,
                    Some("recipe completed".to_string()),
                    None,
                )
                .await;
        }
        Err(failure) if failure.code == "stop_requested" => {
            if let Some(step_id) = failure.step_id.as_deref() {
                manager
                    .stop_step(
                        app.as_ref(),
                        RecipeRuntimePhase::Recipe,
                        step_id,
                        Some(failure.message.clone()),
                    )
                    .await;
            }
            manager
                .finish_run(
                    app.as_ref(),
                    RecipeRuntimeStatus::Stopped,
                    RecipeRuntimePhase::Recipe,
                    Some("recipe stopped".to_string()),
                    Some(failure),
                )
                .await;
        }
        Err(failure) => {
            manager
                .mark_failure(RecipeRuntimePhase::Recipe, failure.clone())
                .await;

            if matches!(failure.on_error.as_deref(), Some("safe-stop"))
                && loaded
                    .bundle
                    .safe_stop
                    .as_ref()
                    .is_some_and(|safe_stop| !safe_stop.steps.is_empty())
            {
                manager
                    .transition_to_safe_stop(app.as_ref(), failure.clone())
                    .await;

                match execute_safe_stop(&manager, app.as_ref(), &loaded, &run_control).await {
                    Ok(()) => {
                        manager
                            .finish_run(
                                app.as_ref(),
                                RecipeRuntimeStatus::Stopped,
                                RecipeRuntimePhase::SafeStop,
                                Some("safe-stop completed".to_string()),
                                Some(failure),
                            )
                            .await;
                    }
                    Err(safe_stop_failure) if safe_stop_failure.code == "stop_requested" => {
                        manager
                            .finish_run(
                                app.as_ref(),
                                RecipeRuntimeStatus::Stopped,
                                RecipeRuntimePhase::SafeStop,
                                Some(format!(
                                    "safe-stop interrupted: {}",
                                    safe_stop_failure.message
                                )),
                                Some(failure),
                            )
                            .await;
                    }
                    Err(safe_stop_failure) => {
                        manager
                            .finish_run(
                                app.as_ref(),
                                RecipeRuntimeStatus::Failed,
                                RecipeRuntimePhase::SafeStop,
                                Some(format!(
                                    "safe-stop failed after `{}`: {} ({})",
                                    failure.code, safe_stop_failure.message, safe_stop_failure.code
                                )),
                                Some(failure),
                            )
                            .await;
                    }
                }
            } else {
                manager
                    .finish_run(
                        app.as_ref(),
                        RecipeRuntimeStatus::Failed,
                        RecipeRuntimePhase::Recipe,
                        Some("recipe failed".to_string()),
                        Some(failure),
                    )
                    .await;
            }
        }
    }
}

async fn execute_recipe_steps(
    manager: &RecipeRuntimeManager,
    app: Option<&AppHandle>,
    loaded: &LoadedRecipeRuntime,
    run_control: &RuntimeRunControl,
    steps: &[RecipeStep],
) -> Result<(), RecipeRuntimeFailure> {
    for step in steps {
        ensure_not_stopped(
            run_control,
            Some(step.id.as_str()),
            Some(step.action_id.as_str()),
            None,
        )?;
        if let Err(failure) = validate_interlocks(loaded, manager, step).await {
            manager
                .fail_step(
                    app,
                    RecipeRuntimePhase::Recipe,
                    step.id.as_str(),
                    Some(failure.message.clone()),
                )
                .await;
            return Err(failure);
        }

        manager
            .begin_step(
                app,
                RecipeRuntimePhase::Recipe,
                step.id.as_str(),
                Some(format!("executing action `{}`", step.action_id)),
            )
            .await;

        let result = execute_recipe_step(manager, loaded, run_control, step).await;
        match result {
            Ok(message) => {
                manager
                    .complete_step(
                        app,
                        RecipeRuntimePhase::Recipe,
                        step.id.as_str(),
                        Some(message),
                    )
                    .await;
            }
            Err(failure) if failure.code == "stop_requested" => {
                return Err(failure);
            }
            Err(failure) if matches!(step.on_error.as_deref(), Some("ignore")) => {
                manager
                    .fail_step(
                        app,
                        RecipeRuntimePhase::Recipe,
                        step.id.as_str(),
                        Some(format!("step failed but ignored: {}", failure.message)),
                    )
                    .await;
            }
            Err(failure) => {
                manager
                    .fail_step(
                        app,
                        RecipeRuntimePhase::Recipe,
                        step.id.as_str(),
                        Some(failure.message.clone()),
                    )
                    .await;
                return Err(failure);
            }
        }
    }

    Ok(())
}

async fn execute_safe_stop(
    manager: &RecipeRuntimeManager,
    app: Option<&AppHandle>,
    loaded: &LoadedRecipeRuntime,
    run_control: &RuntimeRunControl,
) -> Result<(), RecipeRuntimeFailure> {
    let Some(safe_stop) = loaded.bundle.safe_stop.as_ref() else {
        return Ok(());
    };

    for step in &safe_stop.steps {
        let safe_step_id = safe_stop_step_id(step);
        ensure_not_stopped(
            run_control,
            Some(safe_step_id.as_str()),
            Some(step.action_id.as_str()),
            Some("safe-stop"),
        )?;

        manager
            .begin_step(
                app,
                RecipeRuntimePhase::SafeStop,
                safe_step_id.as_str(),
                Some(format!("executing safe-stop action `{}`", step.action_id)),
            )
            .await;

        match execute_safe_stop_step(manager, loaded, run_control, step, safe_step_id.clone()).await
        {
            Ok(message) => {
                manager
                    .complete_step(
                        app,
                        RecipeRuntimePhase::SafeStop,
                        safe_step_id.as_str(),
                        Some(message),
                    )
                    .await;
            }
            Err(failure) if failure.code == "stop_requested" => {
                manager
                    .stop_step(
                        app,
                        RecipeRuntimePhase::SafeStop,
                        safe_step_id.as_str(),
                        Some(failure.message.clone()),
                    )
                    .await;
                return Err(failure);
            }
            Err(failure) => {
                manager
                    .fail_step(
                        app,
                        RecipeRuntimePhase::SafeStop,
                        safe_step_id.as_str(),
                        Some(failure.message.clone()),
                    )
                    .await;
                return Err(failure);
            }
        }
    }

    Ok(())
}

async fn execute_recipe_step(
    manager: &RecipeRuntimeManager,
    loaded: &LoadedRecipeRuntime,
    run_control: &RuntimeRunControl,
    step: &RecipeStep,
) -> Result<String, RecipeRuntimeFailure> {
    let action = loaded.actions.get(step.action_id.as_str()).ok_or_else(|| {
        runtime_failure(
            "action_not_found",
            format!(
                "action `{}` is not available during execution",
                step.action_id
            ),
            Some(step.id.clone()),
            Some(step.action_id.clone()),
            step.on_error.clone(),
        )
    })?;

    match action.id.as_str() {
        "common.delay" => execute_delay_step(manager, run_control, step).await,
        "common.wait-signal" => execute_wait_signal_step(manager, run_control, step).await,
        _ => {
            execute_action_completion(
                manager,
                loaded,
                run_control,
                action,
                step.device_id.as_deref(),
                step.timeout_ms,
                step.id.clone(),
                step.on_error.clone(),
            )
            .await
        }
    }
}

async fn execute_safe_stop_step(
    manager: &RecipeRuntimeManager,
    loaded: &LoadedRecipeRuntime,
    run_control: &RuntimeRunControl,
    step: &SafeStopStep,
    step_id: String,
) -> Result<String, RecipeRuntimeFailure> {
    let action = loaded.actions.get(step.action_id.as_str()).ok_or_else(|| {
        runtime_failure(
            "action_not_found",
            format!(
                "safe-stop action `{}` is not available during execution",
                step.action_id
            ),
            Some(step_id.clone()),
            Some(step.action_id.clone()),
            Some("safe-stop".to_string()),
        )
    })?;

    execute_action_completion(
        manager,
        loaded,
        run_control,
        action,
        step.device_id.as_deref(),
        None,
        step_id,
        Some("safe-stop".to_string()),
    )
    .await
}

async fn execute_delay_step(
    manager: &RecipeRuntimeManager,
    run_control: &RuntimeRunControl,
    step: &RecipeStep,
) -> Result<String, RecipeRuntimeFailure> {
    let duration_ms = step
        .parameters
        .get("durationMs")
        .and_then(Value::as_u64)
        .ok_or_else(|| {
            runtime_failure(
                "missing_duration",
                format!("step `{}` requires numeric parameter `durationMs`", step.id),
                Some(step.id.clone()),
                Some(step.action_id.clone()),
                step.on_error.clone(),
            )
        })?;

    let start = Instant::now();
    wait_for_condition(
        manager,
        run_control,
        step.timeout_ms,
        0,
        Some(step.id.as_str()),
        Some(step.action_id.as_str()),
        step.on_error.clone(),
        move |_| Ok(start.elapsed() >= Duration::from_millis(duration_ms)),
    )
    .await?;

    Ok(format!("delay completed after {duration_ms} ms"))
}

async fn execute_wait_signal_step(
    manager: &RecipeRuntimeManager,
    run_control: &RuntimeRunControl,
    step: &RecipeStep,
) -> Result<String, RecipeRuntimeFailure> {
    let signal_id = step
        .parameters
        .get("signalId")
        .and_then(Value::as_str)
        .ok_or_else(|| {
            runtime_failure(
                "missing_signal_id",
                format!("step `{}` requires parameter `signalId`", step.id),
                Some(step.id.clone()),
                Some(step.action_id.clone()),
                step.on_error.clone(),
            )
        })?
        .to_string();
    let operator = step
        .parameters
        .get("operator")
        .and_then(Value::as_str)
        .unwrap_or("eq")
        .to_string();
    let expected = step.parameters.get("value").cloned().ok_or_else(|| {
        runtime_failure(
            "missing_signal_value",
            format!("step `{}` requires parameter `value`", step.id),
            Some(step.id.clone()),
            Some(step.action_id.clone()),
            step.on_error.clone(),
        )
    })?;
    let stable_time_ms = step
        .parameters
        .get("stableTimeMs")
        .and_then(Value::as_u64)
        .unwrap_or(0);

    let message_signal_id = signal_id.clone();
    wait_for_condition(
        manager,
        run_control,
        step.timeout_ms,
        stable_time_ms,
        Some(step.id.as_str()),
        Some(step.action_id.as_str()),
        step.on_error.clone(),
        move |snapshot| {
            let Some(actual) = snapshot.signal_values.get(signal_id.as_str()) else {
                return Ok(false);
            };
            compare_values(actual, operator.as_str(), &expected)
        },
    )
    .await?;

    Ok(format!("signal `{message_signal_id}` reached target"))
}

async fn execute_action_completion(
    manager: &RecipeRuntimeManager,
    loaded: &LoadedRecipeRuntime,
    run_control: &RuntimeRunControl,
    action: &ActionDefinition,
    device_id: Option<&str>,
    timeout_ms: Option<u64>,
    step_id: String,
    on_error: Option<String>,
) -> Result<String, RecipeRuntimeFailure> {
    let Some(completion) = action.completion.as_ref() else {
        return Ok(format!("action `{}` completed immediately", action.id));
    };

    match completion.r#type.as_deref() {
        Some("deviceFeedback") => {
            let device_id = device_id.ok_or_else(|| {
                runtime_failure(
                    "missing_device_feedback_target",
                    format!(
                        "action `{}` requires `deviceId` for device feedback completion",
                        action.id
                    ),
                    Some(step_id.clone()),
                    Some(action.id.clone()),
                    on_error.clone(),
                )
            })?;
            let device = loaded.devices.get(device_id).ok_or_else(|| {
                runtime_failure(
                    "device_not_found",
                    format!("device `{device_id}` is not available during execution"),
                    Some(step_id.clone()),
                    Some(action.id.clone()),
                    on_error.clone(),
                )
            })?;
            let feedback_key = completion.key.as_deref().ok_or_else(|| {
                runtime_failure(
                    "missing_feedback_key",
                    format!("action `{}` completion misses feedback key", action.id),
                    Some(step_id.clone()),
                    Some(action.id.clone()),
                    on_error.clone(),
                )
            })?;
            let runtime_key = device.tags.get(feedback_key).cloned().ok_or_else(|| runtime_failure(
                "device_feedback_key_not_found",
                format!(
                    "device `{device_id}` does not define runtime tag for feedback key `{feedback_key}`"
                ),
                Some(step_id.clone()),
                Some(action.id.clone()),
                on_error.clone(),
            ))?;
            let operator = completion.operator.as_deref().unwrap_or("eq").to_string();
            let expected = completion.value.clone().ok_or_else(|| {
                runtime_failure(
                    "missing_completion_value",
                    format!("action `{}` completion misses comparison value", action.id),
                    Some(step_id.clone()),
                    Some(action.id.clone()),
                    on_error.clone(),
                )
            })?;
            let stable_time_ms = completion.stable_time_ms.unwrap_or(0);
            let feedback_label = feedback_key.to_string();

            wait_for_condition(
                manager,
                run_control,
                timeout_ms,
                stable_time_ms,
                Some(step_id.as_str()),
                Some(action.id.as_str()),
                on_error.clone(),
                move |snapshot| {
                    let Some(actual) = snapshot.runtime_values.get(runtime_key.as_str()) else {
                        return Ok(false);
                    };
                    compare_values(actual, operator.as_str(), &expected)
                },
            )
            .await?;

            Ok(format!(
                "device action `{}` completed via feedback `{}`",
                action.id, feedback_label
            ))
        }
        Some("signalCompare") => {
            let signal_id = completion
                .signal_id
                .as_deref()
                .ok_or_else(|| {
                    runtime_failure(
                        "missing_completion_signal",
                        format!("action `{}` completion misses `signalId`", action.id),
                        Some(step_id.clone()),
                        Some(action.id.clone()),
                        on_error.clone(),
                    )
                })?
                .to_string();
            let operator = completion.operator.as_deref().unwrap_or("eq").to_string();
            let expected = completion.value.clone().ok_or_else(|| {
                runtime_failure(
                    "missing_completion_value",
                    format!("action `{}` completion misses comparison value", action.id),
                    Some(step_id.clone()),
                    Some(action.id.clone()),
                    on_error.clone(),
                )
            })?;
            let stable_time_ms = completion.stable_time_ms.unwrap_or(0);
            let signal_label = signal_id.clone();

            wait_for_condition(
                manager,
                run_control,
                timeout_ms,
                stable_time_ms,
                Some(step_id.as_str()),
                Some(action.id.as_str()),
                on_error.clone(),
                move |snapshot| {
                    let Some(actual) = snapshot.signal_values.get(signal_id.as_str()) else {
                        return Ok(false);
                    };
                    compare_values(actual, operator.as_str(), &expected)
                },
            )
            .await?;

            Ok(format!(
                "action `{}` completed via signal `{}`",
                action.id, signal_label
            ))
        }
        Some("immediate") | None => Ok(format!("action `{}` completed immediately", action.id)),
        Some(other) => Err(runtime_failure(
            "unsupported_completion_type",
            format!(
                "action `{}` uses unsupported runtime completion type `{}`",
                action.id, other
            ),
            Some(step_id),
            Some(action.id.clone()),
            on_error,
        )),
    }
}

async fn validate_interlocks(
    loaded: &LoadedRecipeRuntime,
    manager: &RecipeRuntimeManager,
    step: &RecipeStep,
) -> Result<(), RecipeRuntimeFailure> {
    let Some(interlocks) = loaded.bundle.interlocks.as_ref() else {
        return Ok(());
    };
    let snapshot = manager.snapshot().await;

    for rule in interlocks.rules.iter().filter(|rule| {
        rule.action_ids
            .iter()
            .any(|action_id| action_id == &step.action_id)
    }) {
        let satisfied = evaluate_interlock_condition(&snapshot, &rule.condition)?;
        if !satisfied {
            let code = match rule.on_violation.as_deref() {
                Some("alarm") => "interlock_alarm",
                _ => "interlock_blocked",
            };
            return Err(runtime_failure(
                code,
                format!(
                    "interlock `{}` blocked action `{}` before execution",
                    rule.id, step.action_id
                ),
                Some(step.id.clone()),
                Some(step.action_id.clone()),
                step.on_error.clone(),
            ));
        }
    }

    Ok(())
}

fn evaluate_interlock_condition(
    snapshot: &super::types::RecipeRuntimeSnapshot,
    condition: &InterlockCondition,
) -> Result<bool, RecipeRuntimeFailure> {
    if !condition.items.is_empty() {
        let logic = condition.logic.as_deref().unwrap_or("and");
        match logic {
            "or" => {
                for item in &condition.items {
                    if evaluate_interlock_condition(snapshot, item)? {
                        return Ok(true);
                    }
                }
                return Ok(false);
            }
            _ => {
                for item in &condition.items {
                    if !evaluate_interlock_condition(snapshot, item)? {
                        return Ok(false);
                    }
                }
                return Ok(true);
            }
        }
    }

    let Some(signal_id) = condition.signal_id.as_deref() else {
        return Ok(false);
    };
    let Some(operator) = condition.operator.as_deref() else {
        return Ok(false);
    };
    let Some(expected) = condition.value.as_ref() else {
        return Ok(false);
    };
    let Some(actual) = snapshot.signal_values.get(signal_id) else {
        return Ok(false);
    };

    compare_values(actual, operator, expected).map_err(|message| {
        runtime_failure(
            "interlock_compare_error",
            message,
            None,
            None,
            Some("stop".to_string()),
        )
    })
}

async fn wait_for_condition<F>(
    manager: &RecipeRuntimeManager,
    run_control: &RuntimeRunControl,
    timeout_ms: Option<u64>,
    stable_time_ms: u64,
    step_id: Option<&str>,
    action_id: Option<&str>,
    on_error: Option<String>,
    predicate: F,
) -> Result<(), RecipeRuntimeFailure>
where
    F: Fn(&super::types::RecipeRuntimeSnapshot) -> Result<bool, String>,
{
    let started = Instant::now();
    let stable_required = Duration::from_millis(stable_time_ms);
    let mut stable_since: Option<Instant> = None;
    let notifier = manager.value_changed();

    loop {
        ensure_not_stopped(run_control, step_id, action_id, on_error.as_deref())?;

        if let Some(limit) = timeout_ms {
            if started.elapsed() >= Duration::from_millis(limit) {
                return Err(runtime_failure(
                    "step_timeout",
                    format!("step timed out after {limit} ms"),
                    step_id.map(str::to_string),
                    action_id.map(str::to_string),
                    on_error.clone(),
                ));
            }
        }

        let snapshot = manager.snapshot().await;
        let satisfied = predicate(&snapshot).map_err(|message| {
            runtime_failure(
                "condition_compare_error",
                message,
                step_id.map(str::to_string),
                action_id.map(str::to_string),
                on_error.clone(),
            )
        })?;

        if satisfied {
            if stable_required.is_zero() {
                return Ok(());
            }
            if let Some(since) = stable_since {
                if since.elapsed() >= stable_required {
                    return Ok(());
                }
            } else {
                stable_since = Some(Instant::now());
            }
        } else {
            stable_since = None;
        }

        tokio::select! {
            _ = notifier.notified() => {}
            _ = tokio::time::sleep(Duration::from_millis(20)) => {}
        }
    }
}

fn ensure_not_stopped(
    run_control: &RuntimeRunControl,
    step_id: Option<&str>,
    action_id: Option<&str>,
    on_error: Option<&str>,
) -> Result<(), RecipeRuntimeFailure> {
    if run_control.is_stop_requested() {
        return Err(runtime_failure(
            "stop_requested",
            "runtime stop requested".to_string(),
            step_id.map(str::to_string),
            action_id.map(str::to_string),
            on_error.map(str::to_string),
        ));
    }

    Ok(())
}

fn compare_values(actual: &Value, operator: &str, expected: &Value) -> Result<bool, String> {
    match operator {
        "eq" => Ok(actual == expected),
        "ne" => Ok(actual != expected),
        "gt" | "ge" | "lt" | "le" => {
            let actual_number = actual
                .as_f64()
                .ok_or_else(|| "actual value is not numeric".to_string())?;
            let expected_number = expected
                .as_f64()
                .ok_or_else(|| "expected value is not numeric".to_string())?;
            Ok(match operator {
                "gt" => actual_number > expected_number,
                "ge" => actual_number >= expected_number,
                "lt" => actual_number < expected_number,
                "le" => actual_number <= expected_number,
                _ => false,
            })
        }
        other => Err(format!("unsupported operator `{other}`")),
    }
}

fn runtime_failure(
    code: &str,
    message: String,
    step_id: Option<String>,
    action_id: Option<String>,
    on_error: Option<String>,
) -> RecipeRuntimeFailure {
    RecipeRuntimeFailure {
        code: code.to_string(),
        message,
        step_id,
        action_id,
        on_error,
        timestamp_ms: now_ms(),
    }
}
