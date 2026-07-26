# Mise à niveau du contrat Codex app-server

Ce dépôt certifie une seule forme app-server à la fois. I6 ne sélectionne pas
dynamiquement plusieurs versions et ne tente aucune migration automatique.
La version est un indice, pas un verrou :

- `certified` : version et fixtures connues;
- `compatible_unverified` : autre version, mais le probe du sous-contrat Nodra
  passe; les runs sont autorisés avec warning persistant;
- `incompatible` : un invariant réellement consommé a échoué; les nouveaux runs
  Codex sont bloqués jusqu'à correction.

Une différence de `initialize.userAgent` seule ne bloque jamais. Le health
expose `expectedVersion`, `currentVersion`, le statut, la raison et l'action.
Il vaut `degraded` + `update_required` pour un contrat non certifié ou
incompatible, et `unavailable` seulement lorsque le processus n'est pas
disponible.

## Procédure reproductible

1. Partir d'un worktree propre et relever la version installée :

   ```text
   codex --version
   ```

   Ne lancer ni mission, ni `codex exec`. La lecture de version et la génération
   de schémas ne nécessitent pas de login et ne consomment pas volontairement de
   tokens.

2. Exporter les deux familles d'artefacts dans le dossier ignoré par défaut :

   ```text
   npm run codex:schema:export
   ```

   Pour conserver deux exports côte à côte pendant la revue :

   ```text
   npm run codex:schema:export -- --out .artifacts/codex-app-server-schema-<version>
   ```

   Le script exécute directement, sans shell, `codex app-server generate-ts`
   puis `codex app-server generate-json-schema`. Il ne démarre ni thread ni
   turn. Le dossier `.artifacts/` n'est pas versionné.

3. Comparer l'export avec la version actuellement certifiée
   `codex_cli_rs/0.145.0` et les fixtures de
   `packages/adapters/src/codex/fixtures`. Examiner au minimum :

   - handshake et résultat `initialize`;
   - `account/read`, `model/list`;
   - `ThreadStartParams`, `ThreadResumeParams`, `TurnStartParams`,
     `TurnSteerParams`, `TurnInterruptParams`;
   - notifications de tours/items et terminaison;
   - requêtes/réponses d'approbation;
   - éventuel payload d'usage.

   Le JSON Schema peut valider les messages du transport, mais ne remplace
   jamais le mapping sémantique provider → Nodra, la redaction, la
   sérialisation des événements ou la projection SQLite.

4. Le contrôle I6 est volontairement optimiste. Le probe sans tour valide
   `initialize`, `account/read` et `model/list`. Pendant un run, l'adaptateur
   valide les IDs et réponses de `thread/start|resume`, `turn/start|steer|
   interrupt`, les statuts terminaux et les formes de permissions utilisées.
   Les propriétés additionnelles, notifications inconnues et nouveaux modèles
   sont tolérés et conservés comme données brutes ou warnings lorsqu'utile.
   Une rupture utilisée produit `protocol_incompatible`, préserve les événements,
   échoue le run et marque le health `incompatible`. Un diff structurel
   automatique exhaustif des schémas est reporté à I6.1.

5. Modifier seulement ce qui est prouvé par l'export et une fixture
   déterministe. Mettre à jour l'adaptateur Codex, les fixtures, leurs tests et
   la documentation de forme certifiée. Une capacité absente ou ambiguë reste
   `available=false` avec sa raison. Ne pas ajouter de compatibilité
   multi-version approximative.

6. Les couches `packages/domain` et `packages/application` restent
   provider-neutral : aucun nom de méthode, champ, enum, version ou DTO Codex
   n'y entre. Elles connaissent uniquement `ProviderPort`, capacités, modèles,
   configuration résolue, session externe, événements et demandes de
   permission génériques. Les détails Codex appartiennent à
   `packages/adapters/src/codex` et au wiring API/CLI/worker.

7. Exécuter les contrôles locaux :

   ```text
   npm run typecheck
   npm run lint
   npm test
   npm run build
   git diff --check
   ```

8. Exécuter ensuite seulement le probe réel opt-in, sans mission ni turn :

   ```text
   NODRA_TEST_REAL_CODEX_PROBE=1 npx vitest run packages/adapters/src/codex/codex-provider-adapter.test.ts
   ```

   Vérifier que le probe expose binaire, authentification, modèles, contrat et
   capacités attendus. Il ne faut jamais copier l'e-mail de compte, un token ou
   une clé dans SQLite, un log, une fixture ou un snapshot.

9. Une fois l'export, les fixtures, le mapping et le probe cohérents, remplacer
   la constante de version certifiée, mettre à jour la section « Forme certifiée
   par I6 », relancer tous les contrôles, puis créer un commit local dédié.

## Rollback en cas d'échec

Ne pas changer la version certifiée. Remettre les modifications de
recertification dans un worktree ou commit expérimental séparé, supprimer
uniquement le dossier d'export ciblé sous `.artifacts/`, puis restaurer
l'adaptateur et les fixtures à la dernière révision verte. Le binaire plus
récent restera `compatible_unverified` si les invariants passent, ou
`incompatible` avec les nouveaux runs Codex bloqués si une rupture a été
observée. Réinstaller la version Codex précédemment certifiée si un
fonctionnement local immédiat est nécessaire; ne jamais masquer un invariant
échoué ni effacer les événements qui l'ont établi.
