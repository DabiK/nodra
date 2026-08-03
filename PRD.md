# PRD — DabiK/nodra

Backlog généré depuis les issues GitHub ouvertes. Chaque item est une tâche.
Coche la case quand la tâche est terminée. Une seule tâche par itération Ralph.

- [x] #7 — Mini-cartes de run actif sur le board (labels: —)

  **Issue #7 — détail complet**
  > ## Contexte
  > Les runs actifs (ACTIVE) ne montrent rien en live sur le board `MissionRelay.tsx` : il faut ouvrir le chat pour voir l'avancement.
  >
  > ## Objectif
  > - Sur les cartes des missions en run actif : indicateur "réfléchit…" (`.thinking-dots` existe) + dernier événement/message assistant en live
  > - Sans ouvrir le chat : feed pollé (ou SSE si issue #2 livrée) sur les événements provider du run
  >
  > ## Acceptance
  > - [ ] Les cartes des runs actifs montrent l'activité en cours
  > - [ ] Le dernier message/début de message est visible
  > - [ ] Aucun impact perf notable du polling additionnel
  >
  > ## Méthode d'implémentation
  > - Cartographier le code avec des **subagents explore** avant d'implémenter
  > - Implémenter avec des **subagents**
  > - **Committer le plus fréquemment possible** : commits atomiques
  > - Vérifier : `npm run typecheck`, `npm run lint`, `npm test`

- [x] #8 — Export de mission en Markdown (labels: —)

  **Issue #8 — détail complet**
  > ## Contexte
  > Les missions accumulent contexte, résultat déclaré, preuves et notes (persistées via `mission-notes-service.ts`). Rien ne permet de les partager/archiver.
  >
  > ## Objectif
  > - Bouton "Exporter" dans `MissionInspector.tsx` : copie dans le presse-papier (et/ou téléchargement) d'un Markdown structuré
  > - Contenu : titre, statut, dates, config agent, prompt, résultat, preuves (liens), notes, timeline d'audit (cf. issue timeline)
  > - Prévisualisation avant export
  >
  > ## Acceptance
  > - [ ] Export en un clic depuis la fiche mission
  > - [ ] Markdown GFM propre et lisible dans GitHub/VS Code
  > - [ ] Copie presse-papier + téléchargement `.md`
  >
  > ## Méthode d'implémentation
  > - Cartographier le code avec des **subagents explore** avant d'implémenter
  > - Implémenter avec des **subagents**
  > - **Committer le plus fréquemment possible** : commits atomiques
  > - Vérifier : `npm run typecheck`, `npm run lint`, `npm test`

- [x] #9 — Recherche dans les conversations (labels: —)

  **Issue #9 — détail complet**
  > ## Contexte
  > Les fils de conversation agent/manager (`ProviderMissionConversationPage.tsx`, `ManagerChat.tsx`) peuvent être très longs. Aucune recherche dans l'historique.
  >
  > ## Objectif
  > - Champ de recherche dans chaque chat : surligne les correspondances dans le fil, navigation précédent/suivant
  > - Recherche possiblement côté client sur les messages déjà chargés, puis côté serveur si besoin (`agent-session` / `conversation` endpoints existent)
  > - Support : texte, résultats de tool calls, événements
  >
  > ## Acceptance
  > - [ ] Recherche + surlignage dans le fil
  > - [ ] Navigation entre occurrences
  > - [ ] Indication du nombre de résultats
  >
  > ## Méthode d'implémentation
  > - Cartographier le code avec des **subagents explore** avant d'implémenter
  > - Implémenter avec des **subagents**
  > - **Committer le plus fréquemment possible** : commits atomiques
  > - Vérifier : `npm run typecheck`, `npm run lint`, `npm test`

- [x] #10 — Warning perte de contexte (compact / truncate) (labels: —)

  **Issue #10 — détail complet**
  > ## Contexte
  > Les conversations longues dégradent la qualité des réponses agents. Le domaine sépare conversation et sessions provider, mais aucune heuristique de détection n'existe dans l'UI.
  >
  > ## Objectif
  > - Détecter les conversations longues (nb de tours, taille approximative en tokens, taux de troncature des événements provider)
  > - Bannière dans le chat : "Conversation longue — risque de perte de contexte"
  > - Proposer une action : démarrer un nouveau fil, ou compact/truncate (à définir côté provider, peut être `steer` avec instruction de résumé)
  >
  > ## Acceptance
  > - [ ] Bannière déclenchée sur seuil
  > - [ ] Action claire proposée à l'utilisateur
  > - [ ] Métriques visibles (tokens estimés)
  >
  > ## Méthode d'implémentation
  > - Cartographier le code avec des **subagents explore** avant d'implémenter (notamment `extractConversationStats`)
  > - Implémenter avec des **subagents**
  > - **Committer le plus fréquemment possible** : commits atomiques (heuristique → bannière → action)
  > - Vérifier : `npm run typecheck`, `npm run lint`, `npm test`

- [x] #11 — Timeline d'audit sur la fiche mission (labels: —)

  **Issue #11 — détail complet**
  > ## Contexte
  > Chaque transition/commande est auditée en base (audit events persistés atomiquement avec le save d'agrégat, `CommandContext` = commandId/actor/occurredAt). Rien n'est affiché dans l'UI.
  >
  > ## Objectif
  > - Panneau "Historique" dans `MissionInspector.tsx` : timeline chronologique des événements
  > - Afficher : transitions d'état, gate evaluations, événements provider, décisions humaines (accept/deny), actor (user|manager)
  > - Endpoint serveur : `GET /api/missions/:id/audit` (probablement à créer dans `mission.controller.ts`)
  >
  > ## Acceptance
  > - [ ] Timeline visible sur la fiche mission
  > - [ ] Filtrage par type d'événement
  > - [ ] Actor et timestamp affichés
  >
  > ## Méthode d'implémentation
  > - Cartographier le code avec des **subagents explore** avant d'implémenter (audit events en base, repository existant)
  > - Implémenter avec des **subagents**
  > - **Committer le plus fréquemment possible** : commits atomiques (endpoint → composant → filtres)
  > - Vérifier : `npm run typecheck`, `npm run lint`, `npm test`

- [x] #12 — Diff Git avant validation (labels: —)

  **Issue #12 — détail complet**
  > ## Contexte
  > Les workspaces Git existent (snapshots, commits, intégration — `workspace.controller.ts`, `LocalWorkspaceAdapter`). La validation humaine (`delivery:accept`) n'a aucune vue des fichiers modifiés.
  >
  > ## Objectif
  > - Onglet "Fichiers modifiés / Diff" dans `MissionInspector.tsx`
  > - Comparer snapshot initial → état delivery : liste des fichiers changés, diff par fichier (textuel, `git diff`)
  > - Endpoint serveur : `GET /api/workspaces/:id/diff?base=&head=` (à créer côté adaptateur Git)
  >
  > ## Acceptance
  > - [ ] Liste des fichiers modifiés visible avant acceptation
  > - [ ] Diff par fichier consultable
  > - [ ] Indication des fichiers ajoutés/supprimés/modifiés
  >
  > ## Méthode d'implémentation
  > - Cartographier le code avec des **subagents explore** avant d'implémenter (snapshots, adapter Git)
  > - Implémenter avec des **subagents**
  > - **Committer le plus fréquemment possible** : commits atomiques (endpoint diff → composant → intégration fiche mission)
  > - Vérifier : `npm run typecheck`, `npm run lint`, `npm test`

- [x] #13 — Notifications et hub d'activité (labels: —)

  **Issue #13 — détail complet**
  > ## Contexte
  > Rien ne signale les missions qui ont besoin d'attention (VALIDATION, BLOCKED, delivery à accepter, approbation pipeline, confirmation). L'utilisateur doit scruter le board.
  >
  > ## Objectif
  > - Badge de compteur dans la sidebar : missions en attente de décision humaine
  > - Hub de notifications (liste des items en attente, cliquables → ouvrent la fiche mission)
  > - Sources : missions en VALIDATION/BLOCKED, deliveries pending, approvals pending, transitions de pipeline à approuver
  > - (Option) notification système (Notification API)
  >
  > ## Acceptance
  > - [ ] Badge visible et à jour (même mécanique de polling que le board)
  > - [ ] Hub listant les items avec navigation
  > - [ ] Marquage lu / fermeture
  >
  > ## Méthode d'implémentation
  > - Cartographier le code avec des **subagents explore** avant d'implémenter (states et endpoints existants)
  > - Implémenter avec des **subagents**
  > - **Committer le plus fréquemment possible** : commits atomiques (agrégation → badge → hub)
  > - Vérifier : `npm run typecheck`, `npm run lint`, `npm test`

- [x] #14 — États vides et onboarding (labels: —)

  **Issue #14 — détail complet**
  > ## Contexte
  > Aucun état vide explicatif : un nouvel utilisateur ne sait pas par où commencer (board vide, pas de pipeline, pas de manager).
  >
  > ## Objectif
  > - États vides par écran : Tâches, Pipelines, Managers, Sessions provider — avec action CTA principale
  > - Templates de mission : refactor, test, release (config agent préremplie : provider, modèle, prompt type)
  > - Pipeline d'exemple préremplissable en un clic
  > - Bannière de bienvenue au premier lancement (détecté via localStorage)
  >
  > ## Acceptance
  > - [ ] Chaque écran a un état vide avec CTA
  > - [ ] Créer depuis un template fonctionne en 1 clic
  > - [ ] Onboarding masquable
  >
  > ## Méthode d'implémentation
  > - Cartographier le code avec des **subagents explore** avant d'implémenter
  > - Implémenter avec des **subagents**
  > - **Committer le plus fréquemment possible** : commits atomiques (états vides → templates → bannière)
  > - Vérifier : `npm run typecheck`, `npm run lint`, `npm test`

- [x] #15 — Responsive / vue tablette (labels: —)

  **Issue #15 — détail complet**
  > ## Contexte
  > L'UI est desktop-only : board kanban (`MissionRelay.tsx`), sidebar et graph SVG ne s'adaptent pas aux petits écrans.
  >
  > ## Objectif
  > - Breakpoints raisonnables (≥ 768px tablette, ≥ 1024px desktop)
  > - Vue liste comme fallback du kanban sur petit écran (le mode liste existe déjà via `view-mode-service.ts`)
  > - Sidebar repliable (déjà existant) + drawer plein écran sur mobile
  > - Le graph SVG des pipelines bascule sur la vue timeline (issue #4) en petit écran
  >
  > ## Acceptance
  > - [ ] Tous les écrans utilisables à 768px sans scroll horizontal
  > - [ ] Board bascule en liste sur petit écran
  > - [ ] Modales et chat utilisables
  >
  > ## Méthode d'implémentation
  > - Cartographier le code avec des **subagents explore** avant d'implémenter
  > - Implémenter avec des **subagents**
  > - **Committer le plus fréquemment possible** : commits atomiques par écran
  > - Vérifier : `npm run typecheck`, `npm run lint`, `npm test`

- [x] #16 — Rejouer / dupliquer un run (labels: —)

  **Issue #16 — détail complet**
  > ## Contexte
  > Les missions gardent leur config agent (provider, modèle, prompt, workspace). Relancer un run identique ou varié demande de tout reconfigurer manuellement.
  >
  > ## Objectif
  > - Action "Relancer avec les mêmes réglages" depuis la fiche mission (`MissionInspector.tsx`) : duplique la mission avec config agent + prompt + workspace, statut READY
  > - Option au lancement : varier le modèle (listbox des modèles du même provider)
  > - (Option) historique des lancements avec leurs réglages
  >
  > ## Acceptance
  > - [ ] Relancer en 1 clic depuis la fiche
  > - [ ] Choix du modèle au relancement
  > - [ ] La nouvelle mission apparaît dans le board en READY
  >
  > ## Méthode d'implémentation
  > - Cartographier le code avec des **subagents explore** avant d'implémenter
  > - Implémenter avec des **subagents**
  > - **Committer le plus fréquemment possible** : commits atomiques
  > - Vérifier : `npm run typecheck`, `npm run lint`, `npm test`

- [x] #17 — Filtre 'ma journée' (labels: —)

  **Issue #17 — détail complet**
  > ## Contexte
  > Le board liste tout. Le planning local existe déjà (`mission-schedule-service.ts` : `nodra.mission.schedule` + bannière "en retard" dans `MissionInspector.tsx`) mais rien n'agrège les missions touchées aujourd'hui.
  >
  > ## Objectif
  > - Vue/filtre "Ma journée" : missions créées, activées, validées ou échouées aujourd'hui (dérivable des audit events)
  > - S'appuie sur le planning local existant + dates d'audit (cf. issue timeline d'audit pour l'endpoint)
  > - Tri par urgence : retard > validation en attente > active > nouveau
  >
  > ## Acceptance
  > - [ ] Filtre disponible dans la barre latérale ou les chips du board
  > - [ ] Compteur de missions du jour
  > - [ ] Tri par urgence
  >
  > ## Méthode d'implémentation
  > - Cartographier le code avec des **subagents explore** avant d'implémenter (audit events, schedule service)
  > - Implémenter avec des **subagents**
  > - **Committer le plus fréquemment possible** : commits atomiques
  > - Vérifier : `npm run typecheck`, `npm run lint`, `npm test`

- [ ] #18 — Glance horizontal : où en est le run ? (labels: —)

  **Issue #18 — détail complet**
  > ## Contexte
  > Pour savoir où en sont les runs actifs, il faut ouvrir chaque chat. Le board ne montre pas l'activité en cours (complète l'issue #7 mini-cartes).
  >
  > ## Objectif
  > - Barre horizontale en haut du board ("Glance") listant tous les runs actifs
  > - Pour chacun : mission, manager ou pipeline, dernière action/événement, temps écoulé, état de connexion
  > - Clic → ouvre la conversation correspondante
  > - Mise à jour par le même mécanisme de polling/SSE que le board (cf. issue #2 SSE)
  >
  > ## Acceptance
  > - [ ] Tous les runs actifs visibles dans la barre
  > - [ ] Dernière action affichée en live
  > - [ ] Navigation 1 clic vers la conversation
  >
  > ## Méthode d'implémentation
  > - Cartographier le code avec des **subagents explore** avant d'implémenter
  > - Implémenter avec des **subagents**
  > - **Committer le plus fréquemment possible** : commits atomiques
  > - Vérifier : `npm run typecheck`, `npm run lint`, `npm test`

- [ ] #19 — Quick actions sur cartes mission (labels: —)

  **Issue #19 — détail complet**
  > ## Contexte
  > Chaque action nécessite d'ouvrir la fiche mission. Les transitions possibles sont déjà pilotées par une policy UI (`services/mission-ui-policy.ts`).
  >
  > ## Objectif
  > - Menu contextuel sur les cartes du board (`MissionRelay.tsx`) : clic droit / bouton `…`
  > - Actions selon l'état (même policy) : configurer, lancer, mettre en validation, accepter delivery, demander corrections, abandonner
  > - Sans ouvrir la fiche ; feedback via toasts existants
  >
  > ## Acceptance
  > - [ ] Menu contextuel sur chaque carte
  > - [ ] Actions cohérentes avec `mission-ui-policy.ts` (pas d'action invalide)
  > - [ ] Aucun changement visuel pour le drag & drop
  >
  > ## Méthode d'implémentation
  > - Cartographier le code avec des **subagents explore** avant d'implémenter (policy UI, board)
  > - Implémenter avec des **subagents**
  > - **Committer le plus fréquemment possible** : commits atomiques
  > - Vérifier : `npm run typecheck`, `npm run lint`, `npm test`

- [ ] #20 — Séquences favorites (templates de pipeline) (labels: —)

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
  > - [ ] Enregistrer une pipeline comme modèle en 1 clic
  > - [ ] Créer une nouvelle pipeline depuis un modèle
  > - [ ] Modèles listés dans l'écran Pipelines
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
  > - [ ] Audit des features livrées + nouvelles : aucune fonctionnalité cassée sur Windows natif / WSL2
  > - [ ] `Ctrl+K` (et autres raccourcis) fonctionnels sur Windows
  > - [ ] SSE OK sur Windows et WSL2
  > - [ ] Boucle Ralph documentée WSL2-only (ou équivalent PowerShell)
  > - [ ] Vérifications `npm run typecheck` / `lint` / `test` sur Windows natives
  >
  > ## Méthode d'implémentation
  > - Cartographier le code avec des **subagents explore** avant d'implémenter (rechercher slashs durs, raccourcis, dépendances Unix)
  > - Implémenter avec des **subagents** (par feature, en parallèle)
  > - **Committer le plus fréquemment possible** : commits atomiques par feature corrigée
  > - Vérifier : `npm run typecheck`, `npm run lint`, `npm test`

- [ ] #22 — Comparateur de missions / runs (labels: —)

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
  > - [ ] Sélection de 2 runs depuis la fiche mission
  > - [ ] Panneaux côte à côte avec scroll synchronisé
  > - [ ] Diff visible sur les métriques (durée, coût, tokens)
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

- [ ] #25 — Retirer Temporal : exécuteur in-process + polling SQLite (labels: —)

  **Issue #25 — détail complet**
  > ## Contexte
  > Temporal est actuellement l'exécuteur des runs (workflow MissionWorkflow → RunWorkflow → activités recordStarted/executeProvider/recordTerminal) et le transport des commandes interactives (steer/resume/cancel) pendant des exécutions de plusieurs minutes.
  >
  > Pour un outil de dev local mono-utilisateur (SQLite, agent codex invoqué en child process), c'est overkill :
  > - binaire Go externe `temporal` requis sur le PATH (supervisor à 4 composants, démarrage 10-120s)
  > - dispatcher manuel : les runs restent QUEUED indéfiniment si l'outbox n'est pas dispatchée
  > - serveur dev réinitialisé au restart → workflows perdus → runs orphelins (bug vécu le 2026-08-02)
  > - toute la vérité durable est déjà en SQLite : Temporal n'est qu'une enveloppe d'orchestration
  >
  > ## Ce qui est réutilisable tel quel (déjà découplé de Temporal)
  > - packages/adapters/src/sqlite/sqlite-run-workflow-activity.ts
  > - packages/adapters/src/sqlite/sqlite-provider-run-store.ts
  > - packages/adapters/src/sqlite/sqlite-provider-permission-handler.ts
  > - packages/adapters/src/sqlite/sqlite-workflow-outbox-store.ts
  >
  > ## Migration proposée (1-2 jours)
  > 1. Nouvel exécuteur in-process dans l'API (ou child_process par run) : poll outbox SQLite → exécute provider avec les mêmes sinks → transitions de state en direct
  > 2. Remplacer les signaux Temporal par une file de commandes en DB pollée (steer/resume/cancel)
  > 3. Heartbeat en DB + watchdog au boot : reprise des runs STARTING/RUNNING orphelins après restart
  > 4. Supprimer packages/adapters/src/temporal/** (8 fichiers prod) + apps/worker, recâbler nodra.module.ts et run-cli.ts
  > 5. Repenser les colonnes runs.temporal_workflow_id (NOT NULL unique), missions/managers/pipelines.temporal_*
  > 6. Supervisor à 3 composants (opencode, api, executor) ; retirer les checks RUNTIME_UNHEALTHY liés à Temporal
  > 7. Réécrire ~20 fichiers de tests (e2e i7-temporal, i8-opencode, poc/temporal)
  >
  > ## Ce qu'on perd (acceptable en local)
  > - historique rejouable + UI Temporal
  > - garanties d'idempotence workflow (remplaçables par inbox/outbox existants)
  > - attente durable 'gratuite' (remplacée par file de commandes DB)
  >
  > ## Ce qu'on gagne
  > - plus de binaire Go externe, démarrage ~5s
  > - plus de dispatcher manuel, plus de runs QUEUED orphelins
  > - 1 process de moins dans le supervisor
