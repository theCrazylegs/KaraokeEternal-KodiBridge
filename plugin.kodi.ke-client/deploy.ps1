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
# CHARGEMENT CONFIGURATION
# ============================================

Write-Step "Chargement configuration..."

# Charger config.ps1 (local) ou config.example.ps1 (demo)
if (Test-Path "config.ps1") {
    Write-OK "config.ps1 trouvé"
    . .\config.ps1
} elseif (Test-Path "config.example.ps1") {
    Write-Warn "config.ps1 manquant ! Copie config.example.ps1 → config.ps1"
    Write-Warn "Valeurs par défaut (config.example.ps1) utilisées pour démo"
    . .\config.example.ps1
} else {
    Write-Error "Aucun fichier config trouvé !"
    Write-Error "Crée config.ps1 à partir de config.example.ps1"
    exit 1
}

# Validation config
if (-not (Test-Path $Config.ADBPath)) {
    Write-Error "ADB introuvable: $($Config.ADBPath)"
    exit 1
}
Write-OK "Config OK - $($Config.DeviceIP):$($Config.ADBPort)"

# ============================================
# FONCTIONS UTILITAIRES (identiques)
# ============================================

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

function Connect-ADB {
    $connectResult = & $Config.ADBPath connect "${Config.DeviceIP}:${Config.ADBPort}" 2>&1
    if ($connectResult -match "connected|already connected") {
        return $true
    }
    return $false
}

# ============================================
# MODES SPÉCIALUX (identiques - utiliser $Config.*)
# ============================================

if ($Help) {
    Write-Host "Usage: .\deploy.ps1 [-NoClearCache] [-LogsOnly] [-Debug] [-KodiLog] [-CheckAddon] [-Help]"
    Write-Host "Config: config.ps1 (copie config.example.ps1 et personnalise)"
    exit 0
}

# ... (KodiLog, CheckAddon, Debug, LogsOnly - mêmes logiques, remplacer les variables par $Config.*)

# ============================================
# DÉPLOIEMENT PRINCIPAL (refactorisé)
# ============================================

if ($KodiLog -or $CheckAddon -or $Debug -or $LogsOnly) {
    # Modes spéciaux (code identique, utiliser $Config.*)
} else {
    Write-Host "============================================" -ForegroundColor Magenta
    Write-Host "   Déploiement $($Config.AddonID) sur $($Config.DeviceIP)" -ForegroundColor Magenta
    Write-Host "============================================" -ForegroundColor Magenta

    # 1. Connexion
    Write-Step "Connexion ADB..."
    if (-not (Connect-ADB)) {
        Write-Error "Échec connexion ADB"
        exit 1
    }
    Write-OK "Connecté"

    # 2. Arrêt Kodi
    Write-Step "Arrêt $($Config.KodiPackage)..."
    & $Config.ADBPath shell "am force-stop $Config.KodiPackage" 2>$null
    Start-Sleep -Milliseconds 500
    Write-OK "Kodi arrêté"

    # 3. Nettoyage cache
    if (-not $NoClearCache) {
        Write-Step "Nettoyage cache..."
        $DEST = "$($Config.KodiDataDir)/addons/$($Config.AddonID)"
        & $Config.ADBPath shell "rm -f $($Config.KodiDataDir)/Database/Addons*.db" 2>$null
        & $Config.ADBPath shell "rm -rf $($Config.KodiDataDir)/userdata/addon_data/$($Config.AddonID)" 2>$null
        Write-OK "Cache vidé"
    }

    # 4. Déploiement fichiers
    Write-Step "Déploiement fichiers..."
    $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
    $DEST = "$($Config.KodiDataDir)/addons/$($Config.AddonID)/"
    
    Push-Location $scriptDir\plugin.kodi.ke-client
    
    @("addon.xml", "service.py", "icon.png", "white.png") | ForEach-Object {
        & $Config.ADBPath push $_ "$DEST" | Out-Null
        Write-OK "$_"
    }
    
    & $Config.ADBPath push "resources/settings.xml" "$DEST/resources/" | Out-Null
    Write-OK "resources/settings.xml"
    & $Config.ADBPath push "lib/" "$DEST" | Out-Null
    Write-OK "lib/ (socket.io)"
    
    Pop-Location
    Write-OK "Déploiement terminé"

    # 5. Redémarrage
    Write-Step "Redémarrage Kodi..."
    & $Config.ADBPath shell "am start -n '$($Config.KodiPackage)/org.xbmc.kodi.Main'" | Out-Null
    Write-OK "Kodi démarré"
}

Write-Host ""
Write-Host "✅ Déploiement terminé ! Configure l'addon dans Kodi." -ForegroundColor Green
