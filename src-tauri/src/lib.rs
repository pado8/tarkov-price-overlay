use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use device_query::{DeviceQuery, DeviceState};
use serde::Serialize;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, Manager, RunEvent};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
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

fn notify_minimized_to_tray(app: &tauri::AppHandle) {
    let _ = app
        .notification()
        .builder()
        .title("Tarkov Price Overlay")
        .body("앱이 시스템 트레이에서 실행 중입니다. 트레이 아이콘 우클릭 → 종료\nApp is running in the system tray. Right-click tray icon → Exit to quit.")
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

#[tauri::command]
fn register_hotkey(app: tauri::AppHandle, accelerator: String) -> Result<(), String> {
    let gs = app.global_shortcut();
    let _ = gs.unregister_all();
    gs.register(accelerator.as_str()).map_err(|e| {
        let msg = format!("register({}) failed: {}", accelerator, e);
        println!("[hotkey] {}", msg);
        msg
    })?;
    println!("[hotkey] registered: {}", accelerator);
    Ok(())
}

#[tauri::command]
fn unregister_hotkey(app: tauri::AppHandle) -> Result<(), String> {
    let gs = app.global_shortcut();
    gs.unregister_all().map_err(|e| e.to_string())?;
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
                    // Any registered shortcut triggers a lookup. The frontend
                    // owns which key is currently registered.
                    if event.state == ShortcutState::Pressed {
                        let device_state = DeviceState::new();
                        let mouse = device_state.get_mouse();
                        let pos = CursorPos {
                            x: mouse.coords.0,
                            y: mouse.coords.1,
                        };
                        println!(
                            "[hotkey] {:?} pressed, cursor=({}, {})",
                            shortcut, pos.x, pos.y
                        );
                        let _ = app.emit("hotkey-lookup", pos);
                    }
                })
                .build(),
        )
        .manage(SidecarChild(Mutex::new(None)))
        .manage(IsQuitting(AtomicBool::new(false)))
        .invoke_handler(tauri::generate_handler![
            get_cursor_position,
            log_msg,
            register_hotkey,
            unregister_hotkey,
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
