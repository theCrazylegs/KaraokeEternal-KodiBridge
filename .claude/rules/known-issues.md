# Karaoke Eternal – Problèmes connus & Solutions

## Problèmes critiques résolus

| Problème | Cause | Solution |
|----------|-------|----------|
| **Route `/api/kodi/logo` → 404** | Route `/:token` capturait **toutes** les routes | **Déplacer** routes spécifiques **AVANT** `/:token` dans `router.ts` |
| **Boucle infinie fin queue** | `loadNext()` appelé sans fin | Check `isAtQueueEnd && isIdleScreenShowing` **avant** appel |
| **Notification 15s manquante** | `getTotalTime()` Kodi retourne 0 | **Retry tardif** `getTotalTime()` + délai 500ms |
| **Queue corrompue après delete** | Liste chaînée `prevQueueId` cassée | **Null checks** dans boucle `while` de reconstruction |
| **Image PNG invisible** | `Player.Open` Kodi gère mal PNG | Image **PNG statique** + overlay texte au lieu de vidéo PNG |

## Vérifications avant commit

**KodiBridge (router.ts)** :

// ✅ BON ORDRE
router.get('/api/kodi/logo/:token', handler)
router.get('/api/kodi/idle', handler)
router.get('/:token', catchAll)  // TOUJOURS EN DERNIER

Queue (linked list) :

// ✅ AVANT suppression
if (!prevQueueId) return;  // tête de liste
while (current && current.id !== toDelete) {
  if (!current.prevQueueId) break;  // null check
  current = getById(current.prevQueueId);
}


## Points de vigilance permanente

1. Ordre des routes Koa
❌ MAUVAIS : catchAll en premier
✅ BON : spécifiques → catchAll

2. Polling Kodi
Avant loadNext() → VÉRIFIER :
- queue vide ?
- idle screen actif ?
- Kodi prêt (Player.Open réussi) ?

3. Migration queue
    Suppression → TOUJOURS :
    1. Mettre à jour prevQueueId voisins
    2. Émettre QUEUE_PUSH
    3. Vérifier intégrité liste chaînée
Tests manuels obligatoires

[ ] Queue : add → delete → move → coSingers
[ ] Kodi : play → next → pause → replay → idle screen
[ ] Routes : /api/kodi/logo/{token} → 200 OK
[ ] Notification 15s → overlay "À suivre"
[ ] Drag & drop queue → cohérence DB/Socket.io
⚠️ Toute modif dans ces zones = ces tests MANUELS AVANT push.