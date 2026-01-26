"""
Karaoke Eternal Client for Kodi
Client Socket.io natif pour communiquer avec le serveur KE.

L'add-on se connecte au serveur KE via Socket.io et :
- Recoit les commandes (play, pause, next) depuis l'interface web
- Envoie l'etat de lecture (position, fin de chanson)
- Affiche un ecran d'attente quand rien ne joue
"""
import sys
import os
import threading
import time
import json

# IMPORTANT: Patch signal avant d'importer socketio
# Kodi execute l'addon dans un thread secondaire, pas le thread principal.
# socketio/engineio utilisent signal.signal() qui ne fonctionne que dans le main thread.
# On cree un wrapper qui ignore silencieusement les appels signal dans les threads secondaires.
import signal
_original_signal = signal.signal
def _patched_signal(signalnum, handler):
    try:
        return _original_signal(signalnum, handler)
    except ValueError:
        # "signal only works in main thread" - ignorer silencieusement
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
import json

ADDON_ID = "plugin.kodi.ke-client"
STATUS_INTERVAL = 1  # Envoyer le status toutes les secondes
NOTIFICATION_BEFORE_END = 15  # Notification 15s avant la fin

# Types d'actions Socket.io (meme que KE)
# Commandes recues du serveur (a traiter)
PLAYER_CMD_NEXT = 'player/CMD_NEXT'
PLAYER_CMD_OPTIONS = 'player/CMD_OPTIONS'
PLAYER_CMD_PAUSE = 'player/CMD_PAUSE'
PLAYER_CMD_PLAY = 'player/CMD_PLAY'
PLAYER_CMD_REPLAY = 'player/CMD_REPLAY'
PLAYER_CMD_VOLUME = 'player/CMD_VOLUME'
QUEUE_PUSH = 'queue/PUSH'

# Actions a envoyer AU serveur (EMIT)
PLAYER_EMIT_STATUS = 'server/PLAYER_EMIT_STATUS'  # Envoyer notre status
PLAYER_EMIT_LEAVE = 'server/PLAYER_EMIT_LEAVE'    # Signaler qu'on part

# Actions broadcast par le serveur (status/)
PLAYER_STATUS = 'status/PLAYER_STATUS'  # Status recu d'autres players
PLAYER_LEAVE = 'status/PLAYER_LEAVE'    # Un player a quitte


def log(message, level=xbmc.LOGINFO):
    """Log un message avec le prefixe de l'addon."""
    xbmc.log(f"[{ADDON_ID}] {message}", level)


class KEPlayer(xbmc.Player):
    """Player Kodi personnalise pour detecter les evenements de lecture."""

    def __init__(self, service):
        super().__init__()
        self.service = service

    def onPlayBackStarted(self):
        # Ne pas logger si c'est la video idle
        if not self.service.is_playing_idle_video:
            log("Lecture demarree")
        self.service.on_playback_started()

    def onPlayBackEnded(self):
        if not self.service.is_playing_idle_video:
            log("Lecture terminee")
        self.service.on_playback_ended()

    def onPlayBackStopped(self):
        if not self.service.is_playing_idle_video:
            log("Lecture arretee")
        self.service.on_playback_stopped()

    def onPlayBackPaused(self):
        if not self.service.is_playing_idle_video:
            log("Lecture en pause")
        self.service.on_playback_paused()

    def onPlayBackResumed(self):
        if not self.service.is_playing_idle_video:
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
        self.is_playing_idle_video = False
        self.idle_video_duration = 0
        self._idle_video_start_time = 0  # Timestamp pour grace period

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
            reconnection_attempts=0,  # Infinite
            reconnection_delay=1,
            reconnection_delay_max=5,
            logger=False,
            engineio_logger=False
        )

        @self.sio.event
        def connect():
            log("Socket.io connecte!")
            self.connected = True
            # Rejoindre la room (on utilise room 1 par defaut)
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
                self._update_window_properties()

    def _emit_status(self):
        """Envoie l'etat actuel du player au serveur."""
        if not self.connected or not self.sio:
            return

        try:
            # Recuperer la position actuelle si en lecture
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
                'isKodiAddon': True,  # Identifie ce player comme l'add-on
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
            # En JSON, les cles des objets sont des strings
            return self.queue['entities'].get(str(queue_id))

        return None

    def _get_media_url(self, queue_item):
        """Construit l'URL pour streamer le media."""
        if not queue_item:
            return None

        media_id = queue_item.get('mediaId')
        if not media_id:
            return None

        server_url = self._get_server_url()
        if not server_url:
            return None

        # Demander un token de streaming au serveur
        # Pour l'instant on utilise l'endpoint /api/kodi/stream
        return f"{server_url}/api/kodi/stream/{media_id}"

    def _handle_play(self):
        """Gere la commande PLAY."""
        if self.player.isPlaying():
            # Deja en lecture, reprendre si en pause
            self.player.pause()  # Toggle pause
            self.state['isPlaying'] = True
        else:
            # Charger la prochaine chanson
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
        # Convertir 0-1 en 0-100 pour Kodi
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

        # Construire l'URL de streaming
        # On doit demander un token au serveur via l'API
        stream_url = f"{server_url}/api/kodi/stream/{media_id}"

        log(f"Lecture de: {stream_url} (queueId={queue_id})")

        try:
            self._hide_waiting_screen()

            self.state['queueId'] = queue_id
            self.state['mediaType'] = media_type
            self.state['isPlaying'] = True
            self.state['isAtQueueEnd'] = False
            self.state['position'] = 0

            # Mettre a jour nextUserId
            next_item = self._get_next_queue_item()
            if next_item:
                self.state['nextUserId'] = next_item.get('userId')
            else:
                self.state['nextUserId'] = None

            # Jouer le fichier
            self.player.play(stream_url)
            self._emit_status()

        except Exception as e:
            log(f"Erreur lecture: {e}", xbmc.LOGERROR)

    # Callbacks du player
    def on_playback_started(self):
        # Ignorer si c'est la video idle
        if self.is_playing_idle_video:
            return

        self.state['isPlaying'] = True
        self._hide_waiting_screen()

        # Recuperer la duree du media
        try:
            self.media_duration = self.player.getTotalTime()
            self.notification_shown = False
            log(f"Duree du media: {self.media_duration:.1f}s")
        except:
            self.media_duration = 0

        self._emit_status()

    def on_playback_ended(self):
        # Ignorer si c'est la video idle (elle est en boucle)
        if self.is_playing_idle_video:
            return

        log("Chanson terminee")
        self.state['isPlaying'] = False
        self.notification_shown = False
        self.media_duration = 0

        # Mode manuel: afficher le waiting screen et attendre PLAY
        self._show_waiting_screen()
        self._emit_status()

    def on_playback_stopped(self):
        # Ignorer si c'est la video idle
        if self.is_playing_idle_video:
            return

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
        if self.is_playing_idle_video:
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

                    # Afficher la notification Kodi
                    heading = "A suivre"
                    message = f"{singer}: {title}"
                    if artist:
                        message += f" ({artist})"

                    xbmcgui.Dialog().notification(
                        heading,
                        message,
                        xbmcgui.NOTIFICATION_INFO,
                        5000  # 5 secondes
                    )
                    log(f"Notification Up Next: {singer} - {title}")
        except Exception as e:
            pass  # Ignorer les erreurs (player pas pret, etc.)

    def _update_window_properties(self):
        """Met a jour les proprietes pour l'affichage."""
        # Trouver le prochain element de la queue
        next_item = self._get_next_queue_item()

        # Infos du prochain chanteur
        next_singer = next_item.get('userDisplayName', '') if next_item else ''
        next_title = next_item.get('title', '') if next_item else ''
        next_artist = next_item.get('artist', '') if next_item else ''
        next_user_id = next_item.get('userId') if next_item else None

        # Avatar URL et initiale
        server_url = self._get_server_url()
        next_avatar_path = ''
        next_initial = ''
        if next_user_id and server_url:
            # Telecharger l'avatar et utiliser le chemin local
            next_avatar_path = self._download_avatar(next_user_id, server_url)
        if next_singer:
            next_initial = next_singer[0].upper()

        # Compter les chansons restantes
        current_idx = -1
        if self.state['queueId'] != -1:
            try:
                current_idx = self.queue['result'].index(self.state['queueId'])
            except ValueError:
                pass
        remaining = len(self.queue['result']) - current_idx - 1 if current_idx >= 0 else len(self.queue['result'])

        # Mettre a jour les proprietes Window(10000) pour compatibilite
        home_window = xbmcgui.Window(10000)
        home_window.setProperty('KE.NextSinger', next_singer or 'En attente...')
        home_window.setProperty('KE.NextTitle', next_title or '')
        home_window.setProperty('KE.NextArtist', next_artist or '')
        home_window.setProperty('KE.NextAvatarUrl', next_avatar_path)
        home_window.setProperty('KE.NextInitial', next_initial or '?')
        home_window.setProperty('KE.QueueCount', str(remaining))

        # Mettre a jour les controles overlay si ils existent
        try:
            if hasattr(self, 'overlay_singer') and self.overlay_singer:
                self.overlay_singer.setLabel(next_singer or 'En attente...')
            if hasattr(self, 'overlay_title') and self.overlay_title:
                self.overlay_title.setLabel(next_title or '')
            if hasattr(self, 'overlay_artist') and self.overlay_artist:
                self.overlay_artist.setLabel(next_artist or '')
            if hasattr(self, 'overlay_count') and self.overlay_count:
                self.overlay_count.setLabel(str(remaining))
            # Mettre a jour l'avatar
            if hasattr(self, 'overlay_avatar') and self.overlay_avatar and next_avatar_path:
                self.overlay_avatar.setImage(next_avatar_path)
        except Exception as e:
            pass  # Ignorer les erreurs si les controles n'existent plus

    def _download_avatar(self, user_id, server_url):
        """Telecharge l'avatar de l'utilisateur et retourne le chemin local."""
        try:
            # Chemin local pour l'avatar (dans le dossier temp de Kodi)
            local_path = xbmcvfs.translatePath(f"special://temp/ke_avatar_{user_id}.png")

            # Verifier si on a deja tente pour cet utilisateur (evite le spam)
            if hasattr(self, '_avatar_cache') and user_id in self._avatar_cache:
                cached = self._avatar_cache[user_id]
                if cached:  # Si on a un chemin en cache
                    return cached
                else:  # Si on a deja echoue pour cet utilisateur
                    return ''

            # Initialiser le cache si besoin
            if not hasattr(self, '_avatar_cache'):
                self._avatar_cache = {}

            avatar_url = f"{server_url}/api/user/{user_id}/image"
            log(f"Telechargement avatar: {avatar_url}")

            # Telecharger l'avatar
            response = urlopen(avatar_url, timeout=5)
            if response.getcode() == 200:
                data = response.read()
                # Ecrire le fichier
                with xbmcvfs.File(local_path, 'wb') as f:
                    f.write(data)
                self._avatar_cache[user_id] = local_path
                log(f"Avatar telecharge: {local_path}")
                return local_path
        except Exception as e:
            log(f"Avatar non disponible pour user {user_id} (403 = normal si pas de session)")
            # Marquer comme echoue pour ne pas reessayer
            if not hasattr(self, '_avatar_cache'):
                self._avatar_cache = {}
            self._avatar_cache[user_id] = ''
        return ''

    def _show_waiting_screen(self):
        """Affiche l'ecran d'attente avec video en boucle et infos."""
        if self.window is None:
            try:
                # Desactiver l'OSD pour eviter la barre de seek
                self._disable_osd()

                # 1. D'ABORD lancer la video idle
                self._play_idle_video()

                # 2. Attendre que la video demarre
                xbmc.sleep(500)

                # 3. Creer un WindowDialog (prend le focus, bloque l'OSD)
                self.window = xbmcgui.WindowDialog()
                self.window.show()

                # Creer les controles manuellement
                self._create_overlay_controls()

                log("Ecran d'attente affiche")

            except Exception as e:
                log(f"Erreur affichage ecran: {e}", xbmc.LOGERROR)
                import traceback
                log(traceback.format_exc(), xbmc.LOGERROR)

    def _create_overlay_controls(self):
        """Cree les controles de l'overlay manuellement."""
        try:
            # Utiliser une image 1x1 pixel pour le fond (special://skin semble vide sur certains skins)
            # On utilise l'image de l'addon comme fallback
            bg_image = os.path.join(ADDON_PATH, 'icon.png')

            # Fond semi-transparent en bas (on utilise l'icon avec teinte noire)
            self.overlay_bg = xbmcgui.ControlImage(
                30, 480, 1220, 210,
                bg_image,
                colorDiffuse='CC000000'
            )
            self.window.addControl(self.overlay_bg)

            # Avatar placeholder (carre violet)
            self.overlay_avatar_bg = xbmcgui.ControlImage(
                55, 505, 160, 160,
                bg_image,
                colorDiffuse='FF9150D3'
            )
            self.window.addControl(self.overlay_avatar_bg)

            # Avatar image (sera mis a jour dynamiquement)
            self.overlay_avatar = xbmcgui.ControlImage(
                55, 505, 160, 160,
                '',  # vide au depart
                aspectRatio=1  # keep aspect
            )
            self.window.addControl(self.overlay_avatar)

            # Label de test
            self.overlay_test = xbmcgui.ControlLabel(
                30, 650, 1220, 30,
                '*** KARAOKE ETERNAL ***',
                font='font13',
                textColor='FFFF0000',
                alignment=2  # center
            )
            self.window.addControl(self.overlay_test)

            # Nom du chanteur
            self.overlay_singer = xbmcgui.ControlLabel(
                240, 505, 650, 50,
                'Chargement...',
                font='font13',
                textColor='FFFFFFFF'
            )
            self.window.addControl(self.overlay_singer)

            # Titre
            self.overlay_title = xbmcgui.ControlLabel(
                240, 555, 650, 50,
                '',
                font='font12',
                textColor='FF9150D3'
            )
            self.window.addControl(self.overlay_title)

            # Artiste
            self.overlay_artist = xbmcgui.ControlLabel(
                240, 600, 650, 50,
                '',
                font='font10',
                textColor='FFAAAAAA'
            )
            self.window.addControl(self.overlay_artist)

            # Compteur
            self.overlay_count = xbmcgui.ControlLabel(
                950, 510, 280, 80,
                '0',
                font='font14',
                textColor='FF9150D3',
                alignment=2
            )
            self.window.addControl(self.overlay_count)

            self.overlay_count_label = xbmcgui.ControlLabel(
                950, 580, 280, 50,
                'en attente',
                font='font10',
                textColor='FFE0E0E0',
                alignment=2
            )
            self.window.addControl(self.overlay_count_label)

            log("Controles overlay crees")

        except Exception as e:
            log(f"Erreur creation controles: {e}", xbmc.LOGERROR)
            import traceback
            log(traceback.format_exc(), xbmc.LOGERROR)

    def _disable_osd(self):
        """Desactive l'OSD (barre de progression, seek, etc.)."""
        try:
            # Fermer tous les dialogs OSD de force
            xbmc.executebuiltin('Dialog.Close(all,true)')
            xbmc.executebuiltin('Dialog.Close(seekbar)')
            xbmc.executebuiltin('Dialog.Close(osdvideosettings)')
            xbmc.executebuiltin('Dialog.Close(playerprocessinfo)')
            xbmc.executebuiltin('Dialog.Close(fullscreeninfo)')
            xbmc.executebuiltin('Dialog.Close(videoosd)')

            # Desactiver l'affichage des infos de lecture
            self._json_rpc("Settings.SetSettingValue", {
                "setting": "videoplayer.showosd",
                "value": False
            })
            # Desactiver aussi la seek bar
            self._json_rpc("Settings.SetSettingValue", {
                "setting": "videoplayer.showseekbar",
                "value": False
            })
            log("OSD desactive")
        except Exception as e:
            log(f"Erreur desactivation OSD: {e}", xbmc.LOGWARNING)

    def _enable_osd(self):
        """Reactive l'OSD."""
        try:
            self._json_rpc("Settings.SetSettingValue", {
                "setting": "videoplayer.showosd",
                "value": True
            })
            self._json_rpc("Settings.SetSettingValue", {
                "setting": "videoplayer.showseekbar",
                "value": True
            })
            log("OSD reactive")
        except Exception as e:
            log(f"Erreur reactivation OSD: {e}", xbmc.LOGWARNING)

    def _hide_waiting_screen(self):
        """Cache l'ecran d'attente et arrete la video idle."""
        # Reactiver l'OSD pour la lecture normale
        self._enable_osd()

        # Supprimer les controles overlay
        self._remove_overlay_controls()

        if self.window is not None:
            try:
                self.window.close()
            except:
                pass
            self.window = None
        self._stop_idle_video()

    def _remove_overlay_controls(self):
        """Supprime les controles overlay."""
        controls_to_remove = [
            'overlay_bg', 'overlay_avatar_bg', 'overlay_avatar', 'overlay_test',
            'overlay_singer', 'overlay_title', 'overlay_artist',
            'overlay_count', 'overlay_count_label'
        ]
        for ctrl_name in controls_to_remove:
            if hasattr(self, ctrl_name):
                try:
                    ctrl = getattr(self, ctrl_name)
                    if ctrl and self.window:
                        self.window.removeControl(ctrl)
                except:
                    pass
                setattr(self, ctrl_name, None)

    def _stop_idle_video(self):
        """Arrete la video idle."""
        if self.is_playing_idle_video:
            try:
                self.player.stop()
            except:
                pass
            self.is_playing_idle_video = False

    def _play_idle_video(self):
        """Joue la video idle sans OSD et prépare la boucle."""
        try:
            server_url = self._get_server_url()
            if not server_url: return

            idle_url = f"{server_url}/api/kodi/idle"
            log(f"Lecture video idle: {idle_url}")

            self.is_playing_idle_video = True
            self._idle_video_start_time = time.time()  # Enregistrer le timestamp de demarrage

            # On prépare l'item
            list_item = xbmcgui.ListItem("Waiting...")

            # On lance la lecture
            self.player.play(idle_url, list_item)

            # --- ASTUCE : On cache l'OSD immédiatement ---
            xbmc.executebuiltin('Dialog.Close(all, true)')
            xbmc.executebuiltin('SetProperty(HideOSE,true,home)') # Pour certains skins

        except Exception as e:
            log(f"Erreur lecture video idle: {e}", xbmc.LOGWARNING)

    def _check_idle_video_loop(self):
        """Gere le loop silencieux de la video idle via seek."""
        if not self.is_playing_idle_video:
            return

        # Toujours fermer l'OSD pendant la video idle (evite les interactions user)
        xbmc.executebuiltin('Dialog.Close(seekbar)')
        xbmc.executebuiltin('Dialog.Close(osdvideosettings)')
        xbmc.executebuiltin('Dialog.Close(playerprocessinfo)')
        xbmc.executebuiltin('Dialog.Close(fullscreeninfo)')
        xbmc.executebuiltin('Dialog.Close(videoosd)')
        xbmc.executebuiltin('Dialog.Close(12901)')  # ID de l'OSD video
        xbmc.executebuiltin('Dialog.Close(142)')    # ID de l'OSD player

        # Grace period: laisser 5 secondes pour que la video demarre
        elapsed_since_start = time.time() - self._idle_video_start_time
        if elapsed_since_start < 5.0:
            # Pendant la grace period, ne pas relancer meme si isPlaying() est False
            return

        # Si le player s'est arrete tout seul (apres la grace period), on le relance
        if not self.player.isPlaying():
            log("Video idle arretee, relance...")
            self._play_idle_video()
            return

        try:
            curr_time = self.player.getTime()
            total_time = self.player.getTotalTime()

            # Loop silencieux a 1s de la fin
            if total_time > 0 and (total_time - curr_time) < 1.0:
                # Seek au debut
                self.player.seekTime(0)

                # Recréer le WindowDialog pour le remettre au premier plan
                xbmc.sleep(200)
                if self.window:
                    # Supprimer les anciens controles
                    self._remove_overlay_controls()
                    try:
                        self.window.close()
                    except:
                        pass

                    # Recreer le window
                    self.window = xbmcgui.WindowDialog()
                    self.window.show()
                    self._create_overlay_controls()

                    # Forcer la fermeture de l'OSD
                    xbmc.executebuiltin('Dialog.Close(all,true)')
        except:
            pass

    def _json_rpc(self, method, params=None):
        payload = {"jsonrpc": "2.0", "method": method, "params": params or {}, "id": 1}
        return xbmc.executeJSONRPC(json.dumps(payload))

    def _connect(self):
        """Tente de se connecter au serveur."""
        server_url = self._get_server_url()
        if not server_url:
            log("URL serveur non configuree", xbmc.LOGWARNING)
            return False

        # Recuperer le roomId depuis les settings (defaut: 1)
        room_id = self.addon.getSetting('room_id')
        if not room_id:
            room_id = '1'

        try:
            log(f"Connexion a {server_url} (room {room_id})...")
            self._setup_socketio()
            # Envoyer kodiAddon=true pour s'authentifier comme addon Kodi
            self.sio.connect(
                server_url,
                transports=['websocket', 'polling'],
                wait_timeout=10,
                headers={},
                socketio_path='/socket.io',
                # Query parameters pour l'authentification addon
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
                # Mettre a jour les proprietes
                self._update_window_properties()

                # Gerer la boucle de la video idle (seek au lieu de reload)
                self._check_idle_video_loop()

                # Verifier si on doit afficher la notification "Up Next"
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

            # Si on est en idle, on check plus souvent (0.1s) sinon 0.5s
            sleep_time = 0.1 if self.is_playing_idle_video else 0.5
            if self.waitForAbort(sleep_time):
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
