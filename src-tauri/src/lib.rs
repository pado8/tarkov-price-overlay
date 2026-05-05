use std::sync::Mutex;

use device_query::{DeviceQuery, DeviceState};
use serde::Serialize;
use tauri::{Emitter, Manager, RunEvent};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

#[derive(Serialize, Clone)]
struct CursorPos {
    x: i32,
    y: i32,
}

/// Holds the spawned Python sidecar so we can kill it on app exit.
struct SidecarChild(Mutex<Option<CommandChild>>);

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
        .invoke_handler(tauri::generate_handler![
            get_cursor_position,
            log_msg,
            register_hotkey,
            unregister_hotkey
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
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        if let RunEvent::ExitRequested { .. } | RunEvent::Exit = event {
            // Kill the sidecar so the Python process doesn't outlive the GUI.
            if let Some(state) = app_handle.try_state::<SidecarChild>() {
                if let Some(child) = state.0.lock().unwrap().take() {
                    let _ = child.kill();
                    println!("[sidecar] killed on app exit");
                }
            }
        }
    });
}
