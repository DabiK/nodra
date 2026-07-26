# I4 — Preuves structurées, gates et acceptation humaine

Date de validation : 22 juillet 2026

## Périmètre

I4 livre uniquement le backend, l’API et la CLI. Aucun frontend, provider, pipeline, modèle complet de permissions, conversation agent, manager ou packaging runtime n’est ajouté. SQLite reste la vérité métier ; les blobs immuables résident sous le data root configurable par `NODRA_DATA_ROOT`, dans `artifacts/`.

## Contradiction documentaire résolue

Le baseline normatif de `02-domain-sqlite.md` contient les tables I4, mais `approval` n’y porte ni acteur ni commentaire de décision. Le mandat I4 les exige explicitement. La migration Drizzle générée `0001_wakeful_pete_wisdom.sql` ajoute donc `decided_by` et `decision_comment`, sans DDL métier ad hoc ni modification de la baseline déjà appliquée. Le correctif de revue `0002_boring_ultimates.sql` ajoute l’unicité de `gate_override.approval_id`; le checksum de `0001` reste `034522dbf6cd33aee96f28f47a5144c974b271a9add1052e925c7ea2e34351dc`.

## Contrats de preuve

`evidence` est append-only et liée à un run exact. Une collecte persiste dans `payload_json` un payload `schemaVersion: 1` et répète l’identité utile à la validation : `runId`, `missionId`, `attempt`, `collectorId`, `collectorVersion`, `subjectDigest` et timestamps.

Le collecteur command `nodra.command@1` expose :

- `argv` comme liste passée à `spawn` avec `shell: false` ;
- `cwd` et `workspaceRoot` canoniques, après refus d’un escape réel ou par symlink ;
- environnement minimal d’exécution et vue redacted `{PATH:"[REDACTED]",LANG:"[REDACTED]"}` ;
- `startedAt`, `endedAt`, `exitCode`, `signal`, `timedOut`, `outputTruncated` ;
- `gitBefore` et `gitAfter` quand le snapshot est dans un dépôt Git ;
- `stdoutSha256` et `stderrSha256`, reliés à deux blobs distincts par `evidence_blob`.

Le collecteur Git read-only `nodra.git@1` expose `head`, `treeDigest`, `diffDigest`, `dirty` et `capturedAt`. Le digest de cible couvre HEAD, statut, diff binaire et contenu des fichiers non suivis. Il n’exécute aucune écriture, aucun commit et refuse un dépôt sortant du workspace ou un fichier non suivi symlinké.

Les blobs sont adressés par SHA-256 sous `artifacts/<préfixe>/<sha256>`. L’écriture passe par un fichier temporaire borné et `fsync`, puis une publication atomique sans écrasement par hard-link. En cas de cible concurrente (`EEXIST`, ou `EPERM` avec cible existante), le blob canonique est relu et doit correspondre exactement avant suppression du temporaire. Une cible corrompue n’est jamais écrasée. SQLite ne reçoit que digest, taille, MIME et chemin relatif. La lecture vérifie aussi la correspondance exacte `id ↔ path ↔ sha256`, et refuse chemin absolu, traversal, symlink escape, taille incohérente, blob absent ou digest corrompu.

## Gates et staleness

`GateDefinition` et son binding mission sont créés dans une transaction et ne sont jamais modifiés. Le registre hexagonal I4 reconnaît uniquement `command-exit@1`, avec critères :

```json
{
  "schemaVersion": 1,
  "expectedExitCode": 0,
  "requiresGit": true
}
```

La définition contient aussi un contrat `expectedEvidence` strict :

```json
{
  "schemaVersion": 1,
  "kind": "observation",
  "collectorId": "nodra.command",
  "collectorVersion": "1",
  "requiredBlobRoles": ["stdout", "stderr"],
  "subject": { "type": "git-tree" }
}
```

`subject.type` vaut `git-tree` pour une gate Git ou `content-digest` pour une gate indépendante de Git. Critères et preuves attendues refusent les champs inconnus. Un sujet Git doit être un SHA-256 hexadécimal identique à `gitAfter.treeDigest`; un sujet contenu doit être identique à la fois à `payload.stdoutSha256` et au digest du blob stdout. L’évaluateur sélectionne exactement une preuve conforme ; zéro correspondance, plusieurs correspondances, une preuve supplémentaire, un type/collector/version, un sujet ou des rôles différents échouent explicitement.

L’évaluation lie explicitement ses `evidenceIds`. Elle vérifie identité run/mission/attempt, collector et version, schéma, timestamps, workspace, rôles stdout/stderr, digests, intégrité des blobs, exit code et observation Git requise. Un évaluateur inconnu, une déclaration agent seule, un collector incomplet, un dépôt absent ou un blob invalide produit une évaluation `failed` avec rationale stable ; aucun texte agent et aucune heuristique de commande ne sont interprétés.

`refresh-staleness` recalcule la cible via `GitObservationPort`. Pour chaque binding, seule la dernière évaluation effective du run est considérée, avec un ordre stable `evaluatedAt DESC, id DESC`, identique à celui utilisé par la transaction de delivery. Une ancienne preuve passée ne peut donc pas invalider une preuve de remplacement plus récente et fraîche. Seuls les liens persistés avec le rôle `git-subject`, issus du contrat `expectedEvidence.subject`, participent à la comparaison ; une autre preuve associée ne peut pas rendre la gate stale. Toute dernière évaluation `passed` dépendant de Git dont le `subjectDigest` diffère devient `stale` avec `staleAt`. L’historique et les liens de preuve sont conservés.

## Approbations, overrides et delivery

Une approbation cible exactement un run, une mission ou un manager. `expiresAt` est normalisé en UTC canonique avec `toISOString`; les comparaisons de décision portent sur les instants parsés et la frontière exacte est expirée. `pending` ne peut devenir qu’une seule fois `approved`, `denied` ou `expired`. La décision optimiste persiste dans la même transaction état, date, acteur, commentaire et audit. Une course ou une seconde décision retourne `APPROVAL_ALREADY_DECIDED`.

Un override `accept|reject|waive` exige une approbation `approved`, non expirée, ciblant exactement le run de l’évaluation, de kind exact `gate_override:<evaluationId>`, ainsi qu’un commentaire non vide. L’approbation est consommable une seule fois, garantie par contrôle transactionnel et index SQLite unique. Il ajoute une ligne `gate_override` et un audit sans modifier la ligne `gate_evaluation` historique ; l’état stale/failed original reste visible.

`run_delivery` sépare `agentDeclaration`, `observationSummary`, `resultState` et décision humaine. `declare` fait passer atomiquement une mission agent `ACTIVE` à `VALIDATION`, jamais à `DONE`. Le chemin `accept` appelle obligatoirement `GateFreshnessPort` avant la transaction finale : toute mutation Git postérieure marque l’évaluation `stale` avec un audit propre, retourne `EVIDENCE_STALE` et laisse mission/delivery en `VALIDATION/delivered`. La transaction d’acceptation relit ensuite les dernières évaluations du run et exige chaque gate `passed`, ou un override explicite `accept|waive`, avant de mettre à jour mission, delivery, Relais et audit. `request-changes` et `reject` restent distincts et ramènent la mission à `READY`.

## API et CLI

Routes principales :

- `GET /api/runs/:id/evidence`, `GET /api/evidence/:id` ;
- `POST /api/runs/:id/evidence/collect-command|collect-git` ;
- `POST /api/gates`, `GET /api/gates/:id/evaluations`, `POST /api/gates/bindings/:id/evaluate`, `POST /api/gates/runs/:runId/refresh-staleness`, `POST /api/gates/:evaluationId/override` ;
- `POST /api/approvals`, `GET /api/approvals/:id`, `POST /api/approvals/:id/decide` ;
- `GET /api/runs/:id/delivery`, `POST /api/runs/:id/delivery/declare|accept|request-changes|reject`.

La CLI expose les familles équivalentes `evidence:*`, `gate:*`, `approval:*` et `delivery:*`. Les mutations acceptent `--command-id`; les IDs métier sont produits côté serveur. Les corps REST et flags sont stricts, les erreurs passent par les contrats JSON/problem+json sans fuite SQL, filesystem ou process. `gate:bind-pipeline` et `POST /api/gates/pipeline-bindings` répondent explicitement `CAPABILITY_UNAVAILABLE` jusqu’à I8.

## Preuves automatisées

- application : schémas stricts critères/expected evidence, déclaration distincte d’une observation, sélection exacte, mauvais collector/version/type/rôles, ambiguïté, preuve incomplète et exit structuré ;
- SQLite : FK et run exact, transaction/rollback/audit, evidence immuable, blob absent ou corrompu, expiration UTC avec offsets, décision d’approbation one-shot, mauvais kind/cible, consommation unique et concurrente, accept direct fail-closed après mutation Git ;
- filesystem/process/Git : argv sans shell, métacaractères littéraux, cwd escape, symlink escape, timeout avec kill final, cap stdout/stderr, environnement redacted, publication atomique/déduplication concurrente, cible corrompue non écrasée, dépôt sale et changement post-collecte stale ;
- API et CLI : parcours `failed → observation structurée → passed → changement Git → stale → approval → override → accept humain` ;
- régression : suite complète I1–I3, reprise, parent/child et replay Temporal conservés.

## Limites et suite I5

Le lancement process est une action locale explicite derrière `CommandObservationPort`. I4 applique seulement les bornes intrinsèques du collecteur ; il ne prétend pas implémenter les grants, presets ou confirmations générales de permissions. I5 devra placer cette action derrière sa policy de permissions complète sans modifier le format de preuve. Il devra aussi formaliser la création/découverte des workspaces ; I4 consomme exclusivement le workspace immuable déjà snapshoté dans le run.

Les évaluateurs supplémentaires devront recevoir un nouvel `evaluatorId` ou une nouvelle version et un schéma de critères explicite. Aucun fallback textuel n’est autorisé. Les bindings pipeline restent réservés à I8.

## Validation finale

- `npm run lint` : réussi ;
- `npm run typecheck` : réussi ;
- `npm test` : 18 fichiers et 73 tests réussis, incluant parent/child, reprise et replay Temporal I3 ;
- `npm run build` : six workspaces construits ;
- `npm run db:setup -- <base-neuve>` : versions de migration 1, 2 et 3 (`0000`, `0001`, `0002`) enregistrées, FK et WAL valides ;
- upgrade automatisé depuis une base arrêtée après `0001` vers `0002` : version 3 seule appliquée et index unique de consommation présent ;
- second `db:setup` sur la même base : aucune migration réappliquée ;
- `git diff --check` : réussi.
