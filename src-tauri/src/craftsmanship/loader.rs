use super::types::*;
use super::validation::{
    validate_project_resources, validate_system_bundle, validate_workspace_projects,
};
use serde::de::DeserializeOwned;
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

pub fn scan_workspace(workspace_root: &str) -> Result<CraftsmanshipWorkspaceSummary, String> {
    let root = resolve_workspace_root(workspace_root)?;
    let system = load_system_bundle(&root)?;
    let mut diagnostics = validate_system_bundle(&system);
    let projects_dir = require_directory(&root.join("projects"), "projects")?;
    let project_dirs = read_child_directories(&projects_dir)?;

    let mut projects = Vec::new();
    for project_dir in project_dirs {
        let bundle = load_project_bundle_from_dir(&root, &system, &project_dir, Vec::new())?;
        diagnostics.extend(bundle.diagnostics);
        projects.push(bundle.project);
    }
    diagnostics.extend(validate_workspace_projects(&projects));

    Ok(CraftsmanshipWorkspaceSummary {
        workspace_root: path_to_string(&root),
        system,
        projects,
        diagnostics,
    })
}

pub fn get_project_bundle(
    workspace_root: &str,
    project_id: &str,
) -> Result<CraftsmanshipProjectBundle, String> {
    let root = resolve_workspace_root(workspace_root)?;
    let system = load_system_bundle(&root)?;
    let project_dir = find_project_dir(&root, project_id)?;
    load_project_bundle_from_dir(
        &root,
        &system,
        &project_dir,
        validate_system_bundle(&system),
    )
}

pub fn get_recipe_bundle(
    workspace_root: &str,
    project_id: &str,
    recipe_id: &str,
) -> Result<CraftsmanshipRecipeBundle, String> {
    let project_bundle = get_project_bundle(workspace_root, project_id)?;
    let recipe = project_bundle
        .recipes
        .iter()
        .find(|candidate| candidate.id == recipe_id)
        .cloned()
        .ok_or_else(|| {
            format!(
                "recipe `{recipe_id}` not found in project `{}`",
                project_bundle.project.id
            )
        })?;

    let action_ids: HashSet<&str> = recipe
        .steps
        .iter()
        .map(|step| step.action_id.as_str())
        .collect();
    let related_actions = project_bundle
        .system
        .actions
        .iter()
        .filter(|action| action_ids.contains(action.id.as_str()))
        .cloned()
        .collect::<Vec<_>>();
    let diagnostics = filter_recipe_diagnostics(&project_bundle, &recipe);

    Ok(CraftsmanshipRecipeBundle {
        workspace_root: project_bundle.workspace_root,
        system: project_bundle.system,
        project: project_bundle.project,
        connections: project_bundle.connections,
        devices: project_bundle.devices,
        feedback_mappings: project_bundle.feedback_mappings,
        signals: project_bundle.signals,
        interlocks: project_bundle.interlocks,
        safe_stop: project_bundle.safe_stop,
        recipe,
        related_actions,
        diagnostics,
    })
}

fn filter_recipe_diagnostics(
    project_bundle: &CraftsmanshipProjectBundle,
    recipe: &RecipeDefinition,
) -> Vec<CraftsmanshipDiagnostic> {
    let mut relevant_paths = HashSet::from([
        project_bundle.project.source_path.clone(),
        recipe.source_path.clone(),
    ]);
    let recipe_action_ids = recipe
        .steps
        .iter()
        .map(|step| step.action_id.clone())
        .collect::<HashSet<_>>();
    let mut relevant_action_ids = recipe_action_ids.clone();
    let mut relevant_device_ids = recipe
        .steps
        .iter()
        .filter_map(|step| step.device_id.clone())
        .collect::<HashSet<_>>();
    let mut relevant_device_type_ids = HashSet::new();
    let mut relevant_connection_ids = HashSet::new();
    let mut relevant_signal_ids = recipe
        .steps
        .iter()
        .filter_map(|step| {
            step.parameters
                .get("signalId")
                .and_then(serde_json::Value::as_str)
                .map(str::to_string)
        })
        .collect::<HashSet<_>>();
    let mut relevant_interlock_rule_ids = HashSet::new();

    if let Some(safe_stop) = project_bundle.safe_stop.as_ref() {
        relevant_paths.insert(safe_stop.source_path.clone());
        for step in &safe_stop.steps {
            relevant_action_ids.insert(step.action_id.clone());
            if let Some(device_id) = step.device_id.clone() {
                relevant_device_ids.insert(device_id);
            }
        }
    }

    if let Some(interlocks) = project_bundle.interlocks.as_ref() {
        for rule in &interlocks.rules {
            if rule
                .action_ids
                .iter()
                .any(|action_id| recipe_action_ids.contains(action_id))
            {
                relevant_interlock_rule_ids.insert(rule.id.clone());
                collect_condition_signal_ids(&rule.condition, &mut relevant_signal_ids);
            }
        }
    }

    for action in &project_bundle.system.actions {
        if relevant_action_ids.contains(&action.id) {
            relevant_paths.insert(action.source_path.clone());
            if let Some(signal_id) = action
                .completion
                .as_ref()
                .and_then(|completion| completion.signal_id.clone())
            {
                relevant_signal_ids.insert(signal_id);
            }
        }
    }

    for device in &project_bundle.devices {
        if relevant_device_ids.contains(&device.id) {
            relevant_paths.insert(device.source_path.clone());
            relevant_device_type_ids.insert(device.type_id.clone());
            if let Some(connection_id) = device
                .transport
                .as_ref()
                .and_then(|transport| transport.connection_id.clone())
            {
                relevant_connection_ids.insert(connection_id);
            }
        }
    }

    for device_type in &project_bundle.system.device_types {
        if relevant_device_type_ids.contains(&device_type.id) {
            relevant_paths.insert(device_type.source_path.clone());
        }
    }

    for connection in &project_bundle.connections {
        if relevant_connection_ids.contains(&connection.id) {
            relevant_paths.insert(connection.source_path.clone());
        }
    }

    for signal in &project_bundle.signals {
        if relevant_signal_ids.contains(&signal.id) {
            relevant_paths.insert(signal.source_path.clone());
        }
    }

    for mapping in &project_bundle.feedback_mappings {
        let targets_relevant_signal = mapping
            .target
            .signal_id
            .as_ref()
            .is_some_and(|signal_id| relevant_signal_ids.contains(signal_id));
        let targets_relevant_device = mapping
            .target
            .device_id
            .as_ref()
            .is_some_and(|device_id| relevant_device_ids.contains(device_id));
        if targets_relevant_signal || targets_relevant_device {
            relevant_paths.insert(mapping.source_path.clone());
        }
    }

    let interlocks_source_path = project_bundle
        .interlocks
        .as_ref()
        .map(|interlocks| interlocks.source_path.as_str());

    project_bundle
        .diagnostics
        .iter()
        .filter(|diagnostic| {
            if diagnostic.level != "error" {
                return true;
            }

            if diagnostic.source_path.as_deref() == interlocks_source_path {
                return diagnostic
                    .entity_id
                    .as_ref()
                    .is_some_and(|entity_id| relevant_interlock_rule_ids.contains(entity_id));
            }

            diagnostic
                .source_path
                .as_ref()
                .is_some_and(|source_path| relevant_paths.contains(source_path))
        })
        .cloned()
        .collect()
}

fn collect_condition_signal_ids(condition: &InterlockCondition, signal_ids: &mut HashSet<String>) {
    if let Some(signal_id) = condition.signal_id.as_ref() {
        signal_ids.insert(signal_id.clone());
    }

    for item in &condition.items {
        collect_condition_signal_ids(item, signal_ids);
    }
}

fn resolve_workspace_root(workspace_root: &str) -> Result<PathBuf, String> {
    let trimmed = workspace_root.trim();
    if trimmed.is_empty() {
        return Err("workspace_root is empty".to_string());
    }

    let path = PathBuf::from(trimmed);
    if !path.exists() {
        return Err(format!("workspace root does not exist: {}", path.display()));
    }
    if !path.is_dir() {
        return Err(format!(
            "workspace root is not a directory: {}",
            path.display()
        ));
    }
    Ok(path)
}

fn load_project_bundle_from_dir(
    root: &Path,
    system: &CraftsmanshipSystemBundle,
    project_dir: &Path,
    mut diagnostics: Vec<CraftsmanshipDiagnostic>,
) -> Result<CraftsmanshipProjectBundle, String> {
    let project = read_json_file::<ProjectDefinition>(
        &project_dir.join("project.json"),
        "project definition",
    )?;
    let connections = read_optional_json_collection::<ConnectionDefinition>(
        &project_dir.join("connections"),
        "connection definitions",
        &mut diagnostics,
        "connections directory is missing; returning empty connection list",
    )?;
    let devices = read_optional_json_collection::<DeviceInstance>(
        &project_dir.join("devices"),
        "device definitions",
        &mut diagnostics,
        "devices directory is missing; returning empty device list",
    )?;
    let feedback_mappings = read_optional_json_collection::<FeedbackMappingDefinition>(
        &project_dir.join("feedback-mappings"),
        "feedback mapping definitions",
        &mut diagnostics,
        "feedback-mappings directory is missing; returning empty feedback mapping list",
    )?;
    let signals = read_optional_json_collection::<SignalDefinition>(
        &project_dir.join("signals"),
        "signal definitions",
        &mut diagnostics,
        "signals directory is missing; returning empty signal list",
    )?;
    let interlocks = read_optional_json_file::<InterlockFile>(
        &project_dir.join("safety").join("interlocks.json"),
        "interlock definitions",
        &mut diagnostics,
        "interlocks.json is missing; returning no interlock rules",
    )?;
    let mut safe_stop = read_optional_json_file::<SafeStopDefinition>(
        &project_dir.join("safety").join("safe-stop.json"),
        "safe-stop definition",
        &mut diagnostics,
        "safe-stop.json is missing; returning no safe-stop plan",
    )?;
    if let Some(ref mut safe_stop) = safe_stop {
        safe_stop.steps.sort_by_key(|step| step.seq);
    }
    let mut recipes = read_optional_json_collection::<RecipeDefinition>(
        &project_dir.join("recipes"),
        "recipe definitions",
        &mut diagnostics,
        "recipes directory is missing; returning empty recipe list",
    )?;
    for recipe in &mut recipes {
        recipe.steps.sort_by_key(|step| step.seq);
    }

    diagnostics.extend(validate_project_resources(
        system,
        &project,
        &connections,
        &devices,
        &feedback_mappings,
        &signals,
        interlocks.as_ref(),
        safe_stop.as_ref(),
        &recipes,
    ));

    Ok(CraftsmanshipProjectBundle {
        workspace_root: path_to_string(root),
        system: system.clone(),
        project,
        connections,
        devices,
        feedback_mappings,
        signals,
        interlocks,
        safe_stop,
        recipes,
        diagnostics,
    })
}

fn load_system_bundle(workspace_root: &Path) -> Result<CraftsmanshipSystemBundle, String> {
    let system_dir = require_directory(&workspace_root.join("system"), "system")?;
    let actions_dir = require_directory(&system_dir.join("actions"), "system/actions")?;
    let device_types_dir =
        require_directory(&system_dir.join("device-types"), "system/device-types")?;
    let schemas_dir = system_dir.join("schemas");

    let actions = read_json_collection::<ActionDefinition>(&actions_dir, "action definitions")?;
    let device_types =
        read_json_collection::<DeviceTypeDefinition>(&device_types_dir, "device type definitions")?;
    let schemas = if schemas_dir.exists() {
        list_json_file_paths(&schemas_dir)?
    } else {
        Vec::new()
    };

    Ok(CraftsmanshipSystemBundle {
        actions,
        device_types,
        schemas,
    })
}

fn require_directory(path: &Path, label: &str) -> Result<PathBuf, String> {
    if !path.exists() {
        return Err(format!(
            "{label} directory does not exist: {}",
            path.display()
        ));
    }
    if !path.is_dir() {
        return Err(format!("{label} is not a directory: {}", path.display()));
    }
    Ok(path.to_path_buf())
}

fn read_child_directories(path: &Path) -> Result<Vec<PathBuf>, String> {
    let mut directories = fs::read_dir(path)
        .map_err(|error| format!("failed to read directory `{}`: {error}", path.display()))?
        .filter_map(|entry| entry.ok().map(|item| item.path()))
        .filter(|item| item.is_dir())
        .collect::<Vec<_>>();
    directories.sort();
    Ok(directories)
}

fn read_json_collection<T>(path: &Path, label: &str) -> Result<Vec<T>, String>
where
    T: DeserializeOwned + HasSourcePath,
{
    let mut files = list_json_files(path)?;
    let mut items = Vec::with_capacity(files.len());
    for file in files.drain(..) {
        items.push(read_json_file::<T>(&file, label)?);
    }
    Ok(items)
}

fn read_optional_json_collection<T>(
    path: &Path,
    label: &str,
    diagnostics: &mut Vec<CraftsmanshipDiagnostic>,
    missing_message: &str,
) -> Result<Vec<T>, String>
where
    T: DeserializeOwned + HasSourcePath,
{
    if !path.exists() {
        diagnostics.push(diagnostic_warning(
            "missing_directory",
            missing_message.to_string(),
            Some(path_to_string(path)),
            None,
        ));
        return Ok(Vec::new());
    }
    if !path.is_dir() {
        return Err(format!("{label} is not a directory: {}", path.display()));
    }
    read_json_collection(path, label)
}

fn read_optional_json_file<T>(
    path: &Path,
    label: &str,
    diagnostics: &mut Vec<CraftsmanshipDiagnostic>,
    missing_message: &str,
) -> Result<Option<T>, String>
where
    T: DeserializeOwned + HasSourcePath,
{
    if !path.exists() {
        diagnostics.push(diagnostic_warning(
            "missing_file",
            missing_message.to_string(),
            Some(path_to_string(path)),
            None,
        ));
        return Ok(None);
    }
    Ok(Some(read_json_file(path, label)?))
}

fn read_json_file<T>(path: &Path, label: &str) -> Result<T, String>
where
    T: DeserializeOwned + HasSourcePath,
{
    let raw = fs::read_to_string(path)
        .map_err(|error| format!("failed to read {label} `{}`: {error}", path.display()))?;
    let mut parsed = serde_json::from_str::<T>(&raw)
        .map_err(|error| format!("failed to parse {label} `{}`: {error}", path.display()))?;
    parsed.set_source_path(path_to_string(path));
    Ok(parsed)
}

fn list_json_files(path: &Path) -> Result<Vec<PathBuf>, String> {
    let mut files = fs::read_dir(path)
        .map_err(|error| format!("failed to read directory `{}`: {error}", path.display()))?
        .filter_map(|entry| entry.ok().map(|item| item.path()))
        .filter(|item| item.is_file() && item.extension().is_some_and(|ext| ext == "json"))
        .collect::<Vec<_>>();
    files.sort();
    Ok(files)
}

fn list_json_file_paths(path: &Path) -> Result<Vec<String>, String> {
    Ok(list_json_files(path)?
        .into_iter()
        .map(|file| path_to_string(&file))
        .collect())
}

fn find_project_dir(workspace_root: &Path, project_id: &str) -> Result<PathBuf, String> {
    let projects_dir = require_directory(&workspace_root.join("projects"), "projects")?;
    let project_dir = projects_dir.join(project_id);
    let child_dirs = read_child_directories(&projects_dir)?;
    let mut direct_dir_mismatch = None;
    let mut direct_parse_error = None;
    let mut matching_dirs = Vec::new();

    if project_dir.exists() && project_dir.is_dir() {
        let project_json = project_dir.join("project.json");
        if project_json.exists() {
            match read_json_file::<ProjectDefinition>(&project_json, "project definition") {
                Ok(project) => {
                    if project.id == project_id {
                        matching_dirs.push(project_dir.clone());
                    } else {
                        direct_dir_mismatch = Some(project.id);
                    }
                }
                Err(error) => {
                    direct_parse_error = Some(error);
                }
            }
        }
    }

    let mut sibling_parse_error = None;

    for child_dir in child_dirs {
        if child_dir == project_dir {
            continue;
        }
        let project_json = child_dir.join("project.json");
        if !project_json.exists() {
            continue;
        }
        match read_json_file::<ProjectDefinition>(&project_json, "project definition") {
            Ok(project) => {
                if project.id == project_id {
                    matching_dirs.push(child_dir);
                }
            }
            Err(error) => {
                if sibling_parse_error.is_none() {
                    sibling_parse_error = Some(error);
                }
            }
        }
    }

    if matching_dirs.len() > 1 {
        let matching_paths = matching_dirs
            .iter()
            .map(|path| path.display().to_string())
            .collect::<Vec<_>>()
            .join(", ");
        return Err(format!(
            "project `{project_id}` is ambiguous; multiple directories declare this id: {matching_paths}"
        ));
    }

    if let Some(project_dir) = matching_dirs.into_iter().next() {
        return Ok(project_dir);
    }

    if let Some(actual_id) = direct_dir_mismatch {
        return Err(format!(
            "project directory `{}` exists, but project.json declares id `{actual_id}` instead of `{project_id}`",
            project_dir.display()
        ));
    }

    if let Some(error) = direct_parse_error {
        return Err(error);
    }

    if let Some(error) = sibling_parse_error {
        return Err(error);
    }

    Err(format!(
        "project `{project_id}` not found under {}",
        projects_dir.display()
    ))
}

fn path_to_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}
