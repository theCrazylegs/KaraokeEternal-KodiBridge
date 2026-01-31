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

# ============================================
# FONCTIONS UTILITAIRES (EN PREMIER !)
# ============================================

function Write-Step($message) {
    $time = (Get-Date).ToString('HH:mm:ss')
    Write-Host ""
    Write-Host "[$time] $message" -ForegroundColor Cyan
}

function Write-OK($message) {
    Write-Host "  ✅ $message" -ForegroundColor Green
}

function Write-Warn($message) {
    Write-Host "  ⚠️ $message" -ForegroundColor Yellow
}

function Write-Error($message) {
    Write-Host "  ❌ $message" -ForegroundColor Red
}

function Connect-ADB($Config) {
    
    $connectResult = & $Config.ADBPath connect "$($Config.DeviceIP):$($Config.ADBPort)" 2>&1
    Write-Host "Résultat ADB: $connectResult" -ForegroundColor Gray
    
    return $connectResult -match "connected|already connected"
}



# ============================================
# CHARGEMENT CONFIGURATION
# ============================================

Write-Step "Chargement configuration..."

if (Test-Path "config.ps1") {
    Write-OK "config.ps1 trouvé"
    . .\config.ps1
} elseif (Test-Path "config.example.ps1") {
    Write-Warn "config.ps1 manquant ! Copie config.example.ps1 → config.ps1"
    . .\config.example.ps1
    exit 1
} else {
    Write-Error "Aucun fichier config trouvé ! Crée config.ps1"
    exit 1
}


# ============================================
# AIDE
# ============================================
if ($Help) {
    Write-Host "Usage: .\deploy.ps1 [-NoClearCache] [-LogsOnly] [-Debug] [-KodiLog] [-CheckAddon] [-Help]" -ForegroundColor Cyan
    Write-Host "Config: Voir config.ps1 (copie config.example.ps1 et personnalise)" -ForegroundColor Yellow
    exit 0
}

# ============================================
# MODES SPÉCIAUX
# ============================================

if ($KodiLog) {
    Write-Step "Connexion ADB..."
    if (-not (Connect-ADB $Config)) { Write-Error "ADB échoué"; exit 1 }
    
    $logPath = "$($Config.KodiDataDir)/temp/kodi.log"
    & $Config.ADBPath shell "cat $logPath" | Select-String "ERROR|plugin.kodi.ke-client|KEService" | Select-Object -Last 50
    exit 0
}

if ($CheckAddon) {
    Write-Step "Connexion ADB..."
    if (-not (Connect-ADB $Config)) { Write-Error "ADB échoué"; exit 1 }
    
    $DEST = "$($Config.KodiDataDir)/addons/$($Config.AddonID)"
    & $Config.ADBPath shell "ls -la $DEST"
    exit 0
}

if ($Debug -or $LogsOnly) {
    if (-not (Connect-ADB $Config)) { Write-Error "ADB échoué"; exit 1 }
    & $Config.ADBPath logcat -c
    & $Config.ADBPath logcat "xbmc.python:V" "*:S"
    exit 0
}

# ============================================
# DÉPLOIEMENT PRINCIPAL
# ============================================

Write-Host "============================================" -ForegroundColor Magenta
Write-Host "   Déploiement $($Config.AddonID) → $($Config.DeviceIP)" -ForegroundColor Magenta
Write-Host "============================================" -ForegroundColor Magenta

# 1. Connexion
Write-Step "Connexion ADB..."
if (-not (Connect-ADB $Config)) {
    Write-Error "Échec connexion ADB → Vérifie: IP $($Config.DeviceIP):$($Config.ADBPort)"
    exit 1
}
Write-OK "Connecté !"

# 2. Arrêt Kodi
Write-Step "Arrêt $($Config.KodiPackage)..."
& $Config.ADBPath shell "am force-stop $($Config.KodiPackage)" 2>$null
Start-Sleep -Milliseconds 500
Write-OK "Kodi arrêté"

# 3. Nettoyage (optionnel)
if (-not $NoClearCache) {
    Write-Step "Nettoyage cache..."
    $DEST = "$($Config.KodiDataDir)/addons/$($Config.AddonID)"
    & $Config.ADBPath shell "rm -f $($Config.KodiDataDir)/Database/Addons*.db" 2>$null
    & $Config.ADBPath shell "rm -rf $($Config.KodiDataDir)/userdata/addon_data/$($Config.AddonID)" 2>$null
    Write-OK "Cache nettoyé"
}

# 4. Déploiement
Write-Step "Déploiement fichiers..."
$DEST = "$($Config.KodiDataDir)/addons/$($Config.AddonID)/"

# Fichiers principaux
@("addon.xml", "service.py", "icon.png", "white.png", "waiting_screen.png") | ForEach-Object {
    & $Config.ADBPath push $_ "$DEST" | Out-Null
    Write-OK "$_"
}

& $Config.ADBPath push "resources/settings.xml" "$DEST/resources/" | Out-Null
Write-OK "settings.xml"

& $Config.ADBPath push "resources/language/" "$DEST/resources/" | Out-Null
Write-OK "language/ (i18n)"

& $Config.ADBPath push "lib/" "$DEST" | Out-Null
Write-OK "lib/ (socket.io)"

# 5. Redémarrage
Write-Step "Redémarrage Kodi..."
& $Config.ADBPath shell "am start -n '$($Config.KodiPackage)/org.xbmc.kodi.Main'" | Out-Null
Write-OK "Kodi démarré !"

# 7. Attendre et afficher les logs
Write-Host ""
Write-Host "============================================" -ForegroundColor Green
Write-Host "   Deploiement termine !" -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Green
Write-Host ""
Write-Host "Pour ouvrir les settings dans Kodi:" -ForegroundColor Yellow
Write-Host "  Parametres - Extensions - Mes extensions - Services - Karaoke Eternal Client - Configurer" -ForegroundColor White
