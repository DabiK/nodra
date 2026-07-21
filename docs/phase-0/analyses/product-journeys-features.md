# Analyse produit — parcours et capacités AS-IS

Référence analysée : `/Users/Dabi/Documents/devflow/api-v2`, commit `475ae382bb5a19cc889c79ab6d19b592d730a105` du 21 juillet 2026.

## Synthèse

- **OBS** — La promesse observable est un cockpit local qui remplace la coordination de plusieurs agents/terminaux par un relais centré sur le prochain geste utile : démarrer, suivre, décider ou terminer. Preuves : `README.md:3-5`, `README.md:37-49`, `apps/web/src/App.tsx:53-74`.
- **OBS** — Les quatre niveaux d'orchestration annoncés sont présents dans le produit : tâche autonome, séquence ponctuelle, pipeline réutilisable et manager persistant. La séquence n'a toutefois pas de page propre : elle se configure après création d'une tâche. Preuves : `README.md:63-83`, `apps/web/src/features/home/MissionConfigurator.tsx:268-291`, symbole `TaskSequencePicker`.
- **OBS** — Le parcours principal réellement branché est : accueil « Le relais » → inspection sans lancement → configuration éventuelle → lancement explicite → conversation/suivi → terminaison ou intégration. Preuves : `apps/web/src/App.tsx:468-526`, `apps/web/src/App.tsx:557-760`, `test/e2e/devflow.spec.ts:67-105`.
- **OBS** — Deux ensembles annoncés comme livrés ne sont pas accessibles dans la navigation AS-IS : le cockpit portefeuille/projets et la vue Agents. Leurs composants et tests existent, mais `App` ne les importe ni ne les rend ; l'ancienne page Agents est explicitement redirigée vers l'accueil. Preuves : tableau `pages`, `apps/web/src/App.tsx:39-50`; symboles isolés `PortfolioCockpit` et `AgentWorkspace`; test `navigation > redirige l'ancienne page agents vers l'accueil` dans `apps/web/src/App.test.ts`.
- **OBS** — La file d'arbitrage détaillée est également portée par un composant non branché (`DecisionQueue`). La page Supervision n'en montre que trois entrées et affirme qu'elle « vit sur la vue d'ensemble », alors que l'accueil rendu est `TaskRelay` sans `DecisionQueue`. Preuves : `apps/web/src/features/supervisor/AgenticControlCenter.tsx:54-93`, `apps/web/src/App.tsx:468-486`, symbole `DecisionQueue` seulement consommé par `PortfolioCockpit`.
- **DEC-V** — La cible reste local-first, mono-utilisateur, sans comptes, rôles, organisations, multi-tenant, collaboration temps réel ni SaaS.
- **DEC-V** — La cible repart d'une base propre, sans migration ni rétrocompatibilité des données historiques du MVP.
- **DEC-V** — La cible conserve un runtime multi-provider extensible : Codex et GitHub Copilot initiaux, contrat stable, socle commun, capacités optionnelles et indisponibilités/dégradations explicites.

## Périmètre et exclusions

- **OBS** — L'analyse couvre uniquement la promesse produit, l'opérateur mono-utilisateur, la navigation, les tâches, séquences, pipelines/workflows, managers, projets, attention, efficacité, et les parcours de création, configuration, lancement, suivi et revue.
- **OBS** — Les couches techniques, schémas de persistance, menaces et stratégie de tests ne sont pas analysés en détail ; les routes et tests ne servent ici que de preuves de comportement.
- **OBS** — `demo-video/` est exclu et n'a pas été consulté ni modifié.
- **DEC-V** — Les données runtime et les formats historiques du MVP ne constituent pas des exigences de la nouvelle base.

## Méthode

- **OBS** — La charte `docs/phase-0/00-refactor-charter.md` a été lue avant l'analyse.
- **OBS** — Les preuves ont été confrontées dans cet ordre : tests de parcours et branchement UI, composants rendus, README, puis roadmap. En cas d'écart, le comportement ou les tests priment.
- **OBS** — L'analyse a été menée en lecture seule au commit figé. Aucun test n'a été exécuté afin de ne créer ni donnée ni artefact dans la source ; les tests ont été lus comme spécifications exécutables.
- **OBS** — Le commit `HEAD` de la source correspondait exactement à `475ae382bb5a19cc889c79ab6d19b592d730a105` au début de l'analyse.

## Acteur et promesse

- **OBS** — L'acteur produit est un opérateur local unique, développeur travaillant avec plusieurs agents. Le discours est systématiquement à la deuxième personne et ne montre aucun parcours d'inscription, équipe, rôle ou partage. Preuves : `README.md:37-49`, `README.md:124-134`, `apps/web/src/App.tsx:53-74`.
- **INT** — La direction produit vise une compréhension en dix secondes de ce qui tourne, bloque et requiert une décision humaine. Preuve : `docs/product-roadmap.md:3-13`.
- **OBS** — L'accueil observable privilégie trois files bornées — « Aujourd'hui », « Ça bosse », « À toi de jouer » — plus un sas « À intégrer » pour les revues. Preuves : `apps/web/src/features/home/TaskRelay.tsx:245-247`, `apps/web/src/features/home/TaskRelay.tsx:285-373`; tests `task relay home` dans `apps/web/src/features/home/TaskRelay.test.tsx:24-137`.
- **OBS** — Le produit sépare explicitement inspection et exécution : ouvrir une mission ou la retrouver par la palette ne crée aucun run ; le bouton porte « Lancer explicitement ». Preuves : `apps/web/src/App.tsx:742-760`; tests E2E `inspecter depuis le cockpit...` et `retrouver une mission avec la palette...`, `test/e2e/devflow.spec.ts:67-105`.

## Navigation AS-IS

| Surface visible | Rôle AS-IS | Preuve | Statut |
| --- | --- | --- | --- |
| Vue d'ensemble | Relais quotidien, briefing, inspection des missions et regroupement des pipelines | `apps/web/src/App.tsx:39-56`, `apps/web/src/App.tsx:468-486` | **OBS** |
| Tâches | Capture rapide, vues temporelles/statuts/tags, configuration agent, actions par lot | `apps/web/src/App.tsx:57-58`, `apps/web/src/features/tasks/TaskFeature.tsx:342-523`, `:524-674` | **OBS** |
| Pipelines | Création/template/génération, graphe, gates, routage, lancement, reprise, archivage | `apps/web/src/App.tsx:59-62`, `apps/web/src/features/workflows/WorkflowFeature.tsx:548-597`, `:714-988` | **OBS** |
| Managers | Création et configuration de managers persistants, briefs, historique et nouveaux chats | `apps/web/src/App.tsx:63-66`, `apps/web/src/features/managers/ManagerFeature.tsx:230-266`, `:356-614` | **OBS** |
| Supervision | Réglage de concurrence/contexte et aperçu de trois arbitrages | `apps/web/src/App.tsx:67-70`, `apps/web/src/features/supervisor/AgenticControlCenter.tsx:54-153` | **OBS** |
| Efficacité | Tokens, coût estimé, couverture, résultats acceptés et vues provider/projet/agent | `apps/web/src/App.tsx:71-74`, `apps/web/src/features/efficiency/EfficiencyDashboard.tsx:15-28` | **OBS** |
| Conversation | Suivi live, messages, queue/steer/arrêt, fichiers, coût, fiche mission et terminaison | `apps/web/src/features/conversation/ConversationPage.tsx:651-719` | **OBS** |
| Projets | Pas de destination accessible ; seulement des traces dans l'efficacité et des composants non branchés | tableau `pages`, `apps/web/src/App.tsx:39-50`; symbole `PortfolioCockpit` | **OBS** |
| Agents | Pas de destination accessible ; composant `AgentWorkspace` non consommé | symbole `AgentWorkspace`; `apps/web/src/App.test.ts`, test `navigation` | **OBS** |

## Carte des parcours et capacités

### Tâche autonome

1. **OBS** — Capturer un titre, une priorité et une échéance ; ouvrir facultativement « Configurer l'agent ». Preuve : `apps/web/src/features/tasks/TaskFeature.tsx:342-425`.
2. **OBS** — Avant création, configurer notes, tags, prompt, dépôt/workspace, provider, modèle, réflexion et pièces jointes. Preuve : `apps/web/src/features/tasks/TaskFeature.tsx:427-520`; tests `task agent settings`, `apps/web/src/features/tasks/TaskFeature.settings.test.tsx:11-96`.
3. **OBS** — La création n'exécute pas l'agent ; un clic sur la tâche ouvre sa fiche. Preuves : `apps/web/src/features/tasks/TaskFeature.tsx:252-339`; `apps/web/src/features/tasks/TaskFeature.settings.test.tsx:99-115`.
4. **OBS** — La fiche permet de configurer puis de lancer explicitement, ou d'ouvrir une session existante. Preuve : `apps/web/src/App.tsx:719-760`.
5. **OBS** — La conversation permet suivi live, ajout en queue, steer prioritaire, arrêt forcé, pièces jointes et inspection de fichiers. Preuve : `apps/web/src/features/conversation/ConversationPage.tsx:651-702`.
6. **OBS** — Après succès, l'interface propose « Terminer la tâche » ; pour une revue worktree, elle propose l'intégration. Preuves : `apps/web/src/App.tsx:725-740`, `apps/web/src/features/conversation/ConversationPage.tsx:703-719`.

### Séquence ponctuelle

1. **OBS** — Ouvrir la configuration d'une tâche existante hors pipeline.
2. **OBS** — Choisir une ou plusieurs tâches sources compatibles ; leur dernier message devient handover. Preuve : `apps/web/src/components/TaskSequencePicker.tsx:24-67`.
3. **OBS** — Activer le démarrage automatique après succès de toutes les sources. Preuve : `apps/web/src/components/TaskSequencePicker.tsx:64-67`.
4. **OBS** — La liste candidate filtre recherche, statut et date, exclut les nœuds de pipeline et les cycles. Preuve : `apps/web/src/components/TaskSequencePicker.tsx:12-41`; test `TaskSequencePicker filters`.
5. **Q** — La création en deux temps — créer d'abord, configurer la dépendance ensuite — est-elle intentionnelle pour le PRD cible, ou la séquence doit-elle être composable dès la capture ?

### Pipeline / workflow

1. **OBS** — Créer depuis un template et des variables, ou générer depuis un objectif avec prévisualisation puis approbation. Preuves : `apps/web/src/features/workflows/WorkflowFeature.tsx:995-1112`, `:1121-1301`; test `prévisualise puis approuve un pipeline généré`, `apps/web/src/features/workflows/WorkflowFeature.chat.test.tsx:119-135`.
2. **OBS** — Choisir dépôt existant, workspace isolé ou worktree, puis provider/modèle. Preuves : `apps/web/src/features/workflows/WorkflowFeature.tsx:1043-1081`, `:1170-1241`.
3. **OBS** — Inspecter un graphe dont les nœuds affichent `WAIT`, `READY`, `LIVE`, `DONE`, décision requise ou ignorée, ainsi que preuve/validation requise. Preuve : `apps/web/src/features/workflows/WorkflowFeature.tsx:714-790`.
4. **OBS** — Lancer explicitement le pipeline, basculer auto/validation humaine, ouvrir le chat d'un nœud, forcer un handover, reprendre depuis un nœud, archiver/restaurer ou supprimer. Preuve : `apps/web/src/features/workflows/WorkflowFeature.tsx:791-988`; tests `apps/web/src/features/workflows/WorkflowFeature.chat.test.tsx:13-116`.
5. **OBS** — L'accueil regroupe les nœuds en une carte pipeline et permet de l'ouvrir ou de tout terminer. Preuve : `apps/web/src/features/home/TaskRelay.test.tsx:121-137`.

### Manager

1. **OBS** — Créer un manager persistant avec style, dépôt/workspace, provider, modèle et réflexion. Preuve : `apps/web/src/features/managers/ManagerFeature.tsx:230-356`.
2. **OBS** — Lui confier un brief depuis sa carte ou le dock global. Preuves : `apps/web/src/features/managers/ManagerFeature.tsx:574-609`, symbole `ManagerDock`; test `confie un brief au manager depuis sa carte`, `apps/web/src/features/managers/ManagerFeature.test.tsx:13-22`.
3. **OBS** — Reconfigurer le manager, consulter les conversations conservées et ouvrir un nouveau chat sans supprimer l'ancien. Preuve : `apps/web/src/features/managers/ManagerFeature.tsx:382-565`; test `reconfigure le manager...`, `apps/web/src/features/managers/ManagerFeature.test.tsx:49-68`.
4. **OBS** — Les managers actifs ou en attente rejoignent les files « Ça bosse » et « À toi de jouer » ; les managers inactifs restent absents du relais. Preuve : `apps/web/src/features/home/TaskRelay.test.tsx:51-75`.

### Attention, revue et efficacité

1. **OBS** — Le relais calme borne chaque colonne à huit éléments et regroupe les pipelines. Preuve : `apps/web/src/features/home/TaskRelay.tsx:245-247`; tests `apps/web/src/features/home/TaskRelay.test.tsx:98-137`.
2. **OBS** — « Faire le point » ouvre une configuration sans générer ; la génération reste une action distincte, l'historique est consultable sans nouvel appel, et un briefing périmé est signalé. Preuves : `apps/web/src/features/home/TaskBriefingPanel.tsx:114-177`; tests `apps/web/src/features/home/TaskBriefingPanel.test.tsx:44-117`.
3. **OBS** — Le suivi conversationnel distingue provider, modèle, état, contexte restant, quotas disponibles et coût estimé, avec dégradation visible de certaines métriques Copilot par `—`. Preuve : `apps/web/src/features/conversation/ConversationPage.tsx:673-694`.
4. **OBS** — La vue Efficacité relie consommation et qualité : résultats acceptés, DoD résolues, exceptions, tokens par résultat accepté, puis agrégats provider/projet/agent. Preuve : `apps/web/src/features/efficiency/EfficiencyDashboard.tsx:22-28`; E2E `test/e2e/devflow.spec.ts:129-133`.
5. **OBS** — Un composant riche de handoff sépare déclaration agent, faits DevFlow et décision humaine, mais il n'est consommé par aucune surface applicative au commit analysé. Preuves : symbole `HandoffCard`, `apps/web/src/features/agents/HandoffCard.tsx:19-34`; recherche d'usage limitée à son test.

## États visibles

- **OBS** — État métier tâche : `À faire`, `En cours`, `Terminée`; vues : `Aujourd'hui`, `Inbox`, `À venir`, `En retard`, `Toutes`, `Terminées`. Preuve : `apps/web/src/features/tasks/TaskFeature.tsx:368-401`, `:610-619`.
- **OBS** — État agent dans la fiche : `Prêt à démarrer`, `Mission en cours`, `Résultat disponible`, `Intervention nécessaire`. Preuve : `apps/web/src/App.tsx:588-603`.
- **OBS** — État d'attention accueil : `Aujourd'hui`, `Ça bosse`, `À toi de jouer`, `À intégrer`. Preuve : `apps/web/src/features/home/TaskRelay.tsx:285-373`.
- **OBS** — État pipeline : actif ou terminé/archivé ; nœud `WAIT`, `READY`, `LIVE`, `DONE`, `DÉCISION REQUISE`, `IGNORÉE`; gate `PREUVE REQUISE/OBSERVÉE` ou `VALIDATION REQUISE/HANDOFF VALIDÉ`. Preuve : `apps/web/src/features/workflows/WorkflowFeature.tsx:579-597`, `:738-790`.
- **OBS** — État conversation : en direct, file en attente/reprise, conversation manager archivée en lecture seule. Preuve : `apps/web/src/features/conversation/ConversationPage.tsx:657-694`.
- **OBS** — État provider : option disponible ou désactivée avec raison ; fonctionnalités non partagées masquées ou métriques non exposées rendues par `—`. Preuves : `apps/web/src/App.tsx:632-666`, `apps/web/src/features/conversation/ConversationPage.tsx:676-694`, `README.md:280-294`.

## Contradictions et frictions critiques

| Constat | Preuves en tension | Conclusion |
| --- | --- | --- |
| Cockpit projets annoncé livré mais absent de la navigation | `docs/product-roadmap.md:15-36` et `PortfolioCockpit` vs `apps/web/src/App.tsx:39-50`, `:468-523` | **OBS** — Le code isolé et ses tests ne constituent pas un parcours produit accessible. |
| Vue Agents annoncée à l'échelle mais retirée de la navigation | `docs/product-roadmap.md:28-31`, composant `AgentWorkspace` vs test `navigation` de `apps/web/src/App.test.ts` | **OBS** — Le suivi multi-agent passe actuellement par le relais, les pipelines et les conversations, pas par un inventaire global accessible. |
| File d'arbitrage dite présente sur l'accueil mais non rendue | `docs/product-roadmap.md:45-59`, `AgenticControlCenter.tsx:60-61` vs `App.tsx:468-486` | **OBS** — Les décisions détaillées ne sont pas opérables depuis l'accueil AS-IS ; Supervision n'en expose qu'un aperçu de trois éléments. |
| Promesse de distinction preuve/acceptation, composant riche non branché | `README.md:43-49`, `docs/product-roadmap.md:48-57`, `HandoffCard.tsx:19-34` vs absence d'usage applicatif | **OBS** — Le parcours accessible propose surtout « Terminer »/« Intégrer » après succès ; la revue probante complète n'est pas démontrée en E2E. |
| Documentation « dashboard par dépôt » vs accueil volontairement sans vue projet | `docs/product-roadmap.md:17`, test `ouvre la tâche sans afficher de vue projet`, `TaskRelay.test.tsx:77-87` | **OBS** — README et accueil sont cohérents sur le relais quotidien, mais la roadmap décrit une surface plus large que l'AS-IS branché. |
| Séquence annoncée comme niveau d'orchestration, sans entrée directe de navigation/création | `README.md:63-68` vs `MissionConfigurator.tsx:268-277` | **OBS** — La capacité existe mais sa découvrabilité dépend de la configuration d'une tâche déjà créée. |
| Création avancée affiche `FULL ACCESS` alors que les politiques projet sont annoncées | `TaskFeature.tsx:427-433` vs `README.md:266-278` | **OBS** — La portée effective est difficile à comprendre au moment de créer une tâche non rattachée visiblement à un projet. |
| Migration de briefing historique présente dans le MVP | `TaskBriefingPanel.tsx:88-99`, test `migre le dernier briefing local...` | **DEC-V** — Ce comportement historique ne doit pas devenir une exigence cible : la nouvelle base ne migre aucune donnée du MVP. |

## Implications pour le PRD

- **DEC-P** — Décrire l'AS-IS accessible comme source de référence et classer `PortfolioCockpit`, `DecisionQueue`, `AgentWorkspace`, `HandoffCard` et `RunHistory` comme capacités candidates non validées tant qu'un parcours branché n'est pas confirmé.
- **DEC-P** — Faire arbitrer explicitement dans le PRD la surface principale d'attention : relais simple, file de décisions opérable, ou combinaison progressive des deux.
- **DEC-P** — Exiger des critères d'acceptation séparés pour succès agent, preuve observée et acceptation humaine, sans présumer que le composant actuel sera conservé.
- **DEC-P** — Définir un socle provider commun pour créer/configurer/lancer/suivre/revoir, puis rendre chaque capacité optionnelle indisponible ou dégradée avec une explication visible, conformément à la contrainte multi-provider.
- **DEC-P** — Conserver l'inspection sans exécution et l'action explicite avant tout lancement, génération ou opération destructive.

## Matrice capacité → preuve → confiance → question

| Capacité AS-IS | Preuve primaire | Confiance | Question ouverte |
| --- | --- | --- | --- |
| Capture/configuration de tâche | `TaskFeature.tsx:342-523`; E2E `devflow.spec.ts:3-24` | **OBS — Haute** | **Q** — Faut-il rattacher explicitement la tâche à un projet dès la création ? |
| Inspection sans lancement | E2E `devflow.spec.ts:67-105` | **OBS — Haute** | **Q** — Aucune sur l'invariant ; sa portée exacte doit être reprise dans les critères d'acceptation. |
| Lancement explicite | `App.tsx:742-760` | **OBS — Haute** | **Q** — Quelle confirmation de portée doit précéder chaque type de lancement ? |
| Séquence ponctuelle | `TaskSequencePicker.tsx:24-67` | **OBS — Moyenne** | **Q** — Doit-elle être créée directement ou rester une configuration post-création ? |
| Pipeline manuel/template | `WorkflowFeature.tsx:995-1112`; E2E `devflow.spec.ts:49-60` | **OBS — Haute** | **Q** — Quels templates appartiennent au MVP cible ? |
| Pipeline généré puis approuvé | test `WorkflowFeature.chat.test.tsx:119-135` | **OBS — Moyenne** | **Q** — Quelle action coûteuse a lieu à la prévisualisation et comment sa portée est-elle annoncée ? |
| Gates, handovers et routage | `WorkflowFeature.tsx:714-916`; tests `WorkflowFeature.chat.test.tsx:81-116` | **OBS — Haute** | **Q** — Quels états doivent remonter au relais plutôt que rester dans le graphe ? |
| Managers persistants multi-conversations | `ManagerFeature.tsx:356-614`; `ManagerFeature.test.tsx:13-68` | **OBS — Haute** | **Q** — Un manager est-il indispensable au premier jalon ou une capacité avancée ? |
| Briefing d'attention explicite | `TaskBriefingPanel.test.tsx:44-117` | **OBS — Haute** | **Q** — Quel contenu minimal, non génératif, doit rester visible sans appel provider ? |
| File de décisions détaillée | `DecisionQueue.tsx:36-213`, non branché | **OBS — Faible pour le produit accessible** | **Q** — Doit-elle remplacer, compléter ou rester distincte du relais ? |
| Cockpit projets | `PortfolioCockpit.tsx:135-766`, non branché | **OBS — Faible pour le produit accessible** | **Q** — Les projets sont-ils une navigation de premier rang ou un filtre/contexte ? |
| Vue globale Agents | `AgentWorkspace.tsx:39-171`, non branché | **OBS — Faible pour le produit accessible** | **Q** — Le relais et la recherche suffisent-ils, ou faut-il restaurer cet inventaire ? |
| Conversation live et pilotage | `ConversationPage.tsx:651-719`; tests `ConversationPage.strict.test.tsx` | **OBS — Haute** | **Q** — Quelle partie du pilotage queue/steer/arrêt appartient au socle provider commun ? |
| Revue preuve/faits/humain | `HandoffCard.tsx:19-34`, non branché ; terminaison accessible dans `App.tsx:725-740` | **OBS — Faible pour le parcours complet** | **Q** — Où l'opérateur relit-il et accepte-t-il formellement un résultat dans la cible ? |
| Efficacité par provider/projet/agent | `EfficiencyDashboard.tsx:22-28`; E2E `devflow.spec.ts:129-133` | **OBS — Haute** | **Q** — Quelles métriques influencent réellement une décision plutôt que d'ajouter du bruit ? |
| Dégradation provider explicite | `App.tsx:632-666`; `README.md:280-294` | **OBS — Moyenne** | **Q** — Quelle matrice minimale de capacités Codex/Copilot doit être visible avant lancement ? |

## Incertitudes et questions ouvertes prioritaires

- **Q** — Quelle surface fait foi pour « ce qui attend vraiment ta décision » : `TaskRelay`, `DecisionQueue`, ou une composition des deux ?
- **Q** — Les projets doivent-ils redevenir une destination de navigation, ou seulement structurer les tâches, politiques et statistiques en arrière-plan ?
- **Q** — Une vue globale Agents est-elle nécessaire en plus du relais, des pipelines, de la palette et des conversations multi-flux ?
- **Q** — Quel est le parcours cible d'acceptation humaine : terminaison directe, handoff probant, revue worktree, ou plusieurs niveaux selon la mission ?
- **Q** — La génération de pipeline et le briefing doivent-ils être disponibles avec tous les providers, ou déclarés comme capacités optionnelles avec dégradation explicite ?
- **Q** — Les managers font-ils partie du premier parcours produit ou d'un niveau avancé après tâches/séquences/pipelines ?
- **Q** — Le vocabulaire final doit-il unifier tâches/missions, pipelines/workflows, providers/moteurs et projet/workspace afin de réduire les changements de terme visibles ?

## Couverture et limites

- **OBS** — Couverture : README, roadmap produit, navigation `App`, surfaces de tâches, relais/briefing, séquences, pipelines, managers, supervision, efficacité, conversation, composants projets/agents/revue et tests de parcours associés.
- **OBS** — Limite : aucun test n'a été exécuté et aucune validation navigateur interactive n'a été menée ; la confiance « haute » signifie branchement UI plus test lisible, pas exécution fraîche.
- **OBS** — Limite : les composants non branchés prouvent une intention et du code disponible, pas une capacité utilisable par l'opérateur.
- **OBS** — Limite : les détails API, persistance, architecture runtime, accessibilité, sécurité et qualité relèvent des autres rapports Phase 0.

## Contrôle d'intégrité

- **OBS** — Avant rédaction, la source était au commit attendu, sans modification suivie ; seul `demo-video/` apparaissait comme dossier non suivi préexistant.
- **OBS** — Le contrôle final doit confirmer que la source reste au même commit, que son diff suivi reste vide, que `demo-video/` est inchangé par cette mission et que la cible ne contient comme nouvelle écriture de cette mission que ce rapport.
