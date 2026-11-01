$ErrorActionPreference = 'Stop'
$taskRepoPath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$taskDistro = 'ResilienceLab'
$taskDistros = (wsl --list --quiet) -replace "`0", ''
if (!($taskDistros | Where-Object { $_.Trim() -eq $taskDistro })) { throw 'The project WSL distribution is not installed. See docs/DEPLOY.md.' }
wsl -d $taskDistro -- docker info --format '{{.ServerVersion}}' 2>$null
if ($LASTEXITCODE -ne 0) {
    Start-Process -FilePath 'wsl.exe' -ArgumentList @('-d', $taskDistro, '--cd', ('"' + $taskRepoPath + '"'), '--', 'sh', 'scripts/docker-daemon.sh') -WindowStyle Hidden
    $taskReady = $false
    for ($taskAttempt = 0; $taskAttempt -lt 30; $taskAttempt++) {
        Start-Sleep -Seconds 1
        wsl -d $taskDistro -- docker info --format '{{.ServerVersion}}' 2>$null
        if ($LASTEXITCODE -eq 0) { $taskReady = $true; break }
    }
    if (!$taskReady) { throw 'Docker did not become ready in the project WSL distribution.' }
}
wsl -d $taskDistro --cd $taskRepoPath -- make dev
if ($LASTEXITCODE -ne 0) { throw 'Local stack startup failed; inspect docker compose logs.' }
Write-Output 'Resilience Lab: http://localhost:8088'
