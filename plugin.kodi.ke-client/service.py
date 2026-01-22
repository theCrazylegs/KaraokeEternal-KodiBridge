"""
Karaoke Eternal Client for Kodi
Service qui affiche l'écran d'attente et communique avec le serveur KE.
"""
import xbmc
import xbmcgui
import xbmcaddon
import urllib.request
import json

ADDON_ID = "plugin.kodi.ke-client"
POLL_INTERVAL = 3  # secondes entre chaque appel API


def log(message, level=xbmc.LOGINFO):
    """Log un message avec le préfixe de l'addon."""
    xbmc.log(f"[{ADDON_ID}] {message}", level)


class KEService(xbmc.Monitor):
    """Service principal qui gère l'écran d'attente."""

    def __init__(self):
        super().__init__()
        self.addon = xbmcaddon.Addon()
        self.window = None
        self._last_error_logged = False
        log("Service initialisé")

    def _get_server_url(self):
        """Construit l'URL du serveur à partir des settings."""
        ip = self.addon.getSetting('server_ip')
        port = self.addon.getSetting('server_port')

        if not ip or not port:
            log("Settings non configurés - IP ou Port manquant", xbmc.LOGWARNING)
            return None

        return f"http://{ip}:{port}"

    def get_ke_status(self):
        """Récupère le statut depuis le serveur KE."""
        base_url = self._get_server_url()
        if not base_url:
            return None

        try:
            url = f"{base_url}/api/kodi/status"
            req = urllib.request.Request(url, headers={'User-Agent': 'Kodi-KE-Client/1.0'})
            with urllib.request.urlopen(req, timeout=2) as response:
                data = json.loads(response.read().decode('utf-8'))
                if self._last_error_logged:
                    log(f"Connexion rétablie avec {base_url}")
                    self._last_error_logged = False
                return data
        except urllib.error.URLError as e:
            if not self._last_error_logged:
                log(f"Impossible de joindre le serveur: {e.reason}", xbmc.LOGWARNING)
                self._last_error_logged = True
        except json.JSONDecodeError:
            log("Réponse JSON invalide du serveur", xbmc.LOGWARNING)
        except Exception as e:
            log(f"Erreur inattendue: {e}", xbmc.LOGERROR)

        return None

    def _update_window_properties(self, data):
        """Met à jour les propriétés de la fenêtre pour l'affichage."""
        home_window = xbmcgui.Window(10000)

        if data:
            next_singer = data.get('nextSinger', '')
            queue_count = data.get('count', 0)

            home_window.setProperty('KE.NextSinger', next_singer or 'En attente...')
            home_window.setProperty('KE.QueueCount', str(queue_count))
            home_window.setProperty('KE.Connected', 'true')
        else:
            home_window.setProperty('KE.NextSinger', 'Serveur non connecté')
            home_window.setProperty('KE.QueueCount', '-')
            home_window.setProperty('KE.Connected', 'false')

    def _show_waiting_screen(self):
        """Affiche l'écran d'attente."""
        if self.window is None:
            try:
                addon_path = self.addon.getAddonInfo('path')
                self.window = xbmcgui.WindowXML(
                    'waiting_screen.xml',
                    addon_path,
                    'default',
                    '720p'
                )
                self.window.show()
                log("Écran d'attente affiché")
            except Exception as e:
                log(f"Erreur affichage écran d'attente: {e}", xbmc.LOGERROR)

    def _hide_waiting_screen(self):
        """Masque l'écran d'attente."""
        if self.window is not None:
            try:
                self.window.close()
                log("Écran d'attente masqué")
            except Exception:
                pass
            finally:
                self.window = None

    def run(self):
        """Boucle principale du service."""
        log("Démarrage du service")

        # Log les settings au démarrage
        ip = self.addon.getSetting('server_ip')
        port = self.addon.getSetting('server_port')
        log(f"Configuration: serveur={ip}:{port}")

        while not self.abortRequested():
            player = xbmc.Player()

            if not player.isPlaying():
                # Pas de lecture en cours - afficher l'écran d'attente
                data = self.get_ke_status()
                self._update_window_properties(data)
                self._show_waiting_screen()
            else:
                # Lecture en cours - masquer l'écran
                self._hide_waiting_screen()

            if self.waitForAbort(POLL_INTERVAL):
                break

        # Nettoyage à l'arrêt
        self._hide_waiting_screen()
        log("Service arrêté")


if __name__ == '__main__':
    KEService().run()