use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use device_query::{DeviceQuery, DeviceState};
use serde::Serialize;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, Manager, RunEvent};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

#[derive(Serialize, Clone)]
struct CursorPos {
    x: i32,
    y: i32,
}

/// Holds the spawned Python sidecar so we can kill it on app exit.
struct SidecarChild(Mutex<Option<CommandChild>>);

/// Set to true when the user actually wants to quit (tray "Exit" or
/// `exit_app` command). The window-close path checks this flag and, if
/// false, prevents the exit and hides to tray instead.
struct IsQuitting(AtomicBool);

/// Tracks whether we've already shown the "minimized to tray" notification
/// this session. We only show it on the very first hide-to-tray so users
/// learn the tray icon exists, then stop nagging on every X click.
struct TrayNotifShown(AtomicBool);

/// The two global hotkeys we manage. We store the parsed `Shortcut` so the
/// pressed-shortcut handler can compare by equality and emit the right event
/// without dealing with string-format normalization (e.g. "Shift+F2" vs
/// "shift+f2").
#[derive(Default)]
struct HotkeyConfig {
    lookup: Option<Shortcut>,
    toggle: Option<Shortcut>,
}
struct Hotkeys(Mutex<HotkeyConfig>);

/// Mouse-button hotkeys. tauri-plugin-global-shortcut is keyboard-only, so we
/// run a tiny background polling thread (~60 Hz via device_query) for mouse
/// side buttons and the wheel click. Same emit contract as the keyboard hotkey
/// handler — same cursor payload, same window-show fallback — so React doesn't
/// care which input bound the shortcut.
#[derive(Clone, Copy, PartialEq, Eq)]
enum MouseHotkeyButton {
    Middle, // wheel click
    X1,     // back / thumb-1
    X2,     // forward / thumb-2
}

impl MouseHotkeyButton {
    fn from_str(s: &str) -> Option<Self> {
        match s {
            "MouseMiddle" => Some(Self::Middle),
            "MouseX1" => Some(Self::X1),
            "MouseX2" => Some(Self::X2),
            _ => None,
        }
    }
    /// device_query indexes mouse buttons 1=Left, 2=Right, 3=Middle, 4=X1, 5=X2.
    fn device_index(self) -> usize {
        match self {
            Self::Middle => 3,
            Self::X1 => 4,
            Self::X2 => 5,
        }
    }
}

#[derive(Default, Clone, Copy)]
struct MouseHotkeyConfig {
    lookup: Option<MouseHotkeyButton>,
    toggle: Option<MouseHotkeyButton>,
}
struct MouseHotkeys(Arc<Mutex<MouseHotkeyConfig>>);

fn notify_minimized_to_tray(app: &tauri::AppHandle) {
    // Only fire the notification on the first hide-to-tray of the session.
    // Repeating it on every X click is noisy; the user learns where the tray
    // icon is once and that's enough.
    if let Some(state) = app.try_state::<TrayNotifShown>() {
        if state.0.swap(true, Ordering::SeqCst) {
            return;
        }
    }
    let _ = app
        .notification()
        .builder()
        .title("Tarkov Price Overlay")
        .body("트레이로 숨겼어요. 다시 띄우려면 단축키(F2) 또는 트레이 아이콘 클릭.\nHidden to tray. Press your hotkey or click the tray icon to show again.")
        .show();
}

#[tauri::command]
fn get_cursor_position() -> CursorPos {
    let device_state = DeviceState::new();
    let mouse = device_state.get_mouse();
    CursorPos {
        x: mouse.coords.0,
        y: mouse.coords.1,
    }
}

#[tauri::command]
fn log_msg(msg: String) {
    println!("[react] {}", msg);
}

fn parse_accel(accelerator: &str) -> Result<Shortcut, String> {
    accelerator
        .parse::<Shortcut>()
        .map_err(|e| format!("parse({accelerator}) failed: {e}"))
}

/// Register or clear a keyboard hotkey slot. Empty `accelerator` clears the
/// slot — used when the user moves that slot's binding to a mouse button.
fn apply_keyboard_hotkey(
    app: &tauri::AppHandle,
    slot: &str,
    accelerator: &str,
) -> Result<(), String> {
    let gs = app.global_shortcut();
    let state = app.state::<Hotkeys>();
    let mut cfg = state.0.lock().unwrap();
    let old = match slot {
        "lookup" => cfg.lookup.take(),
        "toggle" => cfg.toggle.take(),
        _ => return Err(format!("unknown slot: {slot}")),
    };
    if let Some(old) = old {
        let _ = gs.unregister(old);
    }
    if accelerator.is_empty() {
        println!("[hotkey] {slot} cleared");
        return Ok(());
    }
    let parsed = parse_accel(accelerator)?;
    gs.register(parsed.clone())
        .map_err(|e| format!("register {slot}({accelerator}) failed: {e}"))?;
    match slot {
        "lookup" => cfg.lookup = Some(parsed),
        "toggle" => cfg.toggle = Some(parsed),
        _ => unreachable!(),
    }
    println!("[hotkey] {slot} registered: {accelerator}");
    Ok(())
}

#[tauri::command]
fn register_lookup_hotkey(app: tauri::AppHandle, accelerator: String) -> Result<(), String> {
    apply_keyboard_hotkey(&app, "lookup", &accelerator)
}

#[tauri::command]
fn register_toggle_hotkey(app: tauri::AppHandle, accelerator: String) -> Result<(), String> {
    apply_keyboard_hotkey(&app, "toggle", &accelerator)
}

/// Set or clear the mouse-button hotkey for a slot. `button` is one of
/// "MouseMiddle" | "MouseX1" | "MouseX2", or empty string to clear that slot.
fn apply_mouse_hotkey(
    app: &tauri::AppHandle,
    slot: &str,
    button: &str,
) -> Result<(), String> {
    let parsed = if button.is_empty() {
        None
    } else {
        Some(MouseHotkeyButton::from_str(button)
            .ok_or_else(|| format!("unknown mouse button: {button}"))?)
    };
    let state = app.state::<MouseHotkeys>();
    let mut cfg = state.0.lock().unwrap();
    match slot {
        "lookup" => cfg.lookup = parsed,
        "toggle" => cfg.toggle = parsed,
        _ => return Err(format!("unknown slot: {slot}")),
    }
    println!("[hotkey] mouse {slot} = {button}");
    Ok(())
}

#[tauri::command]
fn register_lookup_mouse(app: tauri::AppHandle, button: String) -> Result<(), String> {
    apply_mouse_hotkey(&app, "lookup", &button)
}

#[tauri::command]
fn register_toggle_mouse(app: tauri::AppHandle, button: String) -> Result<(), String> {
    apply_mouse_hotkey(&app, "toggle", &button)
}

/// Background poller that watches the three usable mouse buttons (middle, X1,
/// X2) and emits the same `hotkey-lookup` / `hotkey-toggle` events the
/// keyboard handler emits. Edge-triggered: only emits on the false→true
/// transition so a held button doesn't flood the channel.
fn spawn_mouse_hotkey_thread(app: tauri::AppHandle, cfg: Arc<Mutex<MouseHotkeyConfig>>) {
    thread::spawn(move || {
        let device_state = DeviceState::new();
        let mut prev_pressed = [false; 8];
        // Buttons we actually care about. Left/Right are excluded — binding
        // them would steal normal game input and there's no good UX for it.
        const WATCHED: &[MouseHotkeyButton] = &[
            MouseHotkeyButton::Middle,
            MouseHotkeyButton::X1,
            MouseHotkeyButton::X2,
        ];
        loop {
            let mouse = device_state.get_mouse();
            // device_query returns Vec<bool>; guard against shorter-than-expected.
            let pressed = &mouse.button_pressed;
            for &btn in WATCHED {
                let idx = btn.device_index();
                let now = pressed.get(idx).copied().unwrap_or(false);
                let was = prev_pressed[idx];
                if now && !was {
                    // Edge: button just went down. Decide which event slot,
                    // if any, this button is bound to.
                    let kind = {
                        let c = cfg.lock().unwrap();
                        if c.lookup == Some(btn) {
                            Some("hotkey-lookup")
                        } else if c.toggle == Some(btn) {
                            Some("hotkey-toggle")
                        } else {
                            None
                        }
                    };
                    if let Some(event_name) = kind {
                        // Same window-revival behavior as the keyboard hotkey
                        // path so users on a mouse binding aren't worse off
                        // when they've X-to-tray'd the overlay.
                        if let Some(window) = app.get_webview_window("main") {
                            if !window.is_visible().unwrap_or(true) {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                        let pos = CursorPos {
                            x: mouse.coords.0,
                            y: mouse.coords.1,
                        };
                        println!(
                            "[hotkey] {event_name} (mouse {idx}) cursor=({}, {})",
                            pos.x, pos.y
                        );
                        let _ = app.emit(event_name, pos);
                    }
                }
                prev_pressed[idx] = now;
            }
            thread::sleep(Duration::from_millis(16));
        }
    });
}

#[tauri::command]
fn unregister_all_hotkeys(app: tauri::AppHandle) -> Result<(), String> {
    let gs = app.global_shortcut();
    gs.unregister_all().map_err(|e| e.to_string())?;
    let state = app.state::<Hotkeys>();
    let mut cfg = state.0.lock().unwrap();
    cfg.lookup = None;
    cfg.toggle = None;
    drop(cfg);
    // Clear mouse bindings too — "unregister all" should mean all input
    // sources, not just keyboard.
    let mstate = app.state::<MouseHotkeys>();
    let mut mcfg = mstate.0.lock().unwrap();
    mcfg.lookup = None;
    mcfg.toggle = None;
    println!("[hotkey] unregistered all (keyboard + mouse)");
    Ok(())
}

#[tauri::command]
fn hide_to_tray(app: tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
        println!("[tray] window hidden to tray");
    }
    // Also hide the capture-region preview rectangles. They live in
    // separate always-on-top windows, so hiding the main overlay alone
    // leaves them floating with no UI to dismiss them.
    for label in ["preview-primary", "preview-ground"] {
        if let Some(w) = app.get_webview_window(label) {
            let _ = w.hide();
        }
    }
    notify_minimized_to_tray(&app);
}

/// Show + position a preview-rect window (preview-primary / preview-ground).
/// Used by the settings panel: while the user is editing capture-region
/// offsets, a translucent red/yellow rectangle follows the cursor on screen
/// so they can see exactly where the capture box lands. Click-through is
/// enabled the first time the window is shown so the rectangle never blocks
/// clicks on the game underneath.
#[tauri::command]
fn show_preview_rect(
    app: tauri::AppHandle,
    label: String,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
) -> Result<(), String> {
    let Some(window) = app.get_webview_window(&label) else {
        return Err(format!("preview window '{label}' not found"));
    };
    // Click-through so the user can interact with the game beneath the
    // rectangle. Idempotent on Windows, safe to call every move.
    let _ = window.set_ignore_cursor_events(true);
    // Only do the z-order bump on the transition from hidden -> shown.
    // The frontend polls show_preview_rect at 10Hz; toggling alwaysOnTop
    // 20 times/sec is wasted OS work when the window is already topmost
    // and visible. Re-asserting on every show-from-hidden is still
    // required so the rectangle ends up above the main overlay even if
    // the main was focused after the previous preview session.
    let was_visible = window.is_visible().unwrap_or(false);
    window
        .set_position(tauri::PhysicalPosition::new(x, y))
        .map_err(|e| e.to_string())?;
    window
        .set_size(tauri::PhysicalSize::new(width, height))
        .map_err(|e| e.to_string())?;
    window.show().map_err(|e| e.to_string())?;
    if !was_visible {
        let _ = window.set_always_on_top(false);
        let _ = window.set_always_on_top(true);
    }
    Ok(())
}

#[tauri::command]
fn hide_preview_rect(app: tauri::AppHandle, label: String) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(&label) {
        window.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn exit_app(app: tauri::AppHandle) {
    if let Some(state) = app.try_state::<IsQuitting>() {
        state.0.store(true, Ordering::SeqCst);
    }
    if let Some(state) = app.try_state::<SidecarChild>() {
        if let Some(child) = state.0.lock().unwrap().take() {
            let _ = child.kill();
            println!("[sidecar] killed on exit_app");
        }
    }
    app.exit(0);
}

fn spawn_sidecar(app: &tauri::AppHandle) -> Result<CommandChild, String> {
    let cmd = app
        .shell()
        .sidecar("tarkov-server")
        .map_err(|e| format!("sidecar() failed: {e}"))?;
    let (mut rx, child) = cmd
        .spawn()
        .map_err(|e| format!("sidecar.spawn() failed: {e}"))?;
    println!("[sidecar] tarkov-server spawned (pid via shell-plugin)");

    // Forward sidecar stdout/stderr into our own console for debugging.
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    println!("[sidecar/out] {}", String::from_utf8_lossy(&line));
                }
                CommandEvent::Stderr(line) => {
                    eprintln!("[sidecar/err] {}", String::from_utf8_lossy(&line));
                }
                CommandEvent::Terminated(payload) => {
                    println!("[sidecar] terminated: code={:?}", payload.code);
                    break;
                }
                _ => {}
            }
        }
    });

    Ok(child)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state != ShortcutState::Pressed {
                        return;
                    }
                    // Decide event kind by comparing the pressed shortcut to
                    // the two registered ones. This avoids any string-format
                    // ambiguity ("Shift+F2" vs "shift+f2", etc.).
                    let kind = {
                        let state = app.state::<Hotkeys>();
                        let cfg = state.0.lock().unwrap();
                        if cfg.lookup.as_ref() == Some(shortcut) {
                            Some("hotkey-lookup")
                        } else if cfg.toggle.as_ref() == Some(shortcut) {
                            Some("hotkey-toggle")
                        } else {
                            None
                        }
                    };
                    let Some(event_name) = kind else {
                        println!("[hotkey] {shortcut:?} pressed but unmapped");
                        return;
                    };
                    // If the window is hidden (user clicked X → hide_to_tray),
                    // bring it back so the next emit has somewhere to render.
                    // Same pattern as the tray menu / left-click handlers.
                    if let Some(window) = app.get_webview_window("main") {
                        if !window.is_visible().unwrap_or(true) {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    let device_state = DeviceState::new();
                    let mouse = device_state.get_mouse();
                    let pos = CursorPos {
                        x: mouse.coords.0,
                        y: mouse.coords.1,
                    };
                    println!(
                        "[hotkey] {event_name} ({shortcut:?}) cursor=({}, {})",
                        pos.x, pos.y
                    );
                    let _ = app.emit(event_name, pos);
                })
                .build(),
        )
        .manage(SidecarChild(Mutex::new(None)))
        .manage(IsQuitting(AtomicBool::new(false)))
        .manage(TrayNotifShown(AtomicBool::new(false)))
        .manage(Hotkeys(Mutex::new(HotkeyConfig::default())))
        .manage(MouseHotkeys(Arc::new(Mutex::new(MouseHotkeyConfig::default()))))
        .invoke_handler(tauri::generate_handler![
            get_cursor_position,
            log_msg,
            register_lookup_hotkey,
            register_toggle_hotkey,
            register_lookup_mouse,
            register_toggle_mouse,
            unregister_all_hotkeys,
            hide_to_tray,
            show_preview_rect,
            hide_preview_rect,
            exit_app
        ])
        .setup(|app| {
            // Mouse-button hotkey poller — needs the AppHandle for emits and
            // shares the MouseHotkeys Arc so register_*_mouse takes effect
            // without restarting the thread.
            let mcfg = app.state::<MouseHotkeys>().0.clone();
            spawn_mouse_hotkey_thread(app.handle().clone(), mcfg);

            match spawn_sidecar(&app.handle()) {
                Ok(child) => {
                    let state = app.state::<SidecarChild>();
                    *state.0.lock().unwrap() = Some(child);
                }
                Err(e) => {
                    eprintln!("[sidecar] WARN: could not spawn — {e}. App will run but /lookup will fail until the Python server is started another way.");
                }
            }

            // System tray: hidden from taskbar (skipTaskbar=true), so the
            // tray icon is the only persistent UI surface. Left-click brings
            // the price card up. Right-click opens a menu (Show / Settings / Exit).
            let show_item = MenuItem::with_id(app, "show", "표시 / Show", true, None::<&str>)?;
            let settings_item =
                MenuItem::with_id(app, "settings", "설정 / Settings", true, None::<&str>)?;
            let exit_item = MenuItem::with_id(app, "exit", "종료 / Exit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &settings_item, &exit_item])?;

            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("Tarkov Price Overlay")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                        let _ = app.emit("tray-show", ());
                    }
                    "settings" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                        let _ = app.emit("tray-settings", ());
                    }
                    "exit" => {
                        if let Some(state) = app.try_state::<IsQuitting>() {
                            state.0.store(true, Ordering::SeqCst);
                        }
                        if let Some(state) = app.try_state::<SidecarChild>() {
                            if let Some(child) = state.0.lock().unwrap().take() {
                                let _ = child.kill();
                                println!("[sidecar] killed via tray exit");
                            }
                        }
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                        let _ = app.emit("tray-show", ());
                    }
                })
                .build(app)?;

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| match event {
        // OS-level close (Alt+F4, last-window-closed, etc.) — if the user
        // hasn't actually picked tray "Exit", hide to tray and notify
        // instead of quitting.
        RunEvent::ExitRequested { api, .. } => {
            let quitting = app_handle
                .try_state::<IsQuitting>()
                .map(|s| s.0.load(Ordering::SeqCst))
                .unwrap_or(false);
            if !quitting {
                api.prevent_exit();
                if let Some(window) = app_handle.get_webview_window("main") {
                    let _ = window.hide();
                }
                // Hide preview rectangles too (same reason as hide_to_tray:
                // they're independent windows that survive main-window hide).
                for label in ["preview-primary", "preview-ground"] {
                    if let Some(w) = app_handle.get_webview_window(label) {
                        let _ = w.hide();
                    }
                }
                notify_minimized_to_tray(app_handle);
            }
        }
        RunEvent::Exit => {
            if let Some(state) = app_handle.try_state::<SidecarChild>() {
                if let Some(child) = state.0.lock().unwrap().take() {
                    let _ = child.kill();
                    println!("[sidecar] killed on app exit");
                }
            }
        }
        _ => {}
    });
}
