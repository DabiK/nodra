# 06 — API NestJS/Express, streaming et contrats clients

NestJS utilise `NestExpressApplication`; REST/JSON valide les DTO à la frontière (schémas stricts) et renvoie `application/problem+json` : `{type,title,status,code,detail,commandId}`. UI React/Vite et CLI appellent les mêmes use cases, jamais un repository.

| Endpoint | Commande / réponse |
| --- | --- |
| `POST /api/missions` | créer titre seul; `201 Mission` |
| `GET` / `PUT /api/missions/:id/agent-config` | lire/modifier configuration mutable avec `If-Match` version; 404/409 pour mission humaine/active |
| `POST /api/missions/:id/agent-config/preview` | résolution pure avec provenance, capacités et erreurs; aucun run/provider |
| `POST /api/missions/:id/start` | start explicite, `202 {commandId,workflowId?}` |
| `POST /api/missions/:id/approve` | confirmation portée/cible, `202` |
| `POST /api/missions/:id/{ready,complete,abandon}` | transitions humaines explicites et auditées |
| `POST /api/missions/:id/dependencies` | créer/supprimer dépendance avec contrôle de cycle |
| `GET` / `POST` / `PUT /api/managers` | manager first-class, configuration, instruction/brief versionnés et supervision |
| `POST /api/managers/:id/start` / `preview` | composition global→instruction→brief, sans fake mission |
| `POST /api/runs/:id/steer` / `cancel` / `retry` | Update/Signal, `202` |
| `GET /api/relay`, `/missions/:id`, `/projects` | projections SQLite |
| `GET /api/runs/:id/events` | SSE `id: sequence`, reprise `Last-Event-ID` |
| `GET /api/runs/:id/config-snapshot` | snapshot immuable complet, secrets redacted |
| `GET /api/conversations/:id/items` / `POST .../items` | historique, queue, steer, ack et pièces jointes |
| `GET /api/pipelines/:id/definitions` / `POST .../publish` / `POST .../runs` | version immutable, lancement et relance ciblée |
| `GET /api/gates/:id/evaluations` / `POST .../override` | critères, preuves, staleness et décision humaine |
| `GET /api/runs/:id/evidence` / `GET .../delivery` / `POST .../delivery/{accept,request-changes}` | preuves, déclaration/observations et acceptation humaine |
| `POST /api/workspaces` / `GET /api/workspaces/:id` / `POST /api/workspaces/:id/snapshots` | créer/lire repo, scratch ou worktree et observer Git sans effet caché |
| `POST /api/workspaces/:id/commit` | commit uniquement si `auto_commit_authorized=true`, sinon `428 CONFIRMATION_REQUIRED` avec demande exacte |
| `POST /api/workspaces/:id/integrate` | intégration toujours précédée d'une confirmation exacte ; aucune intégration automatique |
| `POST /api/workspaces/:id/delete` / `restore` | passage `pending_delete`, contrôle d'absence de run, confirmation consommée, tombstone/restauration |
| `POST /api/confirmations` / `GET /api/confirmations/:id` / `POST .../decide` | demander, afficher et décider une confirmation immuable ; la consommation est interne à l'action protégée |
| `GET /api/efficiency` | durée, tokens, cache, coût, statut d’usage et résultat accepté |
| `POST /api/retention/:id/{delete,restore,purge}` | soft-delete, restauration, puis purge manuelle confirmée des blobs non référencés |
| `GET /api/search?q=` | FTS titres/briefs/messages admis, jamais secrets/logs bruts |
| `GET /api/audit` | historique métier append-only, filtres agrégat/commande |
| `POST /api/relay/:id/{read,snooze,resolve}` | état d'attention persistant |
| `GET /api/providers/capabilities` | snapshot réel par provider |
| `POST /api/runtime/temporal/{start,stop,update}` | confirmation sensible, état superviseur |

La prévisualisation répond `{resolved, provenance, requested, capabilities, blockingErrors}`. Chaque valeur de `resolved` porte `project|mission|launch`; provider/modèle/réflexion, permissions, budget, workspace, MCP et attachments sont inspectables avant le bouton Lancer. L'UI affiche un résumé contrôlable et le diff avec le défaut projet, jamais une valeur secrète. Après lancement, la vue d'audit montre uniquement le snapshot du run, ses digests et l'origine historique — pas la configuration mutable actuelle. SSE est un canal de projection : événements persistés `provider_event` ou domaine, jamais la source d'une commande. Message : `{id,type,occurredAt,aggregateId,sequence,payload}`. Reconnexion relit SQLite depuis sequence; si gap purgé, client recharge l'endpoint ressource. Auth absente en V1, mais bind loopback, Origin contrôlé et token local éphémère de CLI pour éviter un autre processus local non autorisé.

Erreurs : `MISSION_VERSION_CONFLICT` 409; `AGENT_CONFIG_REQUIRED` 422; `AGENT_CONFIG_LOCKED` 409; `CONFIG_SCHEMA_UNSUPPORTED` 422; `CONFIG_RESOLUTION_FAILED` 422; `TRANSITION_FORBIDDEN` 409; `CONFIRMATION_REQUIRED` 428; `CONFIRMATION_EXPIRED` 409; `CONFIRMATION_TARGET_MISMATCH` 409; `WORKSPACE_ACTIVE_RUN` 409; `WORKSPACE_PATH_CONFLICT` 409; `CAPABILITY_UNAVAILABLE` 422; `BUDGET_CONFIRMATION_REQUIRED` 428; `WORKFLOW_UNAVAILABLE` 503; `EVIDENCE_STALE` 409; `RUNTIME_UNHEALTHY` 503. UI expose action suivante et détail progressif; CLI sort code non-zéro stable et JSON optionnel.

Sources : [Nest Express](https://docs.nestjs.com/techniques/performance), [SSE](https://docs.nestjs.com/techniques/server-sent-events), [Validation](https://docs.nestjs.com/techniques/validation).
