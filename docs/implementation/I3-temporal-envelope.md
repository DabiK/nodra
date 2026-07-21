# I3 — Enveloppe d’exécution durable Temporal

Date de validation : 22 juillet 2026

## Périmètre livré

I3 livre le backend, l’API, la CLI et le worker Temporal, sans frontend ni provider. SQLite reste l’unique vérité métier. Temporal coordonne un `MissionWorkflow` durable et conserve son historique d’exécution.

Le SDK Temporal TypeScript `1.20.3` est confiné à `packages/adapters`. `domain` et `application` ne l’importent pas. Les responsabilités sont séparées dans les modules `temporal/client`, `temporal/worker`, `temporal/workflows` et `temporal/activities`. Le processus worker est exposé par le workspace `apps/worker` et la commande `npm run worker`.

## Protocole de démarrage

`StartMission` applique les priorités suivantes avant toute écriture : mission existante, version attendue, transition agent `READY → ACTIVE`, configuration agent minimale déjà persistée, puis santé Temporal. Une indisponibilité retourne `RUNTIME_UNHEALTHY` et ne crée ni run ni outbox.

Une transaction SQLite unique persiste ensuite :

- la mission `ACTIVE`, sa version et `temporal_parent_workflow_id = mission/<missionId>` ;
- la conversation technique, le run `QUEUED` avec `run/<runId>` et son snapshot immuable ;
- l’audit `MISSION_START_REQUESTED`, la projection Relais `active` et l’outbox `workflow.mission.start` non publiée.

Le snapshot reprend uniquement la configuration déjà stockée. Aucun provider n’est interrogé. Les champs capacités et budget portent explicitement `not_probed` et `not_evaluated`; ils ne simulent aucun résultat.

Le dispatcher lit seulement les `workflow.mission.start` dont `published_at` est nul. Le client utilise `workflowId = mission/<missionId>`, `USE_EXISTING` pour un Workflow vivant et `REJECT_DUPLICATE` pour un historique fermé. `published_at` est écrit seulement après acceptation. Un crash injecté juste après le start laisse donc l’outbox en attente; le redémarrage rejoint la même exécution Temporal.

## Workflow, Activity et inbox

`MissionWorkflow({missionId, commandId, schemaVersion: 1})` ne contient aucun accès SQLite, processus, provider, Git, horloge système ou aléa. Il installe une Query `status`, un Signal `cancel`, puis appelle l’Activity `recordStarted` avec l’identifiant logique stable `mission/<missionId>/activity/record-started/v1`.

L’Activity enrichit la commande avec le run ID Temporal et son horodatage hors du Workflow. La mutation `run → STARTING`, la mise à jour du Relais et l’insertion inbox sont atomiques. Un message inbox déjà consommé retourne `applied: false` sans second effet métier.

## Santé, reprise et opérations

`NODRA_TEMPORAL_ADDRESS` configure l’adresse locale, par défaut `127.0.0.1:7233`; `NODRA_TEMPORAL_NAMESPACE` vaut `nodra` par défaut. La connexion API/CLI est paresseuse et son probe est borné à 500 ms. Ainsi l’API démarre, les lectures SQLite restent disponibles et `/health` devient `degraded` lorsque Temporal est absent.

Commandes exposées :

```text
nodra mission:start <missionId> <expectedVersion> [--command-id <id>]
nodra temporal:dispatch
nodra temporal:reconcile
```

API correspondante : `POST /api/missions/:id/start`, `POST /api/runtime/temporal/dispatch`, `POST /api/runtime/temporal/reconcile` et `GET /health`. Preview et lectures ne déclenchent aucun lancement.

I3 ne télécharge, n’installe, ne sauvegarde et ne met à jour aucun runtime de production. Le test d’intégration utilise exclusivement `TestWorkflowEnvironment.createLocal()` du SDK officiel. Sur la machine de validation, il a lancé Temporal CLI `1.8.1` / Server `1.31.2` en mémoire.

## Migrations

Aucune migration I3 n’est ajoutée : la baseline I2 contient déjà toutes les tables et colonnes requises (`mission.temporal_parent_workflow_id`, `run`, `run_config_snapshot`, `outbox`, `inbox`). Ajouter une migration vide ou un second modèle aurait contredit `02-domain-sqlite.md`. Les tests de migration existants couvrent toujours une base neuve, le redémarrage idempotent, les checksums immuables et l’application ordonnée de migrations multiples; I3 teste ses transactions sur une base créée par cette chaîne.

## Tension documentaire et limite retenue

`03-temporal.md` décrit le contrat cible où le parent `MissionWorkflow` démarre un `RunWorkflow` child. Le mandat I3 demande la démonstration minimale de `MissionWorkflow` tout en interdisant providers, pipeline et configuration complète. I3 persiste donc dès maintenant le `runId`, le snapshot et `run/<runId>`, mais ne démarre pas encore un child fictif et ne produit aucun effet provider. Le child devient la prochaine extension compatible quand une vraie exécution provider sera autorisée.

Le namespace officiel du produit reste `nodra`. Le serveur de test isolé utilise son namespace `default` auto-provisionné; ce choix est limité au harness et ne modifie pas la configuration de production.

## Preuves

- application : priorités d’erreurs, barrière `RUNTIME_UNHEALTHY`, publication après acceptation seulement, crash au checkpoint et reconciliation explicite ;
- SQLite : transaction complète, rollback sur commande dupliquée, snapshot/run/outbox atomiques et inbox anti-doublon ;
- Temporal officiel : premier dispatch, redispatch vide après succès, crash après start avant `published_at`, reprise avec le même run ID Temporal, inbox sans second effet, redémarrage worker et `Worker.runReplayHistory` ;
- API/CLI : start refusé sans runtime, lectures/health conservées, dispatch non publié et reconcile borné ;
- architecture : aucun import Temporal dans domain/application et aucun import I/O ou global non déterministe dans les Workflows.

Validation finale avant commit :

- `npm run lint` : réussi ;
- `npm run typecheck` : réussi ;
- `npm test` : 13 fichiers et 51 tests réussis, dont le serveur Temporal officiel, la reprise et le replay ;
- `npm run build` : les six workspaces construits, worker inclus ;
- `npm run db:setup -- <base-neuve>` : baseline version 1 enregistrée, checksum `1ac7d977d11e5a1631aaf8e29836b9efbb42dd9d348c68a6d67109a8f38a471d`, FK et WAL valides ;
- second `db:setup` : aucune migration réappliquée ;
- smoke CLI sans provider : health `degraded`, SQLite `ok`, création humaine persistée et reconciliation vide ;
- smoke API construit : écoute loopback et `/health` lisible avec Temporal indisponible explicite ;
- `git diff --check` : réussi.

## Prochaine tranche

I4 peut ajouter preuves/gates sans modifier ce protocole. Le vrai `RunWorkflow` child, les appels provider et la résolution complète de configuration restent différés aux tranches qui les autorisent. Le gestionnaire de binaire, backup et upgrade Temporal reste strictement I10.
