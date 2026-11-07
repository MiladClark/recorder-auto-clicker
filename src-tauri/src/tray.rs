use std::sync::Mutex;
use tauri::{
    Emitter, Manager,
    menu::MenuBuilder,
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};
#[derive(Default)]
pub struct TrayState {
    menu: Mutex<Option<tauri::menu::Menu<tauri::Wry>>>,
    snapshot: Mutex<String>,
}

pub fn initialize(app: &tauri::AppHandle) -> tauri::Result<()> {
    let menu = MenuBuilder::new(app)
        .text("open", "Open FrameCue")
        .separator()
        .text("screen", "Screen recorder")
        .text("voice", "Voice recorder")
        .text("screenshot-screen", "Capture screen")
        .text("screenshot-area", "Capture area")
        .text("clicker", "Auto-clicker")
        .text("library", "Library")
        .separator()
        .text("widgets", "Show floating controls")
        .text("screen-pause", "Pause / resume screen recording")
        .text("screen-stop", "Stop and save screen recording")
        .text("voice-pause", "Pause / resume voice recording")
        .text("voice-stop", "Stop and save voice recording")
        .text("clicker-stop", "Stop all auto-clickers")
        .separator()
        .text("quit", "Quit FrameCue")
        .build()?;
    *app.state::<TrayState>()
        .menu
        .lock()
        .unwrap_or_else(|e| e.into_inner()) = Some(menu.clone());
    let mut builder = TrayIconBuilder::with_id("framecue")
        .menu(&menu)
        .tooltip("FrameCue — ready")
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
            if matches!(
                event,
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                }
            ) {
                crate::desktop::restore(tray.app_handle());
            }
        })
        .on_menu_event(|app, event| {
            let _ = tray_action(app.clone(), event.id.as_ref().into());
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}

#[tauri::command]
pub fn minimize_to_tray(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(main) = app.get_webview_window("main") {
        main.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn tray_action(app: tauri::AppHandle, action: String) -> Result<(), String> {
    match action.as_str() {
        "open" => crate::desktop::restore(&app),
        "screen" | "voice" | "clicker" | "library" => {
            crate::desktop::restore(&app);
            let tab = if action == "screen" {
                "recorder"
            } else {
                action.as_str()
            };
            app.emit_to("main", "navigate", tab)
                .map_err(|e| e.to_string())?;
        }
        "screenshot-screen" | "screenshot-area" => {
            app.emit_to("main", "navigate", "screenshot")
                .map_err(|e| e.to_string())?;
            app.emit_to(
                "main",
                "screenshot:action",
                if action.ends_with("area") {
                    "area"
                } else {
                    "screen"
                },
            )
            .map_err(|e| e.to_string())?;
        }
        "screen-pause" | "screen-stop" => {
            crate::desktop::recording_action(
                app.clone(),
                if action.ends_with("pause") {
                    "pause"
                } else {
                    "stop"
                }
                .into(),
            )?;
        }
        "voice-pause" | "voice-stop" => {
            app.emit_to(
                "main",
                "voice:action",
                if action.ends_with("pause") {
                    "pause"
                } else {
                    "stop"
                },
            )
            .map_err(|e| e.to_string())?;
        }
        "widgets" => {
            for label in ["recorder-controls", "voice-controls", "screenshot-controls"] {
                if let Some(window) = app.get_webview_window(label) {
                    let _ = window.show();
                }
            }
        }
        "clicker-stop" => crate::autoclicker::stop_autoclicker(app.clone(), None)?,
        "quit" => {
            crate::desktop::restore(&app);
            if let Some(main) = app.get_webview_window("main") {
                main.close().map_err(|e| e.to_string())?;
            }
        }
        _ => return Err("Unknown tray action".into()),
    }
    Ok(())
}

pub fn refresh(app: &tauri::AppHandle) {
    let Some(tray) = app.tray_by_id("framecue") else {
        return;
    };
    let statuses = crate::widgets::statuses(app);
    let mut active: Vec<_> = statuses
        .iter()
        .filter_map(|(kind, status)| {
            let phase = status["phase"].as_str().unwrap_or("idle");
            if matches!(phase, "recording" | "paused" | "saving") {
                Some(format!(
                    "{}: {}",
                    if kind == "voice" { "Voice" } else { "Screen" },
                    phase
                ))
            } else {
                None
            }
        })
        .collect();
    let clicking = crate::autoclicker::get_autoclicker_status(app.clone())
        .iter()
        .any(|item| item.running);
    if clicking {
        active.push("Auto-clicker active".into());
    }
    active.sort();
    let text = if active.is_empty() {
        "FrameCue — ready".into()
    } else {
        format!("FrameCue — {}", active.join(" · "))
    };
    let is_active = |kind: &str| {
        statuses
            .get(kind)
            .and_then(|value| value["phase"].as_str())
            .is_some_and(|phase| matches!(phase, "recording" | "paused"))
    };
    let screen = is_active("recorder");
    let voice = is_active("voice");
    let widgets = ["recorder-controls", "voice-controls", "screenshot-controls"]
        .iter()
        .any(|name| app.get_webview_window(name).is_some());
    let snapshot=serde_json::json!({"tooltip":text,"screen":screen,"voice":voice,"clicker":clicking,"widgets":widgets}).to_string();
    let state = app.state::<TrayState>();
    {
        let mut previous = state.snapshot.lock().unwrap_or_else(|e| e.into_inner());
        if *previous == snapshot {
            return;
        }
        *previous = snapshot;
    }
    if let Some(menu) = state
        .menu
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .as_ref()
    {
        for (id, enabled) in [
            ("screen-pause", screen),
            ("screen-stop", screen),
            ("voice-pause", voice),
            ("voice-stop", voice),
            ("clicker-stop", clicking),
            ("widgets", widgets),
        ] {
            if let Some(item) = menu.get(id)
                && let Some(item) = item.as_menuitem()
            {
                let _ = item.set_enabled(enabled);
            }
        }
    }
    let _ = tray.set_tooltip(Some(text));
    if let Some(icon) = app.default_window_icon() {
        let mut rgba = icon.rgba().to_vec();
        if !active.is_empty() {
            let w = icon.width() as i32;
            let h = icon.height() as i32;
            let r = (w / 6).max(2);
            let cx = w - r - 1;
            let cy = h - r - 1;
            for y in (cy - r).max(0)..h {
                for x in (cx - r).max(0)..w {
                    if (x - cx).pow(2) + (y - cy).pow(2) <= r * r {
                        let i = ((y * w + x) * 4) as usize;
                        rgba[i..i + 4].copy_from_slice(&[245, 108, 97, 255]);
                    }
                }
            }
        }
        let _ = tray.set_icon(Some(tauri::image::Image::new_owned(
            rgba,
            icon.width(),
            icon.height(),
        )));
    }
}

#[tauri::command]
pub fn get_tray_state(app: tauri::AppHandle) -> serde_json::Value {
    let value = app
        .state::<TrayState>()
        .snapshot
        .lock()
        .map(|v| v.clone())
        .unwrap_or_default();
    serde_json::json!({"present":app.tray_by_id("framecue").is_some(),"state":serde_json::from_str::<serde_json::Value>(&value).unwrap_or_default()})
}
