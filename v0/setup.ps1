# Music Reader v0 : installe Audiveris et les données OCR dans .\tools (sans installation système),
# et télécharge deux partitions d'exemple dans .\samples.
# Usage : powershell -ExecutionPolicy Bypass -File setup.ps1
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$root = $PSScriptRoot
$version = '5.11.0'
$tools = Join-Path $root 'tools'
$audiverisDir = Join-Path $tools 'audiveris'
$exe = Join-Path $audiverisDir 'Audiveris\Audiveris.exe'
New-Item -ItemType Directory -Force $tools | Out-Null

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

# 2. Données OCR Tesseract (modèles « standard » : Audiveris utilise le mode legacy)
$tess = Join-Path $tools 'tessdata'
New-Item -ItemType Directory -Force $tess | Out-Null
foreach ($lang in 'eng', 'ita', 'fra') {
    $file = Join-Path $tess "$lang.traineddata"
    if ((Test-Path $file) -and (Get-Item $file).Length -gt 100000) { continue }
    Write-Host "Téléchargement OCR : $lang"
    for ($try = 1; $try -le 3; $try++) {
        try { Invoke-WebRequest "https://github.com/tesseract-ocr/tessdata/raw/main/$lang.traineddata" -OutFile $file; break }
        catch { if ($try -eq 3) { throw } Start-Sleep -Seconds 2 }
    }
}

# 3. Partitions d'exemple (Wikimedia Commons)
$samples = Join-Path $root 'samples'
New-Item -ItemType Directory -Force $samples | Out-Null
$examples = @{
    'yankee-doodle.png'  = 'https://upload.wikimedia.org/wikipedia/commons/0/08/Yankee_Doodle_harmonization_36.png'
    'bwv1052-melody.jpg' = 'https://upload.wikimedia.org/wikipedia/commons/2/2e/BWV1052-adagio-melody.jpeg'
}
foreach ($name in $examples.Keys) {
    $file = Join-Path $samples $name
    if (-not (Test-Path $file)) {
        Write-Host "Exemple : $name"
        Invoke-WebRequest $examples[$name] -OutFile $file -UserAgent 'music-reader-v0'
    }
}

Write-Host ''
Write-Host 'Prêt. Lancer le serveur avec : node server.mjs   puis ouvrir http://localhost:8787'
