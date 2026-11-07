param([Parameter(Mandatory=$true)][string]$Version)
$ErrorActionPreference = 'Stop'
$taskRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if ($Version -notmatch '^\d+\.\d+\.\d+(-[A-Za-z0-9.-]+)?$') { throw 'Invalid version' }
$taskRelease = Join-Path $taskRoot 'release'
$taskExe = Join-Path $taskRoot 'src-tauri\target\release\framecue.exe'
if (!(Test-Path -LiteralPath $taskExe)) { throw 'Build the Windows app before packaging.' }
$taskPackage = Get-Content -LiteralPath (Join-Path $taskRoot 'package.json') -Raw | ConvertFrom-Json
$taskConfig = Get-Content -LiteralPath (Join-Path $taskRoot 'src-tauri\tauri.conf.json') -Raw | ConvertFrom-Json
if ($taskPackage.version -ne $Version -or $taskConfig.version -ne $Version) { throw 'Release versions must match.' }
$taskPe = [IO.File]::ReadAllBytes($taskExe)
$taskPeOffset = [BitConverter]::ToInt32($taskPe, 0x3c)
if ([BitConverter]::ToUInt16($taskPe, $taskPeOffset + 4) -ne 0x8664 -or [BitConverter]::ToUInt16($taskPe, $taskPeOffset + 24 + 68) -ne 2) { throw 'Expected a Windows x64 GUI executable.' }

New-Item -ItemType Directory -Path $taskRelease -Force | Out-Null
$taskStage = Join-Path ([IO.Path]::GetTempPath()) ('framecue-release-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $taskStage | Out-Null
try {
    $taskPortable = Join-Path $taskStage 'FrameCue'
    New-Item -ItemType Directory -Path $taskPortable | Out-Null
    Copy-Item -LiteralPath $taskExe -Destination (Join-Path $taskPortable 'FrameCue.exe')
    Copy-Item -LiteralPath (Join-Path $taskRoot 'README.md') -Destination (Join-Path $taskPortable 'README.md')
    $taskLicenses = Join-Path $taskPortable 'licenses'
    New-Item -ItemType Directory -Path $taskLicenses | Out-Null
    Copy-Item -LiteralPath (Join-Path $taskRoot 'licenses\sinaui-MIT.txt') -Destination $taskLicenses
    Copy-Item -LiteralPath (Join-Path $taskRoot 'public\fonts\OFL.txt') -Destination (Join-Path $taskLicenses 'Inter-OFL.txt')
    $taskBase = "FrameCue-$Version-windows-x64"
    $taskOutputExe = Join-Path $taskRelease "$taskBase.exe"
    $taskZip = Join-Path $taskRelease "$taskBase.zip"
    Copy-Item -LiteralPath $taskExe -Destination $taskOutputExe -Force
    Compress-Archive -LiteralPath $taskPortable -DestinationPath $taskZip -Force
    $taskSums = foreach ($taskFile in @($taskOutputExe, $taskZip)) {
        $taskHasher = [Security.Cryptography.SHA256]::Create()
        $taskStream = [IO.File]::OpenRead($taskFile)
        try { $taskHash = [BitConverter]::ToString($taskHasher.ComputeHash($taskStream)).Replace('-', '').ToLowerInvariant() }
        finally { $taskStream.Dispose(); $taskHasher.Dispose() }
        '{0}  {1}' -f $taskHash, [IO.Path]::GetFileName($taskFile)
    }
    $taskSums | Set-Content -LiteralPath (Join-Path $taskRelease 'SHA256SUMS.txt') -Encoding ascii
    Write-Output "Prepared $taskBase.exe, $taskBase.zip and SHA256SUMS.txt"
} finally {
    $taskResolvedStage = [IO.Path]::GetFullPath($taskStage)
    $taskTempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')
    if ([IO.Path]::GetDirectoryName($taskResolvedStage) -ne $taskTempRoot -or [IO.Path]::GetFileName($taskResolvedStage) -notlike 'framecue-release-*') { throw 'Refusing to remove a directory outside the release staging area.' }
    Remove-Item -LiteralPath $taskResolvedStage -Recurse -Force
}
