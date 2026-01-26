"""
Karaoke Eternal Client for Kodi
Client Socket.io natif pour communiquer avec le serveur KE.

L'add-on se connecte au serveur KE via Socket.io et :
- Recoit les commandes (play, pause, next) depuis l'interface web
- Envoie l'etat de lecture (position, fin de chanson)
- Affiche un ecran d'attente (image fixe) quand rien ne joue
"""
import sys
import os
import time
import json

# IMPORTANT: Patch signal avant d'importer socketio
# Kodi execute l'addon dans un thread secondaire, pas le thread principal.
# socketio/engineio utilisent signal.signal() qui ne fonctionne que dans le main thread.
import signal
_original_signal = signal.signal
def _patched_signal(signalnum, handler):
    try:
        return _original_signal(signalnum, handler)
    except ValueError:
        return None
signal.signal = _patched_signal

import xbmc
import xbmcgui
import xbmcaddon
import xbmcvfs
try:
    from urllib.request import urlopen
except ImportError:
    from urllib2 import urlopen

# Ajouter le dossier lib/ au path pour les imports
ADDON_PATH = xbmcaddon.Addon().getAddonInfo('path')
LIB_PATH = os.path.join(ADDON_PATH, 'lib')
if LIB_PATH not in sys.path:
    sys.path.insert(0, LIB_PATH)

import socketio

ADDON_ID = "plugin.kodi.ke-client"
STATUS_INTERVAL = 1
NOTIFICATION_BEFORE_END = 15

# Types d'actions Socket.io
PLAYER_CMD_NEXT = 'player/CMD_NEXT'
PLAYER_CMD_OPTIONS = 'player/CMD_OPTIONS'
PLAYER_CMD_PAUSE = 'player/CMD_PAUSE'
PLAYER_CMD_PLAY = 'player/CMD_PLAY'
PLAYER_CMD_REPLAY = 'player/CMD_REPLAY'
PLAYER_CMD_VOLUME = 'player/CMD_VOLUME'
QUEUE_PUSH = 'queue/PUSH'
PLAYER_EMIT_STATUS = 'server/PLAYER_EMIT_STATUS'
PLAYER_EMIT_LEAVE = 'server/PLAYER_EMIT_LEAVE'


def log(message, level=xbmc.LOGINFO):
    """Log un message avec le prefixe de l'addon."""
    xbmc.log(f"[{ADDON_ID}] {message}", level)


class KEPlayer(xbmc.Player):
    """Player Kodi personnalise pour detecter les evenements de lecture."""

    def __init__(self, service):
        super().__init__()
        self.service = service

    def onPlayBackStarted(self):
        log("Lecture demarree")
        self.service.on_playback_started()

    def onPlayBackEnded(self):
        log("Lecture terminee")
        self.service.on_playback_ended()

    def onPlayBackStopped(self):
        log("Lecture arretee")
        self.service.on_playback_stopped()

    def onPlayBackPaused(self):
        log("Lecture en pause")
        self.service.on_playback_paused()

    def onPlayBackResumed(self):
        log("Lecture reprise")
        self.service.on_playback_resumed()


class KEService(xbmc.Monitor):
    """Service principal qui gere la connexion Socket.io et le player."""

    def __init__(self):
        super().__init__()
        self.addon = xbmcaddon.Addon()
        self.window = None
        self.player = KEPlayer(self)
        self.sio = None
        self.connected = False
        self.room_id = None

        # Etat du player
        self.state = {
            'queueId': -1,
            'isPlaying': False,
            'position': 0,
            'isAtQueueEnd': False,
            'mediaType': None,
            'historyJSON': '[]',
            'volume': 1,
            'nextUserId': None,
        }

        # Queue des chansons
        self.queue = {'result': [], 'entities': {}}
        self.current_media_url = None

        # Tracking pour notification "Up Next"
        self.media_duration = 0
        self.notification_shown = False

        # Chemin de l'image d'attente telechargee
        self._idle_image_path = None
        self._avatar_cache = {}

        log("Service initialise")

    def _get_server_url(self):
        """Construit l'URL du serveur a partir des settings."""
        ip = self.addon.getSetting('server_ip')
        port = self.addon.getSetting('server_port')
        if not ip or not port:
            return None
        return f"http://{ip}:{port}"

    def _setup_socketio(self):
        """Configure le client Socket.io."""
        self.sio = socketio.Client(
            reconnection=True,
            reconnection_attempts=0,
            reconnection_delay=1,
            reconnection_delay_max=5,
            logger=False,
            engineio_logger=False
        )

        @self.sio.event
        def connect():
            log("Socket.io connecte!")
            self.connected = True
            self.room_id = 1
            self._emit_status()

        @self.sio.event
        def disconnect():
            log("Socket.io deconnecte")
            self.connected = False

        @self.sio.event
        def connect_error(data):
            log(f"Erreur de connexion Socket.io: {data}", xbmc.LOGWARNING)

        @self.sio.on('action')
        def on_action(data):
            """Traite les actions recues du serveur."""
            action_type = data.get('type', '')
            payload = data.get('payload', {})

            if action_type == PLAYER_CMD_PLAY:
                log("Commande PLAY recue")
                self._handle_play()
            elif action_type == PLAYER_CMD_PAUSE:
                log("Commande PAUSE recue")
                self._handle_pause()
            elif action_type == PLAYER_CMD_NEXT:
                log("Commande NEXT recue")
                self._handle_next()
            elif action_type == PLAYER_CMD_REPLAY:
                queue_id = payload.get('queueId')
                log(f"Commande REPLAY recue: queueId={queue_id}")
                self._handle_replay(queue_id)
            elif action_type == PLAYER_CMD_VOLUME:
                volume = payload
                log(f"Commande VOLUME recue: {volume}")
                self._handle_volume(volume)
            elif action_type == QUEUE_PUSH:
                log(f"Queue mise a jour: {len(payload.get('result', []))} elements")
                self.queue = payload
                self._update_overlay_info()

    def _emit_status(self):
        """Envoie l'etat actuel du player au serveur."""
        if not self.connected or not self.sio:
            return

        try:
            if self.player.isPlaying():
                try:
                    self.state['position'] = self.player.getTime()
                except:
                    pass

            status = {
                'queueId': self.state['queueId'],
                'isPlaying': self.state['isPlaying'],
                'position': self.state['position'],
                'isAtQueueEnd': self.state['isAtQueueEnd'],
                'mediaType': self.state['mediaType'],
                'historyJSON': self.state['historyJSON'],
                'volume': self.state['volume'],
                'nextUserId': self.state['nextUserId'],
                'isKodiAddon': True,
            }

            self.sio.emit('action', {
                'type': PLAYER_EMIT_STATUS,
                'payload': status
            })
        except Exception as e:
            log(f"Erreur envoi status: {e}", xbmc.LOGWARNING)

    def _get_next_queue_item(self):
        """Recupere le prochain element de la queue."""
        if not self.queue['result']:
            return None

        current_idx = -1
        if self.state['queueId'] != -1:
            try:
                current_idx = self.queue['result'].index(self.state['queueId'])
            except ValueError:
                pass

        next_idx = current_idx + 1
        if next_idx < len(self.queue['result']):
            queue_id = self.queue['result'][next_idx]
            return self.queue['entities'].get(str(queue_id))

        return None

    def _handle_play(self):
        """Gere la commande PLAY."""
        if self.player.isPlaying():
            self.player.pause()
            self.state['isPlaying'] = True
        else:
            self._load_next()

    def _handle_pause(self):
        """Gere la commande PAUSE."""
        if self.player.isPlaying():
            self.player.pause()
            self.state['isPlaying'] = False
            self._emit_status()

    def _handle_next(self):
        """Gere la commande NEXT."""
        self._load_next()

    def _handle_replay(self, queue_id):
        """Gere la commande REPLAY."""
        str_id = str(queue_id) if queue_id else None
        if str_id and str_id in self.queue['entities']:
            item = self.queue['entities'][str_id]
            self._play_item(item, queue_id)

    def _handle_volume(self, volume):
        """Gere la commande VOLUME."""
        self.state['volume'] = volume
        kodi_volume = int(volume * 100)
        xbmc.executebuiltin(f'SetVolume({kodi_volume})')

    def _load_next(self):
        """Charge et joue la prochaine chanson."""
        next_item = self._get_next_queue_item()

        if not next_item:
            log("Fin de la queue")
            self.state['isAtQueueEnd'] = True
            self.state['isPlaying'] = False
            self.state['queueId'] = -1
            self._show_waiting_screen()
            self._emit_status()
            return

        queue_id = next_item.get('queueId')
        self._play_item(next_item, queue_id)

    def _play_item(self, item, queue_id):
        """Joue un element de la queue."""
        server_url = self._get_server_url()
        if not server_url:
            log("Pas d'URL serveur configuree", xbmc.LOGERROR)
            return

        media_id = item.get('mediaId')
        media_type = item.get('mediaType', 'mp4')
        stream_url = f"{server_url}/api/kodi/stream/{media_id}"

        log(f"Lecture de: {stream_url} (queueId={queue_id})")

        try:
            self._hide_waiting_screen()

            self.state['queueId'] = queue_id
            self.state['mediaType'] = media_type
            self.state['isPlaying'] = True
            self.state['isAtQueueEnd'] = False
            self.state['position'] = 0

            next_item = self._get_next_queue_item()
            if next_item:
                self.state['nextUserId'] = next_item.get('userId')
            else:
                self.state['nextUserId'] = None

            self.player.play(stream_url)
            self._emit_status()

        except Exception as e:
            log(f"Erreur lecture: {e}", xbmc.LOGERROR)

    def on_playback_started(self):
        self.state['isPlaying'] = True
        self._hide_waiting_screen()
        try:
            self.media_duration = self.player.getTotalTime()
            self.notification_shown = False
            log(f"Duree du media: {self.media_duration:.1f}s")
        except:
            self.media_duration = 0
        self._emit_status()

    def on_playback_ended(self):
        log("Chanson terminee")
        self.state['isPlaying'] = False
        self.notification_shown = False
        self.media_duration = 0
        self._show_waiting_screen()
        self._emit_status()

    def on_playback_stopped(self):
        self.state['isPlaying'] = False
        self.notification_shown = False
        self.media_duration = 0
        self._show_waiting_screen()
        self._emit_status()

    def on_playback_paused(self):
        self.state['isPlaying'] = False
        self._emit_status()

    def on_playback_resumed(self):
        self.state['isPlaying'] = True
        self._emit_status()

    def _check_upnext_notification(self):
        """Verifie si on doit afficher la notification 'Up Next'."""
        if self.notification_shown or not self.state['isPlaying']:
            return
        if self.media_duration <= 0:
            return

        try:
            position = self.player.getTime()
            remaining = self.media_duration - position

            if remaining <= NOTIFICATION_BEFORE_END and remaining > 0:
                self.notification_shown = True
                next_item = self._get_next_queue_item()

                if next_item:
                    singer = next_item.get('userDisplayName', 'Inconnu')
                    title = next_item.get('title', '')
                    artist = next_item.get('artist', '')

                    heading = "A suivre"
                    message = f"{singer}: {title}"
                    if artist:
                        message += f" ({artist})"

                    xbmcgui.Dialog().notification(
                        heading,
                        message,
                        xbmcgui.NOTIFICATION_INFO,
                        5000
                    )
                    log(f"Notification Up Next: {singer} - {title}")
        except:
            pass

    def _download_idle_image(self):
        """Telecharge l'image d'attente depuis le serveur."""
        if self._idle_image_path:
            return self._idle_image_path

        try:
            server_url = self._get_server_url()
            if not server_url:
                return None

            local_path = xbmcvfs.translatePath("special://temp/ke_waiting_screen.png")
            idle_url = f"{server_url}/api/kodi/idle"

            log(f"Telechargement image idle: {idle_url}")
            response = urlopen(idle_url, timeout=10)
            if response.getcode() == 200:
                data = response.read()
                with xbmcvfs.File(local_path, 'wb') as f:
                    f.write(data)
                self._idle_image_path = local_path
                log(f"Image idle telechargee: {local_path}")
                return local_path
        except Exception as e:
            log(f"Erreur telechargement image idle: {e}", xbmc.LOGWARNING)
        return None

    def _download_avatar(self, user_id, server_url):
        """Telecharge l'avatar de l'utilisateur."""
        try:
            if user_id in self._avatar_cache:
                return self._avatar_cache[user_id]

            local_path = xbmcvfs.translatePath(f"special://temp/ke_avatar_{user_id}.png")
            avatar_url = f"{server_url}/api/user/{user_id}/image"

            response = urlopen(avatar_url, timeout=5)
            if response.getcode() == 200:
                data = response.read()
                with xbmcvfs.File(local_path, 'wb') as f:
                    f.write(data)
                self._avatar_cache[user_id] = local_path
                return local_path
        except:
            self._avatar_cache[user_id] = ''
        return ''

    def _show_waiting_screen(self):
        """Affiche l'ecran d'attente avec image fixe et infos."""
        if self.window is not None:
            return

        try:
            # Telecharger l'image idle si pas deja fait
            idle_image = self._download_idle_image()
            if not idle_image:
                log("Pas d'image idle disponible", xbmc.LOGWARNING)
                return

            # Creer un WindowDialog plein ecran
            self.window = xbmcgui.WindowDialog()

            # Image de fond (plein ecran 1280x720)
            self.bg_image = xbmcgui.ControlImage(
                0, 0, 1280, 720,
                idle_image,
                aspectRatio=2  # scale to fill
            )
            self.window.addControl(self.bg_image)

            # Bandeau semi-transparent en bas (noir 80% opacite)
            # On utilise white.png (image blanche) teintee en noir transparent
            white_img = os.path.join(ADDON_PATH, 'white.png')
            self.info_bg = xbmcgui.ControlImage(
                0, 580, 1280, 140,
                white_img,
                colorDiffuse='CC000000'  # noir 80% opaque (CC = 80% alpha)
            )
            self.window.addControl(self.info_bg)

            # Avatar (image ronde a gauche)
            self.avatar_img = xbmcgui.ControlImage(
                30, 595, 110, 110,
                '',
                aspectRatio=1  # keep aspect
            )
            self.window.addControl(self.avatar_img)

            # Label "A suivre" (petit texte au dessus)
            self.label_next = xbmcgui.ControlLabel(
                160, 590, 200, 25,
                'A suivre :',
                font='font10',
                textColor='FFAAAAAA'
            )
            self.window.addControl(self.label_next)

            # Nom du chanteur (MAJUSCULES - blanc)
            self.label_singer = xbmcgui.ControlLabel(
                160, 615, 700, 45,
                'EN ATTENTE...',
                font='font13',
                textColor='FFFFFFFF'
            )
            self.window.addControl(self.label_singer)

            # Titre + Artiste (violet)
            self.label_title = xbmcgui.ControlLabel(
                160, 660, 700, 40,
                '',
                font='font12',
                textColor='FF9150D3'
            )
            self.window.addControl(self.label_title)

            # Compteur (a droite)
            self.label_count = xbmcgui.ControlLabel(
                950, 600, 300, 60,
                '0',
                font='font14',
                textColor='FF9150D3',
                alignment=2  # right align
            )
            self.window.addControl(self.label_count)

            self.label_count_text = xbmcgui.ControlLabel(
                950, 665, 300, 35,
                'en attente',
                font='font10',
                textColor='FFE0E0E0',
                alignment=2
            )
            self.window.addControl(self.label_count_text)

            self.window.show()
            self._update_overlay_info()
            log("Ecran d'attente affiche")

        except Exception as e:
            log(f"Erreur affichage ecran: {e}", xbmc.LOGERROR)
            import traceback
            log(traceback.format_exc(), xbmc.LOGERROR)

    def _hide_waiting_screen(self):
        """Cache l'ecran d'attente."""
        if self.window is not None:
            try:
                self.window.close()
            except:
                pass
            self.window = None
            self.bg_image = None
            self.info_bg = None
            self.avatar_img = None
            self.label_next = None
            self.label_singer = None
            self.label_title = None
            self.label_count = None
            self.label_count_text = None

    def _update_overlay_info(self):
        """Met a jour les infos affichees sur l'overlay."""
        next_item = self._get_next_queue_item()

        next_singer = next_item.get('userDisplayName', '') if next_item else ''
        next_title = next_item.get('title', '') if next_item else ''
        next_artist = next_item.get('artist', '') if next_item else ''
        next_user_id = next_item.get('userId') if next_item else None

        # Formatage: Singer en MAJUSCULES
        singer_display = next_singer.upper() if next_singer else 'EN ATTENTE...'

        # Formatage: Titre (Title case) - ARTISTE (MAJUSCULES)
        title_line = ''
        if next_title and next_artist:
            title_line = f"{next_title.title()} - {next_artist.upper()}"
        elif next_title:
            title_line = next_title.title()
        elif next_artist:
            title_line = next_artist.upper()

        # Avatar
        server_url = self._get_server_url()
        avatar_path = ''
        if next_user_id and server_url:
            avatar_path = self._download_avatar(next_user_id, server_url)

        # Compteur
        current_idx = -1
        if self.state['queueId'] != -1:
            try:
                current_idx = self.queue['result'].index(self.state['queueId'])
            except ValueError:
                pass
        remaining = len(self.queue['result']) - current_idx - 1 if current_idx >= 0 else len(self.queue['result'])

        # Mettre a jour les labels si le window existe
        try:
            if self.label_singer:
                self.label_singer.setLabel(singer_display)
            if self.label_title:
                self.label_title.setLabel(title_line)
            if self.label_count:
                self.label_count.setLabel(str(remaining))
            if self.avatar_img and avatar_path:
                self.avatar_img.setImage(avatar_path)
        except:
            pass

    def _connect(self):
        """Tente de se connecter au serveur."""
        server_url = self._get_server_url()
        if not server_url:
            log("URL serveur non configuree", xbmc.LOGWARNING)
            return False

        room_id = self.addon.getSetting('room_id') or '1'

        try:
            log(f"Connexion a {server_url} (room {room_id})...")
            self._setup_socketio()
            self.sio.connect(
                server_url,
                transports=['websocket', 'polling'],
                wait_timeout=10,
                headers={},
                socketio_path='/socket.io',
                auth={'kodiAddon': 'true', 'roomId': room_id}
            )
            return True
        except Exception as e:
            log(f"Erreur connexion: {e}", xbmc.LOGWARNING)
            return False

    def run(self):
        """Boucle principale du service."""
        log("Demarrage du service")

        ip = self.addon.getSetting('server_ip')
        port = self.addon.getSetting('server_port')
        log(f"Configuration: serveur={ip}:{port}")

        # Afficher l'ecran d'attente au demarrage
        self._show_waiting_screen()

        # Tenter la connexion
        connection_attempts = 0
        while not self.abortRequested() and not self.connected:
            if self._connect():
                break
            connection_attempts += 1
            log(f"Tentative de connexion {connection_attempts}...")
            if self.waitForAbort(5):
                break

        # Boucle principale
        last_status_time = 0
        while not self.abortRequested():
            try:
                # Mettre a jour les infos de l'overlay
                self._update_overlay_info()

                # Verifier notification "Up Next"
                self._check_upnext_notification()

                # Envoyer le status periodiquement
                current_time = time.time()
                if self.connected and current_time - last_status_time >= STATUS_INTERVAL:
                    self._emit_status()
                    last_status_time = current_time

                # Verifier la connexion
                if not self.connected and self.sio:
                    log("Reconnexion...")
                    self._connect()

            except Exception as e:
                log(f"Erreur boucle principale: {e}", xbmc.LOGERROR)

            if self.waitForAbort(0.5):
                break

        # Nettoyage
        log("Arret du service")
        if self.sio and self.connected:
            try:
                self.sio.emit('action', {
                    'type': PLAYER_EMIT_LEAVE,
                    'payload': {}
                })
                self.sio.disconnect()
            except:
                pass

        self._hide_waiting_screen()
        log("Service arrete")


if __name__ == '__main__':
    KEService().run()
