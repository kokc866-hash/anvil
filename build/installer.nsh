; Runs in .onInit before the file copy. Built-in ExecWait — no extra NSIS plugins.
!macro customInit
  ExecWait "taskkill /IM Anvil.exe /F /T"
  ExecWait '"$SYSDIR\cmd.exe" /c for /d %D in ("$TEMP\anvil-run-*") do @rd /s /q "%D"'
  ExecWait '"$SYSDIR\cmd.exe" /c for /d %D in ("$TEMP\anvil-fmt-*") do @rd /s /q "%D"'
  ExecWait '"$SYSDIR\cmd.exe" /c for /d %D in ("$TEMP\anvil-lint-*") do @rd /s /q "%D"'
  ExecWait '"$SYSDIR\cmd.exe" /c for /d %D in ("$TEMP\anvil-dbg-*") do @rd /s /q "%D"'
  ExecWait '"$SYSDIR\cmd.exe" /c for /d %D in ("$TEMP\anvil-tc-*") do @rd /s /q "%D"'
!macroend
