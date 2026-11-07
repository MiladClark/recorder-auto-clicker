param([Parameter(Mandatory=$true)][string]$Executable)
$ErrorActionPreference='Stop'
$taskOld=$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS
try{
 $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS='--remote-debugging-port=9224'
 Start-Sleep -Milliseconds 400
 $taskApp=Start-Process -FilePath $Executable -WorkingDirectory (Split-Path $Executable) -WindowStyle Hidden -PassThru
 $taskApp.Id
}finally{$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=$taskOld}
