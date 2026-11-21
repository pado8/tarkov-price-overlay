//! 11-22 비정상 종료 계측 — 앱이 켜질 때 '실행 중' 표시 파일을 남기고, 정상 종료(트레이 종료·설치판 전환·관리자로 다시 켜기·
//! 업데이트 설치 전 prepare_quit·RunEvent::Exit) 때 지운다. 다음 실행에 표시가 남아 있으면 앞 실행이 비정상으로 끝난 것
//! (충돌·작업 관리자 강제 종료 등). 표시에 그때의 부팅 시각을 적어 두어, 그사이 PC 가 다시 켜졌으면(윈도우 종료·재시작)
//! 세지 않는다. 서버 호출은 없고 화면이 하루 요약 `ucx` 로 센다(take_unclean_exit).
//!
//! 파일: %LOCALAPPDATA%\TarkovPriceOverlay\running — "v1 <pid> <부팅 unix초> <시작 unix초> <앱 버전>"

use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

/// 부팅 시각을 같다고 볼 오차(초). 시계 보정·절전 복귀로 조금 흔들린다.
const BOOT_SLACK_SECS: u64 = 120;

fn marker_path() -> Option<PathBuf> {
    let base = std::env::var_os("LOCALAPPDATA")?;
    Some(PathBuf::from(base).join("TarkovPriceOverlay").join("running"))
}

fn now_unix() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

#[cfg(windows)]
fn uptime_secs() -> u64 {
    // SAFETY: 인자 없는 단순 조회
    unsafe { windows_sys::Win32::System::SystemInformation::GetTickCount64() / 1000 }
}

#[cfg(not(windows))]
fn uptime_secs() -> u64 {
    0
}

fn boot_unix() -> u64 {
    now_unix().saturating_sub(uptime_secs())
}

/// 앞 실행이 같은 부팅 안에서 비정상으로 끝났는지 판정. 그렇다면 "<앞 실행 시간(초)>s v<버전>" 을 돌려준다.
pub fn judge(prev: &str, boot_now: u64) -> Option<String> {
    let mut it = prev.split_whitespace();
    if it.next()? != "v1" {
        return None;
    }
    let _pid: u32 = it.next()?.parse().ok()?;
    let boot_prev: u64 = it.next()?.parse().ok()?;
    let start_prev: u64 = it.next()?.parse().ok()?;
    let ver = it.next().unwrap_or("?");
    if boot_prev.abs_diff(boot_now) > BOOT_SLACK_SECS {
        return None; // 그사이 PC 가 다시 켜짐 — 윈도우 종료·재시작으로 꺼진 것으로 보고 세지 않음
    }
    let ran = now_unix().saturating_sub(start_prev);
    Some(format!("{ran}s v{ver}"))
}

/// 시작 때 한 번: 남은 표시를 판정하고 새 표시를 쓴다. 비정상 종료였으면 Some(설명).
pub fn begin(version: &str) -> Option<String> {
    let path = marker_path()?;
    let boot = boot_unix();
    let prev = std::fs::read_to_string(&path).ok().and_then(|s| judge(&s, boot));
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let _ = std::fs::write(&path, format!("v1 {} {} {} {}", std::process::id(), boot, now_unix(), version));
    prev
}

/// 정상 종료 때: 표시를 지운다(여러 번 불려도 된다).
pub fn end() {
    if let Some(path) = marker_path() {
        let _ = std::fs::remove_file(path);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn same_boot_counts_and_reboot_does_not() {
        let boot = 1_800_000_000;
        let start = now_unix().saturating_sub(300);
        let line = format!("v1 1234 {} {} 1.3.6", boot + 30, start);
        let got = judge(&line, boot).expect("같은 부팅이면 비정상 종료");
        assert!(got.ends_with("s v1.3.6"), "{got}");
        assert!(judge(&format!("v1 1234 {} {} 1.3.6", boot - 5000, start), boot).is_none(), "다시 켜졌으면 안 셈");
        assert!(judge("", boot).is_none());
        assert!(judge("v0 1 2 3", boot).is_none());
        assert!(judge("v1 x 2 3", boot).is_none());
    }
}
