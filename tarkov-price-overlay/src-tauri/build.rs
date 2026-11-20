fn main() {
    // 11-20 공식 빌드 확인: 공식 빌드 스크립트(release.ps1·test-build.ps1)가 넣은 버전 키를 앱에 넣는다(없으면 빈 값 = 확인 안 됨)
    println!("cargo:rerun-if-env-changed=TPO_BUILD_KEY");
    println!("cargo:rustc-env=TPO_BUILD_KEY={}", std::env::var("TPO_BUILD_KEY").unwrap_or_default());
    tauri_build::build()
}
