mod autoclicker;
mod bindings;
mod desktop;
mod recorder;
mod screenshot;
mod tray;
mod widgets;
use tauri::Manager;

pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(autoclicker::AutoClickerState::new())
        .manage(recorder::RecorderState::default())
        .manage(desktop::DesktopState::default())
        .manage(widgets::WidgetState::default())
        .manage(tray::TrayState::default())
        .manage(bindings::BindingState::default())
        .on_window_event(|window, event| {
            if window.label() == "main"
                && matches!(event, tauri::WindowEvent::Resized(_))
                && window.is_minimized().unwrap_or(false)
            {
                let _ = window.hide();
            }
            if window.label() == "main" && matches!(event, tauri::WindowEvent::Destroyed) {
                let _ = desktop::close_recording_overlay(window.app_handle().clone(), false);
                let _ = desktop::cancel_selection(window.app_handle().clone());
                for kind in ["voice", "screenshot"] {
                    let _ = widgets::close_widget(window.app_handle().clone(), kind.into());
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            autoclicker::start_autoclicker,
            autoclicker::stop_autoclicker,
            autoclicker::get_clicker_items,
            autoclicker::save_clicker_item,
            autoclicker::delete_clicker_item,
            autoclicker::get_autoclicker_status,
            autoclicker::get_hotkey_status,
            screenshot::capture_screen,
            screenshot::save_screenshot,
            recorder::begin_recording,
            recorder::append_recording,
            recorder::finish_recording,
            recorder::list_recordings,
            recorder::get_output_dirs,
            recorder::open_file_in_explorer,
            recorder::remove_capture,
            recorder::restore_library,
            desktop::get_displays,
            desktop::capture_display,
            desktop::get_selection,
            desktop::complete_selection,
            desktop::cancel_selection,
            desktop::get_recording_overlay,
            desktop::sync_recording_overlay,
            desktop::show_recording_overlay,
            desktop::close_recording_overlay,
            desktop::recording_action,
            widgets::get_widget_state,
            widgets::sync_widget_status,
            widgets::show_widget,
            widgets::close_widget,
            widgets::begin_widget_drag,
            widgets::drag_widget,
            widgets::dock_widget,
            widgets::widget_action,
            tray::minimize_to_tray,
            tray::tray_action,
            tray::get_tray_state,
            bindings::arm_binding,
            bindings::cancel_binding,
            bindings::get_binding_error,
            bindings::get_binding_diagnostics,
        ])
        .setup(|app| {
            widgets::load(app.handle());
            tray::initialize(app.handle())?;
            autoclicker::initialize(app.handle());
            autoclicker::register_hotkeys(app.handle().clone());
            bindings::install(app.handle().clone());
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                loop {
                    tray::refresh(&handle);
                    tokio::time::sleep(std::time::Duration::from_secs(1)).await;
                }
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("Could not launch FrameCue. Ensure Microsoft Edge WebView2 Runtime is installed.");
    app.run(|handle, event| {
        if matches!(event, tauri::RunEvent::Exit) {
            let _ = handle.state::<autoclicker::AutoClickerState>().stop(None);
        }
    });
}
