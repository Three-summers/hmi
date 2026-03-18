use super::types::*;
use super::validation::{validate_project_resources, validate_system_bundle};
use serde::de::DeserializeOwned;
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

pub fn scan_workspace(workspace_root: &str) -> Result<CraftsmanshipWorkspaceSummary, String> {
    let root = resolve_workspace_root(workspace_root)?;
    let system = load_system_bundle(&root)?;
    let diagnostics = validate_system_bundle(&system);
    let projects_dir = require_directory(&root.join("projects"), "projects")?;
    let project_dirs = read_child_directories(&projects_dir)?;

    let mut projects = Vec::new();
    for project_dir in project_dirs {
        let project_path = project_dir.join("project.json");
        let project = read_json_file::<ProjectDefinition>(&project_path, "project definition")?;
        projects.push(project);
    }

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
    let mut diagnostics = validate_system_bundle(&system);

    let project = read_json_file::<ProjectDefinition>(
        &project_dir.join("project.json"),
        "project definition",
    )?;
    let devices = read_optional_json_collection::<DeviceInstance>(
        &project_dir.join("devices"),
        "device definitions",
        &mut diagnostics,
        "devices directory is missing; returning empty device list",
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
        &system,
        &project,
        &devices,
        &signals,
        interlocks.as_ref(),
        safe_stop.as_ref(),
        &recipes,
    ));

    Ok(CraftsmanshipProjectBundle {
        workspace_root: path_to_string(&root),
        system,
        project,
        devices,
        signals,
        interlocks,
        safe_stop,
        recipes,
        diagnostics,
    })
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

    Ok(CraftsmanshipRecipeBundle {
        workspace_root: project_bundle.workspace_root,
        system: project_bundle.system,
        project: project_bundle.project,
        devices: project_bundle.devices,
        signals: project_bundle.signals,
        interlocks: project_bundle.interlocks,
        safe_stop: project_bundle.safe_stop,
        recipe,
        related_actions,
        diagnostics: project_bundle.diagnostics,
    })
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
    if project_dir.exists() && project_dir.is_dir() {
        return Ok(project_dir);
    }

    let child_dirs = read_child_directories(&projects_dir)?;
    for child_dir in child_dirs {
        let project_json = child_dir.join("project.json");
        if !project_json.exists() {
            continue;
        }
        let project = read_json_file::<ProjectDefinition>(&project_json, "project definition")?;
        if project.id == project_id {
            return Ok(child_dir);
        }
    }

    Err(format!(
        "project `{project_id}` not found under {}",
        projects_dir.display()
    ))
}

fn path_to_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}
