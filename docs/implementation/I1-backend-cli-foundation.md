# I1 — Fondation backend et CLI

Date de validation : 21 juillet 2026

## Suivi

- Tâche DevFlow : `85a0303a-d8e6-4bd3-8693-8cea76fb3ca2`
- Thread : `019f8609-0360-7e30-8c46-871f7dc5eff0`
- Fondation : `f42e39d feat: bootstrap executable Nodra backend`
- Correctif de revue : `ffc1467 fix: enforce immutable migration checksums`
- Périmètre effectif : backend et CLI uniquement. Le titre historique de la tâche mentionne une UI, mais aucune UI n'a été livrée ni conservée dans cette tranche.

## Livré

### Architecture exécutable

Le monorepo TypeScript strict contient cinq workspaces :

- `packages/domain` : modèle métier initial de mission, sans dépendance vers les couches externes ;
- `packages/application` : cas d'usage et ports, dont le port d'orchestration ;
- `packages/adapters` : persistance SQLite/Drizzle et migrations ;
- `apps/api` : API NestJS et endpoint de santé ;
- `apps/cli` : commandes locales utilisant les mêmes cas d'usage que l'API.

Les tests d'architecture empêchent les dépendances interdites entre couches, les fichiers contenant plusieurs classes principales et la logique métier dans les barrel files.

### Données

- SQLite transactionnel avec Drizzle ORM ; le SQL manuel reste limité aux migrations, contraintes, triggers et FTS qui le nécessitent.
- Baseline du schéma métier documenté, avec clés étrangères actives et journal WAL.
- Registre Nodra `schema_migration` en complément du journal interne Drizzle.
- Catalogue de migrations construit depuis `meta/_journal.json`, dans un ordre déterministe.
- Checksum d'une migration appliquée immuable : un fichier modifié ou manquant bloque le démarrage avant mutation du registre.
- Support de plusieurs migrations et enregistrement des seules nouvelles versions.
- Script `db:setup` idempotent et vérification des tables, triggers et réglages SQLite attendus.

### Fonctionnel disponible

- Création d'une mission humaine en état `DRAFT`, sans lancement automatique.
- Persistance de la mission dans SQLite.
- Santé Nodra accessible depuis NestJS et la CLI.
- État de santé explicite : SQLite actif, orchestration Temporal désactivée, providers désactivés.

Cette tranche pose volontairement les ports sans installer une fausse intégration Temporal, Codex ou Copilot.

## Validation finale indépendante

- `npm run lint` : réussi ;
- `npm run typecheck` : réussi ;
- `npm test` : 7 fichiers et 15 tests réussis ;
- `npm run build` : 5 workspaces construits ;
- `npm run db:setup -- <base temporaire>` : réussi ;
- `npm run cli -- health` : `status: ok` ;
- `npm run cli -- mission:create "Validation finale I1"` : mission humaine persistée en `DRAFT` ;
- `git diff --check` : réussi.

Les tests de migration couvrent une base neuve, le redémarrage idempotent, le refus d'un checksum altéré, le refus d'un fichier manquant et deux migrations ordonnées par le journal Drizzle.

## Éléments différés

- cycle de vie complet des missions et projections du Relais ;
- transactions métier avec événements d'audit et outbox ;
- exécution durable via Temporal derrière le port existant ;
- adapters Codex app-server et Copilot SDK ;
- pipelines, managers, budgets et gates ;
- interface React et cadrage détaillé de ses parcours.

## Prochaine tranche recommandée — I2

Construire verticalement le cycle de vie fiable des missions humaines et sa lecture Relais, toujours en backend et CLI :

1. commandes `create`, `ready`, `complete` et `abandon`, avec transitions métier testées ;
2. lectures `list` et `show`, puis projection Relais des missions prêtes, actives, bloquées et à décider ;
3. concurrence optimiste via la version de mission ;
4. écriture atomique de la mission, de l'événement d'audit et de l'outbox ;
5. exposition par cas d'usage, CLI et endpoints NestJS minces.

Temporal et les providers doivent rester hors d'I2 : la prochaine tranche valide d'abord le cœur métier et transactionnel sur lequel leur orchestration s'appuiera.
