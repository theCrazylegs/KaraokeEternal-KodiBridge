# ============================================
# Deploy script pour plugin.kodi.ke-client
# ============================================

param(
    [switch]$NoClearCache,
    [switch]$LogsOnly,
    [switch]$Debug,
    [switch]$KodiLog,
    [switch]$CheckAddon,
    [switch]$Help
)

# Configuration
$ADB_PATH = "F:\rv_data_local\telechargement\platform-tools-latest-windows\platform-tools\adb.exe"
$ADDON_ID = "plugin.kodi.ke-client"
$KODI_DATA = "/storage/emulated/0/Android/data/org.xbmc.kodi/files/.kodi"
$DEST = "$KODI_DATA/addons/$ADDON_ID/"
$KODI_PACKAGE = "org.xbmc.kodi"
# Freebox Player / Android TV
$DEVICE_IP = "192.168.1.86"
$ADB_PORT = 5555

if ($Help) {
    Write-Host "Usage: .\deploy.ps1 [-NoClearCache] [-LogsOnly] [-Debug] [-KodiLog] [-CheckAddon] [-Help]"
    Write-Host ""
    Write-Host "Options:"
    Write-Host "  -NoClearCache  Ne pas vider le cache Kodi"
    Write-Host "  -LogsOnly      Afficher uniquement les logs sans deployer"
    Write-Host "  -Debug         Mode debug: logs verbeux (Python, XML, Addon, Permissions)"
    Write-Host "  -KodiLog       Afficher le fichier kodi.log (erreurs Python detaillees)"
    Write-Host "  -CheckAddon    Verifier si l'addon est installe et ses fichiers"
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

function Write-Error($message) {
    Write-Host "  [ERREUR] $message" -ForegroundColor Red
}

# Connexion ADB commune
function Connect-ADB {
    $connectResult = & $ADB_PATH connect "${DEVICE_IP}:${ADB_PORT}" 2>&1
    if ($connectResult -match "connected|already connected") {
        return $true
    }
    return $false
}

# Mode KodiLog - Affiche le fichier kodi.log
if ($KodiLog) {
    Write-Step "Connexion ADB..."
    if (-not (Connect-ADB)) {
        Write-Error "Impossible de se connecter a ADB"
        exit 1
    }

    Write-Step "Recuperation du fichier kodi.log..."
    $logPath = "$KODI_DATA/temp/kodi.log"

    # Verifier si le fichier existe
    $fileCheck = & $ADB_PATH shell "ls -la $logPath 2>/dev/null"
    if (-not $fileCheck) {
        Write-Error "Fichier kodi.log non trouve a: $logPath"
        Write-Host "  Essayez de demarrer Kodi d'abord" -ForegroundColor Yellow
        exit 1
    }

    Write-Host ""
    Write-Host "=== Derniers logs Kodi (filtres Python/Addon) ===" -ForegroundColor Cyan
    Write-Host ""

    # Afficher les derniers logs avec filtre sur les erreurs Python et addon
    & $ADB_PATH shell "cat $logPath" | Select-String -Pattern "ERROR|WARNING|plugin.kodi.ke-client|KEService|xbmc.python|Python|Traceback|Exception|ImportError|ModuleNotFoundError|SyntaxError|CAddonMgr|service|addon" | Select-Object -Last 150

    Write-Host ""
    Write-Host "=== Recherche des logs de chargement addon ===" -ForegroundColor Cyan
    Write-Host ""
    $addonLogs = & $ADB_PATH shell "cat $logPath" | Select-String -Pattern "plugin.kodi.ke-client|CAddonMgr.*service|Loading addon|Failed to load|xbmc.python" | Select-Object -Last 50
    if ($addonLogs) {
        $addonLogs
    } else {
        Write-Host "  Aucun log de l'addon trouve - l'addon n'est probablement pas charge par Kodi" -ForegroundColor Yellow
        Write-Host "  Verifiez que l'addon est active: Parametres > Extensions > Mes extensions > Services" -ForegroundColor Yellow
    }
    Write-Host ""
    Write-Host "=== Fin des logs ===" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Pour voir le log complet: adb shell cat $logPath" -ForegroundColor DarkGray
    exit 0
}

# Mode CheckAddon - Verifie l'installation de l'addon
if ($CheckAddon) {
    Write-Step "Connexion ADB..."
    if (-not (Connect-ADB)) {
        Write-Error "Impossible de se connecter a ADB"
        exit 1
    }

    Write-Host ""
    Write-Host "=== Verification de l'addon ===" -ForegroundColor Cyan
    Write-Host ""

    # 1. Verifier si le dossier addon existe
    Write-Step "Verification du dossier addon..."
    $addonDir = & $ADB_PATH shell "ls -la $DEST 2>/dev/null"
    if ($addonDir) {
        Write-OK "Dossier addon existe"
        Write-Host $addonDir -ForegroundColor DarkGray
    } else {
        Write-Error "Dossier addon NON TROUVE: $DEST"
    }

    # 2. Verifier les fichiers critiques
    Write-Step "Verification des fichiers critiques..."
    $criticalFiles = @("addon.xml", "service.py", "lib")
    foreach ($file in $criticalFiles) {
        $check = & $ADB_PATH shell "ls ${DEST}${file} 2>/dev/null"
        if ($check) {
            Write-OK "$file present"
        } else {
            Write-Error "$file MANQUANT"
        }
    }

    # 3. Verifier le contenu de addon.xml
    Write-Step "Verification de addon.xml..."
    $addonXml = & $ADB_PATH shell "cat ${DEST}addon.xml 2>/dev/null"
    if ($addonXml -match 'id="plugin.kodi.ke-client"') {
        Write-OK "addon.xml valide (ID correct)"
    } else {
        Write-Error "addon.xml invalide ou corrompu"
    }

    # 4. Verifier les libs Python
    Write-Step "Verification des libs Python..."
    $libs = & $ADB_PATH shell "ls ${DEST}lib/ 2>/dev/null"
    if ($libs -match "socketio") {
        Write-OK "socketio present"
    } else {
        Write-Error "socketio MANQUANT dans lib/"
    }
    if ($libs -match "engineio") {
        Write-OK "engineio present"
    } else {
        Write-Error "engineio MANQUANT dans lib/"
    }

    # 5. Verifier si l'addon est dans la base de donnees Kodi
    Write-Step "Verification de la base addons Kodi..."
    $addonDb = & $ADB_PATH shell "ls $KODI_DATA/Database/Addons*.db 2>/dev/null"
    if ($addonDb) {
        Write-OK "Base addons presente: $addonDb"
        # Essayer de voir si l'addon est enregistre (sqlite3 pas toujours disponible)
        $sqlCheck = & $ADB_PATH shell "sqlite3 '$addonDb' `"SELECT * FROM installed WHERE addonID='$ADDON_ID'`" 2>/dev/null"
        if ($sqlCheck) {
            Write-OK "Addon enregistre dans la base"
        } else {
            Write-Warn "Addon non trouve dans la base (normal apres un clear cache)"
        }
    } else {
        Write-Warn "Base addons non trouvee (Kodi pas encore lance?)"
    }

    # 6. Verifier les settings de l'addon
    Write-Step "Verification des settings..."
    $settings = & $ADB_PATH shell "cat $KODI_DATA/userdata/addon_data/$ADDON_ID/settings.xml 2>/dev/null"
    if ($settings) {
        Write-OK "Settings existent"
        if ($settings -match "server_ip") {
            Write-Host "  server_ip configure" -ForegroundColor Green
        }
    } else {
        Write-Warn "Pas de settings (normal pour premiere installation)"
    }

    Write-Host ""
    Write-Host "=== Fin de la verification ===" -ForegroundColor Cyan
    exit 0
}

# Mode debug (logs verbeux)
if ($Debug) {
    Write-Step "Mode DEBUG - Logs verbeux (Ctrl+C pour arreter)..."
    Write-Host "  Tags surveilles: Python, Addon, XML, Permissions, Service" -ForegroundColor Yellow
    Write-Host ""
    & $ADB_PATH logcat -c
    # Filtres pour debugger les addons Kodi:
    # - xbmc.python: erreurs Python / traceback
    # - XBMC-Addon: chargement/erreurs addons
    # - kodi: logs generaux Kodi
    # - python: interpretreur Python
    # - ActivityManager: lancement d'activites Android
    # - AndroidRuntime: crashes Java/Python
    & $ADB_PATH logcat "xbmc.python:V" "XBMC-Addon:V" "XBMC-AddonManager:V" "kodi:V" "python:V" "ActivityManager:I" "AndroidRuntime:E" "System.err:W" "*:S"
    exit 0
}

# Mode logs uniquement (filtre standard)
if ($LogsOnly) {
    Write-Step "Affichage des logs Kodi (Ctrl+C pour arreter)..."
    Write-Host "  Tip: Utilisez -Debug pour plus de details" -ForegroundColor Yellow
    & $ADB_PATH logcat -c
    & $ADB_PATH logcat "*:S" "Kodi:V" | Select-String -Pattern "plugin.kodi.ke-client|KEService"
    exit 0
}

Write-Host "============================================" -ForegroundColor Magenta
Write-Host "   Deploiement de $ADDON_ID" -ForegroundColor Magenta
Write-Host "============================================" -ForegroundColor Magenta

# 1. Connexion ADB
Write-Step "Connexion ADB a $DEVICE_IP`:$ADB_PORT..."
$connectResult = & $ADB_PATH connect "${DEVICE_IP}:${ADB_PORT}" 2>&1
if ($connectResult -match "connected|already connected") {
    Write-OK "Connecte a $DEVICE_IP"
} else {
    Write-Warn "Tentative de connexion: $connectResult"
}

# Verifier que l'appareil est bien connecte
$deviceCheck = & $ADB_PATH devices | Select-String -Pattern "device$"
if (-not $deviceCheck) {
    Write-Host "  [ERREUR] Aucun appareil connecte ! Verifiez que ADB est active sur la Freebox." -ForegroundColor Red
    Write-Host "  Conseil: Parametres Freebox - Systeme - Informations Freebox Player - adb" -ForegroundColor Yellow
    exit 1
}
Write-OK "Appareil pret"

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
& $ADB_PATH shell "mkdir -p $DEST/lib" 2>$null
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

& $ADB_PATH push "white.png" "$DEST" | Out-Null
Write-OK "white.png"

& $ADB_PATH push "resources/settings.xml" "$DEST/resources/" | Out-Null
Write-OK "resources/settings.xml"

& $ADB_PATH push "resources/skins/default/720p/waiting_screen.xml" "$DEST/resources/skins/default/720p/" | Out-Null
Write-OK "resources/skins/default/720p/waiting_screen.xml"

# Deployer les libs Socket.io
Write-Step "Deploiement des libs Python (Socket.io)..."
& $ADB_PATH push "lib/" "$DEST" 2>&1 | Out-Null
Write-OK "lib/ (socketio, engineio, websocket)"

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

if ($Debug) {
    Write-Host "  Mode DEBUG actif - logs verbeux" -ForegroundColor Yellow
    & $ADB_PATH logcat "xbmc.python:V" "XBMC-Addon:V" "XBMC-AddonManager:V" "kodi:V" "python:V" "ActivityManager:I" "AndroidRuntime:E" "System.err:W" "*:S"
} else {
    Write-Host "  Tip: Utilisez -Debug pour plus de details" -ForegroundColor DarkGray
    & $ADB_PATH logcat "*:S" "Kodi:V" | Select-String -Pattern "plugin.kodi.ke-client|KEService|xbmc.python"
}
