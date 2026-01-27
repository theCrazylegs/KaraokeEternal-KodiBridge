# Karaoke Eternal – Architecture & Structure

## Vue d’ensemble

Karaoke Eternal est un système de karaoké open‑source complet comprenant :
- un serveur Node.js (KES – Karaoke Eternal Server) ;
- une application web React/Redux pour la bibliothèque, la file d’attente et le player ;
- un addon Kodi natif pour l’affichage sur TV.

Le but est de gérer une soirée karaoké de bout en bout : gestion du catalogue, choix des chansons, file d’attente, affichage des paroles et contrôle à distance du lecteur.

---

## Architecture globale

Le cœur du système est le serveur KES (Node.js/Koa) qui :
- expose une API HTTP et une application web ;
- gère la base SQLite (songs, artists, queue, users, rooms, médias…) ;
- communique en temps réel avec le frontend et l’addon Kodi via Socket.io.

Vue simplifiée des flux :

- **Web App (React)**  
  - Accède à la bibliothèque, à la queue et au player.  
  - Reçoit et envoie des événements temps réel via Socket.io (queue, player, statut).

- **KES Server (Node.js/Koa + Socket.io + SQLite)**  
  - Gère la logique métier (queue, rooms, users, prefs).  
  - Scanne les médias et alimente la base.  
  - Expose des endpoints spécifiques pour le bridge Kodi (streaming, idle screen).  

- **Clients de lecture**  
  - **Kodi Addon (Python)** : lecteur distant contrôlé par KES, affichage TV.  
  - **Web Player** : lecture CDG/MP4 dans le navigateur (WebGL + audio).

L’objectif est que le serveur reste la source de vérité (état de la queue, chansons, rooms), et que les clients (web/Kodi) ne soient que des vues ou contrôleurs distants.

---

## Structure des dossiers

À la racine du dépôt `KaraokeEternal/` :

```text
KaraokeEternal/
├── server/                  # Backend Node.js (KES)
├── src/                     # Frontend React
├── shared/                  # Code partagé client/serveur
├── plugin.kodi.ke-client/   # Addon Kodi natif
├── config/                  # Configs build (Webpack, TS)
└── docs/                    # Documentation (Hugo)
