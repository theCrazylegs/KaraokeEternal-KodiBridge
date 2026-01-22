# ============================================
# Deploy script pour plugin.kodi.ke-client
# ============================================

param(
    [switch]$NoClearCache,
    [switch]$LogsOnly,
    [switch]$Help
)

# Configuration
$ADB_PATH = "F:\rv_data_local\telechargement\platform-tools-latest-windows\platform-tools\adb.exe"
$ADDON_ID = "plugin.kodi.ke-client"
$KODI_DATA = "/storage/emulated/0/Android/data/org.xbmc.kodi/files/.kodi"
$DEST = "$KODI_DATA/addons/$ADDON_ID/"
$KODI_PACKAGE = "org.xbmc.kodi"

if ($Help) {
    Write-Host "Usage: .\deploy.ps1 [-NoClearCache] [-LogsOnly] [-Help]"
    Write-Host ""
    Write-Host "Options:"
    Write-Host "  -NoClearCache  Ne pas vider le cache Kodi"
    Write-Host "  -LogsOnly      Afficher uniquement les logs sans deployer"
    Write-Host "  -Help          Afficher cette aide"
    exit 0
}

function Write-Step($message) {
    $time = (Get-Date).ToString('HH:mm:ss')
    Write-Host ""
    Write-Host "[$time] $message" -ForegroundColor Cyan
}

function Write-OK($message) {
    Write-Host "  [OK] $message" -ForegroundColor Green
}

function Write-Warn($message) {
    Write-Host "  [!] $message" -ForegroundColor Yellow
}

# Mode logs uniquement
if ($LogsOnly) {
    Write-Step "Affichage des logs Kodi (Ctrl+C pour arreter)..."
    & $ADB_PATH logcat -c
    & $ADB_PATH logcat "*:S" "Kodi:V" | Select-String -Pattern "plugin.kodi.ke-client|KEService"
    exit 0
}

Write-Host "============================================" -ForegroundColor Magenta
Write-Host "   Deploiement de $ADDON_ID" -ForegroundColor Magenta
Write-Host "============================================" -ForegroundColor Magenta

# 1. Verifier la connexion ADB
Write-Step "Verification de la connexion ADB..."
$deviceCheck = & $ADB_PATH devices | Select-String -Pattern "device$"
if (-not $deviceCheck) {
    Write-Host "  [ERREUR] Aucun appareil connecte ! Verifiez ADB." -ForegroundColor Red
    exit 1
}
Write-OK "Appareil connecte"

# 2. Arreter Kodi
Write-Step "Arret de Kodi..."
& $ADB_PATH shell am force-stop $KODI_PACKAGE 2>$null
Start-Sleep -Milliseconds 500
Write-OK "Kodi arrete"

# 3. Nettoyer le cache si demande
if (-not $NoClearCache) {
    Write-Step "Nettoyage du cache Kodi..."

    # Supprimer le cache de l addon database (force Kodi a relire addon.xml)
    & $ADB_PATH shell "rm -f $KODI_DATA/Database/Addons*.db" 2>$null
    Write-OK "Base de donnees addons reinitialisee"

    # Supprimer les settings en cache pour forcer la relecture
    & $ADB_PATH shell "rm -rf $KODI_DATA/userdata/addon_data/$ADDON_ID" 2>$null
    Write-OK "Settings utilisateur reinitialises"
}

# 4. Creer le dossier destination si necessaire
Write-Step "Preparation du dossier destination..."
& $ADB_PATH shell "mkdir -p $DEST" 2>$null
& $ADB_PATH shell "mkdir -p $DEST/resources/skins/default/720p" 2>$null
Write-OK "Dossiers crees"

# 5. Deployer les fichiers
Write-Step "Deploiement des fichiers..."
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Push-Location $scriptDir

& $ADB_PATH push "addon.xml" "$DEST" | Out-Null
Write-OK "addon.xml"

& $ADB_PATH push "service.py" "$DEST" | Out-Null
Write-OK "service.py"

& $ADB_PATH push "icon.png" "$DEST" | Out-Null
Write-OK "icon.png"

& $ADB_PATH push "resources/settings.xml" "$DEST/resources/" | Out-Null
Write-OK "resources/settings.xml"

& $ADB_PATH push "resources/skins/default/720p/waiting_screen.xml" "$DEST/resources/skins/default/720p/" | Out-Null
Write-OK "resources/skins/default/720p/waiting_screen.xml"

Pop-Location

# 6. Demarrer Kodi
Write-Step "Demarrage de Kodi..."
& $ADB_PATH shell am start -n "$KODI_PACKAGE/org.xbmc.kodi.Main" 2>$null | Out-Null
Write-OK "Kodi demarre"

# 7. Attendre et afficher les logs
Write-Host ""
Write-Host "============================================" -ForegroundColor Green
Write-Host "   Deploiement termine !" -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Green
Write-Host ""
Write-Host "Pour ouvrir les settings dans Kodi:" -ForegroundColor Yellow
Write-Host "  Parametres - Extensions - Mes extensions - Services - Karaoke Eternal Client - Configurer" -ForegroundColor White

Write-Step "Logs en direct (Ctrl+C pour arreter)..."
Start-Sleep -Seconds 3
& $ADB_PATH logcat -c
& $ADB_PATH logcat "*:S" "Kodi:V" | Select-String -Pattern "plugin.kodi.ke-client|KEService|xbmc.python"
