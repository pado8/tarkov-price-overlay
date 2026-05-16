# Build & Release

베타 .exe 인스톨러를 만드는 절차.

## 사전 준비 (한 번만)

1. **Python 3.10+** 설치
2. **Node.js 20+** + **npm** 설치
3. **Rust** + **Tauri CLI** 설치
   ```
   rustup default stable
   cargo install tauri-cli --version "^2"
   ```
4. **Visual Studio C++ Build Tools** (Tauri Windows 빌드 필수)
5. 프로젝트 루트(`C:\project`)에서:
   ```
   python -m venv python-core\.venv
   python-core\.venv\Scripts\Activate.ps1
   pip install -r python-core\requirements.txt
   pip install pyinstaller
   # PyInstaller 호환성 — torch 최신(2.11+)은 frozen 환경에서 c10.dll WinError 1114 발생.
   # CPU 빌드 채널의 2.7.1로 고정.
   pip install --index-url https://download.pytorch.org/whl/cpu torch==2.7.1 torchvision==0.22.1
   deactivate
   npm install
   ```

## 빌드

```powershell
powershell -ExecutionPolicy Bypass -File scripts\build.ps1
```

스크립트가 하는 일:
1. venv에 의존성 + PyInstaller 설치
2. `tarkov-server.spec`로 Python 서버를 `dist-python/tarkov-server/`에 패키징
3. 결과를 `src-tauri/binaries/`로 복사 + sidecar 이름 규약(`tarkov-server-x86_64-pc-windows-msvc.exe`)에 맞게 rename
4. `npm run tauri build --bundles nsis` 실행

산출물: `src-tauri/target/release/bundle/nsis/Tarkov Price Overlay_<version>_x64-setup.exe`

## 검증

- 빌드 후 `dist-python/tarkov-server/tarkov-server.exe`를 더블클릭으로 단독 실행 → 콘솔에 startup 로그 + `[startup] warmup complete`이 떠야 정상.
- 인스톨러 설치 후 시작메뉴에서 앱 실행 → F2 동작 확인.
- 종료 후 작업 관리자에 `tarkov-server.exe`가 좀비로 안 남는지 확인.
- **클린 환경 검증**: Python/Node 미설치된 다른 PC 또는 VM에 설치해 인터넷 끊고 F2 lookup이 동작하는지 확인 (모델 동봉 검증).

## 트러블슈팅

### PyInstaller가 모듈을 못 찾음
- `tarkov-server.spec`의 `hiddenimports`에 누락된 모듈 추가
- 자주 누락: `uvicorn.protocols.*`, `uvicorn.lifespan.*`

### `OSError: [WinError 1114] ... c10.dll`
torch DllMain 초기화 실패. torch 2.11+가 frozen 환경에서 발생시키는 알려진 이슈 — 위 사전 준비 절차의 torch 2.7.1 핀이 들어가 있어야 함. 그래도 같은 에러면 `runtime-hook-torch.py`가 빌드 시 hook으로 잡히는지 (`tarkov-server.spec`의 `runtime_hooks=["runtime-hook-torch.py"]`) 확인.

### sidecar가 안 뜸
- 단독 실행 (`dist-python/tarkov-server/tarkov-server.exe`)으로 PyInstaller 빌드 자체부터 검증
- Tauri 콘솔 로그에서 `[sidecar/err]` / `[sidecar] terminated` 확인

### 인스톨된 앱에서 모델/torch DLL을 못 찾음
- `_internal/` 폴더가 sidecar exe와 같은 디렉토리에 풀렸는지 확인
- 안 풀렸으면 `tauri.conf.json`의 `bundle.resources` 패턴 점검

### 빌드 캐시 정리
```
Remove-Item -Recurse -Force dist-python, build-python, src-tauri\binaries, src-tauri\target
```

## 베타 테스터에게 전달
- 결과 .exe (~600MB) + `installer-readme.txt`를 클라우드 링크(Drive/OneDrive)로 전달
- 코드 사이닝 미적용이라 SmartScreen 우회 안내 포함
