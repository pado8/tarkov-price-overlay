use device_query::{DeviceQuery, DeviceState};
use serde::Serialize;
use tauri::Emitter;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

#[derive(Serialize, Clone)]
struct CursorPos {
    x: i32,
    y: i32,
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state == ShortcutState::Pressed
                        && shortcut.matches(Modifiers::empty(), Code::F2)
                    {
                        let device_state = DeviceState::new();
                        let mouse = device_state.get_mouse();
                        let pos = CursorPos {
                            x: mouse.coords.0,
                            y: mouse.coords.1,
                        };
                        println!("[hotkey] F2 pressed, cursor=({}, {})", pos.x, pos.y);
                        match app.emit("hotkey-lookup", pos) {
                            Ok(_) => println!("[hotkey] emitted hotkey-lookup event"),
                            Err(e) => println!("[hotkey] emit failed: {:?}", e),
                        }
                    }
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![get_cursor_position, log_msg])
        .setup(|app| {
            let f2 = Shortcut::new(None, Code::F2);
            match app.global_shortcut().register(f2) {
                Ok(_) => println!("[setup] F2 global shortcut registered"),
                Err(e) => println!("[setup] F2 registration FAILED: {:?}", e),
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
