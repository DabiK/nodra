# Nodra — dossier technique (validation implementation-ready bloquée)

Ce dossier spécifie V1 sans code ni POC. Les décisions validées sont normatives; les hypothèses de POC sont explicitement conditionnelles. La validation implementation-ready reste bloquée uniquement par les statuts `partial` de la matrice et leurs preuves POC/compatibilité.

SQLite reste la vérité métier. Drizzle ORM fournit le schéma TypeScript strict et les migrations générées dans l'adaptateur SQLite; le DDL de [02-domain-sqlite.md](02-domain-sqlite.md) reste un contrat normatif et de validation. Les triggers, FTS5, index/contraintes SQLite et PRAGMA sont des patches SQL ciblés, documentés et testés — jamais une implémentation applicative full SQL.

| Document | Sujet |
| --- | --- |
| [01-system.md](01-system.md) | C4, modules, interfaces et états |
| [02-domain-sqlite.md](02-domain-sqlite.md) | ERD, DDL logique, migrations et transactions |
| [03-temporal.md](03-temporal.md) | topologie, mappings et limites Temporal |
| [04-providers-permissions.md](04-providers-permissions.md) | providers, MCP, secrets, Git/worktrees |
| [05-consistency.md](05-consistency.md) | vérité, outbox/inbox, crash et preuve |
| [06-api-ui-cli.md](06-api-ui-cli.md) | API NestJS/Express, SSE et contrats clients |
| [07-operations-tests.md](07-operations-tests.md) | budgets, observabilité et stratégie tests |
| [08-traceability.md](08-traceability.md) | matrice FR/NFR exhaustive |
| [09-backlog.md](09-backlog.md) | backlog vertical |
| [10-adrs.md](10-adrs.md) | ADR à approuver |
| [11-schema-validation.sql](11-schema-validation.sql) | validation SQLite documentaire reproductible |
| [12-packaging-backup-poc.md](12-packaging-backup-poc.md) | runtime, sauvegarde et POC |

## Gate de validation humaine

Figé : Nodra, TS strict, NestJS/Express, React/Vite, SQLite vérité métier, Temporal self-host, Codex app-server, OpenCode server HTTP/OpenAPI, MCP/full-access par défaut avec confirmation sensible. Copilot CLI/SDK est hors V1.

Décisions produit closes : budget global hebdomadaire + mission lifetime confirmables; conservation indéfinie, tombstone/restauration, aucune purge automatique; historique neuf Nodra uniquement et briefing génératif après V1. Le propriétaire conserve seulement le gate de résultat POC Temporal.

Risques POC : distribution Temporal durable multi-OS; compatibilités réelles Codex/OpenCode; sémantique d'annulation d'effets externes. ADR à approuver : ADR-004, ADR-005, ADR-008, ADR-010 à ADR-014 ([10-adrs.md](10-adrs.md)). Aucun POC ne commence avant ce gate.
