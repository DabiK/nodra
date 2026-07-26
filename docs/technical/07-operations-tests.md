# 07 — Budgets, observabilité, recovery et tests

## Budgets et quotas

`budget_window` V1 contient exactement un plafond global hebdomadaire et un plafond par mission sur sa durée de vie. Le seuil est `confirmable` : il bloque le prochain tour provider, puis une confirmation crée un `budget_override` borné/audité. Aucun hard-cap absolu n'est actif par défaut; il est possible seulement après configuration explicite. `budget_ledger` est append-only; usage provider est marqué `reported`, `estimated` ou `unavailable`. Concurrence : limite globale + project + provider, contrôlée par Activity de réservation idempotente; valeur initiale est une décision propriétaire.

## Observabilité

Logs JSON locaux : `timestamp, level, component, runId, workflowId, activityId, commandId, correlationId, errorCode`; secrets/redaction obligatoire. Métriques : queue latency, workflow/activity retry, run state duration, provider disconnect, budget, proof stale, runtime health, outbox lag. Traces OpenTelemetry corrèlent API → Temporal → Activity; artefacts sont indexés par digest, pas absorbés par les logs. Un écran Diagnostics expose versions, ports, health, derniers crashes et chemins de logs.

## Crash recovery

Au boot : verrou singleton data-root; intégrité SQLite; migrations; supervisor Temporal health; worker; drain outbox; réconciliation runs ouverts; reprise SSE. Si Temporal indisponible : API en lecture, starts bloqués `RUNTIME_UNHEALTHY`, jamais fallback cloud/scheduler. Activity orpheline : heartbeat expiré → retry sécurisé ou `UNKNOWN` + décision. Les effets externes doivent être idempotents ou avoir une compensation/documenter l'ambiguïté; « exactly once » n'est jamais promis hors SQLite.

## Stratégie tests

| Niveau | Cible / preuve |
| --- | --- |
| domaine | transitions, DAG sans cycle, budgets, gates, résolution/provenance de config; pur et exhaustif |
| application | transaction+outbox, snapshot atomique, authorisation/confirmations, conflit version |
| SQLite/Drizzle | schéma TS strict → migration générée → SQLite neuve; FK/index/triggers/FTS, `foreign_key_check`, drift DDL contractuel, WAL/backup restore |
| Temporal | test environment, Signals/Updates/Queries, replay/version patch, timer/retry/cancel, réutilisation snapshot |
| adapters | fixtures JSON-RPC Codex et HTTP/SSE OpenCode, validation options versionnée, capability absence sans fallback |
| intégration | Nest Express REST/SSE/CLI mêmes use cases, SQLite réel + Temporal local isolé |
| e2e | mission humaine sans config, preview sans I/O, héritage/override, audit snapshot, crash/reboot, retry historique vs nouvelle tentative, proof stale |
| sécurité | path traversal, secret redaction, loopback, confirmation scope, MCP distant |
| rétention | conservation indéfinie, tombstone/restauration, purge manuelle confirmée, blob non référencé seulement |
| compatibilité | macOS arm64/x64, Linux x64/arm64, Windows x64; runtime install/update/rollback |

Chaque bug de crash/duplication devient un scénario deterministe de replay. Les tests providers ne dépensent pas de crédits par défaut; une suite contractuelle opt-in est manuelle et produit une preuve.

Le test de drift est obligatoire : une base neuve créée par les migrations Drizzle (et leurs patchs SQL ciblés) doit satisfaire le DDL contractuel et [11-schema-validation.sql](11-schema-validation.sql). Aucun repository ne doit exécuter de DDL métier ad hoc.
