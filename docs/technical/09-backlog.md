# 09 — Backlog vertical avant implémentation

1. **Foundation local** — data root, config, schéma Drizzle SQLite, migrations générées + patches SQL ciblés, Nest Express/CLI, React shell; critères : base neuve, drift DDL/FK/scénarios verts, aucune action agent.
2. **Mission humaine** — FSM, Relais, projet/scratch, API/CLI; critères : titre seul, fermeture sans run.
3. **Temporal envelope** — outbox/inbox, supervisor contract, MissionWorkflow test environment; critères : start explicite et crash recovery simulé.
4. **Evidence/Gates** — collecteur command/Git, artefacts digest, approbation; critères : preuve stale refusée.
5. **Workspaces/Git** — repo/scratch/worktree, snapshots et confirmations exactes; critères : aucun écrasement, commit seulement autorisé, aucune intégration/suppression sans confirmation consommée, tombstone restaurable.
6. **Codex** — app-server adapter, capabilities, streaming/cancel/resume; critères : fixture + probe opt-in.
7. **OpenCode** — serveur HTTP/OpenAPI local, événements SSE, sessions et capabilities; critères : aucune sortie CLI parsée et absence explicite de toute capability non prouvée.
8. **Pipelines/manager/budgets** — dependencies, child workflows, policies; critères : retry ciblé et confirmation dépassement.
9. **Packaging/recovery** — runtime temporal, backup/restore/update; critères : matrice OS POC satisfaite.

## Dette technique planifiée — frontière HTTP Nest

La fondation et I2–I5 utilisent encore `@Body() value: unknown` puis des helpers impératifs (`objectBody`, `assertKeys`, conversions manuelles) dans les contrôleurs Nest. Cette validation reste correctement cantonnée à la frontière HTTP et les use cases ne doivent pas être modifiés pour cette dette, mais elle duplique les règles et rend les contrats moins lisibles.

Avant d'étendre substantiellement l'API (providers/pipelines), remplacer ce mécanisme par des DTO par endpoint, classes dédiées et `ValidationPipe` global Nest (`whitelist`, `forbidNonWhitelisted`, transformation explicite). Les DTO portent les validations de forme et d'énumération; les règles métier, autorisations, canonicalisation et contrôles de concurrence restent dans l'application. Ajouter des tests de rejet homogènes `application/problem+json` et supprimer `http-validation.ts` seulement après migration complète.

## Dette technique planifiée — arborescence API par domaine

Les contrôleurs et DTO Nest sont actuellement des fichiers correctement petits, mais concentrés au même niveau dans `apps/api/src/` et `apps/api/src/dto/`. Avant que les surfaces provider, conversation, manager et pipeline ne s'étendent, les regrouper par domaine métier/bounded context : par exemple `missions/`, `runs/`, `workspaces/`, `confirmations/`, `evidence-gates/`, `runtime/` et `providers/`. Chaque dossier contient son contrôleur, ses DTO, ses tests HTTP et son mapping de dépendances local; les filtres transverses, bootstrap et tokens réellement partagés restent à la racine.

Cette dette est un déplacement mécanique sans modification de contrat HTTP, de use case, de base SQLite ni de comportement. La réaliser dans un commit dédié après mise à jour des imports et des tests, avec typecheck, lint, suite complète, build et `git diff --check`.

Chaque tranche inclut migration, API/CLI/UI, tests et observabilité; aucun lot horizontal provider avant les fondamentaux de cohérence.
