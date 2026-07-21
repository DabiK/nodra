# 08 — Traçabilité PRD → conception, sous-exigences et statut

`covered` = conception/tables/invariants/API/tests définis; `partial` = conception présente mais exige une preuve POC/runtime/provider; `decision-required` = choix produit propriétaire non inventé.

| Sous-exigence | Champs / tables | Invariant | API / événement | Test | Statut |
| --- | --- | --- | --- | --- | --- |
| FR-01.a repo implicite | repository, project_repository | identité stable ≠ chemin | create/discover project | rename/move repo | covered |
| FR-01.b scratch sans projet | project nullable, pipeline.project_id nullable | pipeline scratch valide | POST pipeline | scratch pipeline | covered |
| FR-01.c filtre sans histoire | project_id, relay projection | filtre ne mute pas | GET projects/relay | history unchanged | covered |
| FR-02.a titre seul/todo | mission.execution_kind=human | aucune config/run requis | POST mission | human close | covered |
| FR-02.b agent éditable | mission_agent_config | verrou pendant run | GET/PUT config | ETag conflict | covered |
| FR-03.a aucune I/O lecture | query boundary | GET/preview sans provider | GET/preview | zero run/session | covered |
| FR-03.b start explicite | run + snapshot + outbox | snapshot atomique avant Temporal | POST start | crash between DB/Temporal | covered |
| FR-04 lifecycle humain/agent | mission FSM, run_delivery | agent success ≠ DONE | transition event | all transitions | covered |
| FR-05.a conversation/tentatives | conversation, run | ordre attempts unique | GET conversation | ordered attempts | covered |
| FR-05.b messages/queue/steer | conversation_item/queue | event ≠ conversation history | send/steer/SSE | ack/retry order | covered |
| FR-05.c provider change | conversation.provider | provider manual change → new conversation | create conversation | no cross-provider reuse | covered |
| FR-06.a preuve structurée | evidence/artifact/blob | declaration seule insuffisante | GET evidence | stale digest | covered |
| FR-06.b gates | gate_definition/evaluation/override | evaluator versionné | evaluate/override | expected evidence | covered |
| FR-07 décisions | approval/permission_grant | grant scoped/expirable/consommable | approve/deny | target digest mismatch | covered |
| FR-08 dépendances | mission_dependency/pipeline_edge | acyclique | create dependency | cycle reject | covered |
| FR-09.a pipeline versionné | definition/node/edge | published immutable | publish pipeline | immutable version | covered |
| FR-09.b handover/retry | handover/targeted_retry/node_run | retry historisé, ciblé | retry node | no global replay | covered |
| FR-10.a manager first-class | manager/instruction/brief/conversation/run | manager ≠ mission | manager CRUD/start/preview | instruction version + subject FK | covered |
| FR-10.b supervision/création | manager_supervision/creation_request | autre manager nécessite approval | manager create/approve | denied request | covered |
| FR-11.a prompt manager | app_config, manager_instruction_version, manager_brief, snapshot | global→manager→brief | preview/start | exact composition | covered |
| FR-11.b budgets | budget_window/override/ledger/snapshot | global week + mission lifetime, soft confirmable, override borné | budget preview/approve | block next turn/override audit | covered |
| FR-12 provider/model | config/run columns/capability snapshot | no auto provider switch | preview/start | unavailable model | covered |
| FR-13 dégradation | options schema/capabilities | no simulated capability | 422 capability | absent feature | partial |
| FR-14.a workspace/Git | repository/workspace_repository/snapshots | target visible | workspace/git APIs | worktree tombstone | covered |
| FR-14.b auto-commit | auto_commit_authorized | false by default | config/approval | unauthorized commit | covered |
| FR-15.a MCP | mcp_selection/members | mode non ambigu | preview config | global scratch/default | covered |
| FR-15.b permissions | permission_grant | full-access visible, sensitive action confirmed | approvals | consume once | covered |
| FR-16.a recovery | outbox/inbox/parent-child workflow | replay same snapshot | reconciliation | kill/restart | partial |
| FR-16.b Relais | relay_item | one queue/reason/current state | GET relay/read/snooze | 4 queues mapping | covered |
| FR-16.c efficacité | run usage/delivery | accepted result distinct | GET efficiency | reported/estimated/unavailable | covered |
| NFR-01 local | data root/loopback | no cloud fallback | runtime status | bind only loopback | covered |
| NFR-02 no MVP migration | schema migration | no importer | n/a | no legacy path | covered |
| NFR-03 contract provider | ProviderPort/options schema | protocol not domain | capabilities | adapter contract | covered |
| NFR-04 explicit absence | capability snapshot | unavailable is visible | preview/422 | no fallback | partial |
| NFR-05 no inspection effect | command/query split | reads pure | GET/preview | zero side effect | covered |
| NFR-06 data/secrets local | blob/redaction/search exclusions | secret never snapshot/index | audit/search | redaction | covered |
| NFR-07 transaction/export | Drizzle migrations, SQLite/blob/Temporal backup, outbox/inbox | coordinated manifest + FK contract | backup/restore | base neuve, FK/drift, restore root | partial |
| NFR-08 crash/OS | supervisor/leases | recover or block safely | health/reconcile | OS matrix | partial |
| NFR-09 UX/WCAG | relay/config/audit views | status/provenance accessible | UI contracts | WCAG critical paths | covered |
| NFR-10 concurrence/budget | policies/leases/windows | reservation durable; budget V1 policy fixed | reserve/release | races + weekly/mission windows | covered |
| NFR-11 hexagonal | domain/application/ports; Drizzle confined adapter | no adapter inward dependency | shared API/CLI | architecture + import-boundary test | covered |
| Recherche V1 | search_document FTS | excludes secrets/logs raw | GET /search | scope/index filtering | covered |
| Audit durable | business_audit_event | distinct outbox | GET audit | append-only transition | covered |
| Conservation | retention_policy/tombstone/blob | indefinite; no auto purge; purge only unreferenced blob | delete/restore/purge | retention lifecycle | covered |
| Briefing historique V1 | manager_brief/conversation | Nodra-new only; no DevFlow import/generation | GET brief history | product acceptance | covered |

## Éléments d'efficacité requêtables

`run`/`budget_ledger` doivent exposer, par migration dédiée : `started_at`, `ended_at`, `duration_ms`, `input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_write_tokens`, `cost_micros`, `pricing_snapshot_json`, `usage_kind(reported|estimated|unavailable)`, et joindre `run_delivery.result_state='accepted'`. Le pricing snapshot est versionné et ne corrige jamais rétroactivement l'historique.
