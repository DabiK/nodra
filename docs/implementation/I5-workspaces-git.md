# I5 — Workspaces, Git sûr et confirmations exactes

## But et frontière

I5 livre uniquement backend, API et CLI. Elle rend les espaces `repo`, `scratch` et `worktree` explicites, observables et récupérables. Elle ne livre ni provider réel, ni frontend, ni intégration Git automatique, ni purge définitive.

SQLite reste la vérité métier. Les opérations filesystem/Git sont derrière `WorkspacePort`; les use cases application ne dépendent ni de Git, ni de `node:fs`, ni de Drizzle. API Nest et CLI appellent les mêmes use cases.

## Modèle de workspace

| Kind | Création | Répertoire Git | Destruction |
| --- | --- | --- | --- |
| `repo` | découvre un dépôt existant, chemin canonique | oui | jamais supprimé par I5 |
| `scratch` | crée un répertoire Nodra géré et vide | non, sauf initialisation explicite future | tombstone, pas de purge |
| `worktree` | crée un worktree Git isolé depuis un `repository` et un `base_ref` | oui | tombstone après confirmation exacte |

Un chemin est résolu par `realpath` avant persistance. Création et observation refusent traversal, symlink escape, dépôt en dehors du workspace demandé et chemin déjà existant : I5 n'écrase jamais un dossier. `workspace_repository` conserve l'identité du dépôt, `base_ref`, `head_ref`, la branche et la cible d'intégration. Chaque effet Git écrit un `workspace_git_snapshot` avant et après l'action avec `reason`, HEAD, digest de contenu et branche.

États : `ready → in_use → ready`; `ready → pending_delete → deleted`. `deleted` est un tombstone restaurable. Une suppression exige `pending_delete`, aucune exécution active associée et une confirmation consommée; l'Activity est idempotente. Aucune branche, aucun worktree et aucun fichier n'est purgé automatiquement.

## Confirmation vs approval

`approval` reste une décision métier (gate override, création de manager, budget). `confirmation` autorise une opération externe précise. Une confirmation est une ligne immuable sauf transitions d'état :

```text
pending → approved | denied | expired
approved → consumed
```

Elle contient `action`, `target_json` canonique, `target_digest=sha256(target_json)`, `cwd` canonique, `risk`, `provider_id` et `permission_preset` optionnels, le sujet, l'expiration, l'acteur et le commentaire. Elle ne porte ni secret ni wildcard.

La portée est contextuelle, jamais une permission réutilisable :

| Scope | Sujet permis | Consommation |
| --- | --- | --- |
| `once` | exactement un `run_id`, `mission_id` ou `workspace_id` | une seule opération exacte |
| `run` | seulement `run_id` | une seule opération exacte de ce run |
| `mission` | seulement `mission_id` | une seule opération exacte de cette mission |

La décision à `expires_at` ou après passe à `expired` et répond `CONFIRMATION_EXPIRED`. L'exécution protégée relit et consomme dans la même transaction SQLite une ligne `approved`, non expirée, dont action, digest, cwd, scope et sujet correspondent exactement; sinon elle échoue sans I/O avec `CONFIRMATION_REQUIRED` ou `CONFIRMATION_TARGET_MISMATCH`.

## Politique Git V1

| Opération | Condition | Effet permis |
| --- | --- | --- |
| créer worktree | chemin absent et source/base visibles | création isolée, snapshot initial |
| commit | `mission_agent_config.auto_commit_authorized=true`, sinon confirmation exacte `git.commit` | commit dans le workspace seulement |
| intégration | toujours confirmation exacte `git.integrate` | merge/rebase/cherry-pick explicitement choisi, snapshot avant/après |
| push/force | hors I5 sauf contrat ultérieur explicite | aucun fallback |
| supprimer worktree | confirmation `workspace.delete` scope `once`, aucun run actif | Activity idempotente puis tombstone |
| restaurer | utilisateur explicite, cible tombstonée | état restauré sans suppression implicite |

`auto_commit_authorized` est une autorisation explicite choisie dans la configuration de mission; elle n'autorise ni intégration, ni push, ni rebase, ni suppression. L'intégration reste toujours humaine, même après un commit automatique.

## Use cases obligatoires

1. `CreateWorkspace` : valide kind, chemin et source; persiste uniquement après succès adapter; audite et snapshotte.
2. `ReadWorkspace` / `SnapshotWorkspace` : lecture pure, sans mutation Git.
3. `RequestConfirmation` / `DecideConfirmation` : crée puis décide le contrat exact, sans exécuter d'effet externe.
4. `CommitWorkspace` : vérifie workspace, mission et autorisation; consomme une confirmation si l'auto-commit n'est pas autorisé; snapshot avant/après.
5. `IntegrateWorkspace` : exige une confirmation consommée et une cible source/destination exacte; jamais appelé depuis un start ou un succès agent.
6. `DeleteWorkspace` : bloque si run actif; passe `pending_delete`; consomme la confirmation; Activity idempotente; tombstone et audit.
7. `RestoreWorkspace` : restauration explicite d'un tombstone seulement, sans recréer ni effacer de branche implicitement.

Chaque mutation requiert `CommandContext.commandId`, écrit `business_audit_event` dans sa transaction SQLite et est idempotente sur ce commandId. Les Activities ne reçoivent que des identifiants et snapshots persistés, jamais des chemins non validés transmis directement par un client.

## Contrats API et CLI

Les DTO REST et flags CLI sont stricts. Les créations et previews ne lancent aucun provider. Les réponses de confirmation exposent seulement métadonnées, cible canonique et digest; elles ne masquent pas le risque ni ne révèlent de secret.

- `POST /api/workspaces`, `GET /api/workspaces/:id`, `POST /api/workspaces/:id/snapshots`
- `POST /api/confirmations`, `GET /api/confirmations/:id`, `POST /api/confirmations/:id/decide`
- `POST /api/workspaces/:id/commit`, `/integrate`, `/delete`, `/restore`
- CLI équivalente : `workspace:create|show|snapshot|commit|integrate|delete|restore` et `confirmation:request|show|decide`.

`delete`, `commit` sans auto-commit et `integrate` retournent une demande de confirmation explicite plutôt que d'exécuter une action partielle. Les erreurs stables sont : `WORKSPACE_PATH_CONFLICT`, `WORKSPACE_ACTIVE_RUN`, `CONFIRMATION_REQUIRED`, `CONFIRMATION_EXPIRED`, `CONFIRMATION_TARGET_MISMATCH`, `CONFIRMATION_ALREADY_CONSUMED` et `WORKSPACE_STATE_CONFLICT`.

## Tests et définition de fini

- Domaine/application : validations de scope/sujet, canonisation de cible, expiration à la frontière, consommation unique et concurrence.
- SQLite : migration neuve et upgrade, FK/CHECK/index, audit, rollback, commandId idempotent, tombstone/restauration.
- Git/filesystem : repo/scratch/worktree, chemin existant/traversal/symlink refusés, snapshots avant/après, suppression idempotente, run actif bloquant.
- API/CLI : même use case, DTO/flags invalides, parcours confirmation → décision → action; aucune I/O avant consommation.
- Régression : lint si script disponible, typecheck, suite de tests complète avec replay Temporal, build, base neuve, restart idempotent, `git diff --check`.

I5 est livrée seulement après un commit local sans push et un worktree propre. Toute capability non prouvée répond explicitement indisponible; aucun provider, pipeline ou frontend ne doit être ajouté.
