"""
Karaoke Eternal Client for Kodi
Native Socket.io client to communicate with the KE server.

The addon connects to the KE server via Socket.io and:
- Receives commands (play, pause, next) from the web interface
- Sends playback state (position, end of song)
- Displays a waiting screen (static image) when nothing is playing
"""
import sys
import os
import time
import json

# IMPORTANT: Patch signal before importing socketio
# Kodi runs the addon in a secondary thread, not the main thread.
# socketio/engineio use signal.signal() which only works in the main thread.
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
    from urllib.request import Request, urlopen
    from urllib.parse import quote
except ImportError:
    from urllib2 import Request, urlopen
    from urllib import quote

# Add lib/ folder to path for imports
ADDON_PATH = xbmcaddon.Addon().getAddonInfo('path')
LIB_PATH = os.path.join(ADDON_PATH, 'lib')
if LIB_PATH not in sys.path:
    sys.path.insert(0, LIB_PATH)

import socketio

ADDON_ID = "plugin.kodi.ke-client"
STATUS_INTERVAL = 1
NOTIFICATION_BEFORE_END = 15

# Localized string IDs
STR_UP_NEXT = 32000
STR_UP_NEXT_COLON = 32001
STR_WAITING = 32002
STR_WAITING_LOWER = 32003
STR_WAITING_FOR_SINGER = 32004
STR_UNKNOWN = 32005

# Socket.io action types
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
    """Log a message with the addon prefix."""
    xbmc.log(f"[{ADDON_ID}] {message}", level)


class KEPlayer(xbmc.Player):
    """Custom Kodi player to detect playback events."""

    def __init__(self, service):
        super().__init__()
        self.service = service

    def onPlayBackStarted(self):
        log("Playback started")
        self.service.on_playback_started()

    def onPlayBackEnded(self):
        log("Playback ended")
        self.service.on_playback_ended()

    def onPlayBackStopped(self):
        log("Playback stopped")
        self.service.on_playback_stopped()

    def onPlayBackPaused(self):
        log("Playback paused")
        self.service.on_playback_paused()

    def onPlayBackResumed(self):
        log("Playback resumed")
        self.service.on_playback_resumed()


class KEService(xbmc.Monitor):
    """Main service that manages the Socket.io connection and player."""

    def __init__(self):
        super().__init__()
        self.addon = xbmcaddon.Addon()
        self.window = None
        self.player = KEPlayer(self)
        self.sio = None
        self.connected = False
        self.room_id = None

        # Player state
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

        # Song queue
        self.queue = {'result': [], 'entities': {}}
        self.current_media_url = None

        # Tracking for "Up Next" notification
        self.media_duration = 0
        self.notification_shown = False

        # Path to downloaded idle image
        self._idle_image_path = None
        self._avatar_cache = {}

        # Pending item (after NEXT, before PLAY)
        self.pending_item = None

        # JWT token for authentication
        self.token = None

        log("Service initialized")

    def _get_server_url(self):
        """Build the server URL from settings."""
        ip = self.addon.getSetting('server_ip')
        port = self.addon.getSetting('server_port')
        if not ip or not port:
            return None
        return f"http://{ip}:{port}"

    def _get_token(self):
        """Get a JWT token from the server for authentication."""
        server_url = self._get_server_url()
        if not server_url:
            return None

        room_id = int(self.addon.getSetting('room_id') or '1')

        try:
            url = f"{server_url}/api/kodi/token"
            data = json.dumps({'roomId': room_id}).encode('utf-8')
            req = Request(url, data=data, headers={'Content-Type': 'application/json'})
            response = urlopen(req, timeout=10)

            if response.getcode() == 200:
                result = json.loads(response.read().decode('utf-8'))
                self.token = result.get('token')
                log(f"JWT token obtained (expires in {result.get('expiresIn', 0)}s)")
                return self.token
        except Exception as e:
            log(f"Error getting token: {e}", xbmc.LOGERROR)

        return None

    def _setup_socketio(self):
        """Configure the Socket.io client."""
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
            log("Socket.io connected!")
            self.connected = True
            self.room_id = 1
            self._emit_status()

        @self.sio.event
        def disconnect():
            log("Socket.io disconnected")
            self.connected = False

        @self.sio.event
        def connect_error(data):
            log(f"Socket.io connection error: {data}", xbmc.LOGWARNING)

        @self.sio.on('action')
        def on_action(data):
            """Handle actions received from the server."""
            action_type = data.get('type', '')
            payload = data.get('payload', {})

            if action_type == PLAYER_CMD_PLAY:
                log("PLAY command received")
                self._handle_play()
            elif action_type == PLAYER_CMD_PAUSE:
                log("PAUSE command received")
                self._handle_pause()
            elif action_type == PLAYER_CMD_NEXT:
                log("NEXT command received")
                self._handle_next()
            elif action_type == PLAYER_CMD_REPLAY:
                queue_id = payload.get('queueId')
                log(f"REPLAY command received: queueId={queue_id}")
                self._handle_replay(queue_id)
            elif action_type == PLAYER_CMD_VOLUME:
                volume = payload
                log(f"VOLUME command received: {volume}")
                self._handle_volume(volume)
            elif action_type == QUEUE_PUSH:
                log(f"Queue updated: {len(payload.get('result', []))} items")
                self.queue = payload
                self._update_overlay_info()

    def _emit_status(self):
        """Send the current player state to the server."""
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
            log(f"Error sending status: {e}", xbmc.LOGWARNING)

    def _get_next_queue_item(self):
        """Get the next item in the queue."""
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
        """Handle the PLAY command."""
        # If an item is pending (after NEXT), play it
        if self.pending_item:
            log(f"Playing pending item: queueId={self.pending_item.get('queueId')}")
            item = self.pending_item
            self.pending_item = None
            self._play_item(item, item.get('queueId'))
        elif self.player.isPlaying():
            # If already playing, this is a resume (toggle pause)
            self.player.pause()
            self.state['isPlaying'] = True
        else:
            # Otherwise, load the next item
            self._load_next()

    def _handle_pause(self):
        """Handle the PAUSE command."""
        if self.player.isPlaying():
            self.player.pause()
            self.state['isPlaying'] = False
            self._emit_status()

    def _handle_next(self):
        """Handle the NEXT command - skip to next item and show waiting screen."""
        # Stop current playback
        if self.player.isPlaying():
            self.player.stop()

        # Get the next item
        next_item = self._get_next_queue_item()

        if not next_item:
            # End of queue
            log("NEXT: End of queue")
            self.state['isAtQueueEnd'] = True
            self.state['isPlaying'] = False
            self.pending_item = None
            self._show_waiting_screen()
            self._emit_status()
            return

        # Store the pending item (will be played on next PLAY)
        self.pending_item = next_item
        log(f"NEXT: Pending item - {next_item.get('userDisplayName')} - {next_item.get('title')}")

        # Advance queueId so the overlay shows the right info
        # But don't play yet - wait for PLAY
        self.state['queueId'] = next_item.get('queueId')
        self.state['isPlaying'] = False
        self.state['isAtQueueEnd'] = False
        self.state['position'] = 0

        # Show waiting screen with next item info
        self._show_waiting_screen()
        self._emit_status()

    def _handle_replay(self, queue_id):
        """Handle the REPLAY command."""
        str_id = str(queue_id) if queue_id else None
        if str_id and str_id in self.queue['entities']:
            item = self.queue['entities'][str_id]
            self._play_item(item, queue_id)

    def _handle_volume(self, volume):
        """Handle the VOLUME command."""
        self.state['volume'] = volume
        kodi_volume = int(volume * 100)
        xbmc.executebuiltin(f'SetVolume({kodi_volume})')

    def _load_next(self):
        """Load and play the next song."""
        next_item = self._get_next_queue_item()

        if not next_item:
            log("End of queue")
            self.state['isAtQueueEnd'] = True
            self.state['isPlaying'] = False
            self.state['queueId'] = -1
            self._show_waiting_screen()
            self._emit_status()
            return

        queue_id = next_item.get('queueId')
        self._play_item(next_item, queue_id)

    def _play_item(self, item, queue_id):
        """Play a queue item."""
        server_url = self._get_server_url()
        if not server_url:
            log("Server URL not configured", xbmc.LOGERROR)
            return

        if not self.token:
            log("No JWT token for streaming", xbmc.LOGERROR)
            return

        media_id = item.get('mediaId')
        media_type = item.get('mediaType', 'mp4')

        # Build URL with authentication header
        # Kodi supports: url|Header=Value (no URL encoding)
        base_url = f"{server_url}/api/kodi/stream/{media_id}"
        stream_url = f"{base_url}|Authorization=Bearer {self.token}"

        log(f"Playing: {base_url} (queueId={queue_id})")

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
            log(f"Playback error: {e}", xbmc.LOGERROR)

    def on_playback_started(self):
        self.state['isPlaying'] = True
        self._hide_waiting_screen()
        self.notification_shown = False  # Reset outside try block
        self.media_duration = 0

        # Wait a bit for Kodi to analyze the media
        xbmc.sleep(500)

        try:
            self.media_duration = self.player.getTotalTime()
            log(f"Media duration: {self.media_duration:.1f}s")
        except Exception as e:
            log(f"Error getting total time: {e}", xbmc.LOGWARNING)
            self.media_duration = 0

        self._emit_status()

    def on_playback_ended(self):
        log("Song ended")
        self.state['isPlaying'] = False
        self.notification_shown = False
        self.media_duration = 0
        self.pending_item = None  # Reset - will be recalculated on next PLAY
        self._show_waiting_screen()
        self._emit_status()

    def on_playback_stopped(self):
        self.state['isPlaying'] = False
        self.notification_shown = False
        self.media_duration = 0
        # Don't reset pending_item here because on_playback_stopped is called by _handle_next
        # after player.stop() - we want to keep the pending_item
        self._show_waiting_screen()
        self._emit_status()

    def on_playback_paused(self):
        self.state['isPlaying'] = False
        self._emit_status()

    def on_playback_resumed(self):
        self.state['isPlaying'] = True
        self._emit_status()

    def _check_upnext_notification(self):
        """Check if we should display the 'Up Next' notification."""
        if self.notification_shown:
            return
        if not self.state['isPlaying']:
            return
        if self.media_duration <= 0:
            # Try to get duration if not yet available
            try:
                if self.player.isPlaying():
                    self.media_duration = self.player.getTotalTime()
                    if self.media_duration > 0:
                        log(f"Duration retrieved late: {self.media_duration:.1f}s")
            except:
                pass
            if self.media_duration <= 0:
                return

        try:
            position = self.player.getTime()
            remaining = self.media_duration - position

            if remaining <= NOTIFICATION_BEFORE_END and remaining > 0:
                self.notification_shown = True
                next_item = self._get_next_queue_item()

                if next_item:
                    singer = next_item.get('userDisplayName', self.addon.getLocalizedString(STR_UNKNOWN))
                    title = next_item.get('title', '')
                    artist = next_item.get('artist', '')
                    co_singers = next_item.get('coSingers', [])

                    # Add co-singers to the singer name
                    singer_display = singer
                    if co_singers and len(co_singers) > 0:
                        singer_display += ' + ' + ', '.join(co_singers)

                    heading = self.addon.getLocalizedString(STR_UP_NEXT)
                    message = f"{singer_display}: {title}"
                    if artist:
                        message += f" ({artist})"

                    log(f"Showing Up Next notification: {remaining:.1f}s remaining")
                    xbmcgui.Dialog().notification(
                        heading,
                        message,
                        xbmcgui.NOTIFICATION_INFO,
                        5000
                    )
                    log(f"Up Next notification: {singer_display} - {title}")
                else:
                    log("No next item for Up Next notification")
        except Exception as e:
            log(f"Error checking notification: {e}", xbmc.LOGWARNING)

    def _get_idle_image(self):
        """Return the path to the idle image included in the addon."""
        if self._idle_image_path:
            return self._idle_image_path

        # Use waiting_screen.png included in the addon
        addon_path = xbmcvfs.translatePath(xbmcaddon.Addon().getAddonInfo('path'))
        self._idle_image_path = os.path.join(addon_path, 'waiting_screen.png')
        log(f"Idle image: {self._idle_image_path}")
        return self._idle_image_path

    def _download_avatar(self, user_id, server_url):
        """Download the user avatar via the Kodi API with auth."""
        try:
            if user_id in self._avatar_cache:
                return self._avatar_cache[user_id]

            local_path = xbmcvfs.translatePath(f"special://temp/ke_avatar_{user_id}.png")
            avatar_url = f"{server_url}/api/kodi/avatar/{user_id}"

            req = Request(avatar_url)
            if self.token:
                req.add_header('Authorization', f'Bearer {self.token}')

            response = urlopen(req, timeout=5)
            if response.getcode() == 200:
                data = response.read()
                with xbmcvfs.File(local_path, 'wb') as f:
                    f.write(data)
                self._avatar_cache[user_id] = local_path
                return local_path
        except Exception as e:
            log(f"Error downloading avatar {user_id}: {e}", xbmc.LOGWARNING)
            self._avatar_cache[user_id] = ''
        return ''

    def _show_waiting_screen(self):
        """Display the waiting screen with static image and info."""
        if self.window is not None:
            return

        try:
            # Get idle image
            idle_image = self._get_idle_image()
            if not idle_image:
                log("No idle image available", xbmc.LOGWARNING)
                return

            # Create a fullscreen WindowDialog
            self.window = xbmcgui.WindowDialog()

            # Background image (fullscreen 1280x720)
            self.bg_image = xbmcgui.ControlImage(
                0, 0, 1280, 720,
                idle_image,
                aspectRatio=2  # scale to fill
            )
            self.window.addControl(self.bg_image)

            # Semi-transparent banner at bottom (black 80% opacity)
            # Use white.png (white image) tinted to transparent black
            white_img = os.path.join(ADDON_PATH, 'white.png')
            self.info_bg = xbmcgui.ControlImage(
                0, 580, 1280, 140,
                white_img,
                colorDiffuse='80000000'  # black 50% opaque (more transparent)
            )
            self.window.addControl(self.info_bg)

            # Avatar (round image on the left)
            self.avatar_img = xbmcgui.ControlImage(
                30, 595, 110, 110,
                '',
                aspectRatio=1  # keep aspect
            )
            self.window.addControl(self.avatar_img)

            # "Up next" label (small text above)
            self.label_next = xbmcgui.ControlLabel(
                160, 590, 200, 25,
                self.addon.getLocalizedString(STR_UP_NEXT_COLON),
                font='font12',
                textColor='FFAAAAAA'
            )
            self.window.addControl(self.label_next)

            # Singer name (UPPERCASE - white)
            self.label_singer = xbmcgui.ControlLabel(
                160, 615, 700, 45,
                self.addon.getLocalizedString(STR_WAITING),
                font='font14',
                textColor='FFFFFFFF'
            )
            self.window.addControl(self.label_singer)

            # Title + Artist (purple #FD80D8)
            self.label_title = xbmcgui.ControlLabel(
                160, 660, 700, 40,
                '',
                font='font14',
                textColor='FFFD80D8'  # #FD80D8 with 100% alpha
            )
            self.window.addControl(self.label_title)

            # Counter (right side, purple #FD80D8)
            self.label_count = xbmcgui.ControlLabel(
                950, 600, 300, 60,
                '0',
                font='font14',
                textColor='FFFD80D8',  # #FD80D8 with 100% alpha
                alignment=2  # right align
            )
            self.window.addControl(self.label_count)

            self.label_count_text = xbmcgui.ControlLabel(
                950, 665, 300, 35,
                self.addon.getLocalizedString(STR_WAITING_LOWER),
                font='font14',
                textColor='FFE0E0E0',
                alignment=2
            )
            self.window.addControl(self.label_count_text)

            # Centered label for "WAITING FOR A SINGER" (empty queue)
            self.label_empty = xbmcgui.ControlLabel(
                0, 630, 1280, 50,
                '',
                font='font14',
                textColor='FFFFFFFF',
                alignment=6  # center align (2=right, 4=center horizontal, 6=center)
            )
            self.window.addControl(self.label_empty)

            self.window.show()
            self._update_overlay_info()
            log("Waiting screen displayed")

        except Exception as e:
            log(f"Error displaying screen: {e}", xbmc.LOGERROR)
            import traceback
            log(traceback.format_exc(), xbmc.LOGERROR)

    def _hide_waiting_screen(self):
        """Hide the waiting screen."""
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
            self.label_empty = None

    def _update_overlay_info(self):
        """Update the info displayed on the overlay."""
        # If an item is pending (after NEXT), show ITS info
        # Otherwise, show the next item in the queue
        if self.pending_item:
            display_item = self.pending_item
        else:
            display_item = self._get_next_queue_item()

        # Check if queue is empty (no item to display)
        queue_is_empty = display_item is None

        if queue_is_empty:
            # "Waiting for a singer" mode - no songs in queue
            singer_display = self.addon.getLocalizedString(STR_WAITING_FOR_SINGER)
            title_line = ''
            avatar_path = ''
            next_user_id = None
        else:
            next_singer = display_item.get('userDisplayName', '')
            next_title = display_item.get('title', '')
            next_artist = display_item.get('artist', '')
            next_user_id = display_item.get('userId')
            co_singers = display_item.get('coSingers', [])

            # Format: Singer in UPPERCASE + co-singers
            if next_singer:
                singer_display = next_singer.upper()
                if co_singers and len(co_singers) > 0:
                    # Add co-singers: "ALICE + Bob, Charlie"
                    singer_display += ' + ' + ', '.join(co_singers)
            else:
                singer_display = self.addon.getLocalizedString(STR_WAITING_FOR_SINGER)

            # Format: Title (Title case) - ARTIST (UPPERCASE)
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

        # Counter
        current_idx = -1
        if self.state['queueId'] != -1:
            try:
                current_idx = self.queue['result'].index(self.state['queueId'])
            except ValueError:
                pass
        remaining = len(self.queue['result']) - current_idx - 1 if current_idx >= 0 else len(self.queue['result'])

        # Update labels if the window exists
        try:
            if queue_is_empty:
                # Empty queue mode: show centered message, hide the rest
                if self.label_empty:
                    self.label_empty.setLabel(self.addon.getLocalizedString(STR_WAITING_FOR_SINGER))
                if self.label_next:
                    self.label_next.setLabel('')
                if self.label_singer:
                    self.label_singer.setLabel('')
                if self.label_title:
                    self.label_title.setLabel('')
                if self.label_count:
                    self.label_count.setLabel('')
                if self.label_count_text:
                    self.label_count_text.setLabel('')
                if self.avatar_img:
                    self.avatar_img.setImage('')
            else:
                # Normal mode: show next singer info
                if self.label_empty:
                    self.label_empty.setLabel('')
                if self.label_next:
                    self.label_next.setLabel(self.addon.getLocalizedString(STR_UP_NEXT_COLON))
                if self.label_singer:
                    self.label_singer.setLabel(singer_display)
                if self.label_title:
                    self.label_title.setLabel(title_line)
                if self.label_count:
                    self.label_count.setLabel(str(remaining))
                if self.label_count_text:
                    self.label_count_text.setLabel(self.addon.getLocalizedString(STR_WAITING_LOWER) if remaining > 0 else '')
                if self.avatar_img:
                    self.avatar_img.setImage(avatar_path if avatar_path else '')
        except:
            pass

    def _connect(self):
        """Attempt to connect to the server."""
        server_url = self._get_server_url()
        if not server_url:
            log("Server URL not configured", xbmc.LOGWARNING)
            return False

        room_id = self.addon.getSetting('room_id') or '1'

        # Get a JWT token first
        if not self.token:
            if not self._get_token():
                log("Unable to get JWT token", xbmc.LOGERROR)
                return False

        try:
            log(f"Connecting to {server_url} (room {room_id}) with JWT token...")
            self._setup_socketio()
            self.sio.connect(
                server_url,
                transports=['websocket', 'polling'],
                wait_timeout=10,
                headers={},
                socketio_path='/socket.io',
                auth={'token': self.token}
            )
            return True
        except Exception as e:
            log(f"Connection error: {e}", xbmc.LOGWARNING)
            # Reset token on error to retry
            self.token = None
            return False

    def run(self):
        """Main service loop."""
        log("Service starting")

        ip = self.addon.getSetting('server_ip')
        port = self.addon.getSetting('server_port')
        log(f"Configuration: server={ip}:{port}")

        # Show waiting screen at startup
        self._show_waiting_screen()

        # Attempt connection
        connection_attempts = 0
        while not self.abortRequested() and not self.connected:
            if self._connect():
                break
            connection_attempts += 1
            log(f"Connection attempt {connection_attempts}...")
            if self.waitForAbort(5):
                break

        # Main loop
        last_status_time = 0
        while not self.abortRequested():
            try:
                # Update overlay info
                self._update_overlay_info()

                # Check "Up Next" notification
                self._check_upnext_notification()

                # Send status periodically
                current_time = time.time()
                if self.connected and current_time - last_status_time >= STATUS_INTERVAL:
                    self._emit_status()
                    last_status_time = current_time

                # Check connection
                if not self.connected and self.sio:
                    log("Reconnecting...")
                    self._connect()

            except Exception as e:
                log(f"Main loop error: {e}", xbmc.LOGERROR)

            if self.waitForAbort(0.5):
                break

        # Cleanup
        log("Service stopping")
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
        log("Service stopped")


if __name__ == '__main__':
    KEService().run()
