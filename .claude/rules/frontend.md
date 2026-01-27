# Karaoke Eternal – Frontend (React)

## Stack frontend

- **React 18** avec hooks uniquement
- **Redux Toolkit** : state management
- **react-swipeable** : gestes tactiles
- **@hello-pangea/dnd** : drag & drop queue
- **WebGL** : rendu CDG (cdgraphics)
- **Butterchurn** : visualiseur audio

Point d'entrée : `src/main.tsx`

## Organisation du dossier `src/`

src/
├── main.tsx # Point d'entrée client
├── components/ # Composants réutilisables
├── routes/ # Pages/vues principales
│ ├── Library/ # Bibliothèque de chansons
│ ├── Queue/ # File d'attente
│ └── Player/ # Lecteur karaoké
├── store/ # Redux store
│ └── modules/ # Slices Redux
└── styles/ # CSS global


## Conventions React

- **Hooks uniquement** : pas de class components pour du nouveau code
- **Redux Toolkit** : utiliser `createSlice`, `createAsyncThunk`
- **Types partagés** : `shared/types.ts` et `shared/actionTypes.ts`
- **Gestes tactiles** : `react-swipeable` pour mobile/tablette
- **Drag & drop** : `@hello-pangea/dnd` (admin only sur queue)

## CSS / Styles

- **CSS Modules** : fichiers `.css` avec classes `camelCase`
- **Structure** : un fichier CSS par composant/page ou `styles/` pour global
- **Nommage** : `queueItem`, `playerControls`, `libraryCard`

Exemple : QueueItem.tsx → QueueItem.css
Composants réutilisables → components/NomComposant/NomComposant.css


## Pages principales et leur rôle

| Page | Fonctionnalités | Slice Redux associé |
|------|-----------------|-------------------|
| `routes/Library/` | Recherche, filtres, favoris (`stars`) | `librarySlice` |
| `routes/Queue/` | Ajout/suppression, drag & drop (admin), co-chanteurs | `queueSlice` |
| `routes/Player/` | Player web (CDG/MP4), contrôles, visualiseur | `playerSlice` |

## Règles pour les nouvelles fonctionnalités frontend

1. **Nouvelle page** → `routes/NouveauNom/`
2. **Nouveau composant** → `components/NomComposant/` (avec CSS dédié)
3. **Nouveau slice Redux** → `store/modules/nouveauSlice.ts`
4. **Logique player partagée** → `shared/PlayerLogic.ts`
5. **Types/actions** → `shared/types.ts` et `shared/actionTypes.ts`

## Communication avec le backend

Le frontend communique exclusivement via **Socket.io** pour :
- État queue (`QUEUE_*`)
- Contrôles player (`PLAYER_CMD_*`)
- Synchronisation en temps réel

**Ne pas** créer d'appels HTTP directs pour les données temps réel.
