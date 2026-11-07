$ErrorActionPreference = 'Stop'
$taskRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$taskFailed = $false
$taskFiles = Get-ChildItem -LiteralPath (Join-Path $taskRoot 'scripts'), (Join-Path $taskRoot 'tests') -Filter '*.ps1' -File
foreach ($taskFile in $taskFiles) {
    $taskTokens = $null
    $taskErrors = $null
    [void][Management.Automation.Language.Parser]::ParseFile($taskFile.FullName, [ref]$taskTokens, [ref]$taskErrors)
    foreach ($taskError in $taskErrors) {
        $taskFailed = $true
        Write-Output ('{0}:{1}: {2}' -f $taskFile.Name, $taskError.Extent.StartLineNumber, $taskError.Message)
    }
}
if ($taskFailed) { exit 1 }
Write-Output "PowerShell syntax passed for $($taskFiles.Count) scripts."
