# Music Reader v1 : installe Audiveris et les données OCR dans .\tools (sans installation système).
# Si la v0 les a déjà téléchargés (..\v0\tools), le serveur les y trouve : rien n'est retéléchargé.
# Usage : powershell -ExecutionPolicy Bypass -File setup.ps1   (ou : npm run setup)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$root = $PSScriptRoot
$version = '5.11.0'
$langs = 'eng', 'fra', 'ita'

# Outils déjà présents ? (mêmes emplacements que ceux cherchés par server/server.mjs)
$candidates = @((Join-Path $root 'tools'), (Join-Path $root '..\v0\tools'))
$found = $candidates | Where-Object { Test-Path (Join-Path $_ 'audiveris\Audiveris\Audiveris.exe') } | Select-Object -First 1
$tools = if ($found) { $found } else { Join-Path $root 'tools' }
New-Item -ItemType Directory -Force $tools | Out-Null
$tools = (Resolve-Path $tools).Path
$audiverisDir = Join-Path $tools 'audiveris'
$exe = Join-Path $audiverisDir 'Audiveris\Audiveris.exe'

# 1. Audiveris (MSI console, extrait localement par une installation administrative)
if (Test-Path $exe) {
    Write-Host "Audiveris déjà présent : $exe"
} else {
    $msi = Join-Path $tools 'audiveris.msi'
    Write-Host "Téléchargement d'Audiveris $version (~85 Mo)..."
    Invoke-WebRequest "https://github.com/Audiveris/audiveris/releases/download/$version/Audiveris-$version-windowsConsole-x86_64.msi" -OutFile $msi
    Write-Host "Extraction dans $audiverisDir..."
    $p = Start-Process msiexec.exe -ArgumentList "/a `"$msi`" /qn TARGETDIR=`"$audiverisDir`"" -Wait -PassThru
    if ($p.ExitCode -ne 0) { throw "Échec de l'extraction du MSI (code $($p.ExitCode))" }
    Remove-Item $msi, (Join-Path $audiverisDir 'audiveris.msi') -ErrorAction SilentlyContinue
    if (-not (Test-Path $exe)) { throw "Audiveris.exe introuvable après extraction" }
}

# 2. Données OCR Tesseract (modèles « standard » : Audiveris utilise le mode legacy, absent des « fast »)
$tess = Join-Path $tools 'tessdata'
New-Item -ItemType Directory -Force $tess | Out-Null
foreach ($lang in $langs) {
    $file = Join-Path $tess "$lang.traineddata"
    if ((Test-Path $file) -and (Get-Item $file).Length -gt 100000) { continue }
    Write-Host "Téléchargement OCR : $lang"
    for ($try = 1; $try -le 3; $try++) {
        try { Invoke-WebRequest "https://github.com/tesseract-ocr/tessdata/raw/main/$lang.traineddata" -OutFile $file; break }
        catch { if ($try -eq 3) { throw } Start-Sleep -Seconds 2 }
    }
}

Write-Host ''
Write-Host "Outils prêts dans $tools"
Write-Host 'Développement : npm start (serveur, port 8787) et npm run dev (interface, port 5173).'
Write-Host 'Production    : npm run build puis npm start, et ouvrir http://localhost:8787'
