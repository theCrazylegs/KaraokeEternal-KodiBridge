# Karaoke Eternal – Backend (Server Node.js)

## Stack backend

- **Node.js** ≥ 24 avec ES Modules
- **Koa** : framework HTTP
- **Socket.io** : communication temps réel
- **SQLite** : base de données
- **TypeScript** : langage principal

Point d'entrée : `server/main.ts`

## Organisation du dossier `server/`

server/
├── main.ts # Point d'entrée serveur
├── socket.ts # Gestion Socket.io
├── serverWorker.ts # Worker principal
├── scannerWorker.ts # Scanner de médias
├── lib/
│ └── schemas/ # Migrations SQLite
├── Library/ # Gestion bibliothèque
├── Media/ # Streaming médias
├── Player/ # Logique player web
├── PlayerKodiBridge/ # Bridge vers Kodi
│ ├── KodiBridge.ts # Logique principale
│ ├── KodiAPI.ts # API JSON-RPC Kodi
│ ├── ADBHelper.ts # Auto-launch via ADB
│ └── router.ts # Endpoints HTTP
├── Queue/ # Gestion file d'attente
│ ├── Queue.ts # Logique queue
│ └── socket.ts # Handlers Socket.io
├── Rooms/ # Gestion des rooms
├── User/ # Authentification
└── Prefs/ # Préférences

## Scripts NPM (racine du projet)

npm run dev      # Développement avec hot reload
npm run build    # Build production
npm run serve    # Lancer le serveur
npm run lint     # ESLint
npm run test     # Tests Vitest
npm run typecheck # Vérification TypeScript

## Conventions TypeScript (backend)
Interfaces partagées : shared/types.ts

Actions Redux : shared/actionTypes.ts

Mode strict activé partout

Toujours typer les fonctions, paramètres et retours

## Logs serveur
Le serveur affiche les logs dans la console. Préfixes à utiliser :

[KodiBridge] : événements du bridge Kodi

[Queue] : opérations sur la queue

[Socket] : connexions Socket.io

Nouveaux logs : utiliser ces préfixes ou en créer de cohérents (ex: [Library], [Scanner]).

## Règles pour les modifications backend
Nouveau code métier → sous-dossier dédié dans server/ (ex: Playlists/)

Nouvelle migration DB → server/lib/schemas/00X-nom.sql

Nouveaux handlers Socket.io → server/Queue/socket.ts ou dossier concerné

Workers → modèle serverWorker.ts ou scannerWorker.ts

Middleware Koa → server/main.ts ou fichier dédié dans server/

Garder la séparation claire entre logique métier, persistance, communication temps réel et workers.