use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

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

#[tauri::command]
fn register_lookup_hotkey(app: tauri::AppHandle, accelerator: String) -> Result<(), String> {
    let parsed = parse_accel(&accelerator)?;
    let gs = app.global_shortcut();
    let state = app.state::<Hotkeys>();
    let mut cfg = state.0.lock().unwrap();
    if let Some(old) = cfg.lookup.take() {
        let _ = gs.unregister(old);
    }
    gs.register(parsed.clone())
        .map_err(|e| format!("register lookup({accelerator}) failed: {e}"))?;
    cfg.lookup = Some(parsed);
    println!("[hotkey] lookup registered: {accelerator}");
    Ok(())
}

#[tauri::command]
fn register_toggle_hotkey(app: tauri::AppHandle, accelerator: String) -> Result<(), String> {
    let parsed = parse_accel(&accelerator)?;
    let gs = app.global_shortcut();
    let state = app.state::<Hotkeys>();
    let mut cfg = state.0.lock().unwrap();
    if let Some(old) = cfg.toggle.take() {
        let _ = gs.unregister(old);
    }
    gs.register(parsed.clone())
        .map_err(|e| format!("register toggle({accelerator}) failed: {e}"))?;
    cfg.toggle = Some(parsed);
    println!("[hotkey] toggle registered: {accelerator}");
    Ok(())
}

#[tauri::command]
fn unregister_all_hotkeys(app: tauri::AppHandle) -> Result<(), String> {
    let gs = app.global_shortcut();
    gs.unregister_all().map_err(|e| e.to_string())?;
    let state = app.state::<Hotkeys>();
    let mut cfg = state.0.lock().unwrap();
    cfg.lookup = None;
    cfg.toggle = None;
    println!("[hotkey] unregistered all");
    Ok(())
}

#[tauri::command]
fn hide_to_tray(app: tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
        println!("[tray] window hidden to tray");
    }
    notify_minimized_to_tray(&app);
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
        .invoke_handler(tauri::generate_handler![
            get_cursor_position,
            log_msg,
            register_lookup_hotkey,
            register_toggle_hotkey,
            unregister_all_hotkeys,
            hide_to_tray,
            exit_app
        ])
        .setup(|app| {
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
