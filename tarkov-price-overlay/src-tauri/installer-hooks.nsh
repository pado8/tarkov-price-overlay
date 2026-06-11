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
  ; Purge dead weight left by pre-v1.1.2 installs. The in-app updater runs
  ; NSIS in update mode, which OVERWRITES files but never runs the old
  ; uninstaller — so the ~889MB of build-time artifacts that v1.1.2 stripped
  ; from the bundle (torch *.lib import libraries, C++ headers, test
  ; fixtures) would linger on disk forever, and the rewritten uninstall.exe
  ; (new manifest) wouldn't remove them either.
  DetailPrint "Removing obsolete files from previous versions..."
  RMDir /r "$INSTDIR\_internal\torch\include"
  RMDir /r "$INSTDIR\_internal\torch\test"
  RMDir /r "$INSTDIR\_internal\torch\share"
  Delete "$INSTDIR\_internal\torch\lib\*.lib"
  Delete "$INSTDIR\_internal\torch\lib\*.exp"
  Delete "$INSTDIR\_internal\torch\lib\*.pdb"
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro KillRunningOverlay
!macroend

; After a MANUAL install completes, launch the new exe so the user doesn't
; have to re-open from Start Menu. Skipped in update mode: the in-app
; updater's /R flag already relaunches the app via .onInstSuccess — running
; ExecShell too spawned a SECOND instance, which single-instance (v1.1.1+)
; then killed with a confusing "already running" toast right after every
; auto-update.
!macro NSIS_HOOK_POSTINSTALL
  ${If} $UpdateMode <> 1
    ExecShell "" "$INSTDIR\tarkov-price-overlay.exe"
  ${EndIf}
!macroend
