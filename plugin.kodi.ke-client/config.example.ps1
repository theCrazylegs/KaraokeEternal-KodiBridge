# ============================================
# Karaoke Eternal Kodi - Configuration
# ============================================
# Copie ce fichier en config.ps1 et personnalise pour ton environnement

$Config = @{
    # ADB Configuration
    ADBPath      = "C:\platform-tools\adb.exe"              # Chemin vers adb.exe
    DeviceIP     = "192.168.1.XXX"                          # IP de ton Freebox Player / Android TV
    ADBPort      = 5555                                     # Port ADB (généralement 5555)
    
    # Kodi Configuration
    KodiPackage  = "org.xbmc.kodi"                          # Package name Android (Kodi officiel)
    AddonID      = "plugin.kodi.ke-client"                  # ID de l'addon (ne pas changer)
    KodiDataDir  = "/storage/emulated/0/Android/data/org.xbmc.kodi/files/.kodi"  # Chemin données Kodi
    
    # Options par défaut
    NoClearCacheDefault = $false                            # Vider cache par défaut ? (false = oui)
    DebugModeDefault    = $false                            # Mode debug par défaut ?
}

Write-Host "Configuration template chargée" -ForegroundColor Green
Write-Host "IMPORTANT: Copie ce fichier → config.ps1 et personnalise les chemins/IP !" -ForegroundColor Yellow

# Export pour deploy.ps1
Export-ModuleMember -Variable Config