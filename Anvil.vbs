Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
Set sh = CreateObject("Wscript.Shell")
sh.CurrentDirectory = dir
' Keep the original filename: a renamed runtime reports app.isPackaged = True.
exe = dir & "\node_modules\electron\dist\electron.exe"
If Not fso.FileExists(exe) Then
  sh.Run "cmd /c """ & dir & "\start.bat""", 1, False
Else
  sh.Run """" & exe & """ .", 1, False
End If
