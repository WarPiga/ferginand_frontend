# filename: tools/bootstrap_windows.ps1
# Ferdinand Frontend Windows Bootstrap Installer
# Run from PowerShell:
# powershell -NoProfile -ExecutionPolicy Bypass -Command "irm 'https://raw.githubusercontent.com/WarPiga/ferginand_frontend/main/tools/bootstrap_windows.ps1' | iex"

$ErrorActionPreference = "Stop"

# ============================================================
# Project settings
# ============================================================

$RepoUrl = "https://github.com/WarPiga/ferginand_frontend.git"
$InstallRoot = Join-Path $env:USERPROFILE "Ferdinand"
$ProjectDir = Join-Path $InstallRoot "ferginand_frontend"
$AppUrl = "http://127.0.0.1:5050"
$StartupShortcutName = "Ferginand Frontend.lnk"

# ============================================================

function Write-Step {
    param([string]$Message)
    Write-Host ""
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Write-Warn {
    param([string]$Message)
    Write-Host "[WARNING] $Message" -ForegroundColor Yellow
}

function Write-Ok {
    param([string]$Message)
    Write-Host "[OK] $Message" -ForegroundColor Green
}

function Command-Exists {
    param([string]$Command)
    $null -ne (Get-Command $Command -ErrorAction SilentlyContinue)
}

function Refresh-Path {
    $machinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
    $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
    $env:Path = "$machinePath;$userPath"
}

function Ensure-Winget {
    Write-Step "Checking winget"

    if (Command-Exists "winget") {
        Write-Ok "winget found"
        return
    }

    Write-Warn "winget was not found."
    Write-Host ""
    Write-Host "Install 'App Installer' from Microsoft Store, then run this command again."
    Write-Host "On Windows 11 it is usually already installed."
    Write-Host ""
    throw "winget missing"
}

function Ensure-Git {
    Write-Step "Checking Git"

    if (Command-Exists "git") {
        git --version
        Write-Ok "Git found"
        return
    }

    Write-Step "Installing Git with winget"
    winget install -e --id Git.Git --source winget --accept-package-agreements --accept-source-agreements

    Refresh-Path

    if (-not (Command-Exists "git")) {
        Write-Warn "Git was installed, but PowerShell cannot see it yet."
        Write-Warn "Close this PowerShell window, open a new one, and run the bootstrap command again."
        throw "Git installed but PATH not refreshed"
    }

    git --version
    Write-Ok "Git installed"
}

function Test-Python313 {
    param(
        [string]$Exe,
        [string[]]$Args = @()
    )

    try {
        $versionOutput = & $Exe @($Args + @("--version")) 2>&1
        if ($LASTEXITCODE -ne 0 -or ($versionOutput -notmatch "Python 3\.13")) {
            return $null
        }

        $realExe = & $Exe @($Args + @("-c", "import sys; print(sys.executable)")) 2>&1
        if ($LASTEXITCODE -ne 0) {
            return $null
        }

        $realExe = (($realExe | Select-Object -First 1) -as [string]).Trim()

        return @{
            Exe = $Exe
            Args = $Args
            RealExe = $realExe
            Version = (($versionOutput | Select-Object -First 1) -as [string]).Trim()
        }
    } catch {
        return $null
    }
}

function Get-PythonCommand {
    $candidates = @()

    if (Command-Exists "py") {
        $candidates += @{ Exe = "py"; Args = @("-3.13") }
    }

    if (Command-Exists "python") {
        $candidates += @{ Exe = "python"; Args = @() }
    }

    if (Command-Exists "python3") {
        $candidates += @{ Exe = "python3"; Args = @() }
    }

    $knownPaths = @(
        (Join-Path $env:LOCALAPPDATA "Programs\Python\Python313\python.exe"),
        (Join-Path $env:ProgramFiles "Python313\python.exe"),
        (Join-Path ${env:ProgramFiles(x86)} "Python313\python.exe")
    )

    foreach ($path in $knownPaths) {
        if ($path -and (Test-Path $path)) {
            $candidates += @{ Exe = $path; Args = @() }
        }
    }

    foreach ($candidate in $candidates) {
        $result = Test-Python313 -Exe $candidate.Exe -Args $candidate.Args
        if ($result) {
            return $result
        }
    }

    return $null
}

function Ensure-Python {
    Write-Step "Checking Python 3.13"

    $pythonCmd = Get-PythonCommand
    if ($pythonCmd) {
        Write-Ok "Python 3.13 found: $($pythonCmd.Version)"
        Write-Host "Python executable: $($pythonCmd.RealExe)"
        return $pythonCmd
    }

    Write-Step "Installing Python 3.13 with winget"
    winget install -e --id Python.Python.3.13 --source winget --accept-package-agreements --accept-source-agreements

    Refresh-Path

    $pythonCmd = Get-PythonCommand
    if (-not $pythonCmd) {
        Write-Warn "Python 3.13 was installed, but PowerShell cannot see it yet."
        Write-Warn "Close this PowerShell window, open a new one, and run the bootstrap command again."
        throw "Python installed but PATH not refreshed"
    }

    Write-Ok "Python 3.13 installed: $($pythonCmd.Version)"
    Write-Host "Python executable: $($pythonCmd.RealExe)"
    return $pythonCmd
}

function Invoke-Python313 {
    param(
        [object]$PythonCmd,
        [string[]]$Arguments
    )

    & $PythonCmd.Exe @($PythonCmd.Args + $Arguments)
}

function Clone-Or-Pull-Repo {
    Write-Step "Preparing project folder"

    New-Item -ItemType Directory -Force -Path $InstallRoot | Out-Null

    if (Test-Path (Join-Path $ProjectDir ".git")) {
        Write-Step "Repo already exists. Pulling latest changes"
        Push-Location $ProjectDir
        try {
            git pull
            Write-Ok "Repo updated"
        } finally {
            Pop-Location
        }
        return
    }

    if (Test-Path $ProjectDir) {
        Write-Warn "Project folder exists but is not a Git repo:"
        Write-Host $ProjectDir
        Write-Warn "Rename/delete it manually, then run this script again."
        throw "Project folder exists but is not a repo"
    }

    Write-Step "Cloning repo"
    git clone $RepoUrl $ProjectDir
    Write-Ok "Repo cloned to $ProjectDir"
}

function Read-RequiredValue {
    param(
        [string]$Prompt,
        [string]$CurrentValue = "",
        [string[]]$InvalidValues = @()
    )

    while ($true) {
        if ($CurrentValue -and ($InvalidValues -notcontains $CurrentValue)) {
            $answer = Read-Host "$Prompt [$CurrentValue]"
            if ([string]::IsNullOrWhiteSpace($answer)) {
                $answer = $CurrentValue
            }
        } else {
            $answer = Read-Host $Prompt
        }

        $answer = ($answer -as [string]).Trim()

        if ([string]::IsNullOrWhiteSpace($answer)) {
            Write-Warn "This value is required."
            continue
        }

        if ($InvalidValues -contains $answer) {
            Write-Warn "Placeholder value is not allowed. Enter the real value."
            continue
        }

        return $answer
    }
}

function Read-EnvValue {
    param(
        [string]$EnvText,
        [string]$Key
    )

    $pattern = "(?m)^\s*$([regex]::Escape($Key))\s*=\s*(.*)\s*$"
    $match = [regex]::Match($EnvText, $pattern)

    if (-not $match.Success) {
        return ""
    }

    return ($match.Groups[1].Value -as [string]).Trim()
}

function Set-EnvValue {
    param(
        [string]$EnvText,
        [string]$Key,
        [string]$Value
    )

    $escapedKey = [regex]::Escape($Key)
    $line = "$Key=$Value"

    if ($EnvText -match "(?m)^\s*$escapedKey\s*=") {
        return [regex]::Replace($EnvText, "(?m)^\s*$escapedKey\s*=.*$", $line)
    }

    if (-not $EnvText.EndsWith("`n")) {
        $EnvText += "`r`n"
    }

    return $EnvText + $line + "`r`n"
}

function Ensure-EnvFile {
    Write-Step "Checking .env"

    $envPath = Join-Path $ProjectDir ".env"
    $examplePath = Join-Path $ProjectDir ".env.example"

    $defaultEnv = @"
FRONTEND_RELAY_URL=wss://ferginand-render.onrender.com/ws
FRONTEND_USER_TOKEN=ASK_ADMIN_FOR_TOKEN
FRONTEND_ROLE=user
FRONTEND_CLIENT_NAME=YOUR_NAME_HERE
FRONTEND_REQUESTED_BY=YOUR_NAME_HERE
FRONTEND_SERVER_ID=main
FRONTEND_AUTO_CONNECT=true

FRONTEND_HOST=127.0.0.1
FRONTEND_PORT=5050
FRONTEND_DEBUG=false
"@

    if (-not (Test-Path $envPath)) {
        if (Test-Path $examplePath) {
            Copy-Item $examplePath $envPath
            Write-Warn ".env was missing, so .env.example was copied to .env"
        } else {
            $defaultEnv | Set-Content -Path $envPath -Encoding UTF8
            Write-Warn ".env was missing, so a default one was created"
        }
    }

    $envText = Get-Content $envPath -Raw

    # Force required defaults/keys to exist.
    $requiredDefaults = [ordered]@{
        "FRONTEND_RELAY_URL" = "wss://ferginand-render.onrender.com/ws"
        "FRONTEND_USER_TOKEN" = "ASK_ADMIN_FOR_TOKEN"
        "FRONTEND_ROLE" = "user"
        "FRONTEND_CLIENT_NAME" = "YOUR_NAME_HERE"
        "FRONTEND_REQUESTED_BY" = "YOUR_NAME_HERE"
        "FRONTEND_SERVER_ID" = "main"
        "FRONTEND_AUTO_CONNECT" = "true"
        "FRONTEND_HOST" = "127.0.0.1"
        "FRONTEND_PORT" = "5050"
        "FRONTEND_DEBUG" = "false"
    }

    foreach ($key in $requiredDefaults.Keys) {
        $current = Read-EnvValue -EnvText $envText -Key $key
        if ([string]::IsNullOrWhiteSpace($current)) {
            $envText = Set-EnvValue -EnvText $envText -Key $key -Value $requiredDefaults[$key]
        }
    }

    $relayUrl = Read-EnvValue -EnvText $envText -Key "FRONTEND_RELAY_URL"
    $token = Read-EnvValue -EnvText $envText -Key "FRONTEND_USER_TOKEN"
    $clientName = Read-EnvValue -EnvText $envText -Key "FRONTEND_CLIENT_NAME"
    $requestedBy = Read-EnvValue -EnvText $envText -Key "FRONTEND_REQUESTED_BY"

    $needsName = (
        [string]::IsNullOrWhiteSpace($clientName) -or
        [string]::IsNullOrWhiteSpace($requestedBy) -or
        $clientName -eq "YOUR_NAME_HERE" -or
        $requestedBy -eq "YOUR_NAME_HERE"
    )

    $needsToken = (
        [string]::IsNullOrWhiteSpace($token) -or
        $token -eq "ASK_ADMIN_FOR_TOKEN" -or
        $token -eq "ask_admin_for_your_personal_token"
    )

    $needsRelay = (
        [string]::IsNullOrWhiteSpace($relayUrl) -or
        $relayUrl -match "your-render-service"
    )

    if ($needsRelay -or $needsName -or $needsToken) {
        Write-Host ""
        Write-Host "============================================================" -ForegroundColor Yellow
        Write-Host "ACTION REQUIRED: Client setup" -ForegroundColor Yellow
        Write-Host "============================================================" -ForegroundColor Yellow
        Write-Host ""
        Write-Host "You must enter a display name and the personal token from the admin."
        Write-Host "The installer will not continue without these."
        Write-Host ""

        if ($needsRelay) {
            $relayUrl = Read-RequiredValue `
                -Prompt "Relay WSS URL" `
                -CurrentValue "wss://ferginand-render.onrender.com/ws" `
                -InvalidValues @("wss://your-render-service.onrender.com/ws")
        }

        if ($needsName) {
            $defaultName = $env:USERNAME
            if ([string]::IsNullOrWhiteSpace($defaultName)) {
                $defaultName = "Friend"
            }

            $name = Read-RequiredValue `
                -Prompt "Your display name" `
                -CurrentValue $defaultName `
                -InvalidValues @("YOUR_NAME_HERE")

            $clientName = $name
            $requestedBy = $name
        }

        if ($needsToken) {
            Write-Host ""
            Write-Host "Ask the admin for your personal FRONTEND_USER_TOKEN." -ForegroundColor Yellow
            Write-Host "Do not use another person's token."
            Write-Host ""

            $token = Read-RequiredValue `
                -Prompt "Paste your personal token" `
                -CurrentValue "" `
                -InvalidValues @("ASK_ADMIN_FOR_TOKEN", "ask_admin_for_your_personal_token")
        }

        $envText = Set-EnvValue -EnvText $envText -Key "FRONTEND_RELAY_URL" -Value $relayUrl
        $envText = Set-EnvValue -EnvText $envText -Key "FRONTEND_USER_TOKEN" -Value $token
        $envText = Set-EnvValue -EnvText $envText -Key "FRONTEND_ROLE" -Value "user"
        $envText = Set-EnvValue -EnvText $envText -Key "FRONTEND_CLIENT_NAME" -Value $clientName
        $envText = Set-EnvValue -EnvText $envText -Key "FRONTEND_REQUESTED_BY" -Value $requestedBy
        $envText = Set-EnvValue -EnvText $envText -Key "FRONTEND_SERVER_ID" -Value "main"
        $envText = Set-EnvValue -EnvText $envText -Key "FRONTEND_AUTO_CONNECT" -Value "true"
        $envText = Set-EnvValue -EnvText $envText -Key "FRONTEND_HOST" -Value "127.0.0.1"
        $envText = Set-EnvValue -EnvText $envText -Key "FRONTEND_PORT" -Value "5050"
        $envText = Set-EnvValue -EnvText $envText -Key "FRONTEND_DEBUG" -Value "false"

        Set-Content -Path $envPath -Value $envText -Encoding UTF8

        Write-Ok ".env configured"
    } else {
        Write-Ok ".env exists and looks configured"
    }

    # Final hard validation. Do not allow install to continue with placeholders.
    $envText = Get-Content $envPath -Raw
    $finalToken = Read-EnvValue -EnvText $envText -Key "FRONTEND_USER_TOKEN"
    $finalClientName = Read-EnvValue -EnvText $envText -Key "FRONTEND_CLIENT_NAME"
    $finalRequestedBy = Read-EnvValue -EnvText $envText -Key "FRONTEND_REQUESTED_BY"

    if (
        [string]::IsNullOrWhiteSpace($finalToken) -or
        $finalToken -eq "ASK_ADMIN_FOR_TOKEN" -or
        $finalToken -eq "ask_admin_for_your_personal_token" -or
        [string]::IsNullOrWhiteSpace($finalClientName) -or
        $finalClientName -eq "YOUR_NAME_HERE" -or
        [string]::IsNullOrWhiteSpace($finalRequestedBy) -or
        $finalRequestedBy -eq "YOUR_NAME_HERE"
    ) {
        throw ".env is incomplete. Display name and personal token are required."
    }
}

function Ensure-Venv-And-Requirements {
    param([object]$PythonCmd)

    Write-Step "Creating/updating Python virtual environment"

    Push-Location $ProjectDir
    try {
        $venvDir = Join-Path $ProjectDir ".venv"
        $venvPython = Join-Path $venvDir "Scripts\python.exe"

        if ((Test-Path $venvDir) -and (-not (Test-Path $venvPython))) {
            Write-Warn "Partial/broken .venv detected. Removing it and recreating."
            Remove-Item -Recurse -Force $venvDir
        }

        if (-not (Test-Path $venvPython)) {
            Write-Step "Creating .venv with Python 3.13"
            Write-Host "Using: $($PythonCmd.RealExe)"
            Invoke-Python313 -PythonCmd $PythonCmd -Arguments @("-m", "venv", ".venv")

            if ($LASTEXITCODE -ne 0) {
                throw "Python venv creation command failed"
            }

            Write-Ok "Created .venv"
        } else {
            Write-Ok ".venv already exists"
        }

        if (-not (Test-Path $venvPython)) {
            throw "Venv Python not found after creation: $venvPython"
        }

        Write-Step "Checking venv Python"
        & $venvPython --version

        if ($LASTEXITCODE -ne 0) {
            throw "Venv Python does not run correctly: $venvPython"
        }

        Write-Step "Upgrading pip"
        & $venvPython -m ensurepip --upgrade
        & $venvPython -m pip install --upgrade pip

        if (Test-Path "requirements.txt") {
            Write-Step "Installing requirements.txt"
            & $venvPython -m pip install -r requirements.txt
            Write-Ok "requirements.txt installed"
        } else {
            Write-Warn "requirements.txt not found"
        }
    } finally {
        Pop-Location
    }
}

function Ensure-StartBat {
    Write-Step "Creating frontend startup files"

    $batPath = Join-Path $ProjectDir "start_ferginand_frontend.bat"
    $vbsPath = Join-Path $ProjectDir "start_ferginand_frontend_hidden.vbs"
    $logPath = Join-Path $ProjectDir "frontend_startup.log"

    $batContent = @"
@echo off
setlocal

cd /d "$ProjectDir"

if not exist ".venv\Scripts\python.exe" (
    echo [ERROR] Missing .venv. Run bootstrap again. >> "$logPath"
    exit /b 1
)

if not exist ".env" (
    echo [ERROR] Missing .env. Ask admin for config. >> "$logPath"
    exit /b 1
)

echo [%date% %time%] Updating Ferdinand Frontend... >> "$logPath"

where git >nul 2>nul
if errorlevel 1 (
    echo [WARNING] Git not found on PATH. Skipping auto-update. >> "$logPath"
) else (
    git pull >> "$logPath" 2>&1
    if errorlevel 1 (
        echo [WARNING] git pull failed. Continuing with currently installed version. >> "$logPath"
    )
)

echo [%date% %time%] Updating Python requirements... >> "$logPath"
".venv\Scripts\python.exe" -m pip install -r requirements.txt >> "$logPath" 2>&1
if errorlevel 1 (
    echo [WARNING] requirements install failed. Continuing anyway. >> "$logPath"
)

echo [%date% %time%] Starting Ferdinand Frontend hidden... >> "$logPath"

start "" /b ".venv\Scripts\python.exe" app.py >> "$logPath" 2>&1

exit /b 0
"@

    $vbsContent = @"
Set shell = CreateObject("WScript.Shell")
shell.Run Chr(34) & "$batPath" & Chr(34), 0, False
"@

    Set-Content -Path $batPath -Value $batContent -Encoding ASCII
    Set-Content -Path $vbsPath -Value $vbsContent -Encoding ASCII

    Write-Ok "Start BAT created: $batPath"
    Write-Ok "Hidden launcher created: $vbsPath"

    return $vbsPath
}

function Install-StartupShortcut {
    param([string]$TargetLauncher)

    Write-Step "Installing Windows Startup shortcut"

    $startupFolder = [Environment]::GetFolderPath("Startup")
    $shortcutPath = Join-Path $startupFolder $StartupShortcutName

    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($shortcutPath)
    $shortcut.TargetPath = $TargetLauncher
    $shortcut.WorkingDirectory = $ProjectDir
    $shortcut.WindowStyle = 7
    $shortcut.Description = "Starts the Ferdinand Frontend local server in the background"
    $shortcut.Save()

    Write-Ok "Startup shortcut installed:"
    Write-Host $shortcutPath
}

function Start-Frontend {
    param([string]$TargetLauncher)

    Write-Step "Starting frontend server"

    Start-Process -FilePath $TargetLauncher -WorkingDirectory $ProjectDir

    Start-Sleep -Seconds 3

    Write-Host ""
    Write-Host "Frontend should be available here:" -ForegroundColor Green
    Write-Host $AppUrl -ForegroundColor Green
    Write-Host ""

    try {
        Start-Process $AppUrl
    } catch {
        Write-Warn "Could not open browser automatically. Open this manually: $AppUrl"
    }
}

try {
    Write-Host ""
    Write-Host "============================================================" -ForegroundColor Cyan
    Write-Host "Ferdinand Frontend Windows Installer" -ForegroundColor Cyan
    Write-Host "============================================================" -ForegroundColor Cyan

    Ensure-Winget
    Ensure-Git
    $pythonCmd = Ensure-Python
    Clone-Or-Pull-Repo
    Ensure-EnvFile
    Ensure-Venv-And-Requirements -PythonCmd $pythonCmd
    $launcher = Ensure-StartBat
    Install-StartupShortcut -TargetLauncher $launcher
    Start-Frontend -TargetLauncher $launcher

    Write-Host ""
    Write-Host "============================================================" -ForegroundColor Green
    Write-Host "DONE" -ForegroundColor Green
    Write-Host "============================================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "Installed to:"
    Write-Host $ProjectDir
    Write-Host ""
    Write-Host "Auto-start installed. It will run when Windows logs in."
    Write-Host ""

} catch {
    Write-Host ""
    Write-Host "============================================================" -ForegroundColor Red
    Write-Host "INSTALL FAILED" -ForegroundColor Red
    Write-Host "============================================================" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    Write-Host ""
    Write-Host "Send this error to the admin."
    Write-Host ""
    Read-Host "Press ENTER to close"
    exit 1
}
