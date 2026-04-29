$WshShell = New-Object -ComObject WScript.Shell
$Shortcut = $WshShell.CreateShortcut("C:\Users\jesse\OneDrive\Desktop\Lab Grader.lnk")
$Shortcut.TargetPath = "C:\Users\jesse\OneDrive\Desktop\Lab Grader Agent\launch.bat"
$Shortcut.WorkingDirectory = "C:\Users\jesse\OneDrive\Desktop\Lab Grader Agent"
$Shortcut.IconLocation = "C:\Users\jesse\anaconda3\envs\lab-grader\python.exe,0"
$Shortcut.Description = "Launch CMU 24-321 Lab Grader"
$Shortcut.WindowStyle = 1
$Shortcut.Save()
Write-Host "Shortcut created on Desktop."
