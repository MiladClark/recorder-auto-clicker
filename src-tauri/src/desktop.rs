use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindowBuilder};

#[derive(Clone, Serialize)]
pub struct Display {
    pub id: usize,
    pub name: String,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub scale: f64,
}
#[derive(Clone, Serialize)]
pub struct Selection {
    pub display: Display,
    pub image: crate::screenshot::ScreenCaptureResult,
    pub purpose: String,
}
#[derive(Default)]
pub struct DesktopState {
    selection: Mutex<Option<Selection>>,
    recording: Mutex<serde_json::Value>,
}
#[tauri::command]
pub fn get_displays(app: tauri::AppHandle) -> Result<Vec<Display>, String> {
    Ok(app
        .available_monitors()
        .map_err(|e| e.to_string())?
        .iter()
        .enumerate()
        .map(|(id, monitor)| Display {
            id,
            name: monitor
                .name()
                .map(|name| {
                    name.trim_start_matches(r"\\.\")
                        .replace("DISPLAY", "Display ")
                })
                .unwrap_or_else(|| format!("Display {}", id + 1)),
            x: monitor.position().x,
            y: monitor.position().y,
            width: monitor.size().width,
            height: monitor.size().height,
            scale: monitor.scale_factor(),
        })
        .collect())
}
fn display(app: &tauri::AppHandle, id: usize) -> Result<Display, String> {
    get_displays(app.clone())?
        .into_iter()
        .find(|d| d.id == id)
        .ok_or("Display disconnected. Refresh and choose a display.".into())
}
pub fn restore(app: &tauri::AppHandle) {
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.show();
        let _ = main.unminimize();
        let _ = main.set_focus();
    }
}
#[tauri::command]
pub async fn capture_display(
    app: tauri::AppHandle,
    display_id: usize,
    region: bool,
    purpose: Option<String>,
) -> Result<Option<crate::screenshot::ScreenCaptureResult>, String> {
    let monitor = display(&app, display_id)?;
    if app
        .state::<DesktopState>()
        .selection
        .lock()
        .map_err(|e| e.to_string())?
        .is_some()
    {
        return Err("Finish the current selection first.".into());
    }
    if let Some(main) = app.get_webview_window("main") {
        main.hide().map_err(|e| e.to_string())?;
    }
    tokio::time::sleep(std::time::Duration::from_millis(250)).await;
    let bounds = monitor.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        crate::screenshot::capture_rect(bounds.x, bounds.y, bounds.width, bounds.height)
    })
    .await
    .map_err(|e| e.to_string())
    .and_then(|v| v);
    let image = match result {
        Ok(value) => value,
        Err(error) => {
            restore(&app);
            return Err(error);
        }
    };
    if !region {
        restore(&app);
        return Ok(Some(image));
    }
    *app.state::<DesktopState>()
        .selection
        .lock()
        .map_err(|e| e.to_string())? = Some(Selection {
        display: monitor.clone(),
        image,
        purpose: purpose.unwrap_or_else(|| "screenshot".into()),
    });
    let result = (|| -> Result<(), String> {
        let overlay = WebviewWindowBuilder::new(
            &app,
            "selection",
            WebviewUrl::App("index.html?surface=selection".into()),
        )
        .title("Select area")
        .shadow(false)
        .additional_browser_args("--disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows")
        .decorations(false)
        .resizable(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible(false)
        .build()
        .map_err(|e| e.to_string())?;
        overlay
            .set_position(PhysicalPosition::new(monitor.x, monitor.y))
            .map_err(|e| e.to_string())?;
        overlay
            .set_size(PhysicalSize::new(monitor.width, monitor.height))
            .map_err(|e| e.to_string())?;
        let handle = app.clone();
        overlay.on_window_event(move |event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                if let Ok(mut selection) = handle.state::<DesktopState>().selection.lock() {
                    *selection = None;
                }
                restore(&handle);
                let _ = handle.emit_to("main", "capture:closed", ());
            }
        });
        overlay.show().map_err(|e| e.to_string())?;
        overlay.set_focus().map_err(|e| e.to_string())?;
        Ok(())
    })();
    if let Err(error) = result {
        let _ = cancel_selection(app.clone());
        return Err(error);
    }
    Ok(None)
}
#[tauri::command]
pub fn get_selection(app: tauri::AppHandle) -> Result<Selection, String> {
    app.state::<DesktopState>()
        .selection
        .lock()
        .map_err(|e| e.to_string())?
        .clone()
        .ok_or("Selection expired.".into())
}
#[derive(Deserialize)]
pub struct Region {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}
fn pixel_region(region: &Region, width: u32, height: u32) -> Result<(u32, u32, u32, u32), String> {
    if [region.x, region.y, region.w, region.h]
        .iter()
        .any(|v| !v.is_finite())
        || region.x < 0.
        || region.y < 0.
        || region.w <= 0.
        || region.h <= 0.
        || region.x + region.w > 1.00001
        || region.y + region.h > 1.00001
    {
        return Err("Invalid selection.".into());
    }
    let x = (region.x * width as f64).floor() as u32;
    let y = (region.y * height as f64).floor() as u32;
    let w = ((region.w * width as f64).round() as u32).min(width.saturating_sub(x));
    let h = ((region.h * height as f64).round() as u32).min(height.saturating_sub(y));
    if w < 2 || h < 2 {
        return Err("Select a larger area.".into());
    }
    Ok((x, y, w, h))
}
#[tauri::command]
pub fn complete_selection(app: tauri::AppHandle, region: Region) -> Result<(), String> {
    use base64::Engine;
    let selection = app
        .state::<DesktopState>()
        .selection
        .lock()
        .map_err(|e| e.to_string())?
        .clone()
        .ok_or("Selection expired.")?;
    let (x, y, w, h) = pixel_region(&region, selection.image.width, selection.image.height)?;
    if selection.purpose == "recording" {
        cancel_selection(app.clone())?;
        app.emit_to(
            "main",
            "capture:region",
            serde_json::json!({"x":region.x,"y":region.y,"w":region.w,"h":region.h}),
        )
        .map_err(|e| e.to_string())?;
        return Ok(());
    } else {
        let encoded = selection
            .image
            .data_url
            .split_once(',')
            .ok_or("Invalid capture.")?
            .1;
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(encoded)
            .map_err(|e| e.to_string())?;
        let image = image::load_from_memory(&bytes)
            .map_err(|e| e.to_string())?
            .crop_imm(x, y, w, h);
        let mut png = std::io::Cursor::new(Vec::new());
        image
            .write_to(&mut png, image::ImageFormat::Png)
            .map_err(|e| e.to_string())?;
        let result = crate::screenshot::ScreenCaptureResult {
            data_url: format!(
                "data:image/png;base64,{}",
                base64::engine::general_purpose::STANDARD.encode(png.into_inner())
            ),
            width: w,
            height: h,
        };
        app.emit_to("main", "capture:result", result)
            .map_err(|e| e.to_string())?;
    }
    cancel_selection(app)
}
#[tauri::command]
pub fn cancel_selection(app: tauri::AppHandle) -> Result<(), String> {
    *app.state::<DesktopState>()
        .selection
        .lock()
        .map_err(|e| e.to_string())? = None;
    if let Some(overlay) = app.get_webview_window("selection") {
        let _ = overlay.destroy();
    }
    restore(&app);
    let _ = app.emit_to("main", "capture:closed", ());
    Ok(())
}
#[tauri::command]
pub fn get_recording_overlay(app: tauri::AppHandle) -> serde_json::Value {
    app.state::<DesktopState>()
        .recording
        .lock()
        .map(|v| v.clone())
        .unwrap_or_default()
}
#[tauri::command]
pub fn sync_recording_overlay(
    app: tauri::AppHandle,
    status: serde_json::Value,
) -> Result<(), String> {
    *app.state::<DesktopState>()
        .recording
        .lock()
        .map_err(|e| e.to_string())? = status.clone();
    let _ = app.emit_to("recorder-controls", "recorder:state", status.clone());
    crate::widgets::sync_widget_status(app, "recorder".into(), status)
}
#[tauri::command]
pub async fn show_recording_overlay(
    app: tauri::AppHandle,
    display_id: usize,
    frame: bool,
    minimize: bool,
) -> Result<(), String> {
    let monitor = display(&app, display_id)?;
    let result = async {
        crate::widgets::show_widget(app.clone(), "recorder".into(), Some(display_id), false).await?;
        if frame && app.get_webview_window("recording-frame").is_none() {
            let border = WebviewWindowBuilder::new(
                &app,
                "recording-frame",
                WebviewUrl::App("index.html?surface=frame".into()),
            )
            .title("Recording frame")
            .additional_browser_args("--disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows")
            .decorations(false)
            .resizable(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .transparent(true)
            .shadow(false)
            .focused(false)
            .visible(false)
            .build()
            .map_err(|e| e.to_string())?;
            border
                .set_position(PhysicalPosition::new(monitor.x, monitor.y))
                .map_err(|e| e.to_string())?;
            border
                .set_size(PhysicalSize::new(monitor.width, monitor.height))
                .map_err(|e| e.to_string())?;
            border
                .set_ignore_cursor_events(true)
                .map_err(|e| e.to_string())?;
            border
                .set_content_protected(true)
                .map_err(|e| e.to_string())?;
            border.show().map_err(|e| e.to_string())?;
        }
        if minimize
            && let Some(main) = app.get_webview_window("main") {
                main.hide().map_err(|e| e.to_string())?;
            }
        Ok(())
    }.await;
    if result.is_err() {
        let _ = close_recording_overlay(app.clone(), false);
    }
    result
}
#[tauri::command]
pub fn close_recording_overlay(app: tauri::AppHandle, restore_main: bool) -> Result<(), String> {
    for name in ["recorder-controls", "recording-frame"] {
        if let Some(window) = app.get_webview_window(name) {
            let _ = window.destroy();
        }
    }
    if restore_main {
        restore(&app);
    }
    Ok(())
}
#[tauri::command]
pub fn recording_action(app: tauri::AppHandle, action: String) -> Result<(), String> {
    match action.as_str() {
        "restore" => restore(&app),
        "hide" => {
            if let Some(window) = app.get_webview_window("recorder-controls") {
                window.hide().map_err(|e| e.to_string())?;
            }
        }
        "start" | "pause" | "stop" => {
            app.emit_to("main", "recorder:action", action)
                .map_err(|e| e.to_string())?;
        }
        _ => return Err("Unknown recorder action.".into()),
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn normalizes_selection_in_physical_pixels() {
        assert_eq!(
            pixel_region(
                &Region {
                    x: 0.25,
                    y: 0.2,
                    w: 0.5,
                    h: 0.5
                },
                2560,
                1440
            )
            .unwrap(),
            (640, 288, 1280, 720)
        );
        assert!(
            pixel_region(
                &Region {
                    x: f64::NAN,
                    y: 0.,
                    w: 0.5,
                    h: 0.5
                },
                1920,
                1080
            )
            .is_err()
        );
        assert!(
            pixel_region(
                &Region {
                    x: 0.8,
                    y: 0.,
                    w: 0.5,
                    h: 0.5
                },
                1920,
                1080
            )
            .is_err()
        );
    }
}
