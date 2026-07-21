# 03 — Temporal : topologie et mapping

Temporal est un runtime **self-host** local. Namespace : `nodra`; task queues : `nodra.workflow`, `nodra.activity.provider`, `nodra.activity.workspace`, `nodra.activity.evidence`. Un worker TypeScript poll chaque queue; le service et Web UI restent loopback-only.

| Besoin Nodra | Primitive Temporal | Règle |
| --- | --- | --- |
| orchestration d'une mission | `MissionWorkflow` parent | workflowId stable `mission/<missionId>`; ne représente pas une tentative |
| exécution d'une tentative | `RunWorkflow` child | workflowId unique `run/<runId>`; mapping SQLite séparé |
| pipeline/DAG | `PipelineWorkflow` + child workflows | dépendances lues/validées SQLite par Activity |
| start explicite | `start` client | après commit SQLite/outbox |
| décision | `Signal` | fire-and-forget : cancel, steer, approval decision |
| commande avec réponse | `Update` | accept/deny, targeted retry; validator sans I/O |
| état UI | `Query` | lecture seulement, ne modifie rien |
| provider/Git/fs | Activity | I/O, timeout, retry, idempotence |
| attente budget/approval | `condition` + Signal | aucun polling SQLite dans Workflow |

```mermaid
sequenceDiagram
participant U as UI/CLI
participant A as API SQLite
participant T as Temporal
participant W as Workflow
participant X as Activity
U->>A: start mission(commandId)
A->>A: mission READY; outbox StartWorkflow
A-->>U: 202 accepted
A->>T: dispatcher idempotent start
T->>W: MissionWorkflow
W->>X: reserve/start provider
X->>A: transaction run + inbox
X-->>W: ProviderRef
W->>X: stream/persist batches
U->>A: approve / steer
A->>T: signal/update after commit
T->>W: signal/update
W->>X: finish/cancel/observe
```

## Contrat de Workflow

`MissionWorkflow(input: {missionId, commandId, schemaVersion})` est le parent durable, identifié par `mission/<missionId>`; `ManagerWorkflow` suit le même pattern `manager/<managerId>`. Chaque parent démarre `RunWorkflow(input:{runId, snapshotVersion})` comme child unique `run/<runId>`. SQLite porte `mission.temporal_parent_workflow_id` ou `manager.temporal_parent_workflow_id` pour le parent et `run.temporal_workflow_id`/`run.temporal_run_id` pour le child : il n'y a donc plus de contradiction d'unicité. `runId` désigne le snapshot immuable déjà persisté; aucun Workflow ne relit la configuration mutable. Les Activities portent `idempotencyKey = workflowId/activityName/logicalAttempt` et vérifient la même clé dans `inbox`/table cible.

Retries d'Activity et replay de Workflow réutilisent obligatoirement le même `runId` et son snapshot. Une relance demandée depuis la configuration courante crée explicitement `attempt+1`, un nouveau `runId`/snapshot et un nouveau Workflow; l'UI ne l'appelle jamais « reprise ». Erreurs transitoires : backoff borné; erreurs de politique/validation : non retryables. Timeouts : `startToClose`, `scheduleToClose` et heartbeat pour les processus longs. Annulation : Activity heartbeate; `WAIT_CANCELLATION_COMPLETED` est requis pour Git/processus où un effet final peut être ambigu. Les I/O ne vont jamais dans un Workflow : replay et déterminisme l'interdisent.

## Versioning et limites

Toute modification de Workflow vivant passe par `patched()`/`deprecatePatch()` ou par une stratégie de compatibilité validée; le POC teste replay après upgrade. Temporal n'est pas la vérité des missions, ne remplace pas Git, les adaptateurs, les observations ni l'acceptation humaine. Ses historiques ne sont jamais réécrits pour corriger SQLite.

Sources : [Temporal TypeScript](https://docs.temporal.io/develop/typescript), [concepts Workflows](https://docs.temporal.io/workflow-execution), [service OSS](https://github.com/temporalio/temporal).
