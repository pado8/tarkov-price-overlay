; Auto-close running instances before install/uninstall.
; Triggered by setup.exe for fresh install, upgrade, repair, and uninstall.
; Without this, an in-progress overlay locks files and corrupts the install.

!macro KillRunningOverlay
  DetailPrint "Closing Tarkov Price Overlay if running..."
  nsExec::Exec 'taskkill /F /IM "tarkov-price-overlay.exe" /T'
  nsExec::Exec 'taskkill /F /IM "tarkov-server.exe" /T'
  Sleep 800
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro KillRunningOverlay
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro KillRunningOverlay
!macroend

; After auto-update install completes, launch the new exe so the user
; doesn't have to manually re-open from Start Menu. ExecShell uses the
; current user's context (not elevated), matching how Start Menu launches
; the app. Safe for first-time installs too — same behavior NSIS's
; standard "Run on finish" checkbox would give.
!macro NSIS_HOOK_POSTINSTALL
  ExecShell "" "$INSTDIR\tarkov-price-overlay.exe"
!macroend
