# filename: tools/bootstrap_windows.ps1
# Ferdinand Frontend Windows Bootstrap Installer
# Run from PowerShell:
# powershell -NoProfile -ExecutionPolicy Bypass -Command "irm 'https://raw.githubusercontent.com/WarPiga/ferginand_frontend/main/tools/bootstrap_windows.ps1' | iex"

$ErrorActionPreference = "Stop"

# ============================================================
# EDIT THESE BEFORE COMMITTING
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

function Get-PythonCommand {
    $candidates = @(
        @{ Cmd = "py"; Args = @("-3.13") },
        @{ Cmd = "python"; Args = @() },
        @{ Cmd = "python3"; Args = @() }
    )

    foreach ($candidate in $candidates) {
        if (-not (Command-Exists $candidate.Cmd)) {
            continue
        }

        try {
            $output = & $candidate.Cmd @($candidate.Args + @("--version")) 2>&1
            if ($LASTEXITCODE -eq 0 -and ($output -match "Python 3\.13")) {
                return @{
                    Cmd = $candidate.Cmd
                    Args = $candidate.Args
                }
            }
        } catch {
            continue
        }
    }

    return $null
}

function Ensure-Python {
    Write-Step "Checking Python 3.13"

    $pythonCmd = Get-PythonCommand
    if ($pythonCmd) {
        Write-Ok "Python 3.13 found: $($pythonCmd.Cmd) $($pythonCmd.Args -join ' ')"
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

    Write-Ok "Python 3.13 installed: $($pythonCmd.Cmd) $($pythonCmd.Args -join ' ')"
    return $pythonCmd
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

function Ensure-EnvFile {
    Write-Step "Checking .env"

    $envPath = Join-Path $ProjectDir ".env"
    $examplePath = Join-Path $ProjectDir ".env.example"

    if (-not (Test-Path $envPath)) {
        if (Test-Path $examplePath) {
            Copy-Item $examplePath $envPath
            Write-Warn ".env was missing, so .env.example was copied to .env"
        } else {
            @"
FRONTEND_RELAY_URL=wss://your-render-service.onrender.com/ws
FRONTEND_USER_TOKEN=ask_admin_for_your_personal_token
FRONTEND_ROLE=user
FRONTEND_CLIENT_NAME=$env:USERNAME Windows Client
FRONTEND_REQUESTED_BY=$env:USERNAME
FRONTEND_SERVER_ID=main
FRONTEND_AUTO_CONNECT=true
"@ | Set-Content -Path $envPath -Encoding UTF8
            Write-Warn ".env was missing, so a default one was created"
        }
    }

    $envText = Get-Content $envPath -Raw

    $needsSetup = $false
    if ($envText -match "ask_admin_for_your_personal_token") { $needsSetup = $true }
    if ($envText -match "your-render-service") { $needsSetup = $true }
    if ($envText -notmatch "FRONTEND_USER_TOKEN\s*=\s*\S+") { $needsSetup = $true }

    if ($needsSetup) {
        Write-Host ""
        Write-Host "============================================================" -ForegroundColor Yellow
        Write-Host "ACTION REQUIRED: .env must be configured" -ForegroundColor Yellow
        Write-Host "============================================================" -ForegroundColor Yellow
        Write-Host ""
        Write-Host "Ask the admin for:"
        Write-Host "  - FRONTEND_RELAY_URL"
        Write-Host "  - your personal FRONTEND_USER_TOKEN"
        Write-Host ""
        Write-Host "Opening .env now:"
        Write-Host $envPath
        Write-Host ""

        notepad $envPath

        Write-Host ""
        Read-Host "After saving .env in Notepad, press ENTER to continue"

        $envText = Get-Content $envPath -Raw
        if ($envText -match "ask_admin_for_your_personal_token" -or $envText -match "your-render-service") {
            Write-Warn ".env still looks incomplete."
            Write-Warn "The frontend can be installed, but it will not connect until .env is fixed."
        }
    } else {
        Write-Ok ".env exists and looks configured"
    }
}

function Ensure-Venv-And-Requirements {
    param([object]$PythonCmd)

    Write-Step "Creating/updating Python virtual environment"

    Push-Location $ProjectDir

    if (-not (Test-Path ".venv")) {
        & $PythonCmd.Cmd @($PythonCmd.Args + @("-m", "venv", ".venv"))
        Write-Ok "Created .venv"
    } else {
        Write-Ok ".venv already exists"
    }

    $venvPython = Join-Path $ProjectDir ".venv\Scripts\python.exe"

    if (-not (Test-Path $venvPython)) {
        Pop-Location
        throw "Venv Python not found: $venvPython"
    }

    & $venvPython -m pip install --upgrade pip

    if (Test-Path "requirements.txt") {
        & $venvPython -m pip install -r requirements.txt
        Write-Ok "requirements.txt installed"
    } else {
        Write-Warn "requirements.txt not found"
    }

    Pop-Location
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

if not exist ".venv\Scripts\pythonw.exe" (
    echo [ERROR] Missing pythonw.exe. Run bootstrap again. >> "$logPath"
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
    param([string]$TargetBat)

    Write-Step "Installing Windows Startup shortcut"

    $startupFolder = [Environment]::GetFolderPath("Startup")
    $shortcutPath = Join-Path $startupFolder $StartupShortcutName

    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($shortcutPath)
    $shortcut.TargetPath = $TargetBat
    $shortcut.WorkingDirectory = $ProjectDir
    $shortcut.WindowStyle = 7
    $shortcut.Description = "Starts the Ferdinand Frontend local server in the background"
    $shortcut.Save()

    Write-Ok "Startup shortcut installed:"
    Write-Host $shortcutPath
}

function Start-Frontend {
    param([string]$TargetBat)

    Write-Step "Starting frontend server"

    Start-Process -FilePath $TargetBat -WorkingDirectory $ProjectDir

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
    $startBat = Ensure-StartBat
    Install-StartupShortcut -TargetBat $startBat
    Start-Frontend -TargetBat $startBat

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