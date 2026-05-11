# Starts the chat server and opens a Cloudflare tunnel.
# Run this independently — it does not depend on the calorie logger.
# Ollama must already be running (or run the calorie logger's start-tunnel.ps1 first).

$model = "llama3.2"   # Change to match the model you want to use

# Check Node.js
if (-not (Get-Command "node" -ErrorAction SilentlyContinue)) {
    Write-Host ""
    Write-Host "ERROR: Node.js is not installed." -ForegroundColor Red
    Write-Host "Download it from https://nodejs.org (LTS version)" -ForegroundColor Red
    exit 1
}

# Check cloudflared
$cloudflared = Join-Path $PSScriptRoot "cloudflared-windows-amd64.exe"
if (-not (Test-Path $cloudflared)) {
    Write-Host ""
    Write-Host "ERROR: cloudflared-windows-amd64.exe not found in this folder." -ForegroundColor Red
    Write-Host "Copy it from the calorie logger folder, or download it from:" -ForegroundColor Red
    Write-Host "https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/" -ForegroundColor Red
    exit 1
}

# Kill any process already on port 8788
$conn = netstat -ano | Select-String "8788" | Select-String "LISTENING"
if ($conn) {
    $oldPid = ($conn -split '\s+')[-1].Trim()
    if ($oldPid -match '^\d+$') {
        taskkill /F /PID $oldPid 2>$null
        Write-Host "Stopped old server (PID $oldPid)"
    }
}

# Start Ollama if it isn't already running
$ollamaRunning = Get-Process "ollama" -ErrorAction SilentlyContinue
if (-not $ollamaRunning) {
    Write-Host "Starting Ollama..."
    $env:OLLAMA_ORIGINS = "*"
    Start-Process "ollama" -ArgumentList "serve" -WindowStyle Minimized -Environment @{ OLLAMA_ORIGINS = "*" }
    Start-Sleep -Seconds 3
    & ollama pull $model
} else {
    Write-Host "Ollama is already running."
}

Write-Host ""
Write-Host "Starting chat server..."
$serverScript = Join-Path $PSScriptRoot "server.js"
Start-Process "node" -ArgumentList $serverScript -WindowStyle Minimized
Start-Sleep -Seconds 2

Write-Host ""
Write-Host "Opening Cloudflare tunnel..."
Write-Host "------------------------------------------------------------"
Write-Host "When the URL appears below, copy it and paste it into"
Write-Host "the app Settings (gear icon) as the Cloudflare Tunnel URL."
Write-Host "------------------------------------------------------------"
Write-Host ""

& $cloudflared tunnel --url http://localhost:8788
