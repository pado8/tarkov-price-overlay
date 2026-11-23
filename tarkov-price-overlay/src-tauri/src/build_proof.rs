//! 11-20 공식 빌드 확인 — 통계 묶음에 붙이는 짧은 표식(bp). 공식 빌드 스크립트가 빌드 때 넣은 버전 키(TPO_BUILD_KEY,
//! base64)로 `설치번호|UTC 날짜`를 HMAC-SHA256 해서 base64url 앞 22자를 만든다. 서버는 같은 계산으로 맞는지만 본다.
//! 키는 여기(Rust)에만 두고 웹뷰 쪽에는 넘기지 않는다. 키 없이 빌드한 판은 빈 문자열(= 확인 안 됨).
//! HMAC 은 sha2 두 번으로 직접 계산한다(이미 쓰는 크레이트만, RFC 2104).
use base64::Engine as _;
use sha2::{Digest, Sha256};

const BUILD_KEY_B64: &str = env!("TPO_BUILD_KEY");

pub fn hmac_sha256(key: &[u8], msg: &[u8]) -> [u8; 32] {
    const BLOCK: usize = 64;
    let mut k = [0u8; BLOCK];
    if key.len() > BLOCK {
        k[..32].copy_from_slice(&Sha256::digest(key));
    } else {
        k[..key.len()].copy_from_slice(key);
    }
    let mut ipad = [0x36u8; BLOCK];
    let mut opad = [0x5cu8; BLOCK];
    for i in 0..BLOCK {
        ipad[i] ^= k[i];
        opad[i] ^= k[i];
    }
    let inner = Sha256::new().chain_update(ipad).chain_update(msg).finalize();
    Sha256::new().chain_update(opad).chain_update(inner).finalize().into()
}

/// 표식: base64url(HMAC(key_v, "<설치번호>|<YYYY-MM-DD>")) 앞 22자.
pub fn proof_for(key_v: &[u8], install_id: &str, utc_day: &str) -> String {
    let mac = hmac_sha256(key_v, format!("{install_id}|{utc_day}").as_bytes());
    let s = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(mac);
    s[..22].to_string()
}

/// 유닉스 초 → UTC "YYYY-MM-DD"(Howard Hinnant 의 civil_from_days).
pub fn utc_day(secs: u64) -> String {
    let z = (secs / 86_400) as i64 + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + if m <= 2 { 1 } else { 0 };
    format!("{y:04}-{m:02}-{d:02}")
}

#[tauri::command]
pub fn build_proof(install_id: String) -> String {
    if BUILD_KEY_B64.is_empty() || install_id.is_empty() || install_id.len() > 64 {
        return String::new();
    }
    let Ok(key_v) = base64::engine::general_purpose::STANDARD.decode(BUILD_KEY_B64) else {
        return String::new();
    };
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    proof_for(&key_v, &install_id, &utc_day(now))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hex(s: &str) -> Vec<u8> {
        (0..s.len()).step_by(2).map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap()).collect()
    }

    #[test]
    fn rfc4231_case2() {
        let mac = hmac_sha256(b"Jefe", b"what do ya want for nothing?");
        assert_eq!(mac.to_vec(), hex("5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843"));
    }

    #[test]
    fn handoff_reference_values() {
        // 통계 세션 넘김(메모장/업데이트세션-넘김-261120-빌드표식.md)의 서버와 같은 기준값
        let master = hex("00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff");
        let key_v = hmac_sha256(&master, b"tpo-build|1.3.6");
        assert_eq!(base64::engine::general_purpose::STANDARD.encode(key_v), "Lep8O26I1yJNWwaqxwTlzw55IkPpnovgD8S2wZvM2Xw=");
        assert_eq!(proof_for(&key_v, "11111111-2222-3333-4444-555555555555", "2026-11-21"), "Tea6AlBDV7b8YNPQwxYZJO");
    }

    /// 서버 확인 함수(ops/lib/build-proof.mjs checkBuild)와 맞춰 보기 — 시험 원본 키로 오늘 표식을 찍는다.
    /// `TPO_TEST_MASTER_HEX`·`TPO_TEST_VER`·`TPO_TEST_ID` 를 주고 `cargo test print_for_env -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn print_for_env() {
        let master = hex(&std::env::var("TPO_TEST_MASTER_HEX").expect("TPO_TEST_MASTER_HEX"));
        let ver = std::env::var("TPO_TEST_VER").expect("TPO_TEST_VER");
        let id = std::env::var("TPO_TEST_ID").expect("TPO_TEST_ID");
        let key_v = hmac_sha256(&master, format!("tpo-build|{ver}").as_bytes());
        let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs();
        println!("BP={}", proof_for(&key_v, &id, &utc_day(now)));
    }

    #[test]
    fn utc_days() {
        assert_eq!(utc_day(0), "1970-01-01");
        assert_eq!(utc_day(951_782_400), "2000-02-29");
        assert_eq!(utc_day(1_795_132_800), "2026-11-20");
    }
}
