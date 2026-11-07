param([Parameter(Mandatory=$true)][string]$Launcher,[Parameter(Mandatory=$true)][string]$Release)
$ErrorActionPreference='Stop'
$taskTargets=@([IO.Path]::GetFullPath($Launcher),[IO.Path]::GetFullPath($Release))
$taskNames=@([IO.Path]::GetFileNameWithoutExtension($Launcher),[IO.Path]::GetFileNameWithoutExtension($Release))
foreach($taskName in $taskNames){
 foreach($taskApp in Get-Process -Name $taskName -ErrorAction SilentlyContinue){
  if($taskApp.Path -notin $taskTargets){continue}
  if(-not $taskApp.CloseMainWindow() -or -not $taskApp.WaitForExit(5000)){
   throw 'The open app has an active session. Stop it and close the app before updating the executable.'
  }
 }
}
