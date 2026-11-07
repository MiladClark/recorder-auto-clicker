use base64::Engine;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::Manager;

#[derive(Serialize, Deserialize)]
pub struct RecordingMeta {
    pub name: String,
    pub path: String,
    pub size_bytes: u64,
    pub created_at: u64,
    pub kind: String,
}
struct RecordingSession {
    kind: String,
    file: File,
    path: PathBuf,
}
#[derive(Default)]
pub struct RecorderState(Mutex<HashMap<String, RecordingSession>>);

pub fn clean_path(path: &Path) -> String {
    let value = path.to_string_lossy();
    if let Some(unc) = value.strip_prefix(r"\\?\UNC\") {
        return format!(r"\\{}", unc);
    }
    value.strip_prefix(r"\\?\").unwrap_or(&value).to_string()
}
pub fn output_dir(app: &tauri::AppHandle, kind: &str) -> Result<PathBuf, String> {
    let base = if kind == "image" {
        app.path().picture_dir()
    } else if kind == "audio" {
        app.path().audio_dir()
    } else {
        app.path().video_dir()
    }
    .map_err(|e| format!("Could not locate the Windows media folder: {e}"))?;
    Ok(base.join("OmniPulse"))
}

#[tauri::command]
pub fn get_output_dirs(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    Ok(
        serde_json::json!({ "videos": output_dir(&app, "video")?, "pictures": output_dir(&app, "image")?, "audio": output_dir(&app,"audio")? }),
    )
}

fn validate_filename(name: &str) -> Result<(), String> {
    if name.is_empty() || name.contains(['/', '\\', ':']) || name == "." || name == ".." {
        return Err("The recording filename must be a plain filename.".into());
    }
    let extension = Path::new(name)
        .extension()
        .and_then(|v| v.to_str())
        .unwrap_or("");
    if !matches!(extension, "webm" | "mp4" | "m4a") {
        return Err("Unsupported video file type.".into());
    }
    Ok(())
}

fn remember_folder(app: &tauri::AppHandle, folder: &Path) -> Result<(), String> {
    let root = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    let manifest = root.join("capture-folders.json");
    let mut folders: Vec<PathBuf> = std::fs::read(&manifest)
        .ok()
        .and_then(|v| serde_json::from_slice(&v).ok())
        .unwrap_or_default();
    if !folders.iter().any(|path| path == folder) {
        folders.push(folder.to_path_buf());
    }
    let data = serde_json::to_vec(&folders).map_err(|e| e.to_string())?;
    std::fs::write(manifest, data).map_err(|e| format!("Could not index the capture folder: {e}"))
}

#[tauri::command]
pub fn begin_recording(
    app: tauri::AppHandle,
    state: tauri::State<'_, RecorderState>,
    filename: String,
    custom_dir: Option<String>,
    kind: Option<String>,
) -> Result<String, String> {
    validate_filename(&filename)?;
    let kind = kind.unwrap_or_else(|| "video".into());
    if !matches!(kind.as_str(), "video" | "audio") {
        return Err("Unsupported recording type.".into());
    }
    let mut session = state.0.lock().map_err(|e| e.to_string())?;
    if session.values().any(|value| value.kind == kind) {
        return Err("Another recording is still being saved.".into());
    }
    let folder = match custom_dir {
        Some(path) if !path.trim().is_empty() => PathBuf::from(path),
        _ => output_dir(&app, &kind)?,
    };
    std::fs::create_dir_all(&folder)
        .map_err(|e| format!("Cannot create the recording folder: {e}"))?;
    let folder = folder.canonicalize().map_err(|e| e.to_string())?;
    remember_folder(&app, &folder)?;
    // Grant previews only for directories the user actually selected.
    app.asset_protocol_scope()
        .allow_directory(&folder, true)
        .map_err(|e| e.to_string())?;
    let path = folder.join(filename);
    let file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
        .map_err(|e| format!("Cannot create the recording file: {e}"))?;
    let id = format!("{:016x}", rand::random::<u64>());
    session.insert(id.clone(), RecordingSession { kind, file, path });
    Ok(id)
}

fn decode_chunk(value: &str) -> Result<Vec<u8>, String> {
    let clean = value
        .rsplit_once(',')
        .map(|(_, data)| data)
        .unwrap_or(value);
    base64::engine::general_purpose::STANDARD
        .decode(clean)
        .map_err(|e| format!("Invalid recording data: {e}"))
}

#[tauri::command]
pub fn append_recording(
    state: tauri::State<'_, RecorderState>,
    session_id: String,
    data_base64: String,
) -> Result<(), String> {
    let bytes = decode_chunk(&data_base64)?;
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    let session = guard
        .get_mut(&session_id)
        .ok_or("This recording session has ended.")?;
    session
        .file
        .write_all(&bytes)
        .map_err(|e| format!("Could not write recording data: {e}"))
}

#[tauri::command]
pub fn finish_recording(
    app: tauri::AppHandle,
    state: tauri::State<'_, RecorderState>,
    session_id: String,
) -> Result<String, String> {
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    let session = guard
        .remove(&session_id)
        .ok_or("Unknown recording session.")?;
    session
        .file
        .sync_all()
        .map_err(|e| format!("Could not finalize recording: {e}"))?;
    let empty = session
        .file
        .metadata()
        .map(|value| value.len() == 0)
        .unwrap_or(false);
    drop(session.file);
    if empty {
        let _ = std::fs::remove_file(&session.path);
    }
    if !empty {
        let root = app.path().app_data_dir().map_err(|e| e.to_string())?;
        let index = root.join("capture-kinds.json");
        let mut kinds: HashMap<String, String> = std::fs::read(&index)
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default();
        kinds.insert(clean_path(&session.path), session.kind);
        std::fs::write(
            index,
            serde_json::to_vec(&kinds).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(clean_path(&session.path))
}

#[tauri::command]
pub fn list_recordings(app: tauri::AppHandle) -> Result<Vec<RecordingMeta>, String> {
    let mut folders = vec![
        output_dir(&app, "video")?,
        output_dir(&app, "image")?,
        output_dir(&app, "audio")?,
    ];
    let kinds: HashMap<String, String> = app
        .path()
        .app_data_dir()
        .ok()
        .and_then(|root| std::fs::read(root.join("capture-kinds.json")).ok())
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default();
    if let Ok(root) = app.path().app_data_dir()
        && let Ok(data) = std::fs::read(root.join("capture-folders.json"))
        && let Ok(extra) = serde_json::from_slice::<Vec<PathBuf>>(&data)
    {
        folders.extend(extra);
    }
    let mut seen = std::collections::HashSet::new();
    let mut list = Vec::new();
    for folder in folders {
        if !folder.exists() {
            continue;
        }
        let folder = folder.canonicalize().map_err(|e| e.to_string())?;
        if !seen.insert(folder.clone()) {
            continue;
        }
        app.asset_protocol_scope()
            .allow_directory(&folder, true)
            .map_err(|e| e.to_string())?;
        let entries = std::fs::read_dir(&folder)
            .map_err(|e| format!("Could not read {}: {e}", folder.display()))?;
        for entry in entries {
            let entry = entry.map_err(|e| e.to_string())?;
            let path = entry.path();
            let metadata = entry.metadata().map_err(|e| e.to_string())?;
            if !metadata.is_file() || metadata.len() == 0 {
                continue;
            }
            let extension = path
                .extension()
                .and_then(|v| v.to_str())
                .unwrap_or("")
                .to_ascii_lowercase();
            let kind = match extension.as_str() {
                "m4a" => "audio",
                "mp4" | "webm" => "video",
                "png" => "image",
                _ => continue,
            };
            let created_at = metadata
                .created()
                .or_else(|_| metadata.modified())
                .ok()
                .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|value| value.as_secs())
                .unwrap_or(0);
            list.push(RecordingMeta {
                name: entry.file_name().to_string_lossy().to_string(),
                path: clean_path(&path),
                size_bytes: metadata.len(),
                created_at,
                kind: kinds
                    .get(&clean_path(&path))
                    .cloned()
                    .unwrap_or_else(|| kind.into()),
            });
        }
    }
    let hidden = hidden_paths(&app);
    list.retain(|file| !hidden.contains(&file.path));
    list.sort_by(|a, b| {
        b.created_at
            .cmp(&a.created_at)
            .then_with(|| b.name.cmp(&a.name))
    });
    Ok(list)
}

fn hidden_paths(app: &tauri::AppHandle) -> std::collections::HashSet<String> {
    app.path()
        .app_data_dir()
        .ok()
        .and_then(|root| std::fs::read(root.join("hidden-captures.json")).ok())
        .and_then(|v| serde_json::from_slice(&v).ok())
        .unwrap_or_default()
}
#[tauri::command]
pub fn remove_capture(
    app: tauri::AppHandle,
    file_path: String,
    delete_file: bool,
) -> Result<(), String> {
    let requested = PathBuf::from(&file_path)
        .canonicalize()
        .map_err(|e| e.to_string())?;
    // Limit deletion to files already indexed in the user's capture library.
    let file = list_recordings(app.clone())?
        .into_iter()
        .find(|f| PathBuf::from(&f.path).canonicalize().ok().as_ref() == Some(&requested))
        .ok_or("This file is not in the capture library.")?;
    if delete_file {
        std::fs::remove_file(&file.path).map_err(|e| format!("Could not delete capture: {e}"))?;
    } else {
        let mut hidden = hidden_paths(&app);
        hidden.insert(file.path);
        let root = app.path().app_data_dir().map_err(|e| e.to_string())?;
        std::fs::create_dir_all(&root).map_err(|e| e.to_string())?;
        std::fs::write(
            root.join("hidden-captures.json"),
            serde_json::to_vec(&hidden).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}
#[tauri::command]
pub fn restore_library(app: tauri::AppHandle) -> Result<(), String> {
    let path = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("hidden-captures.json");
    if path.exists() {
        std::fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn open_file_in_explorer(file_path: String) -> Result<(), String> {
    let path = PathBuf::from(&file_path);
    if !path.exists() {
        return Err("This capture no longer exists on disk.".into());
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        std::process::Command::new("explorer.exe")
            .raw_arg(format!("/select,\"{}\"", path.display()))
            .spawn()
            .map_err(|e| format!("Could not open Explorer: {e}"))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_paths_and_unsupported_extensions() {
        for value in [
            "../test.webm",
            "C:\\test.webm",
            "dir/test.mp4",
            "test.exe",
            "",
        ] {
            assert!(validate_filename(value).is_err(), "{value}");
        }
        assert!(validate_filename("Recording_2026-11-06.webm").is_ok());
        assert!(validate_filename("Recording.mp4").is_ok());
    }
    #[test]
    fn decodes_raw_and_data_url_chunks_without_changing_bytes() {
        assert_eq!(decode_chunk("AAECAw==").unwrap(), vec![0, 1, 2, 3]);
        assert_eq!(
            decode_chunk("data:video/webm;base64,AAECAw==").unwrap(),
            vec![0, 1, 2, 3]
        );
        assert_eq!(
            decode_chunk("data:video/webm;codecs=vp9,opus;base64,AAECAw==").unwrap(),
            vec![0, 1, 2, 3]
        );
        assert!(decode_chunk("invalid!").is_err());
    }
}
