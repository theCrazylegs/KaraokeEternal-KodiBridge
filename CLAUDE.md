# Karaoke Eternal – Instructions pour Claude

## Vue d’ensemble du projet

Karaoke Eternal est un système de karaoké complet composé :
- d’un serveur Node.js (KES) basé sur Koa, Socket.io, SQLite et TypeScript ;
- d’une application web React/Redux pour la bibliothèque, la queue et le player ;
- d’un addon Kodi natif (Python) pour l’affichage sur TV.

Le dépôt `KaraokeEternal/` contient tout le cœur applicatif (serveur, frontend, addon Kodi, docs). Le dépôt `Karaoke-catalogue/` à côté contient uniquement le catalogue brut de fichiers MP4.

## Structure principale des dossiers

- `server/` : backend Node.js (Koa, Socket.io, SQLite, workers, scanner de médias, logique queue, rooms, auth, préférences, bridge Kodi).
- `src/` : frontend React (routes Library/Queue/Player, composants, store Redux, styles).
- `shared/` : code partagé client/serveur (types TypeScript, actions Redux, logique player).
- `plugin.kodi.ke-client/` : addon Kodi (service Python, socket.io client, affichage TV).
- `config/` : configuration de build (Webpack, TypeScript).
- `docs/` : documentation Hugo.

Dès que tu proposes des modifications, garde cette séparation claire entre backend, frontend, code partagé et addon.

## Stack technique et conventions

### Backend

- Node.js ≥ 24, TypeScript, Koa pour HTTP, Socket.io pour le temps réel, SQLite pour la base.
- Migrations SQL dans `server/lib/schemas/` (schéma initial, ReplayGain, queue en liste chaînée, rooms, rôles, co-chanteurs).
- La queue est modélisée en liste chaînée (champ `prevQueueId`), avec gestion des co-chanteurs (`coSingers`).

### Frontend

- React 18 avec hooks, Redux Toolkit pour le state, `react-swipeable` pour les gestes tactiles, `@hello-pangea/dnd` pour le drag & drop de la queue.
- WebGL pour le rendu CDG et Butterchurn pour le visualiseur audio.
- CSS via fichiers `.css` (type CSS Modules, naming camelCase pour les classes).

### Addon Kodi

- Python 3 avec `python-socketio` et APIs Kodi (`xbmcgui`).
- Connexion native Socket.io au serveur KES, réception de commandes (play/pause/next/replay) et remontée de l’état de lecture.
- Écran d’attente dédié (idle screen) avec image fournie par le serveur, overlay d’infos sur le prochain chanteur et la queue.

## Scripts de développement

Utiliser les scripts NPM définis dans `package.json` :

- `npm run dev` : développement avec hot reload.
- `npm run build` : build production.
- `npm run serve` : lancer le serveur.
- `npm run lint` : linting (ESLint).
- `npm run test` : tests (Vitest).
- `npm run typecheck` : vérification TypeScript.

Quand tu proposes de nouvelles commandes ou modifs de scripts, aligne-les avec cette convention et garde les noms explicites.

## Conventions de code

- Commits au format `type(scope): description` (`feat`, `fix`, `chore`, `style`, `refactor`).
- Interfaces et types partagés dans `shared/types.ts`, types d’actions dans `shared/actionTypes.ts`.
- TypeScript en mode strict, privilégier des types explicites pour les nouvelles fonctions.
- CSS : classes en camelCase, structure cohérente avec les composants React associés.

## Comportement attendu de Claude

Quand tu ajoutes ou modifies du code dans ce projet :

- Respecte la séparation des responsabilités (backend vs frontend vs shared vs addon).
- Propose des changements cohérents avec la stack existante (pas de nouveau framework ou lib majeure sans justification).
- T’appuie sur :
  - la structure décrite ci‑dessus,
  - les fichiers de règles détaillés (dans `.claude/rules/` si présents),
  - les conventions de commit, de typage et de CSS mentionnées ici.
- Lorsque tu touches à la queue, au player ou à l’intégration Kodi, vérifie la cohérence globale : base SQLite, événements Socket.io, affichage web et comportement de l’addon.
