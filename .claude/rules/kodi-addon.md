# Karaoke Eternal – Addon Kodi (plugin.kodi.ke-client)

## Fonctionnalités principales

L'addon Kodi natif (`plugin.kodi.ke-client/`) :

- **Connexion Socket.io** native au serveur KES
- **Réception commandes** : play, pause, next, replay
- **Remontée état** : position lecture, fin de chanson
- **Écran d'attente** avec overlay informations
- **Notifications** "À suivre" 15s avant fin
- **Support co-chanteurs** complet

## Structure de l'addon

plugin.kodi.ke-client/
├── service.py # Service principal (logique Socket.io)
├── addon.xml # Manifest addon Kodi
└── lib/ # Dépendances (python-socketio, xbmcgui)


## Écran d'attente (idle screen)

**Image de fond** : téléchargée depuis `/api/kodi/idle`

**Bandeau overlay semi-transparent** affiche :

AVATAR du prochain chanteur
NOM EN MAJUSCULES + Co1, Co2
TITRE - ARTISTE
X chansons en attente


**Queue vide** → "EN ATTENTE D'UN CHANTEUR" centré

## Configuration (settings.xml)

server_ip : IP du serveur KES
server_port : Port serveur (défaut: 3000)
room_id : ID room (défaut: 1)


## Installation Kodi

1. Zipper plugin.kodi.ke-client/
2. Kodi → Paramètres → Extensions → Installer ZIP
3. Configurer IP/port/room dans paramètres addon


## Communication avec KES

L'addon reçoit **exactement** les mêmes événements Socket.io que la web app :

QUEUE_PUSH → mise à jour écran attente
PLAYER_CMD_* → commandes lecteur
PLAYER_EMIT_STATUS → sync état


**L'addon ne stocke RIEN localement** : il est un client "dumb" qui suit les instructions du serveur.

## Synchronisation co-chanteurs

DB → KES → QUEUE_PUSH → Addon Kodi
Format : "CHANTEUR + Co1, Co2"


## Règles de développement addon

1. **Socket.io identique** web app (mêmes events, même ordre)
2. **Pas de stockage local** (tout vient du serveur)
3. **Écran attente = priorité 1** (toujours fonctionnel)
4. **Notifications 15s** = calcul via `getTotalTime()` Kodi
5. **Tests = Kodi réel** (émulateur = faux positifs)

**Toute modif serveur (Socket.io, queue, player) = synchro immédiate addon.**
