# Karaoke Eternal – Base de données & Socket.io

## Base de données (SQLite)

### Migrations (`server/lib/schemas/`)

Les migrations sont numérotées et appliquées séquentiellement :

1. `001-initial-schema.sql` : tables de base (`users`, `rooms`, `songs`, `artists`, `media`)
2. `002-replaygain.sql` : support ReplayGain pour normalisation audio
3. `003-queue-linked-list.sql` : queue en **liste chaînée** (`prevQueueId`)
4. `004-paths-rooms-data.sql` : chemins de fichiers et données rooms
5. `005-roles.sql` : système de rôles utilisateurs
6. `006-queue-cosingers.sql` : support co-chanteurs (`coSingers` JSON array)

**Nouvelle migration** → `server/lib/schemas/00X-nom-descriptif.sql`

### Tables principales

| Table | Contenu | Notes |
|-------|---------|-------|
| `users` | Utilisateurs | login, rôles, avatar |
| `rooms` | Salles de karaoké | ID unique, config, participants |
| `songs` | Chansons | titre, artisteId, durée, mediaId |
| `artists` | Artistes | nom, image |
| `queue` | **File d'attente** | `prevQueueId` pour liste chaînée, `coSingers` JSON |
| `stars` | Favoris utilisateurs | userId, songId |
| `media` | Fichiers médias | chemin, type (MP4/CDG), métadonnées |

**⚠️ La queue utilise une liste chaînée via `prevQueueId`. Toute suppression/modif doit préserver l'intégrité.**

## Socket.io – Actions principales

### Queue (dans `server/Queue/socket.ts`)

| Action | Direction | Description |
|--------|-----------|-------------|
| `QUEUE_ADD` | Client → Serveur | Ajouter une chanson |
| `QUEUE_REMOVE` | Client → Serveur | Retirer une chanson |
| `QUEUE_MOVE` | Client → Serveur | Déplacer une chanson |
| `QUEUE_UPDATE` | Client → Serveur | Modifier (co-chanteurs) |
| `QUEUE_PUSH` | Serveur → Clients | **Sync état complet** de la queue |

### Player (web + Kodi)

| Action | Direction | Description |
|--------|-----------|-------------|
| `PLAYER_CMD_PLAY` | Client → Serveur | Démarrer lecture |
| `PLAYER_CMD_PAUSE` | Client → Serveur | Pause |
| `PLAYER_CMD_NEXT` | Client → Serveur | Chanson suivante |
| `PLAYER_CMD_REPLAY` | Client → Serveur | Rejouer |
| `PLAYER_EMIT_STATUS` | Serveur → Clients | État actuel du player |

## Règles critiques pour cohérence

### Modifications queue
1. **Mettre à jour** `prevQueueId` des éléments adjacents
2. **Émettre** `QUEUE_PUSH` après toute modification
3. **Vérifier** l'intégrité de la liste chaînée après delete/move

### Synchronisation player ↔ queue

PLAYER_CMD_NEXT → avancer queue → émettre QUEUE_PUSH → commander Kodi


### Co-chanteurs
- Stockés en JSON array dans `queue.coSingers`
- Format affichage : `"CHANTEUR + Co1, Co2"`
- Synchronisés via `QUEUE_UPDATE` et `QUEUE_PUSH`

**Toute modification queue/player doit préserver cette chaîne : DB → Socket.io → Web App → Kodi Addon.**
