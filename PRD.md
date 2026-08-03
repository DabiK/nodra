# PRD — DabiK/nodra

Backlog généré depuis les issues GitHub ouvertes. Chaque item est une tâche.
Coche la case quand la tâche est terminée. Une seule tâche par itération Ralph.

- [x] #20 — Séquences favorites (templates de pipeline) (labels: —)

  **Issue #20 — détail complet**
  > ## Contexte
  > Les pipelines se créent manuellement à chaque fois. Aucun moyen de ré-instancer une structure existante (nœuds, arcs, modes auto/humain, gates).
  >
  > ## Objectif
  > - Bouton "Enregistrer comme modèle" sur une pipeline (`PipelineCard.tsx` / `PipelinesPage.tsx`)
  > - Liste de modèles sauvegardés (persistance serveur ou localStorage — pattern existant)
  > - "Créer depuis un modèle" : ré-instancié avec de nouvelles missions (copie de la config agent par nœud, pas des missions existantes)
  > - Renommage/suppression de modèles
  >
  > ## Acceptance
  > - [x] Enregistrer une pipeline comme modèle en 1 clic
  > - [x] Créer une nouvelle pipeline depuis un modèle
  > - [x] Modèles listés dans l'écran Pipelines
  >
  > ## Méthode d'implémentation
  > - Cartographier le code avec des **subagents explore** avant d'implémenter (modèle pipeline existant)
  > - Implémenter avec des **subagents**
  > - **Committer le plus fréquemment possible** : commits atomiques (persistance → UI → instanciation)
  > - Vérifier : `npm run typecheck`, `npm run lint`, `npm test`

- [ ] #21 — Compatibilité Windows des nouvelles features (labels: —)

  **Issue #21 — détail complet**
  > ## Contexte
  > Le README documente un support Windows natif (PowerShell/cmd) pour les commandes dev (build, typecheck, lint, test, db:setup, CLI) et un runtime via WSL2. Les features livrées récemment (SSE, dark mode, Cmd+K, timeline pipeline, budget) et à venir doivent respecter ce contrat : **rien de POSIX-only dans le code livré**.
  >
  > ## Objectif — audit et correction
  > Vérifier et corriger chaque feature (récente et à venir) pour qu'elle tourne sur :
  > - **Windows natif** (PowerShell / cmd.exe) : scripts npm, CLI, API, worker, web
  > - **WSL2** : tout le reste
  >
  > Points de vigilance connus :
  > - Raccourcis clavier : la palette `Cmd+K` doit mapper aussi `Ctrl+K` sur Windows ; flèches/Escape identiques
  > - Chemins : `path.sep`, pas de slashs durs, `NODRA_*_BINARY` déjà honorés (`PATHEXT` géré)
  > - SSE : vérifier que le streaming passe derrière le proxy Vite et sur Windows (pas de dépendance Unix)
  > - Sous-processus lancés par les features (temporal:dispatch, provider, git) : vérifier la résolution des binaires sur Windows
  > - Le script de boucle Ralph et ses helpers sont des scripts bash — à documenter comme WSL2-only ou à fournir un équivalent PowerShell
  > - Tests : les 4 scripts `test:e2e:*` utilisent déjà `cross-env` ; tout nouvel ajout doit suivre le même pattern
  >
  > ## Acceptance
  > - [x] Audit des features livrées + nouvelles : aucune fonctionnalité cassée sur Windows natif / WSL2
  > - [x] `Ctrl+K` (et autres raccourcis) fonctionnels sur Windows
  > - [x] SSE OK sur Windows et WSL2
  > - [x] Boucle Ralph documentée WSL2-only (ou équivalent PowerShell)
  > - [ ] Vérifications `npm run typecheck` / `lint` / `test` sur Windows natives — nécessite une machine Windows réelle (revalidation macOS / WSL2 du 2026-08-03 : code, tests de contrat et stack réelle OK ; preuve Windows toujours requise)
  >
  > ## Méthode d'implémentation
  > - Cartographier le code avec des **subagents explore** avant d'implémenter (rechercher slashs durs, raccourcis, dépendances Unix)
  > - Implémenter avec des **subagents** (par feature, en parallèle)
  > - **Committer le plus fréquemment possible** : commits atomiques par feature corrigée
  > - Vérifier : `npm run typecheck`, `npm run lint`, `npm test`

- [x] #22 — Comparateur de missions / runs (labels: —)

  **Issue #22 — détail complet**
  > ## Contexte
  > Quand un run échoue ou se comporte différemment d'un autre, il n'existe aucun moyen de comparer deux exécutions côte à côte. L'historique par mission existe (cf. issue #6, `GET /api/missions/:id/runs`).
  >
  > ## Objectif
  > - Sélectionner 2 runs d'une même mission (ou 2 missions) et afficher une vue côte à côte
  > - Comparer : prompt, config agent (provider/modèle/effort), événements provider, durée, tokens/coût, résultat déclaré, état des gates
  > - Synchroniser le scroll entre les deux panneaux pour les événements
  >
  > ## Acceptance
  > - [x] Sélection de 2 runs depuis la fiche mission
  > - [x] Panneaux côte à côte avec scroll synchronisé
  > - [x] Diff visible sur les métriques (durée, coût, tokens)
  >
  > ## Méthode d'implémentation
  > - Cartographier le code avec des **subagents explore** avant d'implémenter
  > - Implémenter avec des **subagents**
  > - **Committer le plus fréquemment possible** : commits atomiques
  > - Vérifier : `npm run typecheck`, `npm run lint`, `npm test`

- [ ] #23 — Tags libres sur missions (labels: —)

  **Issue #23 — détail complet**
  > ## Contexte
  > Le board ne permet d'organiser les missions que par état/type/workspace et pipeline. Aucune étiquette utilisateur pour regrouper par thème (urgent, wip, client-x…).
  >
  > ## Objectif
  > - Tags libres (libellé + couleur) attachables aux missions
  > - Gestion des tags : créer, renommer, colorer, supprimer (UI dédiée)
  > - Filtres par tag dans le board + chips de filtre existants
  > - Persistance serveur (nouveau champ/table) ou localStorage — privilégier serveur pour la cohérence multi-écrans
  >
  > ## Acceptance
  > - [ ] Ajouter/retirer un tag sur une carte ou dans la fiche
  > - [ ] Créer/renommer/supprimer des tags
  > - [ ] Filtre par tag combinable avec les filtres existants
  >
  > ## Méthode d'implémentation
  > - Cartographier le code avec des **subagents explore** avant d'implémenter
  > - Implémenter avec des **subagents**
  > - **Committer le plus fréquemment possible** : commits atomiques (modèle → endpoints → UI)
  > - Vérifier : `npm run typecheck`, `npm run lint`, `npm test`

- [ ] #24 — Historique des conversations entre managers (labels: —)

  **Issue #24 — détail complet**
  > ## Contexte
  > Chaque manager a ses conversations (multithreads), mais rien n'agrège la vue : quel manager a dit quoi, quand, sur quelle mission. Retrouver une décision passée demande d'ouvrir chaque manager un par un.
  >
  > ## Objectif
  > - Vue chronologique cross-managers : tous les messages de tous les managers sur une même timeline
  > - Filtres : par manager, par mission, par mot-clé, par période
  > - Lien vers la conversation d'origine à chaque message
  >
  > ## Acceptance
  > - [ ] Timeline agrégée accessible depuis l'écran Managers
  > - [ ] Filtres manager/mission/recherche
  > - [ ] Navigation 1 clic vers la conversation source
  >
  > ## Méthode d'implémentation
  > - Cartographier le code avec des **subagents explore** avant d'implémenter (manager conversations, endpoints existants)
  > - Implémenter avec des **subagents**
  > - **Committer le plus fréquemment possible** : commits atomiques (endpoint agrégé → composant → filtres)
  > - Vérifier : `npm run typecheck`, `npm run lint`, `npm test`

- [ ] #26 — docs: imprécisions mineures dans progress.txt (itération 11, hub d'activité #13) (labels: —)

  **Issue #26 — détail complet**
  > Relevé pendant la review du commit bd4590e (docs itération 11 — #13).
  >
  > Imprécisions factuelles mineures dans la section Vérifications / Fait de progress.txt :
  >
  > 1. **« ActivityHub ... + 11 tests »** : le fichier `apps/web/src/components/ActivityHub.test.tsx` contient en réalité **12** blocs `it()` (renders nothing when closed, empty state, groups items, unread count + mark-all, hide mark-all, opens mission, opens pipeline, marks single read, marks all, close button + backdrop, formatActivityTime, unknown reason codes).
  >
  > 2. **« Web : 43 fichiers / 336 tests OK (315 → 336, +21) »** : le total (43 fichiers / 336 tests) est correct, mais la baseline « 315 » est une copie de l'itération précédente — l'itération 10 (0742f71) documentait déjà 319 tests après ses changements. Le delta réel est **319 → 336 (+17)** (12 + 2 + 3 tests ajoutés), pas +21.
  >
  > 3. **« health → binaire Codex non certifié »** : l'échec de `apps/api/health.test.ts` est lié au **runtime Temporal indisponible** (le test s'intitule « keeps SQLite readable and reports an unavailable Temporal runtime explicitly »), pas au binaire Codex — ce sont i6/i14 qui échouent sur Codex. L'itération 10 l'attribuait correctement (« health → Temporal »).
  >
  > Aucun impact fonctionnel : le contenu descriptif de la feature est exact (endpoints, fichiers, sémantique lu/résolu vérifiés dans le code). Simple correction de chiffres/références dans progress.txt.

- [ ] #27 — web: léger flash du BoardEmptyState au chargement initial (avant le 1er fetch missions) (labels: —)

  **Issue #27 — détail complet**
  > Point mineur repéré en revue de l'itération 12 (#14, états vides et onboarding).
  >
  > **Contexte** : dans `apps/web/src/App.tsx`, `missions` démarre à `[]` et le premier chargement (`loadMissionIntake`) est async. La condition `missions.length === 0` du `BoardEmptyState` est donc vraie au premier rendu : un utilisateur qui a déjà des missions voit l'état vide clignoter brièvement avant le rendu du board réel.
  >
  > **Constats** :
  > - Le `ProviderSessionsEmpty` gère correctement ce cas (affiché seulement après chargement : `loading ? … : mergedSessions.length === 0 ? …`), mais le board ne le fait pas.
  > - Impact limité (fetch local rapide), mais perceptible sur réseau lent ou gros volume.
  >
  > **Piste** : n'afficher le `BoardEmptyState` qu'une fois le premier chargement terminé (par ex. `missions === null` initial ou un flag `loaded`), en gardant le comportement actuel pour le premier lancement (vraiment 0 mission).
