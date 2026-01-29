# ============================================
# Karaoke Eternal Kodi - Configuration TEMPLATE
# ============================================
# Copie ce fichier → config.ps1 et personnalise !

# PSScriptAnalyzer: Supprimer faux positif PSUseDeclaredVarsMoreThanAssignments
# $Config est utilisé via dot-sourcing (. .\config.ps1) dans deploy.ps1
[Diagnostics.CodeAnalysis.SuppressMessageAttribute(
    'PSUseDeclaredVarsMoreThanAssignments', 
    'Config',
    Justification = '$Config exporté via dot-sourcing vers deploy.ps1'
)]

$Config = @{
    ADBPath      = "C:\platform-tools\adb.exe"
    DeviceIP     = "192.168.1.XXX"     # ← TON IP Freebox
    ADBPort      = 5555
    
    KodiPackage  = "org.xbmc.kodi"
    AddonID      = "plugin.kodi.ke-client"
    KodiDataDir  = "/storage/emulated/0/Android/data/org.xbmc.kodi/files/.kodi"
    
    NoClearCacheDefault = $false
    DebugModeDefault    = $false
}

Write-Host "✅ Template chargé. Copie → config.ps1 et édite DeviceIP !" -ForegroundColor Green
