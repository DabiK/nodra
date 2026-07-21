# 09 — Backlog vertical avant implémentation

1. **Foundation local** — data root, config, schéma Drizzle SQLite, migrations générées + patches SQL ciblés, Nest Express/CLI, React shell; critères : base neuve, drift DDL/FK/scénarios verts, aucune action agent.
2. **Mission humaine** — FSM, Relais, projet/scratch, API/CLI; critères : titre seul, fermeture sans run.
3. **Temporal envelope** — outbox/inbox, supervisor contract, MissionWorkflow test environment; critères : start explicite et crash recovery simulé.
4. **Evidence/Gates** — collecteur command/Git, artefacts digest, approbation; critères : preuve stale refusée.
5. **Workspaces/Git** — repo/worktree, confirmations; critères : aucune intégration ou suppression sans portée visible.
6. **Codex** — app-server adapter, capabilities, streaming/cancel/resume; critères : fixture + probe opt-in.
7. **Copilot** — SDK adapter, steering/queue/MCP; critères : absence explicite de toute capability non prouvée.
8. **Pipelines/manager/budgets** — dependencies, child workflows, policies; critères : retry ciblé et confirmation dépassement.
9. **Packaging/recovery** — runtime temporal, backup/restore/update; critères : matrice OS POC satisfaite.

Chaque tranche inclut migration, API/CLI/UI, tests et observabilité; aucun lot horizontal provider avant les fondamentaux de cohérence.
