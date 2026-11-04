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

/// Reveal the main overlay window WITHOUT activating it, so it never steals
/// keyboard/mouse focus from the foreground game. A plain `window.show()` runs
/// ShowWindow(SW_SHOW) which ACTIVATES the window — that's what made ESC/Tab go
/// to the overlay instead of Tarkov after the card auto-hid and a hotkey
/// re-revealed it (reported on 1.1.1/1.1.2). SW_SHOWNOACTIVATE makes it visible
/// (it stays topmost, so it's still above the game) while leaving focus with
/// the game. Clicking the overlay still activates it normally, so settings /
/// correction typing is unaffected. Falls back to a normal show off-Windows or
/// if the HWND can't be obtained.
#[cfg(windows)]
fn reveal_overlay_no_activate(window: &tauri::WebviewWindow) {
    #[link(name = "user32")]
    extern "system" {
        fn ShowWindow(hwnd: isize, n_cmd_show: i32) -> i32;
    }
    const SW_SHOWNOACTIVATE: i32 = 4;
    match window.hwnd() {
        Ok(hwnd) => unsafe {
            ShowWindow(hwnd.0 as isize, SW_SHOWNOACTIVATE);
        },
        Err(_) => {
            let _ = window.show();
        }
    }
}

#[cfg(not(windows))]
fn reveal_overlay_no_activate(window: &tauri::WebviewWindow) {
    let _ = window.show();
}

/// Frontend-invokable passive reveal — used by the F2 / toggle handlers so a
/// re-shown price card doesn't pull focus off the game.
#[tauri::command]
fn show_overlay_passive(app: tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        reveal_overlay_no_activate(&window);
    }
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

/// Cooperative stop flag for the mouse poller. Set on tray Exit /
/// exit_app / RunEvent::Exit so the thread gets one clean iteration to
/// notice and break out instead of being abruptly terminated mid-emit.
/// Closes the race with the installer hook's taskkill on auto-update.
struct MouseHotkeyStop(Arc<AtomicBool>);

/// "조회 키를 게임에도 전달" 모드. RegisterHotKey로 잡은 키는 OS가 가로채서 전경 앱(게임)에
/// 전달하지 않는다 — 일반 메시지도, Raw Input도 안 간다(2026-10-26 실험). 그래서 게임 스크린샷
/// 키와 같은 키를 쓰고 싶으면 등록 대신 **키 상태만 엿듣는다**(마우스 버튼과 같은 방식,
/// device_query/GetAsyncKeyState). 게임에 키를 넣어 주는 방식(SendInput)은 안티치트 쪽
/// 불확실성이 있어 쓰지 않는다.
/// `vk` = Windows 가상 키 코드. device_query 대신 GetAsyncKeyState를 직접 읽는 이유: 0x8000(지금
/// 눌림)만 보면 16ms 폴링 사이에 끝나는 짧은 누름을 놓친다(실행 시험에서 3/3 놓침). 0x0001(마지막
/// 호출 이후 눌린 적 있음) 비트까지 보면 놓치지 않는다.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
struct PollKey {
    vk: u16,
    shift: bool,
    ctrl: bool,
    alt: bool,
}

#[derive(Default, Clone, Copy)]
struct KeyPollConfig {
    lookup: Option<PollKey>,
    toggle: Option<PollKey>,
}
struct KeyPolls(Arc<Mutex<KeyPollConfig>>);
struct HotkeyPassthrough(AtomicBool);

/// Tauri 가속기 문자열("Shift+F2", "F5", "Ctrl+Alt+K")을 폴링용 키로. 지원 안 하는 키면 None
/// → 호출 쪽이 RegisterHotKey로 되돌아간다(그 키는 게임과 공유 불가).
fn parse_poll_key(accelerator: &str) -> Option<PollKey> {
    let mut pk = PollKey { vk: 0, shift: false, ctrl: false, alt: false };
    let mut main: Option<u16> = None;
    for tok in accelerator.split('+').map(|s| s.trim()).filter(|s| !s.is_empty()) {
        let t = tok.to_ascii_lowercase();
        match t.as_str() {
            "shift" => pk.shift = true,
            "ctrl" | "control" | "commandorcontrol" | "cmdorctrl" | "command" | "super" | "meta" => pk.ctrl = true,
            "alt" | "option" => pk.alt = true,
            _ => {
                let b = t.as_bytes();
                let vk: u16 = if t.len() >= 2 && b[0] == b'f' && t[1..].chars().all(|c| c.is_ascii_digit()) {
                    // F1~F12 → VK_F1(0x70)~
                    match t[1..].parse::<u16>() {
                        Ok(n) if (1..=12).contains(&n) => 0x6F + n,
                        _ => return None,
                    }
                } else if t.len() == 1 && b[0].is_ascii_alphanumeric() {
                    b[0].to_ascii_uppercase() as u16 // 'A'..'Z' = 0x41.., '0'..'9' = 0x30..
                } else if let Some(d) = t.strip_prefix("digit").or_else(|| t.strip_prefix("key")) {
                    if d.len() == 1 && d.as_bytes()[0].is_ascii_alphanumeric() { d.as_bytes()[0].to_ascii_uppercase() as u16 } else { return None }
                } else {
                    match t.as_str() {
                        "insert" => 0x2D, "home" => 0x24, "end" => 0x23, "pageup" => 0x21, "pagedown" => 0x22,
                        "delete" => 0x2E, "space" => 0x20, "tab" => 0x09, "enter" | "return" => 0x0D,
                        "`" | "backquote" | "grave" => 0xC0, "-" | "minus" => 0xBD, "=" | "equal" => 0xBB,
                        _ => return None,
                    }
                };
                if main.is_some() {
                    return None;
                }
                main = Some(vk);
            }
        }
    }
    pk.vk = main?;
    Some(pk)
}

#[cfg(windows)]
fn async_key(vk: u16) -> u16 {
    #[link(name = "user32")]
    extern "system" {
        fn GetAsyncKeyState(vkey: i32) -> i16;
    }
    unsafe { GetAsyncKeyState(vk as i32) as u16 }
}
#[cfg(not(windows))]
fn async_key(_vk: u16) -> u16 {
    0
}

/// `main_state` = 주 키의 GetAsyncKeyState 값(호출 쪽이 한 번만 읽어 넘긴다 — 0x0001 비트는 읽으면
/// 지워지므로 조회·토글이 같은 키를 쓸 때 두 번 읽으면 둘째가 못 본다). 주 키는 "지금 눌림(0x8000)
/// 또는 지난 폴링 이후 눌린 적 있음(0x0001)". 수식키는 등록 방식과 똑같이 **정확히** 일치해야 한다 —
/// F2 바인딩은 Shift+F2에 울리지 않는다.
fn poll_mods_match(pk: &PollKey) -> bool {
    const VK_SHIFT: u16 = 0x10;
    const VK_CONTROL: u16 = 0x11;
    const VK_MENU: u16 = 0x12; // Alt
    let held = |vk: u16| async_key(vk) & 0x8000 != 0;
    pk.shift == held(VK_SHIFT) && pk.ctrl == held(VK_CONTROL) && pk.alt == held(VK_MENU)
}

/// 엿듣기 키 한 틱 판정 → (울림, 지금 주 키 눌림). 울림 = **주 키가 이번 틱에 새로 눌렸고**(0x8000 상승,
/// 또는 틱 사이 짧은 탭 = 0x0001 만 남음) **그 순간** 수식키가 정확히 일치할 때. 주 키를 누르고 있는 동안
/// 수식키만 바뀌는 건 새 누름이 아니다.
/// 2026-11-04: 예전엔 '주 키 눌림 && 수식키 일치' 조합의 상승을 봤다 — 조회 F2 + 토글 Shift+F2 일 때
/// Shift+F2 를 누르고 Shift 를 F2 보다 먼저 떼면 'F2 && Shift 없음' 이 새로 참이 돼 빈 곳 조회가 한 번 더 터졌다.
fn key_edge(prev_main_down: bool, main_state: u16, mods_match: bool) -> (bool, bool) {
    let down = main_state & 0x8000 != 0;
    let tapped = !down && main_state & 0x0001 != 0;
    let fired = mods_match && !prev_main_down && (down || tapped);
    (fired, down)
}

#[cfg(test)]
mod key_edge_tests {
    use super::key_edge;
    const DOWN: u16 = 0x8000;
    const TAP: u16 = 0x0001;
    /// 조회=F2(수식키 없음)·토글=Shift+F2 가 같은 주 키를 나눠 쓰는 상황을 틱 단위로 흉내 낸다.
    /// steps = (주 키 상태, Shift 눌림). 반환 = (조회 울린 횟수, 토글 울린 횟수)
    fn run(steps: &[(u16, bool)]) -> (u32, u32) {
        let (mut pl, mut pt, mut nl, mut nt) = (false, false, 0, 0);
        for &(st, shift) in steps {
            let (fl, dl) = key_edge(pl, st, !shift);
            let (ft, dt) = key_edge(pt, st, shift);
            pl = dl;
            pt = dt;
            nl += fl as u32;
            nt += ft as u32;
        }
        (nl, nt)
    }
    #[test]
    fn shift_f2_then_release_shift_first_does_not_fire_lookup() {
        // Shift 누름 → F2 누름(토글) → Shift 먼저 뗌(F2 계속 눌림) → F2 뗌
        assert_eq!(run(&[(0, true), (DOWN | TAP, true), (DOWN, true), (DOWN, false), (DOWN, false), (0, false)]), (0, 1));
    }
    #[test]
    fn shift_f2_release_f2_first() {
        assert_eq!(run(&[(0, true), (DOWN | TAP, true), (0, true), (0, false)]), (0, 1));
    }
    #[test]
    fn plain_f2_fires_lookup_once_while_held() {
        assert_eq!(run(&[(0, false), (DOWN | TAP, false), (DOWN, false), (DOWN, false), (0, false)]), (1, 0));
    }
    #[test]
    fn quick_tap_between_ticks_still_fires() {
        assert_eq!(run(&[(0, false), (TAP, false), (0, false)]), (1, 0));
        assert_eq!(run(&[(0, true), (TAP, true), (0, true)]), (0, 1));
    }
    #[test]
    fn f2_held_then_shift_pressed_is_not_toggle() {
        // F2 를 누른 채 Shift 를 눌러도 토글이 아니다(새 누름 아님)
        assert_eq!(run(&[(0, false), (DOWN | TAP, false), (DOWN, true), (DOWN, true), (0, true)]), (1, 0));
    }
    #[test]
    fn two_presses_fire_twice() {
        assert_eq!(run(&[(DOWN | TAP, false), (0, false), (DOWN | TAP, false), (0, false)]), (2, 0));
    }
}

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
    // 엿듣기 슬롯도 비운다 — 등록 방식이 바뀌어도 옛 바인딩이 같이 울리지 않게
    {
        let kstate = app.state::<KeyPolls>();
        let mut k = kstate.0.lock().unwrap();
        match slot {
            "lookup" => k.lookup = None,
            _ => k.toggle = None,
        }
    }
    if accelerator.is_empty() {
        println!("[hotkey] {slot} cleared");
        return Ok(());
    }
    let passthrough = app
        .try_state::<HotkeyPassthrough>()
        .map(|s| s.0.load(Ordering::SeqCst))
        .unwrap_or(false);
    if passthrough {
        if let Some(pk) = parse_poll_key(accelerator) {
            let kstate = app.state::<KeyPolls>();
            let mut k = kstate.0.lock().unwrap();
            match slot {
                "lookup" => k.lookup = Some(pk),
                _ => k.toggle = Some(pk),
            }
            println!("[hotkey] {slot} passthrough(poll): {accelerator} → {pk:?}");
            return Ok(());
        }
        println!("[hotkey] {slot} passthrough unsupported for {accelerator} — falling back to RegisterHotKey");
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

/// "조회 키를 게임에도 전달" 켜기/끄기. 프론트는 이걸 먼저 부른 뒤 register_*_hotkey를 다시
/// 불러 등록 방식을 바꾼다. 반환값 = 지금 lookup 가속기가 엿듣기로 표현 가능한지(아니면 공유 불가).
#[tauri::command]
fn set_hotkey_passthrough(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    // 자동화 시험용 환경변수가 있으면 프론트의 저장값보다 우선(웹뷰 localStorage 없이 모드 고정)
    let enabled = match std::env::var("TPO_HOTKEY_PASSTHROUGH") {
        Ok(v) if v == "1" || v == "0" => v == "1",
        _ => enabled,
    };
    app.state::<HotkeyPassthrough>().0.store(enabled, Ordering::SeqCst);
    println!("[hotkey] passthrough = {enabled}");
    Ok(())
}

#[tauri::command]
fn hotkey_passthrough_supported(accelerator: String) -> bool {
    parse_poll_key(&accelerator).is_some()
}

/// Background poller that watches the three usable mouse buttons (middle, X1,
/// X2) and emits the same `hotkey-lookup` / `hotkey-toggle` events the
/// keyboard handler emits. Edge-triggered: only emits on the false→true
/// transition so a held button doesn't flood the channel.
fn spawn_mouse_hotkey_thread(
    app: tauri::AppHandle,
    cfg: Arc<Mutex<MouseHotkeyConfig>>,
    kcfg: Arc<Mutex<KeyPollConfig>>,
    stop: Arc<AtomicBool>,
) {
    thread::spawn(move || {
        let device_state = DeviceState::new();
        let mut prev_pressed = [false; 8];
        // 엿듣기 키(passthrough) — 마우스와 같은 edge 트리거
        let mut prev_key = [false; 2];
        // Buttons we actually care about. Left/Right are excluded — binding
        // them would steal normal game input and there's no good UX for it.
        const WATCHED: &[MouseHotkeyButton] = &[
            MouseHotkeyButton::Middle,
            MouseHotkeyButton::X1,
            MouseHotkeyButton::X2,
        ];
        loop {
            if stop.load(Ordering::SeqCst) {
                println!("[hotkey] mouse poller stopped");
                return;
            }
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
                        // when they've X-to-tray'd the overlay. Passive reveal
                        // (no activation) so it doesn't steal focus from the game.
                        if let Some(window) = app.get_webview_window("main") {
                            if !window.is_visible().unwrap_or(true) {
                                reveal_overlay_no_activate(&window);
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
            // 키보드 엿듣기: 등록(RegisterHotKey) 대신 상태만 읽으므로 게임도 같은 키를 받는다.
            let kc = *kcfg.lock().unwrap();
            if kc.lookup.is_some() || kc.toggle.is_some() {
                // 주 키 상태는 슬롯당 한 번만 읽는다(같은 키를 둘이 쓰면 공유)
                let s_lookup = kc.lookup.map(|p| async_key(p.vk)).unwrap_or(0);
                let s_toggle = match (kc.lookup, kc.toggle) {
                    (Some(a), Some(b)) if a.vk == b.vk => s_lookup,
                    (_, Some(b)) => async_key(b.vk),
                    _ => 0,
                };
                for (i, (pk, state, event_name)) in [(kc.lookup, s_lookup, "hotkey-lookup"), (kc.toggle, s_toggle, "hotkey-toggle")]
                    .into_iter()
                    .enumerate()
                {
                    let (fired, main_down) = match pk {
                        Some(p) => key_edge(prev_key[i], state, poll_mods_match(&p)),
                        None => (false, false),
                    };
                    if fired {
                        if let Some(window) = app.get_webview_window("main") {
                            if !window.is_visible().unwrap_or(true) {
                                reveal_overlay_no_activate(&window);
                            }
                        }
                        let pos = CursorPos {
                            x: mouse.coords.0,
                            y: mouse.coords.1,
                        };
                        println!("[hotkey] {event_name} (passthrough {:?}) cursor=({}, {})", pk, pos.x, pos.y);
                        let _ = app.emit(event_name, pos);
                    }
                    prev_key[i] = main_down;
                }
            } else {
                prev_key = [false; 2];
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
    drop(mcfg);
    let kstate = app.state::<KeyPolls>();
    let mut kcfg = kstate.0.lock().unwrap();
    kcfg.lookup = None;
    kcfg.toggle = None;
    println!("[hotkey] unregistered all (keyboard + mouse + passthrough)");
    Ok(())
}

/// Snap the main overlay window to the primary monitor's top-left corner.
/// Panic-button for users whose saved window position lands on a now-
/// disconnected secondary display. The React side also does this on
/// startup, but having a tray entry means a stranded user can recover
/// without restarting the app.
#[tauri::command]
fn recover_window_position(app: tauri::AppHandle) -> Result<(), String> {
    let Some(window) = app.get_webview_window("main") else {
        return Err("main window not found".into());
    };
    let monitor = window
        .primary_monitor()
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "no primary monitor".to_string())?;
    let pos = monitor.position();
    // Inset by 40px so the overlay isn't flush against the screen edge —
    // the resize handle on the settings panel needs a little headroom.
    window
        .set_position(tauri::PhysicalPosition::new(pos.x + 40, pos.y + 40))
        .map_err(|e| e.to_string())?;
    window.show().map_err(|e| e.to_string())?;
    let _ = window.set_focus();
    println!(
        "[recover] window snapped to primary monitor at ({}, {})",
        pos.x + 40,
        pos.y + 40
    );
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
    for label in ["preview-primary", "preview-ground", "preview-anchor"] {
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

/// True when the running .exe is part of a portable ZIP distribution.
///
/// portable.ps1 drops a `_portable.marker` file next to the exe at build
/// time; NSIS installs never have it. We use that to gate the in-app
/// auto-updater: portable users get a "open downloads page" link instead
/// of `update.downloadAndInstall()`, which would otherwise install a
/// *second* copy at the default NSIS path and leave the portable folder
/// pinned at the old version with no exe replacement.
#[tauri::command]
fn is_portable_install() -> bool {
    let Ok(exe_path) = std::env::current_exe() else {
        return false;
    };
    let Some(exe_dir) = exe_path.parent() else {
        return false;
    };
    exe_dir.join("_portable.marker").exists()
}

// ── 포터블 → 설치판 원클릭 전환 (1.2.7) ─────────────────────────────────────
// 포터블은 exe 를 스스로 바꿀 수 없어 옛 버전에 머문다. 업데이터의 설치 파일을 그대로 돌리면
// %LOCALAPPDATA%\Tarkov Price Overlay 에 설치판이 생기고, 데이터(WebView2 = %LOCALAPPDATA%\com.tarkov.overlay,
// 퀘스트 상태 = %LOCALAPPDATA%\TarkovPriceOverlay, 설치 ID = %PROGRAMDATA%)는 exe 위치와 무관해 그대로 이어진다.
// 함정: 업데이터는 설치 파일을 '업데이트 모드'(/UPDATE)로 돌리고, 그 모드에선 Tauri 템플릿이 시작 메뉴·바탕화면
// 바로가기 생성을 건너뛴다 → 전환 직후 바로가기 0개. 그래서 설치 직전에 이 표시 파일을 남기고,
// installer-hooks.nsh 의 POSTINSTALL 이 이 파일을 보면 바로가기를 만든다. 설치판 첫 실행이 읽고 지운다.
const PORTABLE_SWITCH_MARKER: &str = "from_portable.json";
const INSTALLED_EXE: &str = "tarkov-price-overlay.exe";

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

fn now_ms() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

/// 포터블에서 '설치판으로 전환'을 누른 직후(설치 파일 실행 직전) 부른다.
#[tauri::command]
fn mark_portable_switch(app: tauri::AppHandle, from_version: String) -> Result<String, String> {
    let dir = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let portable_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.to_string_lossy().into_owned()))
        .unwrap_or_default();
    let body = serde_json::json!({
        "portable_dir": portable_dir,
        "from_version": from_version.chars().take(32).collect::<String>(),
        "ts": now_ms() as u64,
    });
    let path = dir.join(PORTABLE_SWITCH_MARKER);
    std::fs::write(&path, body.to_string()).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

/// 설치판 첫 실행: 표시 파일이 있으면 내용을 돌려주고 지운다(한 번만). 바로가기가 실제로 생겼는지도 같이 본다.
#[tauri::command]
fn take_portable_switch(app: tauri::AppHandle) -> Option<serde_json::Value> {
    if is_portable_install() {
        return None;
    }
    let path = app.path().app_local_data_dir().ok()?.join(PORTABLE_SWITCH_MARKER);
    let raw = std::fs::read_to_string(&path).ok()?;
    let _ = std::fs::remove_file(&path);
    let mut v: serde_json::Value = serde_json::from_str(&raw).unwrap_or_else(|_| serde_json::json!({}));
    let lnk_name = format!("{}.lnk", product_name(&app));
    let lnk = |base: Option<std::path::PathBuf>| base.map(|b| b.join(&lnk_name).exists()).unwrap_or(false);
    let start_menu = lnk(std::env::var_os("APPDATA").map(|a| {
        std::path::PathBuf::from(a).join("Microsoft\\Windows\\Start Menu\\Programs")
    }));
    let desktop = lnk(app.path().desktop_dir().ok());
    if let Some(o) = v.as_object_mut() {
        o.insert("start_menu_shortcut".into(), start_menu.into());
        o.insert("desktop_shortcut".into(), desktop.into());
    }
    Some(v)
}

/// 레지스트리 제거 정보의 InstallLocation (NSIS 가 따옴표로 감싸 적는다). HKCU 먼저, 없으면 HKLM.
/// reg.exe 출력은 한국어 윈도우에서 cp949 라 한글 사용자 폴더 경로가 깨져서 API 로 UTF-16 을 직접 읽는다.
#[cfg(windows)]
fn registry_install_location(product: &str) -> Option<std::path::PathBuf> {
    use windows_sys::Win32::System::Registry::{RegGetValueW, HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, RRF_RT_REG_SZ};
    let wide = |s: &str| s.encode_utf16().chain(std::iter::once(0)).collect::<Vec<u16>>();
    let sub = wide(&format!("Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\{product}"));
    let name = wide("InstallLocation");
    for root in [HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE] {
        let mut buf = vec![0u16; 2048];
        let mut size: u32 = (buf.len() * 2) as u32;
        // SAFETY: 버퍼 크기를 바이트로 넘기고, 성공 시 size 는 실제로 쓴 바이트 수(끝 NUL 포함)
        let rc = unsafe {
            RegGetValueW(root, sub.as_ptr(), name.as_ptr(), RRF_RT_REG_SZ, std::ptr::null_mut(), buf.as_mut_ptr().cast(), &mut size)
        };
        if rc != 0 {
            continue;
        }
        let n = (size as usize / 2).min(buf.len());
        let s = String::from_utf16_lossy(&buf[..n]);
        let v = s.trim_end_matches('\0').trim().trim_matches('"').trim();
        if !v.is_empty() {
            return Some(std::path::PathBuf::from(v));
        }
    }
    None
}

#[cfg(not(windows))]
fn registry_install_location(_product: &str) -> Option<std::path::PathBuf> {
    None
}

/// tauri.conf productName = NSIS 제거 정보 키 이름 = 바로가기 이름
fn product_name(app: &tauri::AppHandle) -> String {
    app.config().product_name.clone().unwrap_or_else(|| "Tarkov Price Overlay".into())
}

fn installed_copy_path(product: &str) -> Option<std::path::PathBuf> {
    let exe = registry_install_location(product)?.join(INSTALLED_EXE);
    if !exe.is_file() {
        return None;
    }
    // 지금 돌고 있는 exe 자신이면(설치 폴더에 포터블 표시가 있는 이상한 경우) 안내하지 않는다
    if let Ok(cur) = std::env::current_exe() {
        if cur.canonicalize().ok() == exe.canonicalize().ok() {
            return None;
        }
    }
    Some(exe)
}

/// 포터블 실행 중일 때만: 이 PC 에 설치판이 있으면 그 exe 경로.
#[tauri::command]
fn find_installed_copy(app: tauri::AppHandle) -> Option<String> {
    if !is_portable_install() {
        return None;
    }
    installed_copy_path(&product_name(&app)).map(|p| p.to_string_lossy().into_owned())
}

/// 설치판을 켜고 이 포터블은 끝낸다. 설치판이 단일 실행 잠금·사이드카 포트를 잡을 수 있게
/// 1.5초 뒤에 켜지도록 숨은 PowerShell 에 맡기고 바로 종료한다(relaunch_as_admin 과 같은 방식).
#[tauri::command]
fn launch_installed_copy(app: tauri::AppHandle) -> Result<(), String> {
    let exe = installed_copy_path(&product_name(&app)).ok_or_else(|| "installed copy not found".to_string())?;
    let exe_str = exe.to_string_lossy().replace('\'', "''");
    let mut cmd = std::process::Command::new("powershell");
    cmd.args([
        "-NoProfile",
        "-WindowStyle",
        "Hidden",
        "-Command",
        &format!("Start-Sleep -Milliseconds 1500; Start-Process -FilePath '{exe_str}'"),
    ]);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd.spawn().map_err(|e| format!("launch installed failed: {e}"))?;
    prepare_quit(app.clone());
    app.exit(0);
    Ok(())
}

/// 탐색기로 폴더 열기(옛 포터블 폴더 안내용). 실제 있는 폴더만.
#[tauri::command]
fn open_folder(path: String) -> Result<(), String> {
    let p = std::path::PathBuf::from(&path);
    if !p.is_dir() {
        return Err("folder not found".into());
    }
    std::process::Command::new("explorer")
        .arg(p)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// Resolve the stable, machine-wide install id and persist it.
///
/// The id used to live ONLY in WebView2 localStorage, which a reinstall, a
/// cache wipe, or a portable↔installer switch all clear — so one physical PC
/// minted a brand-new id (and looked like a new user) on every such event,
/// inflating the unique-user count. This stores it under
/// `%PROGRAMDATA%\TarkovPriceOverlay\install_id`: machine-wide (shared across
/// Windows accounts) and outside both the install dir and the WebView2 data
/// folder, so it survives all of the above → one id per PC.
///
/// `candidate` is the caller's current localStorage id (a UUID). If the file
/// already holds a valid id it wins — that's what keeps the id stable. Only
/// when the file is absent/corrupt do we adopt `candidate`, which PROMOTES an
/// existing user's localStorage id instead of resetting their identity. The
/// caller mirrors the returned value back into localStorage so both stores
/// agree. Best-effort: any filesystem failure falls back to returning
/// `candidate`, so telemetry keeps working (just not PC-stable) rather than
/// breaking.
#[tauri::command]
fn resolve_install_id(candidate: String) -> String {
    let valid = |s: &str| -> bool {
        s.len() == 36
            && s.as_bytes().iter().enumerate().all(|(i, &b)| match i {
                8 | 13 | 18 | 23 => b == b'-',
                _ => b.is_ascii_hexdigit(),
            })
    };

    let Some(program_data) = std::env::var_os("ProgramData") else {
        return candidate;
    };
    let dir = std::path::Path::new(&program_data).join("TarkovPriceOverlay");
    let file = dir.join("install_id");

    // Existing machine id wins: this is what makes the id survive reinstall,
    // cache wipe, portable↔installer, and second Windows accounts on the PC.
    if let Ok(existing) = std::fs::read_to_string(&file) {
        let existing = existing.trim();
        if valid(existing) {
            return existing.to_string();
        }
    }

    // First run on this PC (or a corrupt file): adopt the caller's id so an
    // existing user isn't reset, and persist it for next time.
    let id = candidate.trim().to_string();
    let _ = std::fs::create_dir_all(&dir);
    let _ = std::fs::write(&file, &id);
    id
}

/// 종료 준비만(quitting 플래그 + 마우스 훅 정지 + 사이드카 kill). 11-03: 받아 둔
/// 업데이트를 종료 때 설치할 때 설치 프로그램이 프로세스를 끝내기 전에 사이드카를
/// 먼저 정리하려고 exit_app 에서 분리했다.
#[tauri::command]
fn prepare_quit(app: tauri::AppHandle) {
    if let Some(state) = app.try_state::<IsQuitting>() {
        state.0.store(true, Ordering::SeqCst);
    }
    if let Some(state) = app.try_state::<MouseHotkeyStop>() {
        state.0.store(true, Ordering::SeqCst);
    }
    if let Some(state) = app.try_state::<SidecarChild>() {
        if let Some(child) = state.0.lock().unwrap().take() {
            let _ = child.kill();
            println!("[sidecar] killed on prepare_quit");
        }
    }
}

#[tauri::command]
fn exit_app(app: tauri::AppHandle) {
    prepare_quit(app.clone());
    app.exit(0);
}

/// Relaunch the app elevated. Tarkov runs as admin (BattlEye), so a non-
/// elevated overlay can't receive the F2 global hotkey or draw over the game
/// (Windows UIPI) — the #1 cause of "F2 does nothing in-game". This spawns an
/// elevated copy via the "runas" verb (UAC prompt) then quits this instance so
/// the elevated one takes over the single-instance lock + the sidecar's port.
#[tauri::command]
fn relaunch_as_admin(app: tauri::AppHandle) -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    // Escape single quotes for the PowerShell single-quoted string literal.
    let exe_str = exe.to_string_lossy().replace('\'', "''");
    std::process::Command::new("powershell")
        .args([
            "-NoProfile",
            "-WindowStyle",
            "Hidden",
            "-Command",
            &format!("Start-Process -FilePath '{exe_str}' -Verb RunAs"),
        ])
        .spawn()
        .map_err(|e| format!("elevated relaunch failed: {e}"))?;
    // Quit this (non-elevated) instance so the elevated copy can grab the
    // single-instance lock and re-bind the Python sidecar port. Same teardown
    // as tray Exit. If the user cancels the UAC prompt nothing relaunches —
    // they can reopen from the Start Menu (acceptable for a rare cancel).
    if let Some(state) = app.try_state::<IsQuitting>() {
        state.0.store(true, Ordering::SeqCst);
    }
    if let Some(state) = app.try_state::<MouseHotkeyStop>() {
        state.0.store(true, Ordering::SeqCst);
    }
    if let Some(state) = app.try_state::<SidecarChild>() {
        if let Some(child) = state.0.lock().unwrap().take() {
            let _ = child.kill();
            println!("[sidecar] killed for elevated relaunch");
        }
    }
    app.exit(0);
    Ok(())
}

/// Consecutive quick-death restart cap. A sidecar that keeps dying within a
/// minute is genuinely broken (missing _internal, port conflict, AV kill) —
/// looping forever would just burn CPU re-loading OCR models.
const SIDECAR_MAX_RESTARTS: u32 = 5;

fn is_quitting(app: &tauri::AppHandle) -> bool {
    app.try_state::<IsQuitting>()
        .map(|s| s.0.load(Ordering::SeqCst))
        // No state (shutdown teardown) → treat as quitting, never respawn.
        .unwrap_or(true)
}

/// Schedule a sidecar respawn 2s out, respecting the consecutive-failure
/// budget. Shared by every failure path (unexpected exit, channel closed
/// without Terminated, spawn error) so none of them silently gives up while
/// budget remains. Re-checks IsQuitting after the sleep — a respawn landing
/// mid-shutdown would leak a zombie tarkov-server nothing is left to kill.
fn schedule_sidecar_restart(app: tauri::AppHandle, next: u32, why: &str) {
    if next > SIDECAR_MAX_RESTARTS {
        eprintln!(
            "[sidecar] restart limit reached ({why}) - giving up (lookups fail until app restart)"
        );
        // Tell the webview so it can stop promising "auto-recovering" — at
        // this point only an app restart brings lookups back, and the user
        // deserves accurate instructions instead of an infinite F2 loop.
        // 11-03: 마지막 실패 이유를 같이 보낸다(텔레메트리 sidecar_fail dead:<이유>).
        let _ = app.emit("sidecar-dead", why.to_string());
        return;
    }
    // Exponential backoff (2,4,8,16,32s ≈ 62s window): a fixed 2s delay
    // burned the whole budget in ~10s, which is SHORTER than a typical
    // on-access AV scan of a fresh unsigned PyInstaller exe — the exact
    // failure this retry exists for. Crash-loop protection is preserved
    // (still a hard 5-attempt cap between healthy runs).
    let delay = Duration::from_secs(2u64 << (next.saturating_sub(1)).min(4));
    eprintln!(
        "[sidecar] {why} - restarting ({next}/{SIDECAR_MAX_RESTARTS}) in {}s",
        delay.as_secs()
    );
    // Plain OS thread for the delay: no tokio dep and spawn() is thread-safe.
    thread::spawn(move || {
        thread::sleep(delay);
        if is_quitting(&app) {
            println!("[sidecar] restart cancelled - app is quitting");
            return;
        }
        spawn_and_watch_sidecar(app, next);
    });
}

/// Spawn the Python sidecar and babysit it. If it dies while the app is NOT
/// quitting (crash/OOM/AV kill), respawn after 2s so lookups self-heal instead
/// of failing with "Failed to fetch" until an app restart — the most common
/// user-reported connection error. A sidecar that survived 60s+ resets the
/// attempt counter (transient crash, not a crash loop).
fn spawn_and_watch_sidecar(app: tauri::AppHandle, attempt: u32) {
    let cmd = match app.shell().sidecar("tarkov-server") {
        Ok(c) => c,
        Err(e) => {
            // Config-level failure (bad externalBin) — retrying won't help,
            // but it shares the budget so a fluke still gets another shot.
            schedule_sidecar_restart(app, attempt + 1, &format!("sidecar() failed: {e}"));
            return;
        }
    };
    let (mut rx, child) = match cmd.spawn() {
        Ok(v) => v,
        Err(e) => {
            // Transient spawn failures are REAL: AV scanners briefly lock
            // fresh PyInstaller exes. Retry within the same budget instead
            // of giving up on the very failure mode we built this for.
            schedule_sidecar_restart(app, attempt + 1, &format!("spawn failed: {e}"));
            return;
        }
    };
    println!("[sidecar] tarkov-server spawned (attempt {attempt})");
    if let Some(state) = app.try_state::<SidecarChild>() {
        *state.0.lock().unwrap() = Some(child);
    }
    // TOCTOU close: if the user hit Exit between our spawn and the store
    // above, the exit path's take()+kill saw None and this child would
    // outlive the app. The exit paths set IsQuitting BEFORE taking, so
    // checking it after storing guarantees one side performs the kill.
    if is_quitting(&app) {
        if let Some(state) = app.try_state::<SidecarChild>() {
            if let Some(c) = state.0.lock().unwrap().take() {
                let _ = c.kill();
                println!("[sidecar] killed right after spawn - app is quitting");
            }
        }
        return;
    }

    let started = std::time::Instant::now();
    // Forward sidecar stdout/stderr into our own console for debugging and
    // watch for termination. `saw_terminated` covers the channel closing
    // WITHOUT a Terminated event (e.g. plugin-side wait() error emits
    // CommandEvent::Error then drops the sender) — the sidecar is just as
    // dead in that case and must heal the same way.
    tauri::async_runtime::spawn(async move {
        let mut saw_terminated = false;
        let mut exit_code: Option<i32> = None;
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    println!("[sidecar/out] {}", String::from_utf8_lossy(&line));
                }
                CommandEvent::Stderr(line) => {
                    eprintln!("[sidecar/err] {}", String::from_utf8_lossy(&line));
                }
                CommandEvent::Error(e) => {
                    eprintln!("[sidecar] command event error: {e}");
                }
                CommandEvent::Terminated(payload) => {
                    saw_terminated = true;
                    exit_code = payload.code;
                    println!("[sidecar] terminated: code={:?}", payload.code);
                    break;
                }
                _ => {}
            }
        }
        if is_quitting(&app) {
            return; // expected teardown — exit paths already killed it
        }
        let next = if started.elapsed().as_secs() >= 60 {
            1 // lived long enough — treat as a fresh transient crash
        } else {
            attempt + 1
        };
        let why = if saw_terminated {
            match exit_code {
                Some(c) => format!("unexpected exit code={c}"),
                None => "unexpected exit".to_string(),
            }
        } else {
            "event channel closed without Terminated".to_string()
        };
        schedule_sidecar_restart(app, next, &why);
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        // MUST be the first plugin: on a second launch this fires in the
        // ALREADY-RUNNING instance (the new process then exits itself), so we
        // never spawn a duplicate window / Python sidecar / tray icon. Reveal
        // the existing window and tell the user it's already running — that's
        // the reported bug: tray icons stacking up because users couldn't tell
        // the app was already open.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            println!("[single-instance] second launch blocked; surfacing existing window");
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
            let _ = app
                .notification()
                .builder()
                .title("Tarkov Price Overlay")
                .body("이미 실행 중이에요 — 트레이 아이콘을 확인하세요.\nAlready running — check the tray icon.")
                .show();
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init())
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
                    // If the window is hidden (user clicked X → hide_to_tray),
                    // bring it back so the next emit has somewhere to render.
                    // Passive reveal (no activation): a normal show()+set_focus()
                    // here stole focus from the game, so ESC/Tab went to the
                    // overlay instead of closing the inventory (1.1.1/1.1.2 bug).
                    if let Some(window) = app.get_webview_window("main") {
                        if !window.is_visible().unwrap_or(true) {
                            reveal_overlay_no_activate(&window);
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
        .manage(MouseHotkeyStop(Arc::new(AtomicBool::new(false))))
        .manage(KeyPolls(Arc::new(Mutex::new(KeyPollConfig::default()))))
        // 시작값은 프론트가 저장된 설정으로 곧 덮어쓴다. 환경변수는 자동화 시험용(웹뷰 localStorage 없이 켜기).
        .manage(HotkeyPassthrough(AtomicBool::new(
            std::env::var("TPO_HOTKEY_PASSTHROUGH").map(|v| v == "1").unwrap_or(false),
        )))
        .invoke_handler(tauri::generate_handler![
            prepare_quit,
            get_cursor_position,
            log_msg,
            register_lookup_hotkey,
            register_toggle_hotkey,
            register_lookup_mouse,
            register_toggle_mouse,
            set_hotkey_passthrough,
            hotkey_passthrough_supported,
            unregister_all_hotkeys,
            hide_to_tray,
            recover_window_position,
            show_preview_rect,
            hide_preview_rect,
            is_portable_install,
            mark_portable_switch,
            take_portable_switch,
            find_installed_copy,
            launch_installed_copy,
            open_folder,
            resolve_install_id,
            exit_app,
            relaunch_as_admin,
            show_overlay_passive
        ])
        .setup(|app| {
            // Mouse-button hotkey poller — needs the AppHandle for emits and
            // shares the MouseHotkeys Arc so register_*_mouse takes effect
            // without restarting the thread.
            let mcfg = app.state::<MouseHotkeys>().0.clone();
            let kcfg = app.state::<KeyPolls>().0.clone();
            let mstop = app.state::<MouseHotkeyStop>().0.clone();
            spawn_mouse_hotkey_thread(app.handle().clone(), mcfg, kcfg, mstop);

            // Self-healing sidecar: respawns on unexpected death (see
            // spawn_and_watch_sidecar) so "Failed to fetch" recovers without
            // an app restart.
            spawn_and_watch_sidecar(app.handle().clone(), 0);

            // System tray: hidden from taskbar (skipTaskbar=true), so the
            // tray icon is the only persistent UI surface. Left-click brings
            // the price card up. Right-click opens a menu (Show / Settings / Exit).
            let show_item = MenuItem::with_id(app, "show", "표시 / Show", true, None::<&str>)?;
            let settings_item =
                MenuItem::with_id(app, "settings", "설정 / Settings", true, None::<&str>)?;
            let recover_item = MenuItem::with_id(
                app,
                "recover",
                "창 위치 복구 / Recover position",
                true,
                None::<&str>,
            )?;
            let exit_item = MenuItem::with_id(app, "exit", "종료 / Exit", true, None::<&str>)?;
            let menu = Menu::with_items(
                app,
                &[&show_item, &settings_item, &recover_item, &exit_item],
            )?;

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
                    "recover" => {
                        // Synthesize the same effect as the React-side
                        // recover button — useful when the overlay sits
                        // off-screen and the user can't reach it via the
                        // UI at all.
                        if let Err(e) = recover_window_position(app.clone()) {
                            eprintln!("[tray] recover failed: {e}");
                        }
                    }
                    "exit" => {
                        // 11-03: 바로 끝내지 않고 JS 에 먼저 알린다 — 받아 둔 업데이트가
                        // 있으면 JS 가 설치를 띄운 뒤 exit_app 을 부른다. 웹뷰가 먹통이면
                        // 8초 뒤 여기서 강제 종료(안전장치).
                        let _ = app.emit("tray-exit", ());
                        let app2 = app.clone();
                        std::thread::spawn(move || {
                            std::thread::sleep(std::time::Duration::from_secs(8));
                            println!("[tray] exit fallback after 8s");
                            exit_app(app2);
                        });
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
                for label in ["preview-primary", "preview-ground", "preview-anchor"] {
                    if let Some(w) = app_handle.get_webview_window(label) {
                        let _ = w.hide();
                    }
                }
                notify_minimized_to_tray(app_handle);
            }
        }
        RunEvent::Exit => {
            if let Some(state) = app_handle.try_state::<MouseHotkeyStop>() {
                state.0.store(true, Ordering::SeqCst);
            }
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
