use crate::bindings::Binding;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU8, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    Repeat,
    Hold,
    Cycle,
    Burst,
}
fn default_duration() -> f64 {
    1000.0
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClickerItem {
    pub id: String,
    pub action: Option<Binding>,
    pub mode: Mode,
    pub interval_ms: f64,
    #[serde(default = "default_duration")]
    pub hold_ms: f64,
    #[serde(default = "default_duration")]
    pub burst_ms: f64,
    #[serde(default = "default_duration")]
    pub pause_ms: f64,
    pub trigger: Option<Binding>,
}
impl ClickerItem {
    fn validate(&self) -> Result<(), String> {
        if self.id.is_empty()
            || self.id.len() > 64
            || !self
                .id
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'-' | b'_'))
        {
            return Err("Invalid item ID.".into());
        }
        if !self.interval_ms.is_finite() || !(0.1..=3_600_000.0).contains(&self.interval_ms) {
            return Err("Delay must be between 0.1 ms and 1 hour.".into());
        }
        for (label, value) in [
            ("Hold time", self.hold_ms),
            ("Click time", self.burst_ms),
            ("Pause time", self.pause_ms),
        ] {
            if !value.is_finite() || !(0.1..=3_600_000.0).contains(&value) {
                return Err(format!("{label} must be between 0.1 ms and 1 hour."));
            }
        }
        if let Some(action) = &self.action {
            action.validate()?;
        }
        if let Some(trigger) = &self.trigger {
            trigger.validate()?;
        }
        Ok(())
    }
}
fn validate_items(items: &[ClickerItem]) -> Result<(), String> {
    if items.len() > 64 {
        return Err("You can save up to 64 items.".into());
    }
    for (index, item) in items.iter().enumerate() {
        item.validate()?;
        if items[..index].iter().any(|other| other.id == item.id) {
            return Err("Duplicate item ID.".into());
        }
        if let Some(trigger) = &item.trigger {
            if items[..index].iter().any(|other| {
                other
                    .trigger
                    .as_ref()
                    .is_some_and(|binding| binding.vk == trigger.vk)
            }) {
                return Err(format!(
                    "{} is already assigned to another item.",
                    trigger.label
                ));
            }
            // RegisterHotKey can also see SendInput. Never let an output activate any item.
            if items.iter().any(|other| {
                other
                    .action
                    .as_ref()
                    .is_some_and(|action| input_keys(action).contains(&normalize_key(trigger.vk)))
            }) {
                return Err(
                    "Use a different start/stop button from the buttons being repeated.".into(),
                );
            }
        }
    }
    Ok(())
}
#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "lowercase")]
#[repr(u8)]
pub enum Phase {
    Stopped,
    Clicking,
    Holding,
    Resting,
}
impl Phase {
    fn from_code(code: u8) -> Self {
        match code {
            1 => Self::Clicking,
            2 => Self::Holding,
            3 => Self::Resting,
            _ => Self::Stopped,
        }
    }
}
#[derive(Clone, Serialize)]
pub struct ItemStatus {
    pub id: String,
    pub running: bool,
    pub clicks: u64,
    pub phase: Phase,
}
struct Worker {
    running: Arc<AtomicBool>,
    count: Arc<AtomicU64>,
    phase: Arc<AtomicU8>,
    handle: Option<JoinHandle<()>>,
    item: ClickerItem,
}
pub struct AutoClickerState {
    items: Mutex<Vec<ClickerItem>>,
    workers: Mutex<HashMap<String, Worker>>,
    hotkey_error: Mutex<String>,
}
impl AutoClickerState {
    pub fn new() -> Self {
        Self {
            items: Mutex::new(Vec::new()),
            workers: Mutex::new(HashMap::new()),
            hotkey_error: Mutex::new(String::new()),
        }
    }
    pub fn items(&self) -> Vec<ClickerItem> {
        self.items.lock().unwrap_or_else(|e| e.into_inner()).clone()
    }
    pub fn running(&self, id: &str) -> bool {
        self.workers
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get(id)
            .is_some_and(|worker| worker.running.load(Ordering::SeqCst))
    }
    pub fn any_running(&self) -> bool {
        self.workers
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .values()
            .any(|worker| worker.running.load(Ordering::SeqCst))
    }
    pub fn held_modifiers(&self) -> u32 {
        self.workers
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .values()
            .filter(|worker| {
                worker.running.load(Ordering::SeqCst)
                    && matches!(worker.item.mode, Mode::Hold | Mode::Cycle)
            })
            .filter_map(|worker| worker.item.action.as_ref())
            .flat_map(input_keys)
            .fold(0, |flags, key| {
                flags
                    | match key {
                        16 => 4,
                        17 => 2,
                        18 => 1,
                        91 => 8,
                        _ => 0,
                    }
            })
    }
    pub fn stop(&self, id: Option<&str>) -> Result<(), String> {
        let mut workers = self.workers.lock().map_err(|e| e.to_string())?;
        for (key, worker) in workers.iter_mut() {
            if id.is_some_and(|value| value != key) {
                continue;
            }
            worker.running.store(false, Ordering::SeqCst);
            if let Some(handle) = worker.handle.take() {
                handle.thread().unpark();
                handle
                    .join()
                    .map_err(|_| "The input worker stopped unexpectedly.".to_string())?;
            }
        }
        Ok(())
    }
    fn statuses(&self) -> Vec<ItemStatus> {
        self.workers
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .iter()
            .map(|(id, worker)| ItemStatus {
                id: id.clone(),
                running: worker.running.load(Ordering::SeqCst),
                clicks: worker.count.load(Ordering::SeqCst),
                phase: if worker.running.load(Ordering::SeqCst) {
                    Phase::from_code(worker.phase.load(Ordering::SeqCst))
                } else {
                    Phase::Stopped
                },
            })
            .collect()
    }
}
fn load_items(app: &AppHandle) -> Result<(), String> {
    let path = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("clicker-items.json");
    if !path.exists() {
        return Ok(());
    }
    let items: Vec<ClickerItem> =
        serde_json::from_slice(&std::fs::read(path).map_err(|e| e.to_string())?)
            .map_err(|e| format!("Could not read clicker items: {e}"))?;
    validate_items(&items)?;
    *app.state::<AutoClickerState>()
        .items
        .lock()
        .map_err(|e| e.to_string())? = items;
    Ok(())
}
pub fn initialize(app: &AppHandle) {
    if let Err(error) = load_items(app) {
        *app.state::<AutoClickerState>()
            .hotkey_error
            .lock()
            .unwrap_or_else(|e| e.into_inner()) = error;
    }
}
fn persist(app: &AppHandle, items: &[ClickerItem]) -> Result<(), String> {
    let root = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    let temporary = root.join("clicker-items.json.tmp");
    std::fs::write(
        &temporary,
        serde_json::to_vec_pretty(items).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    std::fs::rename(temporary, root.join("clicker-items.json")).map_err(|e| e.to_string())
}
#[tauri::command]
pub fn get_clicker_items(app: AppHandle) -> Vec<ClickerItem> {
    app.state::<AutoClickerState>().items()
}
#[tauri::command]
pub fn save_clicker_item(app: AppHandle, item: ClickerItem) -> Result<Vec<ClickerItem>, String> {
    let state = app.state::<AutoClickerState>();
    if state.any_running() {
        return Err("Stop running items before editing.".into());
    }
    let next = {
        let mut items = state.items.lock().map_err(|e| e.to_string())?;
        let mut next = items.clone();
        if let Some(existing) = next.iter_mut().find(|value| value.id == item.id) {
            *existing = item;
        } else {
            next.push(item);
        }
        validate_items(&next)?;
        persist(&app, &next)?;
        *items = next.clone();
        next
    };
    crate::bindings::refresh()?;
    let _ = app.emit("clicker:items", &next);
    Ok(next)
}
#[tauri::command]
pub fn delete_clicker_item(app: AppHandle, id: String) -> Result<Vec<ClickerItem>, String> {
    let state = app.state::<AutoClickerState>();
    if state.any_running() {
        return Err("Stop running items before deleting.".into());
    }
    let next = {
        let mut items = state.items.lock().map_err(|e| e.to_string())?;
        let next: Vec<_> = items.iter().filter(|item| item.id != id).cloned().collect();
        persist(&app, &next)?;
        *items = next.clone();
        next
    };
    state.workers.lock().map_err(|e| e.to_string())?.remove(&id);
    crate::bindings::refresh()?;
    let _ = app.emit("clicker:items", &next);
    Ok(next)
}
#[cfg(windows)]
fn send_action(action: &Binding, down: bool, release: bool) -> Result<(), String> {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::*;
    let keyboard = |vk: u16, up: bool| INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: vk,
                wScan: 0,
                dwFlags: (if up { KEYEVENTF_KEYUP } else { 0 })
                    | (if matches!(vk, 0x21..=0x2E | 0x5B | 0x5C | 0x6F | 0xA3 | 0xA5) {
                        KEYEVENTF_EXTENDEDKEY
                    } else {
                        0
                    }),
                time: 0,
                dwExtraInfo: crate::bindings::OWN_INPUT,
            },
        },
    };
    let modifiers: Vec<u16> = [
        (action.ctrl, 17),
        (action.alt, 18),
        (action.shift, 16),
        (action.win, 91),
    ]
    .into_iter()
    .filter_map(|(enabled, vk)| enabled.then_some(vk))
    .collect();
    let primary = |up: bool| {
        if action.vk >= 8 {
            return keyboard(action.vk as u16, up);
        }
        let (pressed, released, data) = match action.vk {
            2 => (MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP, 0),
            4 => (MOUSEEVENTF_MIDDLEDOWN, MOUSEEVENTF_MIDDLEUP, 0),
            5 => (MOUSEEVENTF_XDOWN, MOUSEEVENTF_XUP, 1),
            6 => (MOUSEEVENTF_XDOWN, MOUSEEVENTF_XUP, 2),
            _ => (MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP, 0),
        };
        INPUT {
            r#type: INPUT_MOUSE,
            Anonymous: INPUT_0 {
                mi: MOUSEINPUT {
                    dx: 0,
                    dy: 0,
                    mouseData: data,
                    dwFlags: if up { released } else { pressed },
                    time: 0,
                    dwExtraInfo: crate::bindings::OWN_INPUT,
                },
            },
        }
    };
    let mut inputs = Vec::new();
    if down {
        inputs.extend(modifiers.iter().map(|vk| keyboard(*vk, false)));
        inputs.push(primary(false));
    }
    if release {
        inputs.push(primary(true));
        inputs.extend(modifiers.iter().rev().map(|vk| keyboard(*vk, true)));
    }
    let sent = unsafe {
        SendInput(
            inputs.len() as u32,
            inputs.as_ptr(),
            std::mem::size_of::<INPUT>() as i32,
        )
    };
    if sent != inputs.len() as u32 {
        return Err(
            "Windows blocked input. Check the target app's administrator permissions.".into(),
        );
    }
    Ok(())
}
#[cfg(windows)]
struct PrecisionTimer(windows_sys::Win32::Foundation::HANDLE);
#[cfg(not(windows))]
fn send_action(_: &Binding, _: bool, _: bool) -> Result<(), String> {
    Err("Auto-clicking requires Windows.".into())
}
#[cfg(windows)]
impl PrecisionTimer {
    fn new() -> Self {
        use windows_sys::Win32::System::Threading::*;
        Self(unsafe {
            CreateWaitableTimerExW(std::ptr::null(), std::ptr::null(), 2, TIMER_ALL_ACCESS)
        })
    }
    fn wait(&self, duration: Duration) {
        use windows_sys::Win32::System::Threading::*;
        if self.0.is_null() {
            std::hint::spin_loop();
            return;
        }
        let due = -((duration.as_nanos() / 100).max(1) as i64);
        unsafe {
            if SetWaitableTimer(self.0, &due, 0, None, std::ptr::null(), 0) != 0 {
                WaitForSingleObject(self.0, 5);
            }
        }
    }
}
#[cfg(windows)]
impl Drop for PrecisionTimer {
    fn drop(&mut self) {
        if !self.0.is_null() {
            unsafe {
                windows_sys::Win32::Foundation::CloseHandle(self.0);
            }
        }
    }
}
fn wait_between(running: &AtomicBool, delay: Duration, #[cfg(windows)] timer: &PrecisionTimer) {
    let deadline = Instant::now() + delay;
    while running.load(Ordering::SeqCst) {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            break;
        }
        if remaining > Duration::from_millis(2) {
            std::thread::park_timeout(
                (remaining - Duration::from_millis(1)).min(Duration::from_millis(10)),
            );
        } else if remaining > Duration::from_micros(100) {
            #[cfg(windows)]
            timer.wait(remaining - Duration::from_micros(50));
            #[cfg(not(windows))]
            std::thread::park_timeout(remaining);
        } else {
            std::hint::spin_loop();
        }
    }
}
fn input_keys(binding: &Binding) -> Vec<u32> {
    let mut result = vec![binding.vk];
    for (enabled, vk) in [
        (binding.ctrl, 17),
        (binding.alt, 18),
        (binding.shift, 16),
        (binding.win, 91),
    ] {
        if enabled {
            result.push(vk);
        }
    }
    // Normalize side-specific modifier keys for overlapping Hold actions.
    for vk in &mut result {
        *vk = normalize_key(*vk);
    }
    result
}
fn normalize_key(key: u32) -> u32 {
    match key {
        0xA0 | 0xA1 => 16,
        0xA2 | 0xA3 => 17,
        0xA4 | 0xA5 => 18,
        0x5C => 91,
        value => value,
    }
}
fn start(app: AppHandle, id: &str) -> Result<(), String> {
    let state = app.state::<AutoClickerState>();
    let item = state
        .items()
        .into_iter()
        .find(|item| item.id == id)
        .ok_or("Item not found.")?;
    item.validate()?;
    let action = item
        .action
        .clone()
        .ok_or("Choose a button for this item first.")?;
    let mut workers = state.workers.lock().map_err(|e| e.to_string())?;
    if workers
        .get(id)
        .is_some_and(|worker| worker.running.load(Ordering::SeqCst))
    {
        return Ok(());
    }
    let keys = input_keys(&action);
    if workers.values().any(|worker| {
        worker.running.load(Ordering::SeqCst)
            && (matches!(item.mode, Mode::Hold | Mode::Cycle)
                || matches!(worker.item.mode, Mode::Hold | Mode::Cycle))
            && worker
                .item
                .action
                .as_ref()
                .is_some_and(|other| input_keys(other).iter().any(|vk| keys.contains(vk)))
    }) {
        return Err("A running item already holds one of these buttons.".into());
    }
    if let Some(previous) = workers.remove(id)
        && let Some(handle) = previous.handle
    {
        let _ = handle.join();
    }
    let running = Arc::new(AtomicBool::new(true));
    let count = Arc::new(AtomicU64::new(0));
    let phase = Arc::new(AtomicU8::new(Phase::Stopped as u8));
    let worker_running = running.clone();
    let worker_count = count.clone();
    let worker_phase = phase.clone();
    let worker_item = item.clone();
    let handle_app = app.clone();
    let handle = std::thread::spawn(move || {
        let id = worker_item.id.clone();
        let publish = |active| {
            let _ = handle_app.emit(
                "autoclicker:update",
                ItemStatus {
                    id: id.clone(),
                    running: active,
                    clicks: worker_count.load(Ordering::SeqCst),
                    phase: Phase::from_code(worker_phase.load(Ordering::SeqCst)),
                },
            );
        };
        #[cfg(windows)]
        let timer = PrecisionTimer::new();
        let mut held = false;
        let mut error = None;
        let last_update = std::cell::Cell::new(Instant::now());
        let update = || {
            if last_update.get().elapsed() >= Duration::from_millis(100) {
                publish(true);
                last_update.set(Instant::now());
            }
        };
        let wait = |duration: Duration| {
            let deadline = Instant::now() + duration;
            loop {
                let remaining = deadline.saturating_duration_since(Instant::now());
                if remaining.is_zero() || !worker_running.load(Ordering::SeqCst) {
                    break;
                }
                wait_between(
                    &worker_running,
                    remaining.min(Duration::from_millis(100)),
                    #[cfg(windows)]
                    &timer,
                );
                update();
            }
        };
        let phase = |value: Phase| {
            let initial = worker_phase.load(Ordering::SeqCst) == Phase::Stopped as u8;
            worker_phase.store(value as u8, Ordering::SeqCst);
            if initial {
                publish(true);
                last_update.set(Instant::now());
            } else {
                update();
            }
        };
        let duration = |ms| Duration::from_secs_f64(ms / 1000.0);
        let mut burst_end = Instant::now() + duration(worker_item.burst_ms);
        publish(true);
        while worker_running.load(Ordering::SeqCst) {
            if matches!(worker_item.mode, Mode::Burst) && Instant::now() >= burst_end {
                phase(Phase::Resting);
                wait(duration(worker_item.pause_ms));
                if !worker_running.load(Ordering::SeqCst) {
                    break;
                }
                burst_end = Instant::now() + duration(worker_item.burst_ms);
            }
            let hold = matches!(worker_item.mode, Mode::Hold | Mode::Cycle);
            // A partial SendInput can leave a button down, so always release on error.
            if let Err(reason) = send_action(&action, true, !hold) {
                let _ = send_action(&action, false, true);
                error = Some(reason);
                break;
            }
            held = hold;
            worker_count.fetch_add(1, Ordering::SeqCst);
            if hold {
                phase(Phase::Holding);
                if matches!(worker_item.mode, Mode::Hold) {
                    while worker_running.load(Ordering::SeqCst) {
                        wait(Duration::from_secs(1));
                    }
                    break;
                }
                wait(duration(worker_item.hold_ms));
                if let Err(reason) = send_action(&action, false, true) {
                    error = Some(reason);
                    break;
                }
                held = false;
                if !worker_running.load(Ordering::SeqCst) {
                    break;
                }
                phase(Phase::Resting);
                wait(duration(worker_item.pause_ms));
                continue;
            }
            phase(Phase::Clicking);
            let mut delay = duration(worker_item.interval_ms);
            if matches!(worker_item.mode, Mode::Burst) {
                delay = delay.min(burst_end.saturating_duration_since(Instant::now()));
            }
            wait(delay);
        }
        if held && let Err(reason) = send_action(&action, false, true) {
            error = Some(reason);
        }
        worker_running.store(false, Ordering::SeqCst);
        worker_phase.store(Phase::Stopped as u8, Ordering::SeqCst);
        if let Some(reason) = error {
            let _ = handle_app.emit("autoclicker:error", reason);
        }
        publish(false);
        crate::bindings::refresh_async();
    });
    workers.insert(
        id.into(),
        Worker {
            running,
            count,
            phase,
            handle: Some(handle),
            item,
        },
    );
    drop(workers);
    if let Err(error) = crate::bindings::refresh() {
        state.stop(Some(id))?;
        return Err(error);
    }
    Ok(())
}
#[tauri::command]
pub fn start_autoclicker(app: AppHandle, id: String) -> Result<(), String> {
    start(app, &id)
}
#[tauri::command]
pub fn stop_autoclicker(app: AppHandle, id: Option<String>) -> Result<(), String> {
    app.state::<AutoClickerState>().stop(id.as_deref())?;
    if id.is_none() {
        let _ = app.emit("autoclicker:stop-all", ());
    }
    Ok(())
}
#[tauri::command]
pub fn get_autoclicker_status(app: AppHandle) -> Vec<ItemStatus> {
    app.state::<AutoClickerState>().statuses()
}
#[tauri::command]
pub fn get_hotkey_status(app: AppHandle) -> String {
    app.state::<AutoClickerState>()
        .hotkey_error
        .lock()
        .map(|value| value.clone())
        .unwrap_or_default()
}
pub fn toggle(app: AppHandle, id: &str) -> Result<(), String> {
    if app.state::<AutoClickerState>().running(id) {
        app.state::<AutoClickerState>().stop(Some(id))
    } else {
        start(app, id)
    }
}
pub fn register_hotkeys(app: AppHandle) {
    #[cfg(windows)]
    std::thread::spawn(move || unsafe {
        use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
            MOD_CONTROL, MOD_NOREPEAT, MOD_SHIFT, RegisterHotKey,
        };
        use windows_sys::Win32::UI::WindowsAndMessaging::{GetMessageW, MSG, WM_HOTKEY};
        if RegisterHotKey(
            std::ptr::null_mut(),
            1,
            MOD_CONTROL | MOD_SHIFT | MOD_NOREPEAT,
            0x7B,
        ) == 0
        {
            *app.state::<AutoClickerState>().hotkey_error.lock().unwrap() =
                "Stop-all shortcut unavailable.".into();
        }
        RegisterHotKey(
            std::ptr::null_mut(),
            2,
            MOD_CONTROL | MOD_SHIFT | MOD_NOREPEAT,
            'R' as u32,
        );
        RegisterHotKey(
            std::ptr::null_mut(),
            3,
            MOD_CONTROL | MOD_SHIFT | MOD_NOREPEAT,
            'S' as u32,
        );
        let mut message: MSG = std::mem::zeroed();
        while GetMessageW(&mut message, std::ptr::null_mut(), 0, 0) > 0 {
            if message.message != WM_HOTKEY {
                continue;
            }
            if message.wParam == 1 {
                let _ = app.state::<AutoClickerState>().stop(None);
                let _ = app.emit("autoclicker:stop-all", ());
                let _ = app.emit_to("main", "recorder:action", "stop");
                crate::desktop::restore(&app);
            } else {
                let target = if message.wParam == 2 {
                    "recorder"
                } else {
                    "screenshot"
                };
                crate::desktop::restore(&app);
                let _ = app.emit("navigate", target);
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    fn item(id: &str, action: u32, trigger: u32) -> ClickerItem {
        ClickerItem {
            id: id.into(),
            action: Some(Binding {
                vk: action,
                label: "Action".into(),
                ..Binding::default()
            }),
            mode: Mode::Repeat,
            interval_ms: 0.5,
            hold_ms: default_duration(),
            burst_ms: default_duration(),
            pause_ms: default_duration(),
            trigger: Some(Binding {
                vk: trigger,
                ..Binding::default()
            }),
        }
    }
    #[test]
    fn fractional_delays_and_cleared_bindings_are_valid() {
        let mut value = item("one", 134, 117);
        assert!(validate_items(&[value.clone()]).is_ok());
        for interval in [0.0, -1.0, f64::NAN, f64::INFINITY, 3_600_001.0] {
            value.interval_ms = interval;
            assert!(value.validate().is_err());
        }
        value.interval_ms = 0.5;
        value.trigger = None;
        value.action = None;
        assert!(value.validate().is_ok());
    }
    #[test]
    fn existing_items_keep_their_behavior_and_timed_fields_are_validated() {
        let mut legacy = serde_json::to_value(item("old", 134, 117)).unwrap();
        for field in ["hold_ms", "pause_ms", "burst_ms"] {
            legacy.as_object_mut().unwrap().remove(field);
        }
        let old: ClickerItem = serde_json::from_value(legacy).unwrap();
        assert!(matches!(old.mode, Mode::Repeat));
        assert_eq!(old.interval_ms, 0.5);
        assert_eq!(old.hold_ms, 1000.0);
        let mut timed = old.clone();
        timed.mode = Mode::Cycle;
        timed.hold_ms = 0.5;
        timed.pause_ms = 3000.0;
        assert!(timed.validate().is_ok());
        for invalid in [0.0, -1.0, f64::NAN, f64::INFINITY, 3_600_001.0] {
            for field in ["hold", "pause", "burst"] {
                let mut value = timed.clone();
                match field {
                    "hold" => value.hold_ms = invalid,
                    "pause" => value.pause_ms = invalid,
                    _ => value.burst_ms = invalid,
                }
                assert!(value.validate().is_err());
            }
        }
    }
    #[test]
    fn items_cannot_trigger_each_other_or_share_a_shortcut() {
        assert!(validate_items(&[item("one", 134, 117), item("two", 135, 118)]).is_ok());
        assert!(validate_items(&[item("one", 134, 117), item("two", 135, 117)]).is_err());
        assert!(validate_items(&[item("one", 134, 117), item("two", 117, 118)]).is_err());
        assert!(validate_items(&[item("one", 117, 117)]).is_err());
    }
    #[test]
    fn stop_joins_each_worker_and_leaves_other_items_running() {
        let state = AutoClickerState::new();
        for id in ["one", "two"] {
            let running = Arc::new(AtomicBool::new(true));
            let copy = running.clone();
            let handle = std::thread::spawn(move || {
                while copy.load(Ordering::SeqCst) {
                    std::thread::park_timeout(Duration::from_secs(30));
                }
            });
            state.workers.lock().unwrap().insert(
                id.into(),
                Worker {
                    running,
                    count: Arc::new(AtomicU64::new(0)),
                    phase: Arc::new(AtomicU8::new(0)),
                    handle: Some(handle),
                    item: item(id, 134, 117),
                },
            );
        }
        state.stop(Some("one")).unwrap();
        assert!(!state.running("one"));
        assert!(state.running("two"));
        state.stop(None).unwrap();
        assert!(!state.any_running());
    }
}
