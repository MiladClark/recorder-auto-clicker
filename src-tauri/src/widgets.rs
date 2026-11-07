use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    sync::{
        Mutex,
        atomic::{AtomicU64, Ordering},
    },
};
use tauri::{Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindowBuilder};

#[derive(Clone, Serialize, Deserialize)]
pub struct Dock {
    pub edge: String,
    pub offset: f64,
    pub display_id: usize,
}
impl Default for Dock {
    fn default() -> Self {
        Self {
            edge: "top".into(),
            offset: 0.5,
            display_id: 0,
        }
    }
}
#[derive(Clone)]
struct Drag {
    cursor: (i32, i32),
    position: PhysicalPosition<i32>,
}
#[derive(Default)]
pub struct WidgetState {
    status: Mutex<HashMap<String, serde_json::Value>>,
    docks: Mutex<HashMap<String, Dock>>,
    drags: Mutex<HashMap<String, Drag>>,
    generation: AtomicU64,
}
pub fn label(kind: &str) -> Result<&'static str, String> {
    match kind {
        "recorder" => Ok("recorder-controls"),
        "voice" => Ok("voice-controls"),
        "screenshot" => Ok("screenshot-controls"),
        _ => Err("Unknown widget".into()),
    }
}
pub fn statuses(app: &tauri::AppHandle) -> HashMap<String, serde_json::Value> {
    app.state::<WidgetState>()
        .status
        .lock()
        .map(|v| v.clone())
        .unwrap_or_default()
}
fn cursor() -> Result<(i32, i32), String> {
    #[cfg(windows)]
    {
        let mut point = windows_sys::Win32::Foundation::POINT { x: 0, y: 0 };
        if unsafe { windows_sys::Win32::UI::WindowsAndMessaging::GetCursorPos(&mut point) } != 0 {
            return Ok((point.x, point.y));
        }
    }
    Err("Could not read pointer position".into())
}
pub fn load(app: &tauri::AppHandle) {
    if let Ok(root) = app.path().app_data_dir()
        && let Ok(bytes) = std::fs::read(root.join("widget-docks.json"))
        && let Ok(value) = serde_json::from_slice::<HashMap<String, Dock>>(&bytes)
        && let Ok(mut docks) = app.state::<WidgetState>().docks.lock()
    {
        *docks = value;
    }
}
fn save(app: &tauri::AppHandle) {
    if let Ok(root) = app.path().app_data_dir()
        && let Ok(docks) = app.state::<WidgetState>().docks.lock()
        && let Ok(bytes) = serde_json::to_vec(&*docks)
    {
        let _ = std::fs::create_dir_all(&root);
        let _ = std::fs::write(root.join("widget-docks.json"), bytes);
    }
}

fn geometry(
    area: (i32, i32, u32, u32),
    scale: f64,
    dock: &Dock,
) -> (PhysicalPosition<i32>, PhysicalSize<u32>) {
    let (x, y, w, h) = area;
    let pad = (12. * scale).round() as i32;
    let long = (346. * scale).round() as u32;
    let short = (56. * scale).round() as u32;
    let vertical = dock.edge != "top";
    let size = PhysicalSize::new(
        if vertical { short } else { long },
        if vertical { long } else { short },
    );
    let offset = if dock.offset.is_finite() {
        dock.offset.clamp(0., 1.)
    } else {
        0.5
    };
    let position = if vertical {
        PhysicalPosition::new(
            if dock.edge == "left" {
                x + pad
            } else {
                x + w as i32 - size.width as i32 - pad
            },
            y + pad
                + ((h as i32 - size.height as i32 - pad * 2).max(0) as f64 * offset).round() as i32,
        )
    } else {
        PhysicalPosition::new(
            x + pad
                + ((w as i32 - size.width as i32 - pad * 2).max(0) as f64 * offset).round() as i32,
            y + pad,
        )
    };
    (position, size)
}
fn area(monitor: &tauri::Monitor) -> (i32, i32, u32, u32) {
    let r = monitor.work_area();
    (r.position.x, r.position.y, r.size.width, r.size.height)
}
fn overlaps(a: (i32, i32, u32, u32), b: (i32, i32, u32, u32), gap: i32) -> bool {
    a.0 < b.0 + b.2 as i32 + gap
        && a.0 + a.2 as i32 + gap > b.0
        && a.1 < b.1 + b.3 as i32 + gap
        && a.1 + a.3 as i32 + gap > b.1
}

#[tauri::command]
pub fn get_widget_state(app: tauri::AppHandle, kind: String) -> Result<serde_json::Value, String> {
    label(&kind)?;
    let state = app.state::<WidgetState>();
    let status = state
        .status
        .lock()
        .map_err(|e| e.to_string())?
        .get(&kind)
        .cloned()
        .unwrap_or(serde_json::json!({"phase":"idle","seconds":0}));
    let dock = state
        .docks
        .lock()
        .map_err(|e| e.to_string())?
        .get(&kind)
        .cloned()
        .unwrap_or_default();
    Ok(serde_json::json!({"status":status,"dock":dock}))
}
#[tauri::command]
pub fn sync_widget_status(
    app: tauri::AppHandle,
    kind: String,
    status: serde_json::Value,
) -> Result<(), String> {
    let target = label(&kind)?;
    let previous = app
        .state::<WidgetState>()
        .status
        .lock()
        .map_err(|e| e.to_string())?
        .insert(kind, status.clone());
    let _ = app.emit_to(target, "widget:status", &status);
    if previous.as_ref().map(|v| &v["phase"]) != Some(&status["phase"]) {
        crate::tray::refresh(&app);
    }
    Ok(())
}
#[tauri::command]
pub async fn show_widget(
    app: tauri::AppHandle,
    kind: String,
    display_id: Option<usize>,
    minimize: bool,
) -> Result<(), String> {
    let target = label(&kind)?;
    let mut dock = app
        .state::<WidgetState>()
        .docks
        .lock()
        .map_err(|e| e.to_string())?
        .get(&kind)
        .cloned()
        .unwrap_or_default();
    if let Some(id) = display_id {
        dock.display_id = id;
    }
    if !matches!(dock.edge.as_str(), "top" | "left" | "right") {
        dock.edge = "top".into();
    }
    let monitors = app.available_monitors().map_err(|e| e.to_string())?;
    let monitor = monitors
        .get(dock.display_id)
        .or_else(|| monitors.first())
        .ok_or("No display available")?;
    if dock.display_id >= monitors.len() {
        dock.display_id = 0;
    }
    // New controls should not cover another active tool's controls.
    if app.get_webview_window(target).is_none() {
        let occupied: Vec<_> = ["recorder-controls", "voice-controls", "screenshot-controls"]
            .iter()
            .filter(|name| **name != target)
            .filter_map(|name| app.get_webview_window(name))
            .filter(|window| window.is_visible().unwrap_or(false))
            .filter_map(|window| {
                let p = window.outer_position().ok()?;
                let s = window.outer_size().ok()?;
                Some((p.x, p.y, s.width, s.height))
            })
            .collect();
        let edges = [
            dock.edge.clone(),
            "top".into(),
            "left".into(),
            "right".into(),
        ];
        'placement: for edge in edges {
            for offset in [dock.offset, 0., 1., 0.5] {
                let candidate = Dock {
                    edge: edge.clone(),
                    offset,
                    display_id: dock.display_id,
                };
                let (p, s) = geometry(area(monitor), monitor.scale_factor(), &candidate);
                if occupied.iter().all(|other| {
                    !overlaps(
                        (p.x, p.y, s.width, s.height),
                        *other,
                        (8. * monitor.scale_factor()).round() as i32,
                    )
                }) {
                    dock = candidate;
                    break 'placement;
                }
            }
        }
    }
    let (position, size) = geometry(area(monitor), monitor.scale_factor(), &dock);
    let window = if let Some(window) = app.get_webview_window(target) {
        window
    } else {
        WebviewWindowBuilder::new(&app,target,WebviewUrl::App(format!("index.html?surface=widget&kind={kind}").into()))
            .title(format!("FrameCue {kind} controls")).inner_size(346.,56.).decorations(false).resizable(false)
            .always_on_top(true).skip_taskbar(true).transparent(true).shadow(false).focused(false).visible(false)
            .additional_browser_args("--disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows")
            .build().map_err(|e|e.to_string())?
    };
    window
        .set_content_protected(true)
        .map_err(|e| e.to_string())?;
    window.set_size(size).map_err(|e| e.to_string())?;
    window.set_position(position).map_err(|e| e.to_string())?;
    app.state::<WidgetState>()
        .docks
        .lock()
        .map_err(|e| e.to_string())?
        .insert(kind, dock.clone());
    let _ = window.emit("widget:dock", &dock);
    window.show().map_err(|e| e.to_string())?;
    if minimize {
        crate::tray::minimize_to_tray(app.clone())?;
    }
    Ok(())
}
#[tauri::command]
pub fn close_widget(app: tauri::AppHandle, kind: String) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(label(&kind)?) {
        window.destroy().map_err(|e| e.to_string())?;
    }
    Ok(())
}
#[tauri::command]
pub fn begin_widget_drag(app: tauri::AppHandle, kind: String) -> Result<(), String> {
    let window = app
        .get_webview_window(label(&kind)?)
        .ok_or("Widget closed")?;
    let state = app.state::<WidgetState>();
    state.generation.fetch_add(1, Ordering::SeqCst);
    state.drags.lock().map_err(|e| e.to_string())?.insert(
        kind,
        Drag {
            cursor: cursor()?,
            position: window.outer_position().map_err(|e| e.to_string())?,
        },
    );
    Ok(())
}
#[tauri::command]
pub fn drag_widget(app: tauri::AppHandle, kind: String) -> Result<(), String> {
    let drag = app
        .state::<WidgetState>()
        .drags
        .lock()
        .map_err(|e| e.to_string())?
        .get(&kind)
        .cloned()
        .ok_or("Drag ended")?;
    let (x, y) = cursor()?;
    if let Some(window) = app.get_webview_window(label(&kind)?) {
        window
            .set_position(PhysicalPosition::new(
                drag.position.x + x - drag.cursor.0,
                drag.position.y + y - drag.cursor.1,
            ))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}
#[tauri::command]
pub async fn dock_widget(
    app: tauri::AppHandle,
    kind: String,
    edge: Option<String>,
    reduced_motion: Option<bool>,
) -> Result<Dock, String> {
    let window = app
        .get_webview_window(label(&kind)?)
        .ok_or("Widget closed")?;
    let start = window.outer_position().map_err(|e| e.to_string())?;
    let start_size = window.outer_size().map_err(|e| e.to_string())?;
    let center = (
        start.x + start_size.width as i32 / 2,
        start.y + start_size.height as i32 / 2,
    );
    let monitors = app.available_monitors().map_err(|e| e.to_string())?;
    let (id, monitor) = monitors
        .iter()
        .enumerate()
        .min_by_key(|(_, m)| {
            let (x, y, w, h) = area(m);
            let dx = (x - center.0).max(0).max(center.0 - x - w as i32) as i64;
            let dy = (y - center.1).max(0).max(center.1 - y - h as i32) as i64;
            dx * dx + dy * dy
        })
        .ok_or("No display available")?;
    let (x, y, w, h) = area(monitor);
    let chosen = match edge.as_deref() {
        Some("top" | "left" | "right") => edge.unwrap(),
        Some(_) => return Err("Choose top, left or right".into()),
        None => [
            ("top", (center.1 - y).abs()),
            ("left", (center.0 - x).abs()),
            ("right", (center.0 - x - w as i32).abs()),
        ]
        .into_iter()
        .min_by_key(|v| v.1)
        .unwrap()
        .0
        .into(),
    };
    let scale = monitor.scale_factor();
    let long = (346. * scale).round() as i32;
    let pad = (12. * scale).round() as i32;
    let offset = if chosen == "top" {
        (center.0 - x - pad - long / 2) as f64 / (w as i32 - long - pad * 2).max(1) as f64
    } else {
        (center.1 - y - pad - long / 2) as f64 / (h as i32 - long - pad * 2).max(1) as f64
    };
    let dock = Dock {
        edge: chosen,
        offset: offset.clamp(0., 1.),
        display_id: id,
    };
    let (end, size) = geometry(area(monitor), scale, &dock);
    let state = app.state::<WidgetState>();
    state.drags.lock().map_err(|e| e.to_string())?.remove(&kind);
    let generation = state.generation.fetch_add(1, Ordering::SeqCst) + 1;
    state
        .docks
        .lock()
        .map_err(|e| e.to_string())?
        .insert(kind, dock.clone());
    window
        .emit("widget:dock", &dock)
        .map_err(|e| e.to_string())?;
    let frames = if reduced_motion.unwrap_or(false) {
        1
    } else {
        16
    };
    for frame in 1..=frames {
        if app.state::<WidgetState>().generation.load(Ordering::SeqCst) != generation {
            return Ok(dock);
        }
        let t = frame as f64 / frames as f64;
        let ease = 1. - (1. - t).powi(4);
        let lerp = |a: f64, b: f64| (a + (b - a) * ease).round();
        window
            .set_size(PhysicalSize::new(
                lerp(start_size.width as f64, size.width as f64) as u32,
                lerp(start_size.height as f64, size.height as f64) as u32,
            ))
            .map_err(|e| e.to_string())?;
        window
            .set_position(PhysicalPosition::new(
                lerp(start.x as f64, end.x as f64) as i32,
                lerp(start.y as f64, end.y as f64) as i32,
            ))
            .map_err(|e| e.to_string())?;
        if frame < frames {
            tokio::time::sleep(std::time::Duration::from_millis(16)).await;
        }
    }
    save(&app);
    Ok(dock)
}
#[tauri::command]
pub fn widget_action(app: tauri::AppHandle, kind: String, action: String) -> Result<(), String> {
    let target = label(&kind)?;
    match action.as_str() {
        "restore" => {
            crate::desktop::restore(&app);
            let _ = app.emit_to("main", "navigate", &kind);
        }
        "hide" => {
            if let Some(window) = app.get_webview_window(target) {
                window.hide().map_err(|e| e.to_string())?;
            }
        }
        "start" | "pause" | "stop" if kind == "recorder" => {
            crate::desktop::recording_action(app, action)?
        }
        "start" | "pause" | "stop" if kind == "voice" => {
            app.emit_to("main", "voice:action", action)
                .map_err(|e| e.to_string())?;
        }
        "screen" | "area" if kind == "screenshot" => {
            let _ = app.emit_to("main", "navigate", "screenshot");
            app.emit_to("main", "screenshot:action", action)
                .map_err(|e| e.to_string())?;
        }
        _ => return Err("Unknown widget action".into()),
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn docks_use_work_area_and_clamp_offsets() {
        for edge in ["top", "left", "right"] {
            let dock = Dock {
                edge: edge.into(),
                offset: 2.,
                display_id: 0,
            };
            let (p, s) = geometry((-1920, -100, 1920, 1040), 1.5, &dock);
            assert!(p.x >= -1920 && p.y >= -100);
            assert!(p.x + s.width as i32 <= 0 && p.y + s.height as i32 <= 940);
            assert_eq!(s.width > s.height, edge == "top");
        }
    }
}
