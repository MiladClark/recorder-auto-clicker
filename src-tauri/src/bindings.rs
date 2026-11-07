use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use tauri::{Emitter, Manager};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Binding {
    pub vk: u32,
    pub ctrl: bool,
    pub alt: bool,
    pub shift: bool,
    pub win: bool,
    pub label: String,
}
impl Default for Binding {
    fn default() -> Self {
        Self {
            vk: 0x75,
            ctrl: false,
            alt: false,
            shift: false,
            win: false,
            label: "F6".into(),
        }
    }
}
impl Binding {
    pub fn validate(&self) -> Result<(), String> {
        if !matches!(self.vk, 1 | 2 | 4 | 5 | 6 | 8..=254)
            || self.label.is_empty()
            || self.label.len() > 128
        {
            return Err("Choose a valid keyboard or mouse button.".into());
        }
        if self.vk == 0x7B && self.ctrl && self.shift {
            return Err("Ctrl + Shift + F12 is reserved for Stop all.".into());
        }
        Ok(())
    }
}
#[derive(Default)]
pub struct BindingState {
    learning: Mutex<Option<String>>,
    latched: Mutex<HashSet<u32>>,
    registered: Mutex<HashMap<usize, String>>,
    polled: Mutex<HashSet<u32>>,
    error: Mutex<String>,
}
static APP: OnceLock<tauri::AppHandle> = OnceLock::new();
pub const OWN_INPUT: usize = 0x4f4d4e49;
static LEARNING: AtomicBool = AtomicBool::new(false);
struct InputEvent {
    vk: u32,
    down: bool,
    ctrl: bool,
    shift: bool,
    alt: bool,
    win: bool,
}
static EVENTS: OnceLock<std::sync::mpsc::Sender<InputEvent>> = OnceLock::new();
type HookReply = std::sync::mpsc::Sender<Result<(), String>>;
static HOOK_CONTROL: OnceLock<std::sync::mpsc::Sender<HookReply>> = OnceLock::new();
static HOOK_THREAD: AtomicU32 = AtomicU32::new(0);
static KEY_EVENTS: AtomicU64 = AtomicU64::new(0);
static MOUSE_EVENTS: AtomicU64 = AtomicU64::new(0);
pub fn refresh() -> Result<(), String> {
    #[cfg(windows)]
    {
        let (sender, receiver) = std::sync::mpsc::channel();
        HOOK_CONTROL
            .get()
            .ok_or("Input bindings are still starting.")?
            .send(sender)
            .map_err(|e| e.to_string())?;
        if unsafe {
            windows_sys::Win32::UI::WindowsAndMessaging::PostThreadMessageW(
                HOOK_THREAD.load(Ordering::SeqCst),
                0x8000 + 42,
                0,
                0,
            )
        } == 0
        {
            return Err("Could not refresh input bindings.".into());
        }
        receiver
            .recv_timeout(std::time::Duration::from_secs(2))
            .map_err(|e| e.to_string())??;
    }
    Ok(())
}
pub fn refresh_async() {
    #[cfg(windows)]
    if let Some(control) = HOOK_CONTROL.get() {
        let (sender, _receiver) = std::sync::mpsc::channel();
        if control.send(sender).is_ok() {
            unsafe {
                windows_sys::Win32::UI::WindowsAndMessaging::PostThreadMessageW(
                    HOOK_THREAD.load(Ordering::SeqCst),
                    0x8000 + 42,
                    0,
                    0,
                );
            }
        }
    }
}
#[tauri::command]
pub fn get_binding_diagnostics() -> serde_json::Value {
    serde_json::json!({"keyboard":KEY_EVENTS.load(Ordering::Relaxed),"mouse":MOUSE_EVENTS.load(Ordering::Relaxed)})
}
#[tauri::command]
pub fn get_binding_error(app: tauri::AppHandle) -> String {
    app.state::<BindingState>()
        .error
        .lock()
        .map(|value| value.clone())
        .unwrap_or_default()
}
#[tauri::command]
pub fn arm_binding(app: tauri::AppHandle, target: String) -> Result<(), String> {
    if !matches!(target.as_str(), "trigger" | "output") {
        return Err("Invalid binding target.".into());
    }
    if app
        .state::<crate::autoclicker::AutoClickerState>()
        .any_running()
    {
        return Err("Stop running items before choosing a button.".into());
    }
    *app.state::<BindingState>()
        .learning
        .lock()
        .map_err(|e| e.to_string())? = Some(target);
    LEARNING.store(true, Ordering::SeqCst);
    if let Err(error) = refresh() {
        cancel_binding(app);
        return Err(error);
    }
    Ok(())
}
#[tauri::command]
pub fn cancel_binding(app: tauri::AppHandle) {
    LEARNING.store(false, Ordering::SeqCst);
    if let Ok(mut value) = app.state::<BindingState>().learning.lock() {
        *value = None;
    }
    refresh_async();
}
#[cfg(windows)]
fn describe(vk: u32, ctrl: bool, alt: bool, shift: bool, win: bool) -> String {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::*;
    let name = match vk {
        1 => "Mouse left".into(),
        2 => "Mouse right".into(),
        4 => "Mouse middle".into(),
        5 => "Mouse 4".into(),
        6 => "Mouse 5".into(),
        0x10 | 0xA0 | 0xA1 => "Shift".into(),
        0x11 | 0xA2 | 0xA3 => "Ctrl".into(),
        0x12 | 0xA4 | 0xA5 => "Alt".into(),
        0x5B | 0x5C => "Win".into(),
        _ => unsafe {
            let scan = MapVirtualKeyW(vk, MAPVK_VK_TO_VSC);
            let extended = matches!(vk, 0x21..=0x2E | 0x5B | 0x5C | 0x6F);
            let mut text = [0u16; 64];
            let n = GetKeyNameTextW(
                ((scan << 16) | if extended { 1 << 24 } else { 0 }) as i32,
                text.as_mut_ptr(),
                64,
            );
            if n > 0 {
                String::from_utf16_lossy(&text[..n as usize])
            } else {
                format!("Key {vk}")
            }
        },
    };
    let mut parts = Vec::new();
    if ctrl {
        parts.push("Ctrl".into());
    }
    if alt {
        parts.push("Alt".into());
    }
    if shift {
        parts.push("Shift".into());
    }
    if win {
        parts.push("Win".into());
    }
    parts.push(name);
    parts.join(" + ")
}
#[cfg(windows)]
fn handle(event: InputEvent) -> bool {
    let InputEvent {
        vk,
        down,
        ctrl,
        shift,
        alt,
        win,
    } = event;
    let Some(app) = APP.get() else { return false };
    let state = app.state::<BindingState>();
    let mut learning = state.learning.lock().unwrap_or_else(|e| e.into_inner());
    let modifier = matches!(vk,0x10..=0x12|0x5B|0x5C|0xA0..=0xA5);
    if learning.is_some() && ((down && !modifier) || (!down && modifier)) {
        let target = learning.take().unwrap();
        LEARNING.store(false, Ordering::SeqCst);
        refresh_async();
        let binding = Binding {
            vk,
            ctrl,
            alt,
            shift,
            win,
            label: describe(vk, ctrl, alt, shift, win),
        };
        match binding.validate() {
            Ok(()) => {
                let _ = app.emit_to(
                    "main",
                    "binding:changed",
                    serde_json::json!({"target":target,"binding":binding}),
                );
            }
            Err(error) => {
                let _ = app.emit_to("main", "binding:error", error);
            }
        }
        return true;
    }
    drop(learning);
    if LEARNING.load(Ordering::SeqCst) {
        return false;
    }
    if !down {
        state
            .latched
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(&vk);
        return false;
    }
    let clicker = app.state::<crate::autoclicker::AutoClickerState>();
    let registered = state
        .registered
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone();
    let targets: Vec<_> = clicker
        .items()
        .into_iter()
        .filter(|item| {
            let Some(trigger) = &item.trigger else {
                return false;
            };
            if item.action.is_none() || trigger.vk != vk {
                return false;
            }
            let exact = ctrl == trigger.ctrl
                && alt == trigger.alt
                && shift == trigger.shift
                && win == trigger.win;
            // RegisterHotKey handles normal keyboard combinations. The hook also allows
            // stopping a Hold item whose output currently holds a modifier.
            if vk >= 8 && registered.values().any(|id| id == &item.id) && exact {
                return false;
            }
            exact || clicker.running(&item.id)
        })
        .map(|item| item.id)
        .collect();
    if targets.is_empty() {
        return false;
    }
    if !state
        .latched
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .insert(vk)
    {
        return false;
    }
    let handle = app.clone();
    std::thread::spawn(move || {
        for id in targets {
            if let Err(error) = crate::autoclicker::toggle(handle.clone(), &id) {
                let _ = handle.emit("autoclicker:error", error);
            }
        }
    });
    false
}
#[cfg(windows)]
fn register_keyboard_binding(app: &tauri::AppHandle) {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::*;
    let state = app.state::<BindingState>();
    let mut registered = state.registered.lock().unwrap_or_else(|e| e.into_inner());
    for id in registered.keys() {
        unsafe {
            UnregisterHotKey(std::ptr::null_mut(), *id as i32);
        }
    }
    registered.clear();
    let mut polled = state.polled.lock().unwrap_or_else(|e| e.into_inner());
    polled.clear();
    // Existing global shortcuts must not swallow the key being learned.
    if LEARNING.load(Ordering::SeqCst) {
        return;
    }
    state
        .latched
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clear();
    let held_modifiers = app
        .state::<crate::autoclicker::AutoClickerState>()
        .held_modifiers();
    for (index, item) in app
        .state::<crate::autoclicker::AutoClickerState>()
        .items()
        .into_iter()
        .enumerate()
    {
        if item.action.is_none() {
            continue;
        }
        let Some(binding) = item.trigger else {
            continue;
        };
        if binding.vk < 8 {
            continue;
        }
        if matches!(binding.vk, 0x10..=0x12 | 0x5B | 0x5C | 0xA0..=0xA5) {
            polled.insert(binding.vk);
            continue;
        }
        let flags = MOD_NOREPEAT
            | if binding.ctrl { MOD_CONTROL } else { 0 }
            | if binding.alt { MOD_ALT } else { 0 }
            | if binding.shift { MOD_SHIFT } else { 0 }
            | if binding.win { MOD_WIN } else { 0 };
        let id = index * 2 + 100;
        if unsafe { RegisterHotKey(std::ptr::null_mut(), id as i32, flags, binding.vk) } != 0 {
            registered.insert(id, item.id.clone());
        } else {
            polled.insert(binding.vk);
        }
        if flags | held_modifiers != flags
            && unsafe {
                RegisterHotKey(
                    std::ptr::null_mut(),
                    (id + 1) as i32,
                    flags | held_modifiers,
                    binding.vk,
                )
            } != 0
        {
            registered.insert(id + 1, item.id);
        }
    }
    let emergency = MOD_NOREPEAT | MOD_CONTROL | MOD_SHIFT;
    if emergency | held_modifiers != emergency
        && unsafe { RegisterHotKey(std::ptr::null_mut(), 99, emergency | held_modifiers, 0x7B) }
            != 0
    {
        registered.insert(99, String::new());
    }
}
#[cfg(windows)]
fn queue_input(vk: u32, down: bool) -> bool {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::GetAsyncKeyState;
    let pressed = |key| unsafe { GetAsyncKeyState(key) < 0 };
    let event = InputEvent {
        vk,
        down,
        ctrl: pressed(0x11) && !matches!(vk, 0x11 | 0xA2 | 0xA3),
        shift: pressed(0x10) && !matches!(vk, 0x10 | 0xA0 | 0xA1),
        alt: pressed(0x12) && !matches!(vk, 0x12 | 0xA4 | 0xA5),
        win: (pressed(0x5B) || pressed(0x5C)) && !matches!(vk, 0x5B | 0x5C),
    };
    let consume =
        LEARNING.load(Ordering::Relaxed) && down && !matches!(vk,0x10..=0x12|0x5B|0x5C|0xA0..=0xA5);
    if let Some(sender) = EVENTS.get() {
        let _ = sender.send(event);
    }
    consume
}
#[cfg(windows)]
unsafe extern "system" fn keyboard(code: i32, wparam: usize, lparam: isize) -> isize {
    KEY_EVENTS.fetch_add(1, Ordering::Relaxed);
    use windows_sys::Win32::UI::WindowsAndMessaging::*;
    if code >= 0 {
        let event = unsafe { &*(lparam as *const KBDLLHOOKSTRUCT) };
        if event.dwExtraInfo != OWN_INPUT
            && queue_input(
                event.vkCode,
                matches!(wparam as u32, WM_KEYDOWN | WM_SYSKEYDOWN),
            )
        {
            return 1;
        }
    }
    unsafe { CallNextHookEx(std::ptr::null_mut(), code, wparam, lparam) }
}
#[cfg(windows)]
unsafe extern "system" fn mouse(code: i32, wparam: usize, lparam: isize) -> isize {
    MOUSE_EVENTS.fetch_add(1, Ordering::Relaxed);
    use windows_sys::Win32::UI::WindowsAndMessaging::*;
    if code >= 0 {
        let event = unsafe { &*(lparam as *const MSLLHOOKSTRUCT) };
        if event.dwExtraInfo != OWN_INPUT {
            let key = match wparam as u32 {
                WM_LBUTTONDOWN | WM_LBUTTONUP => Some(1),
                WM_RBUTTONDOWN | WM_RBUTTONUP => Some(2),
                WM_MBUTTONDOWN | WM_MBUTTONUP => Some(4),
                WM_XBUTTONDOWN | WM_XBUTTONUP => {
                    Some(if event.mouseData >> 16 == 1 { 5 } else { 6 })
                }
                _ => None,
            };
            if let Some(vk) = key
                && queue_input(
                    vk,
                    matches!(
                        wparam as u32,
                        WM_LBUTTONDOWN | WM_RBUTTONDOWN | WM_MBUTTONDOWN | WM_XBUTTONDOWN
                    ),
                )
            {
                return 1;
            }
        }
    }
    unsafe { CallNextHookEx(std::ptr::null_mut(), code, wparam, lparam) }
}
pub fn install(app: tauri::AppHandle) {
    let _ = APP.set(app.clone());
    let (sender, receiver) = std::sync::mpsc::channel();
    let _ = EVENTS.set(sender);
    let (hook_sender, hook_receiver) = std::sync::mpsc::channel();
    let _ = HOOK_CONTROL.set(hook_sender);
    #[cfg(windows)]
    std::thread::spawn(move || {
        for event in receiver {
            handle(event);
        }
    });
    #[cfg(windows)]
    std::thread::spawn(move || unsafe {
        use windows_sys::Win32::UI::WindowsAndMessaging::*;
        let module = windows_sys::Win32::System::LibraryLoader::GetModuleHandleW(std::ptr::null());
        let mut keyboard_hook = SetWindowsHookExW(WH_KEYBOARD_LL, Some(keyboard), module, 0);
        let keyboard_error = if keyboard_hook.is_null() {
            windows_sys::Win32::Foundation::GetLastError()
        } else {
            0
        };
        let mouse_hook = SetWindowsHookExW(WH_MOUSE_LL, Some(mouse), module, 0);
        let mouse_error = if mouse_hook.is_null() {
            windows_sys::Win32::Foundation::GetLastError()
        } else {
            0
        };
        if keyboard_hook.is_null() || mouse_hook.is_null() {
            *app.state::<BindingState>()
                .error
                .lock()
                .unwrap_or_else(|e| e.into_inner()) = format!(
                "Global input unavailable (keyboard {keyboard_error}, mouse {mouse_error})."
            );
            let _ = app.emit(
                "binding:error",
                "Windows could not activate global bindings.",
            );
        }
        let mut message: MSG = std::mem::zeroed();
        PeekMessageW(&mut message, std::ptr::null_mut(), 0, 0, PM_NOREMOVE);
        HOOK_THREAD.store(
            windows_sys::Win32::System::Threading::GetCurrentThreadId(),
            Ordering::SeqCst,
        );
        register_keyboard_binding(&app);
        let mut polled_down = HashSet::new();
        let poll_timer = SetTimer(std::ptr::null_mut(), 444, 8, None);
        while GetMessageW(&mut message, std::ptr::null_mut(), 0, 0) > 0 {
            if message.message == WM_TIMER && message.wParam == poll_timer {
                use windows_sys::Win32::UI::Input::KeyboardAndMouse::GetAsyncKeyState;
                let keys = app
                    .state::<BindingState>()
                    .polled
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .clone();
                polled_down.retain(|key| keys.contains(key));
                if !LEARNING.load(Ordering::SeqCst) {
                    for key in keys {
                        let down = GetAsyncKeyState(key as i32) < 0;
                        if down && polled_down.insert(key) {
                            queue_input(key, true);
                        } else if !down && polled_down.remove(&key) {
                            queue_input(key, false);
                        }
                    }
                }
                continue;
            }
            if message.message == 0x8000 + 42 {
                for reply in hook_receiver.try_iter() {
                    if !keyboard_hook.is_null() {
                        UnhookWindowsHookEx(keyboard_hook);
                    }
                    keyboard_hook = SetWindowsHookExW(WH_KEYBOARD_LL, Some(keyboard), module, 0);
                    register_keyboard_binding(&app);
                    let result = if keyboard_hook.is_null() {
                        Err("Windows could not activate keyboard bindings.".into())
                    } else {
                        Ok(())
                    };
                    let _ = reply.send(result);
                }
                continue;
            }
            if message.message == WM_HOTKEY {
                if !LEARNING.load(Ordering::SeqCst) {
                    let id = app
                        .state::<BindingState>()
                        .registered
                        .lock()
                        .unwrap_or_else(|e| e.into_inner())
                        .get(&message.wParam)
                        .cloned();
                    if let Some(id) = id {
                        if id.is_empty() {
                            let _ = app
                                .state::<crate::autoclicker::AutoClickerState>()
                                .stop(None);
                            let _ = app.emit("autoclicker:stop-all", ());
                            let _ = app.emit_to("main", "recorder:action", "stop");
                            crate::desktop::restore(&app);
                            continue;
                        }
                        let handle = app.clone();
                        std::thread::spawn(move || {
                            if let Err(error) = crate::autoclicker::toggle(handle.clone(), &id) {
                                let _ = handle.emit("autoclicker:error", error);
                            }
                        });
                    }
                }
                continue;
            }
            TranslateMessage(&message);
            DispatchMessageW(&message);
        }
        if !keyboard_hook.is_null() {
            UnhookWindowsHookEx(keyboard_hook);
        }
        if !mouse_hook.is_null() {
            UnhookWindowsHookEx(mouse_hook);
        }
    });
}
