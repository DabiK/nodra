# I4 — Preuves structurées, gates et acceptation humaine

Date de validation : 22 juillet 2026

## Périmètre

I4 livre uniquement le backend, l’API et la CLI. Aucun frontend, provider, pipeline, modèle complet de permissions, conversation agent, manager ou packaging runtime n’est ajouté. SQLite reste la vérité métier ; les blobs immuables résident sous le data root configurable par `NODRA_DATA_ROOT`, dans `artifacts/`.

## Contradiction documentaire résolue

Le baseline normatif de `02-domain-sqlite.md` contient les tables I4, mais `approval` n’y porte ni acteur ni commentaire de décision. Le mandat I4 les exige explicitement. La migration Drizzle générée `0001_wakeful_pete_wisdom.sql` ajoute donc `decided_by` et `decision_comment`, sans DDL métier ad hoc ni modification de la baseline déjà appliquée. Toutes les autres structures I4 utilisent les tables du baseline.

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

Les blobs sont adressés par SHA-256 sous `artifacts/<préfixe>/<sha256>`. L’écriture passe par un fichier temporaire borné, `fsync`, puis rename atomique. SQLite ne reçoit que digest, taille, MIME et chemin relatif. La lecture de validation refuse chemin absolu, traversal, symlink escape, taille incohérente, blob absent ou digest corrompu. Un même contenu converge vers le même identifiant et chemin.

## Gates et staleness

`GateDefinition` et son binding mission sont créés dans une transaction et ne sont jamais modifiés. Le registre hexagonal I4 reconnaît uniquement `command-exit@1`, avec critères :

```json
{
  "schemaVersion": 1,
  "expectedExitCode": 0,
  "requiresGit": true
}
```

L’évaluation lie explicitement ses `evidenceIds`. Elle vérifie identité run/mission/attempt, collector et version, schéma, timestamps, workspace, rôles stdout/stderr, digests, intégrité des blobs, exit code et observation Git requise. Un évaluateur inconnu, une déclaration agent seule, un collector incomplet, un dépôt absent ou un blob invalide produit une évaluation `failed` avec rationale stable ; aucun texte agent et aucune heuristique de commande ne sont interprétés.

`refresh-staleness` recalcule la cible via `GitObservationPort`. Toute évaluation `passed` dépendant de Git dont le `subjectDigest` diffère devient `stale` avec `staleAt`. L’historique et les liens de preuve sont conservés. Une gate stale ne satisfait pas l’acceptation.

## Approbations, overrides et delivery

Une approbation cible exactement un run, une mission ou un manager. `pending` ne peut devenir qu’une seule fois `approved`, `denied` ou `expired`. La décision optimiste persiste dans la même transaction état, date, acteur, commentaire et audit. Une course ou une seconde décision retourne `APPROVAL_ALREADY_DECIDED`.

Un override `accept|reject|waive` exige une approbation `approved`, non expirée, ciblant le run ou la mission de l’évaluation, ainsi qu’un commentaire non vide. Il ajoute une ligne `gate_override` et un audit. Il ne modifie pas la ligne `gate_evaluation` historique ; l’état stale/failed original reste visible.

`run_delivery` sépare `agentDeclaration`, `observationSummary`, `resultState` et décision humaine. `declare` fait passer atomiquement une mission agent `ACTIVE` à `VALIDATION`, jamais à `DONE`. `accept` exige, pour chaque binding mission, la dernière évaluation du run `passed`, ou un override explicite `accept|waive`. L’acceptation fait passer `VALIDATION` à `DONE` avec contrôle de version, delivery, Relais et audit dans une transaction. `request-changes` et `reject` restent deux résultats delivery distincts et ramènent la mission à `READY`.

## API et CLI

Routes principales :

- `GET /api/runs/:id/evidence`, `GET /api/evidence/:id` ;
- `POST /api/runs/:id/evidence/collect-command|collect-git` ;
- `POST /api/gates`, `GET /api/gates/:id/evaluations`, `POST /api/gates/bindings/:id/evaluate`, `POST /api/gates/runs/:runId/refresh-staleness`, `POST /api/gates/:evaluationId/override` ;
- `POST /api/approvals`, `GET /api/approvals/:id`, `POST /api/approvals/:id/decide` ;
- `GET /api/runs/:id/delivery`, `POST /api/runs/:id/delivery/declare|accept|request-changes|reject`.

La CLI expose les familles équivalentes `evidence:*`, `gate:*`, `approval:*` et `delivery:*`. Les mutations acceptent `--command-id`; les IDs métier sont produits côté serveur. Les corps REST et flags sont stricts, les erreurs passent par les contrats JSON/problem+json sans fuite SQL, filesystem ou process. `gate:bind-pipeline` et `POST /api/gates/pipeline-bindings` répondent explicitement `CAPABILITY_UNAVAILABLE` jusqu’à I8.

## Preuves automatisées

- application : déclaration distincte d’une observation, registre/version de l’évaluateur, collector inconnu, preuve incomplète et exit structuré ;
- SQLite : FK et run exact, transaction/rollback/audit, evidence immuable, blob absent ou corrompu, décision d’approbation one-shot et concurrente, override refusé puis autorisé, acceptation bloquée puis atomique ;
- filesystem/process/Git : argv sans shell, métacaractères littéraux, cwd escape, symlink escape, timeout avec kill final, cap stdout/stderr, environnement redacted, rename atomique/déduplication, dépôt sale et changement post-collecte stale ;
- API et CLI : parcours `failed → observation structurée → passed → changement Git → stale → approval → override → accept humain` ;
- régression : suite complète I1–I3, reprise, parent/child et replay Temporal conservés.

## Limites et suite I5

Le lancement process est une action locale explicite derrière `CommandObservationPort`. I4 applique seulement les bornes intrinsèques du collecteur ; il ne prétend pas implémenter les grants, presets ou confirmations générales de permissions. I5 devra placer cette action derrière sa policy de permissions complète sans modifier le format de preuve. Il devra aussi formaliser la création/découverte des workspaces ; I4 consomme exclusivement le workspace immuable déjà snapshoté dans le run.

Les évaluateurs supplémentaires devront recevoir un nouvel `evaluatorId` ou une nouvelle version et un schéma de critères explicite. Aucun fallback textuel n’est autorisé. Les bindings pipeline restent réservés à I8.

## Validation finale

- `npm run lint` : réussi ;
- `npm run typecheck` : réussi ;
- `npm test` : 18 fichiers et 65 tests réussis, incluant parent/child, reprise et replay Temporal I3 ;
- `npm run build` : six workspaces construits ;
- `npm run db:setup -- <base-neuve>` : migrations 1 et 2 enregistrées, FK et WAL valides ;
- second `db:setup` sur la même base : aucune migration réappliquée ;
- `git diff --check` : réussi.
