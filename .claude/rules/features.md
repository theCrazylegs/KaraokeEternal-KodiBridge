# Karaoke Eternal – Fonctionnalités récentes & Roadmap

## Fonctionnalités récentes

### 🎤 **Co-chanteurs (coSingers)**

**Implémentation** :
- Champ `coSingers` (JSON array) dans table `queue`
- Bouton édition (icône **ACCOUNT**) dans swipe menu `QueueItem`
- Affichage : `"CHANTEUR + Co1, Co2"`
- **Support complet** addon Kodi (overlay + notifications)

**Flux** :

Frontend → QUEUE_UPDATE → DB → QUEUE_PUSH → Web App + Kodi


### 🖱️ **Drag & Drop Queue** (admin only)

**Implémentation** :
- Bibliothèque `@hello-pangea/dnd`
- **Seulement** items "upcoming" (pas current playing)
- Feedback visuel pendant drag
- **Admin uniquement**

**Flux** :

Drag → QUEUE_MOVE → DB (prevQueueId) → QUEUE_PUSH


### 📺 **Mode manuel Kodi**

Permet d'**annoncer** avant de jouer :
NEXT → écran attente → ATTEND PLAY → démarrer chanson


## TODO / Roadmap

### Priorité 1 ⏰
- [ ] **multilingue** UK/FR/..... fichier de config (priorisation queue)
- [ ] **Refactoriser le player WEB pour utiliser le même code que pour l'ADD-ON KODI** (karaoké natif)
- [ ] **Système de vote** chansons (priorisation queue)
- [ ] **Historique par utilisateur** (stats soirées)

### Priorité 2 ⚡
- [ ] **Mode tournoi** (élimination)
- [ ] **Export/Import playlists** (JSON)
- [ ] **Paroles synchronisées MP4** (karaoké natif)

### Priorité 3 🎮
- [ ] **Multi-rooms** simultanées

## Quand implémenter un TODO

Créer migration DB si besoin → server/lib/schemas/
Ajouter actions Socket.io → server/Queue/socket.ts
Frontend → nouvelle route/slice → src/routes/ + src/store/
Synchroniser addon Kodi si impact TV
Tester : Web App → KES → Kodi → retour état

⬆️ Déplacer item vers "Fonctionnalités réalisées"


## Fonctionnalités réalisées (template)

📅 2026-01-XX - [NOM FONCTION]
Résumé technique : ...
Migration : 007-xxx.sql
Nouvelles actions Socket.io : ...
Impact Kodi : Oui/Non
Tests validés : [x] Web [x] Kodi [x] Queue

**Pour toute nouvelle feature : suivre ce modèle EXACTEMENT.**
