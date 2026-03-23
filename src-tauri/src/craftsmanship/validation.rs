use super::types::*;
use serde_json::Value;
use std::collections::{HashMap, HashSet};

pub(super) fn validate_system_bundle(
    system: &CraftsmanshipSystemBundle,
) -> Vec<CraftsmanshipDiagnostic> {
    let mut diagnostics = Vec::new();
    let action_ids = system
        .actions
        .iter()
        .map(|action| action.id.as_str())
        .collect::<HashSet<_>>();
    let device_type_ids = system
        .device_types
        .iter()
        .map(|device_type| device_type.id.as_str())
        .collect::<HashSet<_>>();

    for action in &system.actions {
        if let Some(target_mode) = action.target_mode.as_deref() {
            if !is_valid_target_mode(target_mode) {
                diagnostics.push(diagnostic_error(
                    "action_invalid_target_mode",
                    format!(
                        "action `{}` declares unsupported targetMode `{}`",
                        action.id, target_mode
                    ),
                    Some(action.source_path.clone()),
                    Some(action.id.clone()),
                ));
            }
        }

        if matches!(action.target_mode.as_deref(), Some("required"))
            && action.allowed_device_types.is_empty()
        {
            diagnostics.push(diagnostic_error(
                "action_missing_allowed_device_types",
                format!(
                    "action `{}` requires a device but `allowedDeviceTypes` is empty",
                    action.id
                ),
                Some(action.source_path.clone()),
                Some(action.id.clone()),
            ));
        }

        for type_id in &action.allowed_device_types {
            if !device_type_ids.contains(type_id.as_str()) {
                diagnostics.push(diagnostic_error(
                    "action_unknown_device_type",
                    format!(
                        "action `{}` references unknown device type `{}`",
                        action.id, type_id
                    ),
                    Some(action.source_path.clone()),
                    Some(action.id.clone()),
                ));
            }
        }

        for parameter in &action.parameters {
            validate_action_parameter_definition(action, parameter, &mut diagnostics);
        }

        if let Some(completion) = action.completion.as_ref() {
            validate_action_completion_definition(action, completion, &mut diagnostics);
        }
    }

    for device_type in &system.device_types {
        for action_id in &device_type.allowed_actions {
            if !action_ids.contains(action_id.as_str()) {
                diagnostics.push(diagnostic_error(
                    "device_type_unknown_action",
                    format!(
                        "device type `{}` references unknown action `{}`",
                        device_type.id, action_id
                    ),
                    Some(device_type.source_path.clone()),
                    Some(device_type.id.clone()),
                ));
            }
        }
    }

    diagnostics
}

pub(super) fn validate_project_resources(
    system: &CraftsmanshipSystemBundle,
    project: &ProjectDefinition,
    devices: &[DeviceInstance],
    signals: &[SignalDefinition],
    interlocks: Option<&InterlockFile>,
    safe_stop: Option<&SafeStopDefinition>,
    recipes: &[RecipeDefinition],
) -> Vec<CraftsmanshipDiagnostic> {
    let mut diagnostics = Vec::new();
    let action_map = system
        .actions
        .iter()
        .map(|action| (action.id.as_str(), action))
        .collect::<HashMap<_, _>>();
    let device_type_map = system
        .device_types
        .iter()
        .map(|device_type| (device_type.id.as_str(), device_type))
        .collect::<HashMap<_, _>>();
    let device_map = devices
        .iter()
        .map(|device| (device.id.as_str(), device))
        .collect::<HashMap<_, _>>();
    let signal_ids = signals
        .iter()
        .map(|signal| signal.id.as_str())
        .collect::<HashSet<_>>();
    let mut used_action_ids = HashSet::new();

    for device in devices {
        if !device_type_map.contains_key(device.type_id.as_str()) {
            diagnostics.push(diagnostic_error(
                "device_unknown_type",
                format!(
                    "device `{}` in project `{}` references unknown type `{}`",
                    device.id, project.id, device.type_id
                ),
                Some(device.source_path.clone()),
                Some(device.id.clone()),
            ));
        }
    }

    if let Some(interlocks) = interlocks {
        for rule in &interlocks.rules {
            for action_id in &rule.action_ids {
                used_action_ids.insert(action_id.as_str());
                if !action_map.contains_key(action_id.as_str()) {
                    diagnostics.push(diagnostic_error(
                        "interlock_unknown_action",
                        format!(
                            "interlock rule `{}` references unknown action `{}`",
                            rule.id, action_id
                        ),
                        Some(interlocks.source_path.clone()),
                        Some(rule.id.clone()),
                    ));
                }
            }
            validate_interlock_condition(
                &rule.condition,
                &signal_ids,
                &interlocks.source_path,
                &rule.id,
                &mut diagnostics,
            );
        }
    }

    if let Some(safe_stop) = safe_stop {
        for step in &safe_stop.steps {
            used_action_ids.insert(step.action_id.as_str());
            validate_action_device_binding(
                &action_map,
                &device_type_map,
                &device_map,
                step.action_id.as_str(),
                step.device_id.as_deref(),
                &safe_stop.source_path,
                safe_stop.id.as_str(),
                "safe-stop step",
                &mut diagnostics,
            );
        }
    }

    for recipe in recipes {
        for step in &recipe.steps {
            used_action_ids.insert(step.action_id.as_str());
            validate_recipe_step(
                &action_map,
                &device_type_map,
                &device_map,
                &signal_ids,
                &recipe.source_path,
                recipe.id.as_str(),
                step,
                &mut diagnostics,
            );
        }
    }

    for action_id in used_action_ids {
        if let Some(action) = action_map.get(action_id).copied() {
            validate_action_completion_against_project(action, &signal_ids, &mut diagnostics);
        }
    }

    diagnostics
}

fn validate_recipe_step(
    action_map: &HashMap<&str, &ActionDefinition>,
    device_type_map: &HashMap<&str, &DeviceTypeDefinition>,
    device_map: &HashMap<&str, &DeviceInstance>,
    signal_ids: &HashSet<&str>,
    source_path: &str,
    recipe_id: &str,
    step: &RecipeStep,
    diagnostics: &mut Vec<CraftsmanshipDiagnostic>,
) {
    let action = if let Some(action) = action_map.get(step.action_id.as_str()) {
        *action
    } else {
        diagnostics.push(diagnostic_error(
            "recipe_unknown_action",
            format!(
                "recipe `{}` step `{}` references unknown action `{}`",
                recipe_id, step.id, step.action_id
            ),
            Some(source_path.to_string()),
            Some(step.id.clone()),
        ));
        return;
    };

    validate_action_device_binding(
        action_map,
        device_type_map,
        device_map,
        step.action_id.as_str(),
        step.device_id.as_deref(),
        source_path,
        step.id.as_str(),
        "recipe step",
        diagnostics,
    );

    let allowed_parameter_keys = action
        .parameters
        .iter()
        .map(|parameter| parameter.key.as_str())
        .collect::<HashSet<_>>();
    let required_parameter_keys = action
        .parameters
        .iter()
        .filter(|parameter| parameter.required)
        .map(|parameter| parameter.key.as_str())
        .collect::<HashSet<_>>();

    for key in step.parameters.keys() {
        if !allowed_parameter_keys.contains(key.as_str()) {
            diagnostics.push(diagnostic_error(
                "recipe_unknown_parameter",
                format!(
                    "recipe `{}` step `{}` uses parameter `{}` which is not defined by action `{}`",
                    recipe_id, step.id, key, action.id
                ),
                Some(source_path.to_string()),
                Some(step.id.clone()),
            ));
        }
    }

    for required_key in required_parameter_keys {
        if !step.parameters.contains_key(required_key) {
            diagnostics.push(diagnostic_error(
                "recipe_missing_required_parameter",
                format!(
                    "recipe `{}` step `{}` is missing required parameter `{}` for action `{}`",
                    recipe_id, step.id, required_key, action.id
                ),
                Some(source_path.to_string()),
                Some(step.id.clone()),
            ));
        }
    }

    for parameter in &action.parameters {
        if let Some(value) = step.parameters.get(&parameter.key) {
            validate_recipe_parameter_value(
                source_path,
                recipe_id,
                step,
                parameter,
                value,
                diagnostics,
            );
        }
    }

    if let Some(signal_id) = step.parameters.get("signalId").and_then(Value::as_str) {
        if !signal_ids.contains(signal_id) {
            diagnostics.push(diagnostic_error(
                "recipe_unknown_signal",
                format!(
                    "recipe `{}` step `{}` references unknown signal `{}`",
                    recipe_id, step.id, signal_id
                ),
                Some(source_path.to_string()),
                Some(step.id.clone()),
            ));
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn validate_action_device_binding(
    action_map: &HashMap<&str, &ActionDefinition>,
    device_type_map: &HashMap<&str, &DeviceTypeDefinition>,
    device_map: &HashMap<&str, &DeviceInstance>,
    action_id: &str,
    device_id: Option<&str>,
    source_path: &str,
    entity_id: &str,
    context: &str,
    diagnostics: &mut Vec<CraftsmanshipDiagnostic>,
) {
    let Some(action) = action_map.get(action_id).copied() else {
        return;
    };

    match (action.target_mode.as_deref(), device_id) {
        (Some("required"), None) => diagnostics.push(diagnostic_error(
            "missing_required_device",
            format!(
                "{context} `{entity_id}` uses action `{}` which requires `deviceId`",
                action.id
            ),
            Some(source_path.to_string()),
            Some(entity_id.to_string()),
        )),
        (Some("none"), Some(unexpected_device_id)) => diagnostics.push(diagnostic_warning(
            "unexpected_device_binding",
            format!(
                "{context} `{entity_id}` binds device `{unexpected_device_id}` but action `{}` declares `targetMode=none`",
                action.id
            ),
            Some(source_path.to_string()),
            Some(entity_id.to_string()),
        )),
        _ => {}
    }

    let Some(device_id) = device_id else {
        return;
    };

    let Some(device) = device_map.get(device_id).copied() else {
        diagnostics.push(diagnostic_error(
            "unknown_device",
            format!("{context} `{entity_id}` references unknown device `{device_id}`"),
            Some(source_path.to_string()),
            Some(entity_id.to_string()),
        ));
        return;
    };

    if !action.allowed_device_types.is_empty()
        && !action
            .allowed_device_types
            .iter()
            .any(|type_id| type_id == &device.type_id)
    {
        diagnostics.push(diagnostic_error(
            "device_type_not_allowed",
            format!(
                "{context} `{entity_id}` binds device `{}` of type `{}` but action `{}` only allows {:?}",
                device.id, device.type_id, action.id, action.allowed_device_types
            ),
            Some(source_path.to_string()),
            Some(entity_id.to_string()),
        ));
    }

    if let Some(device_type) = device_type_map.get(device.type_id.as_str()).copied() {
        if !device_type.allowed_actions.is_empty()
            && !device_type
                .allowed_actions
                .iter()
                .any(|candidate| candidate == action_id)
        {
            diagnostics.push(diagnostic_error(
                "action_not_allowed_for_device_type",
                format!(
                    "{context} `{entity_id}` binds action `{}` to device `{}` of type `{}`, but the device type does not allow this action",
                    action.id, device.id, device.type_id
                ),
                Some(source_path.to_string()),
                Some(entity_id.to_string()),
            ));
        }
    }

    if matches!(
        action
            .completion
            .as_ref()
            .and_then(|completion| completion.r#type.as_deref()),
        Some("deviceFeedback")
    ) {
        if let Some(feedback_key) = action
            .completion
            .as_ref()
            .and_then(|completion| completion.key.as_deref())
        {
            if !device.tags.contains_key(feedback_key) {
                diagnostics.push(diagnostic_error(
                    "device_feedback_key_not_defined",
                    format!(
                        "{context} `{entity_id}` uses action `{}` whose completion expects feedback key `{feedback_key}`, but device `{}` does not define it",
                        action.id, device.id
                    ),
                    Some(source_path.to_string()),
                    Some(entity_id.to_string()),
                ));
            }
        }
    }
}

fn validate_interlock_condition(
    condition: &InterlockCondition,
    signal_ids: &HashSet<&str>,
    source_path: &str,
    rule_id: &str,
    diagnostics: &mut Vec<CraftsmanshipDiagnostic>,
) {
    if let Some(operator) = condition.operator.as_deref() {
        if !is_valid_compare_operator(operator) {
            diagnostics.push(diagnostic_error(
                "interlock_invalid_operator",
                format!("interlock rule `{rule_id}` uses unsupported operator `{operator}`"),
                Some(source_path.to_string()),
                Some(rule_id.to_string()),
            ));
        }
    }

    if let Some(signal_id) = condition.signal_id.as_deref() {
        if !signal_ids.contains(signal_id) {
            diagnostics.push(diagnostic_error(
                "interlock_unknown_signal",
                format!("interlock rule `{rule_id}` references unknown signal `{signal_id}`"),
                Some(source_path.to_string()),
                Some(rule_id.to_string()),
            ));
        }
    }

    for item in &condition.items {
        validate_interlock_condition(item, signal_ids, source_path, rule_id, diagnostics);
    }
}

fn validate_action_parameter_definition(
    action: &ActionDefinition,
    parameter: &ActionParameterDefinition,
    diagnostics: &mut Vec<CraftsmanshipDiagnostic>,
) {
    if !is_valid_parameter_type(parameter.parameter_type.as_str()) {
        diagnostics.push(diagnostic_error(
            "action_invalid_parameter_type",
            format!(
                "action `{}` parameter `{}` declares unsupported type `{}`",
                action.id, parameter.key, parameter.parameter_type
            ),
            Some(action.source_path.clone()),
            Some(action.id.clone()),
        ));
        return;
    }

    if parameter.parameter_type == "enum" && parameter.options.is_empty() {
        diagnostics.push(diagnostic_error(
            "action_enum_parameter_missing_options",
            format!(
                "action `{}` parameter `{}` declares type `enum` but `options` is empty",
                action.id, parameter.key
            ),
            Some(action.source_path.clone()),
            Some(action.id.clone()),
        ));
    }

    if parameter.parameter_type == "number" {
        if parameter
            .min
            .as_ref()
            .is_some_and(|value| value.as_f64().is_none())
        {
            diagnostics.push(diagnostic_error(
                "action_parameter_invalid_min",
                format!(
                    "action `{}` parameter `{}` declares non-numeric `min`",
                    action.id, parameter.key
                ),
                Some(action.source_path.clone()),
                Some(action.id.clone()),
            ));
        }

        if parameter
            .max
            .as_ref()
            .is_some_and(|value| value.as_f64().is_none())
        {
            diagnostics.push(diagnostic_error(
                "action_parameter_invalid_max",
                format!(
                    "action `{}` parameter `{}` declares non-numeric `max`",
                    action.id, parameter.key
                ),
                Some(action.source_path.clone()),
                Some(action.id.clone()),
            ));
        }

        if let (Some(min), Some(max)) = (
            parameter.min.as_ref().and_then(Value::as_f64),
            parameter.max.as_ref().and_then(Value::as_f64),
        ) {
            if min > max {
                diagnostics.push(diagnostic_error(
                    "action_parameter_invalid_range",
                    format!(
                        "action `{}` parameter `{}` declares `min` greater than `max`",
                        action.id, parameter.key
                    ),
                    Some(action.source_path.clone()),
                    Some(action.id.clone()),
                ));
            }
        }
    }
}

fn validate_action_completion_definition(
    action: &ActionDefinition,
    completion: &ActionCompletionDefinition,
    diagnostics: &mut Vec<CraftsmanshipDiagnostic>,
) {
    match completion.r#type.as_deref() {
        None | Some("immediate") => {}
        Some("deviceFeedback") => {
            if completion.key.as_deref().is_none_or(str::is_empty) {
                diagnostics.push(diagnostic_error(
                    "action_missing_completion_key",
                    format!(
                        "action `{}` declares `completion.type=deviceFeedback` but `key` is missing",
                        action.id
                    ),
                    Some(action.source_path.clone()),
                    Some(action.id.clone()),
                ));
            }
            validate_completion_operator_and_value(action, completion, diagnostics);
        }
        Some("signalCompare") => {
            if completion.signal_id.as_deref().is_none_or(str::is_empty) {
                diagnostics.push(diagnostic_error(
                    "action_missing_completion_signal",
                    format!(
                        "action `{}` declares `completion.type=signalCompare` but `signalId` is missing",
                        action.id
                    ),
                    Some(action.source_path.clone()),
                    Some(action.id.clone()),
                ));
            }
            validate_completion_operator_and_value(action, completion, diagnostics);
        }
        Some(other) => diagnostics.push(diagnostic_error(
            "action_invalid_completion_type",
            format!(
                "action `{}` declares unsupported completion type `{}`",
                action.id, other
            ),
            Some(action.source_path.clone()),
            Some(action.id.clone()),
        )),
    }
}

fn validate_completion_operator_and_value(
    action: &ActionDefinition,
    completion: &ActionCompletionDefinition,
    diagnostics: &mut Vec<CraftsmanshipDiagnostic>,
) {
    match completion.operator.as_deref() {
        None | Some("") => diagnostics.push(diagnostic_error(
            "action_missing_completion_operator",
            format!(
                "action `{}` completion requires `operator` but it is missing",
                action.id
            ),
            Some(action.source_path.clone()),
            Some(action.id.clone()),
        )),
        Some(operator) if !is_valid_compare_operator(operator) => {
            diagnostics.push(diagnostic_error(
                "action_invalid_completion_operator",
                format!(
                    "action `{}` completion uses unsupported operator `{}`",
                    action.id, operator
                ),
                Some(action.source_path.clone()),
                Some(action.id.clone()),
            ))
        }
        _ => {}
    }

    if completion.value.is_none() {
        diagnostics.push(diagnostic_error(
            "action_missing_completion_value",
            format!(
                "action `{}` completion requires `value` but it is missing",
                action.id
            ),
            Some(action.source_path.clone()),
            Some(action.id.clone()),
        ));
    }
}

fn validate_action_completion_against_project(
    action: &ActionDefinition,
    signal_ids: &HashSet<&str>,
    diagnostics: &mut Vec<CraftsmanshipDiagnostic>,
) {
    let Some(completion) = action.completion.as_ref() else {
        return;
    };

    if matches!(completion.r#type.as_deref(), Some("signalCompare")) {
        if let Some(signal_id) = completion.signal_id.as_deref() {
            if !signal_ids.contains(signal_id) {
                diagnostics.push(diagnostic_error(
                    "action_completion_unknown_signal",
                    format!(
                        "action `{}` completion references unknown signal `{}`",
                        action.id, signal_id
                    ),
                    Some(action.source_path.clone()),
                    Some(action.id.clone()),
                ));
            }
        }
    }
}

fn validate_recipe_parameter_value(
    source_path: &str,
    recipe_id: &str,
    step: &RecipeStep,
    parameter: &ActionParameterDefinition,
    value: &Value,
    diagnostics: &mut Vec<CraftsmanshipDiagnostic>,
) {
    match parameter.parameter_type.as_str() {
        "number" => {
            let Some(number) = value.as_f64() else {
                diagnostics.push(diagnostic_error(
                    "recipe_parameter_type_mismatch",
                    format!(
                        "recipe `{}` step `{}` parameter `{}` expects type `number`",
                        recipe_id, step.id, parameter.key
                    ),
                    Some(source_path.to_string()),
                    Some(step.id.clone()),
                ));
                return;
            };

            if let Some(min) = parameter.min.as_ref().and_then(Value::as_f64) {
                if number < min {
                    diagnostics.push(diagnostic_error(
                        "recipe_parameter_value_below_min",
                        format!(
                            "recipe `{}` step `{}` parameter `{}` is below `min` ({number} < {min})",
                            recipe_id, step.id, parameter.key
                        ),
                        Some(source_path.to_string()),
                        Some(step.id.clone()),
                    ));
                }
            }

            if let Some(max) = parameter.max.as_ref().and_then(Value::as_f64) {
                if number > max {
                    diagnostics.push(diagnostic_error(
                        "recipe_parameter_value_above_max",
                        format!(
                            "recipe `{}` step `{}` parameter `{}` is above `max` ({number} > {max})",
                            recipe_id, step.id, parameter.key
                        ),
                        Some(source_path.to_string()),
                        Some(step.id.clone()),
                    ));
                }
            }
        }
        "string" => {
            if !value.is_string() {
                diagnostics.push(diagnostic_error(
                    "recipe_parameter_type_mismatch",
                    format!(
                        "recipe `{}` step `{}` parameter `{}` expects type `string`",
                        recipe_id, step.id, parameter.key
                    ),
                    Some(source_path.to_string()),
                    Some(step.id.clone()),
                ));
            }
        }
        "boolean" => {
            if !value.is_boolean() {
                diagnostics.push(diagnostic_error(
                    "recipe_parameter_type_mismatch",
                    format!(
                        "recipe `{}` step `{}` parameter `{}` expects type `boolean`",
                        recipe_id, step.id, parameter.key
                    ),
                    Some(source_path.to_string()),
                    Some(step.id.clone()),
                ));
            }
        }
        "enum" => {
            if !parameter.options.is_empty()
                && !parameter.options.iter().any(|option| option == value)
            {
                diagnostics.push(diagnostic_error(
                    "recipe_parameter_option_not_allowed",
                    format!(
                        "recipe `{}` step `{}` parameter `{}` must be one of the declared enum options",
                        recipe_id, step.id, parameter.key
                    ),
                    Some(source_path.to_string()),
                    Some(step.id.clone()),
                ));
            }
        }
        _ => {}
    }
}

fn is_valid_target_mode(value: &str) -> bool {
    matches!(value, "none" | "required")
}

fn is_valid_parameter_type(value: &str) -> bool {
    matches!(value, "number" | "string" | "boolean" | "enum")
}

fn is_valid_compare_operator(value: &str) -> bool {
    matches!(value, "eq" | "ne" | "gt" | "ge" | "lt" | "le")
}
