# 10 — ADR à approuver

| ADR | Décision | Statut |
| --- | --- | --- |
| ADR-001 | Nodra / DevFlow historique séparés | accepté (validé) |
| ADR-002 | TypeScript strict, NestJS Express, React/Vite | accepté (validé) |
| ADR-003 | SQLite vérité métier + artefacts filesystem | accepté (validé) |
| ADR-004 | Temporal self-host, pas Cloud | accepté sous POC packaging |
| ADR-005 | outbox/inbox SQLite–Temporal | proposé à approuver |
| ADR-006 | Codex app-server et OpenCode server HTTP/OpenAPI; aucun parsing de CLI provider | accepté (validé) |
| ADR-007 | capacités provider, absence visible | accepté (validé) |
| ADR-008 | preuves immuables/digests/staleness | proposé à approuver |
| ADR-009 | MCP/full access par défaut + confirmations | accepté (validé) |
| ADR-010 | data root backup/restore/upgrade atomiques | proposé à approuver |
| ADR-011 | configuration mutable résolue en snapshot de run immuable; retry historique vs nouvelle tentative | proposé à approuver |
| ADR-012 | `MissionWorkflow` parent stable + `RunWorkflow` child par tentative; mappings SQLite distincts | recommandé, à approuver |
| ADR-013 | changement manuel de provider crée une conversation distincte | recommandé, à approuver |
| ADR-014 | FTS SQLite limité au contenu non secret/non-log | recommandé, à approuver |
| ADR-015 | Budgets V1 hebdomadaire global + mission lifetime confirmables; rétention indéfinie sans purge auto; briefing neuf Nodra seulement | accepté (validé) |
| ADR-016 | Drizzle ORM source d'implémentation SQLite; SQL manuel ciblé pour FTS/triggers/index/PRAGMA; DDL contractuel de validation | accepté (validé) |
| ADR-017 | `confirmation` distincte de `approval`, exacte, expirante et consommée une seule fois pour les effets externes sensibles | accepté (validé) |

ADR-004/005/008/010/011/012/013/014 sont les signatures techniques minimales avant POC. ADR-015 est une contrainte produit désormais close. ADR-016 encadre l'implémentation, sans remplacer SQLite ni les validations SQL. ADR-017 fixe le contrat I5 et ne transforme pas les confirmations en permissions implicites.
