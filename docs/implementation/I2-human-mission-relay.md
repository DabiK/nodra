# I2 — Cycle de vie des missions humaines et Relais

Date de validation : 22 juillet 2026

## Suivi

- Périmètre effectif : backend, API Nest et CLI uniquement.
- Commit : commit local unique `feat: deliver reliable human mission lifecycle`; son hash final est reporté dans le handoff, car un commit ne peut pas contenir son propre hash.
- Source de vérité : `docs/phase-0/` et `docs/technical/`, relus avant implémentation. Le MVP `api-v2` n'a été ni lu pour conception complémentaire, ni modifié.
- Migration I2 : aucune. Le baseline Drizzle I1 contient déjà `mission`, `relay_item`, `business_audit_event` et `outbox`; créer une migration vide ou un modèle concurrent aurait contredit `02-domain-sqlite.md`.

## Décisions et conformité documentaire

- Une création produit exclusivement une mission `human` en `DRAFT`, avec titre seul et `projectId` facultatif. Elle ne crée ni configuration agent, conversation, session, run, appel provider ou workflow.
- La machine d'états implémente les arcs normatifs de `01-system.md`. I2 expose les commandes humaines `prepare`, `pickup`, `block`, `resume`, `close` et `abandon`. Les arcs agent `READY → ACTIVE`, `ACTIVE → BLOCKED`, `ACTIVE → VALIDATION`, `VALIDATION → DONE` et `VALIDATION → READY` restent couverts dans le domaine, avec résultat déclaré, preuve observée et acceptation humaine séparés, mais ne sont exposés par aucun cas d'usage I2 et ne simulent aucun run.
- `VALIDATION → READY` est présent parce que `01-system.md` le rend normatif sous le libellé « request correction », même si le brief I2 ne le citait pas dans sa liste de transitions.
- Chaque commande acceptée écrit dans une transaction Drizzle unique la version de mission, un `business_audit_event` structuré, un message technique `outbox` et la ligne matérialisée du Relais lorsqu'une file s'applique. Aucun repository n'exécute de SQL métier manuel.
- `expectedVersion` est vérifié avant la règle de transition puis de nouveau dans l'`UPDATE ... WHERE version = expectedVersion`; une commande périmée retourne toujours `MISSION_VERSION_CONFLICT` sans audit, outbox ou projection partielle. Un `commandId` réutilisé n'est pas traité comme un succès idempotent implicite.
- Le Relais renvoie toujours les quatre tableaux `ready`, `active`, `blocked`, `decision_required`, y compris vides. Les états terminaux retirent la mission de la projection active. Les lectures missions et Relais acceptent un filtre projet; la CLI expose aussi le filtre scratch sans projet.
- API et CLI appellent uniquement les cas d'usage. Les contrôleurs/commandes n'importent ni domaine ni adaptateur; les composition roots restent responsables du câblage SQLite.

### Écart documentaire explicite

`docs/technical/09-backlog.md` indique génériquement que chaque tranche inclut une UI, tandis que le mandat I2 interdit explicitement React/Vite et limite le travail au backend/CLI. Aucune UI n'a donc été créée. Cet écart de planification reste à résoudre dans la tranche frontend autorisée; il n'affecte pas les contrats backend définis par `01`, `02`, `05`, `06`, `07` et `08`.

## Fichiers principaux

- Domaine : `packages/domain/src/mission.ts` et ses tests exhaustifs.
- Application : `create-mission.ts`, `change-mission-state.ts`, `list-missions.ts`, `show-mission.ts`, `get-relay.ts` et les ports de `mission-repository.ts`.
- SQLite/Drizzle : `sqlite-mission-repository.ts` pour la transaction métier et `sqlite-mission-read-model.ts` pour les projections.
- CLI : `nodra-cli.ts`, son composition root et ses tests de parcours primaire.
- API : `mission.controller.ts`, `relay.controller.ts`, le filtre `application/problem+json`, le module et les tests REST.
- Architecture : `test/architecture-boundaries.test.ts` vérifie aussi la frontière des adaptateurs entrants.

## Validation

- `npm run lint` : réussi.
- `npm run typecheck` : réussi.
- `npm test` : 8 fichiers, 33 tests réussis.
- `npm run build` : les cinq workspaces construits.
- `npm run db:setup -- <base temporaire neuve>` : réussi, migration baseline enregistrée.
- Second `npm run db:setup` sur la même base : réussi, aucune migration réappliquée.
- Smoke CLI réel sur le build : `DRAFT → READY → ACTIVE → BLOCKED → READY → DONE`, puis `mission:list`, `mission:show` et `relay` réussis.
- `git diff --check` : réussi avant récapitulatif et rejoué dans la validation finale.

Les tests couvrent les transitions autorisées et interdites, les invariants humains/agent, l'absence de runtime agent, l'atomicité mission/audit/outbox/Relais, le rollback, les conflits de version, les lectures et filtres projet/scratch, les quatre files du Relais, les sorties CLI et les erreurs REST normatives.

## Limites et prochaine tranche

- Aucune UI, aucun runtime Temporal, worker, dispatcher outbox, inbox, provider, pipeline, manager, gate Git ou packaging n'est inclus.
- `decision_required` est un bucket valide et vide pour les missions humaines I2; son alimentation dépendra des livraisons/approbations agent futures.
- Les projets sont filtrables et référencés, mais leur découverte/création implicite depuis un dépôt n'appartient pas à cette tranche.
- `npm install --package-lock-only` signale quatre vulnérabilités modérées dans l'arbre de dépendances existant; aucun `audit fix --force` hors périmètre n'a été appliqué.
- Prochaine tranche recommandée par `09-backlog.md` : enveloppe Temporal durable, dispatcher outbox/inbox et tests de reprise, sans déplacer la vérité métier hors SQLite.
