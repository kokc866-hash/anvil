; Override electron-builder's default close-then-force-kill path for BOTH
; installation and removal. Only the app can safely resolve unsaved work.
; nsProcess is bundled by electron-builder; 603 means no matching process.
!macro customCheckAppRunning
  ${Do}
    nsProcess::_FindProcess "${APP_EXECUTABLE_FILENAME}"
    Pop $R0
    ${If} $R0 == 603
      ${ExitDo}
    ${EndIf}
    ${If} $R0 != 0
      MessageBox MB_OK|MB_ICONSTOP "Anvil konnte nicht sicher auf laufende Prozesse geprueft werden. Setup wurde ohne Aenderungen abgebrochen." /SD IDOK
      SetErrorLevel 2
      Quit
    ${EndIf}
    IfSilent 0 +3
      SetErrorLevel 2
      Quit
    MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "Anvil ist noch geoeffnet. Bitte dort die Arbeit speichern und Anvil schliessen. Danach auf Wiederholen klicken. Abbrechen laesst Anvil unveraendert." IDRETRY +3
      SetErrorLevel 2
      Quit
  ${Loop}
!macroend

; Build outputs belong to the user. Remove only packaged application files,
; leaving runs/ and separately downloaded compiler folders in place on updates/uninstall.
!macro customRemoveFiles
  SetOutPath $TEMP
  Delete "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
  Delete "$INSTDIR\${UNINSTALL_FILENAME}"
  Delete "$INSTDIR\uninstallerIcon.ico"
  Delete "$INSTDIR\chrome_100_percent.pak"
  Delete "$INSTDIR\chrome_200_percent.pak"
  Delete "$INSTDIR\d3dcompiler_47.dll"
  Delete "$INSTDIR\dxcompiler.dll"
  Delete "$INSTDIR\dxil.dll"
  Delete "$INSTDIR\ffmpeg.dll"
  Delete "$INSTDIR\icudtl.dat"
  Delete "$INSTDIR\resources.pak"
  Delete "$INSTDIR\libEGL.dll"
  Delete "$INSTDIR\libGLESv2.dll"
  Delete "$INSTDIR\LICENSE.electron.txt"
  Delete "$INSTDIR\LICENSES.chromium.html"
  Delete "$INSTDIR\snapshot_blob.bin"
  Delete "$INSTDIR\v8_context_snapshot.bin"
  Delete "$INSTDIR\vk_swiftshader.dll"
  Delete "$INSTDIR\vk_swiftshader_icd.json"
  Delete "$INSTDIR\vulkan-1.dll"
  RMDir /r "$INSTDIR\locales"
  RMDir /r "$INSTDIR\resources"
  RMDir "$INSTDIR"
!macroend
