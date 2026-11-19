//! 11-19 받아 둔 업데이트 설치 파일을 디스크에 둔다.
//!
//! 업데이터 플러그인의 `download` 는 받은 설치 파일(약 291MB)을 메모리에만 두고, 앱을 다시 켜면 '다음 실행 설치'가
//! 같은 파일을 처음부터 다시 받았다(통계: 1.3.1 이상 14일 재다운로드 약 87건). 여기서는 받은 파일을 앱 데이터 폴더
//! `updates\setup-<버전>.bin` 에 두고, 설치 직전과 다음 실행 때 같은 공개 키로 서명을 다시 검증한 뒤에만 설치한다.
//! 플러그인의 `install` 은 서명을 검증하지 않으므로(검증은 `download` 안에서만) 이 검증을 빼면 안 된다.
use std::path::PathBuf;
use std::sync::Mutex;

use base64::Engine;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};

/// 이번 실행에서 받아 둔(또는 디스크 파일을 검증한) 업데이트 — 설치 때 서명·설치 프로그램 실행에 쓴다.
#[derive(Default)]
pub struct SavedUpdate(pub Mutex<Option<Update>>);

fn dir(app: &AppHandle) -> Result<PathBuf, String> {
    let d = app.path().app_local_data_dir().map_err(|e| e.to_string())?.join("updates");
    std::fs::create_dir_all(&d).map_err(|e| e.to_string())?;
    Ok(d)
}

fn valid_version(v: &str) -> bool {
    !v.is_empty() && v.len() <= 32 && v.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-')
}

fn file_for(app: &AppHandle, version: &str) -> Result<PathBuf, String> {
    if !valid_version(version) {
        return Err("bad_version".into());
    }
    Ok(dir(app)?.join(format!("setup-{version}.bin")))
}

fn pubkey(app: &AppHandle) -> Result<String, String> {
    app.config()
        .plugins
        .0
        .get("updater")
        .and_then(|u| u.get("pubkey"))
        .and_then(|v| v.as_str())
        .map(str::to_owned)
        .ok_or_else(|| "no_pubkey".to_string())
}

/// 플러그인 verify_signature 와 같은 검증(minisign, 공개 키·서명 모두 base64 로 감싼 글).
pub fn verify(data: &[u8], signature_b64: &str, pubkey_b64: &str) -> Result<(), String> {
    let unwrap = |s: &str| -> Result<String, String> {
        let raw = base64::engine::general_purpose::STANDARD.decode(s).map_err(|e| format!("sig: {e}"))?;
        String::from_utf8(raw).map_err(|e| format!("sig: {e}"))
    };
    let key = minisign_verify::PublicKey::decode(&unwrap(pubkey_b64)?).map_err(|e| format!("sig: {e}"))?;
    let sig = minisign_verify::Signature::decode(&unwrap(signature_b64)?).map_err(|e| format!("sig: {e}"))?;
    key.verify(data, &sig, true).map_err(|e| format!("sig: {e}"))
}

/// keep 버전 파일만 남기고 지운다(None 이면 전부).
fn clear_except(app: &AppHandle, keep: Option<&str>) {
    let Ok(d) = dir(app) else { return };
    let keep_name = keep.map(|v| format!("setup-{v}.bin"));
    if let Ok(rd) = std::fs::read_dir(&d) {
        for e in rd.flatten() {
            let name = e.file_name().to_string_lossy().to_string();
            if keep_name.as_deref() != Some(name.as_str()) {
                let _ = std::fs::remove_file(e.path());
            }
        }
    }
}

/// 앱 시작 때: 지금 실행 중인 버전의 파일은 이미 설치된 것이라 지운다.
pub fn clear_installed(app: &AppHandle, current_version: &str) {
    if let Ok(p) = file_for(app, current_version) {
        let _ = std::fs::remove_file(p);
    }
}

#[derive(Serialize, Clone)]
struct Progress {
    d: u64,
    t: Option<u64>,
}

/// version 업데이트를 받아 디스크에 둔다. 같은 버전 파일이 이미 있고 지금 서명과 맞으면 다시 받지 않는다.
/// 돌려주는 값: true = 새로 받음, false = 디스크 파일을 다시 검증해 씀. 진행률은 'update-progress' 이벤트.
#[tauri::command]
pub async fn update_download(app: AppHandle, version: String) -> Result<bool, String> {
    let upd = app
        .updater()
        .map_err(|e| e.to_string())?
        .check()
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "no_update".to_string())?;
    if upd.version != version {
        return Err(format!("version_changed:{}", upd.version));
    }
    let path = file_for(&app, &upd.version)?;
    let key = pubkey(&app)?;
    let mut fresh = true;
    if let Ok(bytes) = std::fs::read(&path) {
        if verify(&bytes, &upd.signature, &key).is_ok() {
            fresh = false;
            println!("[update] {} already on disk - signature ok, not downloading again", upd.version);
        } else {
            eprintln!("[update] {} on disk failed the signature check - downloading again", upd.version);
            let _ = std::fs::remove_file(&path);
        }
    }
    if fresh {
        let mut got: u64 = 0;
        let mut last_pct = u64::MAX;
        let tx = app.clone();
        // download 가 받는 동안 서명까지 검증한다(실패하면 Err — 파일을 남기지 않는다)
        let bytes = upd
            .download(
                move |n, total| {
                    got += n as u64;
                    let pct = total.map(|t| got * 100 / t.max(1)).unwrap_or(0);
                    if pct != last_pct {
                        last_pct = pct;
                        let _ = tx.emit("update-progress", Progress { d: got, t: total });
                    }
                },
                || {},
            )
            .await
            .map_err(|e| e.to_string())?;
        let tmp = path.with_extension("part");
        std::fs::write(&tmp, &bytes).map_err(|e| e.to_string())?;
        let _ = std::fs::remove_file(&path);
        std::fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
        println!("[update] {} saved to disk ({} bytes)", upd.version, bytes.len());
    }
    clear_except(&app, Some(&upd.version));
    *app.state::<SavedUpdate>().0.lock().unwrap() = Some(upd);
    Ok(fresh)
}

/// 받아 둔 파일로 설치한다(서명을 다시 검증한 뒤). 설치 프로그램을 띄우고 앱은 플러그인이 끝낸다.
#[tauri::command]
pub fn update_install_saved(app: AppHandle) -> Result<(), String> {
    let upd = app
        .state::<SavedUpdate>()
        .0
        .lock()
        .unwrap()
        .clone()
        .ok_or_else(|| "not_downloaded".to_string())?;
    let path = file_for(&app, &upd.version)?;
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    verify(&bytes, &upd.signature, &pubkey(&app)?)?;
    println!("[update] installing {} from disk", upd.version);
    upd.install(bytes).map_err(|e| e.to_string())
}

/// 디스크에 받아 둔 업데이트 버전(없으면 None) — 다음 실행 때 다시 받지 않고 설치할지 판단용.
#[tauri::command]
pub fn update_saved_version(app: AppHandle) -> Option<String> {
    let d = dir(&app).ok()?;
    std::fs::read_dir(d).ok()?.flatten().find_map(|e| {
        let name = e.file_name().to_string_lossy().to_string();
        let v = name.strip_prefix("setup-")?.strip_suffix(".bin")?.to_string();
        valid_version(&v).then_some(v)
    })
}

/// 새 버전이 없다고 확인됐을 때 등 — 받아 둔 파일을 모두 지운다.
#[tauri::command]
pub fn update_clear_saved(app: AppHandle) {
    clear_except(&app, None);
    *app.state::<SavedUpdate>().0.lock().unwrap() = None;
}

#[cfg(test)]
mod tests {
    use super::verify;

    /// 실제 릴리즈 설치 파일·서명으로(빌드 폴더에 있을 때만): 그대로면 통과, 다른 버전 서명·1바이트 변조는 거부.
    #[test]
    fn verify_real_release_installer() {
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
        let dir = root.join("target/release/bundle/nsis");
        let exe = dir.join("Tarkov Price Overlay_1.3.4_x64-setup.exe");
        let other = dir.join("Tarkov Price Overlay_1.3.3_x64-setup.exe.sig");
        if !exe.exists() || !other.exists() {
            eprintln!("skip: release installer not in {}", dir.display());
            return;
        }
        let conf: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(root.join("tauri.conf.json")).unwrap()).unwrap();
        let key = conf["plugins"]["updater"]["pubkey"].as_str().unwrap();
        let sig = std::fs::read_to_string(exe.with_extension("exe.sig")).unwrap();
        let mut data = std::fs::read(&exe).unwrap();
        assert!(verify(&data, sig.trim(), key).is_ok(), "genuine installer must verify");
        let sig_other = std::fs::read_to_string(&other).unwrap();
        assert!(verify(&data, sig_other.trim(), key).is_err(), "another version's signature must fail");
        data[4096] ^= 1;
        assert!(verify(&data, sig.trim(), key).is_err(), "one flipped byte must fail");
        assert!(verify(b"x", "not base64!", key).is_err());
    }
}
