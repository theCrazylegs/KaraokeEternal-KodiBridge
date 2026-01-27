# Karaoke Eternal – KodiBridge (Contrôle Kodi)

## Objectif

KodiBridge contrôle Kodi comme lecteur karaoké distant via **API JSON-RPC**.
Implémenté dans `server/PlayerKodiBridge/`.

## Fichiers principaux

| Fichier | Rôle |
|---------|------|
| `KodiBridge.ts` | **Logique principale** : queue, polling état, gestion |
| `KodiAPI.ts` | Communication **JSON-RPC** avec Kodi |
| `router.ts` | **Endpoints HTTP** : streaming, idle screen |
| `ADBHelper.ts` | **Auto-lancement** Kodi via ADB |
| `KodiBridgePrefs.tsx` | Interface config (admin) |

## Modes de streaming

### 1. HTTP Streaming (recommandé)

KES streame les fichiers **via HTTP** vers Kodi :

*URL : http://server:port/api/kodi/stream/{mediaId}
Token : UUID temporaire (10 min)

### 2. Direct File Access (SMB/NFS)

Kodi lit **directement** depuis partage réseau :

pathFrom : "/serveur/media/song.mp4" → pathTo : "/kodi/media/song.mp4"


## Configuration TypeScript

interface KodiBridgeConfig {
  host: string;           // IP Kodi
  port: number;           // Port JSON-RPC (8080)
  username?: string;      // Auth Kodi (optionnel)
  password?: string;
  roomId: number;         // Room KES associée
  streamMode: 'http' | 'file';
  serverUrl?: string;     // URL serveur (HTTP)
  pathFrom?: string;      // Chemin local (file)
  pathTo?: string;        // Chemin Kodi (file)
  adb?: {
    enabled: boolean;
    host?: string;
    port: number;
    kodiPackage: string;
  };
  idleScreen?: {
    enabled: boolean;
    mediaUrl?: string;
  };
}

## Flux de fonctionnement

1. Config KodiBridge (IP, port, roomId, streamMode)
2. Polling périodique état Kodi via JSON-RPC
3. Queue KES → commande Kodi (play/next/pause)
4. Kodi → remontée état (position, fin chanson)
5. Serveur → sync web app + addon via Socket.io


## Endpoints HTTP (router.ts)

GET /api/kodi/stream/{mediaId}    → streaming fichier (tokenisé)
GET /api/kodi/idle                → image écran d'attente
GET /api/kodi/logo/{token}        → logo artiste
POST /api/kodi/config             → config bridge

⚠️ Ordre critique des routes : routes spécifiques AVANT /:token

## Règles de développement
Préserve les 2 modes streaming (HTTP + file)

Garde la config rétrocompatible

Vérifie polling JSON-RPC avant/after modifs

Teste avec vrai Kodi (pas simulateur)

Logs : préfixe [KodiBridge]

Toute modif bridge = test complet : Web App → KES → Kodi → retour état.