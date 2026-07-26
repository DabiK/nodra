# I7 — Mission agent configurable, Temporal et provider

## Parcours livré

Une création `titre seul` produit toujours une mission `human/DRAFT`. Aucun
appel provider, workspace, conversation, run ou outbox d'exécution n'est créé.
Le passage agent est une commande explicite et atomique :

1. `agent-config/enable` vérifie la version mission, transforme uniquement une
   mission `human/DRAFT` en `agent/DRAFT`, crée `mission_agent_config` version
   `0` et écrit l'audit ;
2. `PUT agent-config` remplace la configuration complète avec concurrence
   optimiste (`expectedVersion` ou `If-Match`) ;
3. `preview` appelle le même `ResolveAgentConfig` que `ready` et `start`, sans
   aucune écriture ni I/O provider ;
4. `ready` est refusé tant que la résolution possède une erreur bloquante ;
5. `start` explicite vérifie Temporal, résout la configuration, puis écrit dans
   une transaction la mission `ACTIVE`, la conversation, le run, le snapshot
   immuable, la réservation workspace, l'audit et l'outbox ;
6. le dispatcher démarre `MissionWorkflow`, qui démarre le child
   `RunWorkflow`; l'Activity appelle `ProviderPort` depuis le snapshot ;
7. session, référence de tour, événements et message résultat sont persistés ;
8. un terminal provider `SUCCEEDED` appelle la transition domaine explicite
   `Mission.recordAgentSuccess`, met le run à `SUCCEEDED`, libère le workspace
   et place la mission en `VALIDATION`. Il ne la met jamais `DONE`.

L'acceptation humaine reste le seul chemin de `VALIDATION` vers `DONE`.
Un terminal `FAILED` ou `CANCELLED` place la mission en `BLOCKED`.
La transition de succès exige un résultat déclaré, mais aucune gate n'est
obligatoire pour le scénario agent simple. `submitForValidation` reste le
contrat plus strict des parcours qui possèdent effectivement des gates et des
preuves structurées.

## Modèle de configuration

`mission_agent_config` reste provider-neutral :

```text
providerId
modelId
reasoningEffort
providerOptions { schemaVersion, value }
missionPrompt
permissionPreset
workspaceId
autoCommitAuthorized
integrationTargetRef
version
```

Il n'existe ni `codexPrompt`, ni profil Codex dans le domaine. La migration
`0007` ajoute la version de concurrence et initialise les configurations
existantes à `0`. Elle recrée le trigger SQLite
`mission_config_only_for_agent` après la reconstruction de table.

La configuration est modifiable uniquement en `DRAFT`. `GET` et `preview`
restent lisibles après `READY`; `PUT` répond `AGENT_CONFIG_LOCKED`. Le start
vérifie à nouveau la version résolue dans la transaction de snapshot.

## Résolution et invariants

`ResolveAgentConfig` est l'unique résolveur de preview, passage READY et start.
Il consulte exclusivement le dernier `provider_catalog_snapshot` persistant :

- provider et capacité `start` disponibles ;
- modèle présent ;
- effort présent pour ce modèle ;
- version d'options identique au snapshot ;
- options opaques non vides refusées tant qu'aucun schéma provider n'est
  prouvé ;
- MCP et attachments refusés avec la raison de capability persistée ;
- workspace existant, canonique et `ready`.

Il n'y a ni fallback, ni changement de provider/modèle/effort, ni probe
implicite. `GET` et `preview` ne créent pas de process, thread, turn, session,
run, conversation, outbox, workspace ou probe. La réponse preview contient
`requested`, `resolved`, `provenance`, `capabilities` et `blockingErrors`.

Le workspace est réservé `in_use` dans la transaction de start puis libéré par
l'Activity terminale idempotente. Le snapshot contient le cwd canonique, les
capacités/version du catalogue, le prompt simple mission et les permissions.

## API

- `POST /api/missions/:id/agent-config/enable`
  `{expectedVersion, commandId?}`
- `GET /api/missions/:id/agent-config`
- `PUT /api/missions/:id/agent-config`
  avec `If-Match: "<configVersion>"` ou `expectedVersion`
- `POST /api/missions/:id/agent-config/preview`
- `POST /api/missions/:id/ready`
- `POST /api/missions/:id/start`

Les DTO Nest sont décorés et passent par le `ValidationPipe` global. Les
erreurs stables utilisées sont notamment `AGENT_CONFIG_REQUIRED`,
`AGENT_CONFIG_LOCKED`, `MISSION_VERSION_CONFLICT`,
`CAPABILITY_UNAVAILABLE`, `CONFIG_SCHEMA_UNSUPPORTED`,
`WORKSPACE_STATE_CONFLICT` et `RUNTIME_UNHEALTHY`.

## CLI

```bash
npm run cli -- mission:agent-enable <missionId> <missionVersion>
npm run cli -- mission:agent-show <missionId>
npm run cli -- mission:agent-config <missionId> <configVersion> \
  --provider codex \
  --model gpt-5.4-mini \
  --effort low \
  --prompt "..." \
  --permission read_only \
  --workspace <workspaceId>
npm run cli -- mission:agent-preview <missionId>
npm run cli -- mission:prepare <missionId> <missionVersion>
npm run cli -- mission:start <missionId> <missionVersion>
npm run cli -- temporal:dispatch
```

Options facultatives de configuration : `--auto-commit`,
`--integration-ref`, `--options-version` et `--options-json`. Elles n'exécutent
aucune opération Git.

## Temporal dev et tests

Le test vertical déterministe lance un vrai `temporal server start-dev`, une
API Nest, un SQLite temporaire et un vrai `TemporalMissionWorker`. Le provider
déterministe n'ouvre aucun process provider et ne consomme aucun token :

```bash
NODRA_TEST_I7_TEMPORAL=1 npm run test:e2e:i7
```

Il couvre API → activation → configuration → preview pure → READY → start →
outbox → Temporal parent/child → Activity provider → événements/résultat →
terminal → mission `VALIDATION`, ainsi que l'exécution provider unique et le
cleanup. Les tests standards couvrent en plus mission humaine refusée, snapshot
absent, modèle/effort absents, options non prouvées, config verrouillée,
workspace invalide, preview zéro I/O et Temporal absent. Un test Temporal
déterministe distinct couvre steer immédiat, échec d'Activity puis resume du
même run, et cancel propagé par le parent.

### Test Codex réel opt-in

Ce test utilise le même parcours et le même runtime dev, mais lance un vrai
`codex app-server`, un scratch temporaire, le preset `read_only`, le modèle
`gpt-5.4-mini`, l'effort `low` et le prompt marqueur
`NODRA_I7_CODEX_OK`. Il exige les deux choix explicites suivants :

```bash
NODRA_I7_PROVIDER=codex NODRA_TEST_REAL_CODEX_I7=1 npm run test:e2e:i7:codex
```

Durée attendue : environ 10 à 120 secondes selon le démarrage Temporal et la
latence Codex; le test a un timeout de 120 secondes. Il effectue exactement un
tour Codex. Le `finally` arrête worker et dev server, ferme API/connexions et
supprime le data root temporaire. En cas d'interruption brutale, rechercher un
répertoire `nodra-i7-e2e-*` sous le dossier temporaire macOS avant de le
supprimer manuellement.

L'unique exécution autorisée pour I7 a réussi le 26 juillet 2026 en 10,32 s :
run `SUCCEEDED`, mission `VALIDATION`, 43 événements provider persistés et
marqueur `NODRA_I7_CODEX_OK` présent dans le résultat persistant. Le cleanup du
harness a fermé l'API et le worker, drainé Temporal, arrêté le dev server et
supprimé son data root. Les trois data roots laissés par des essais
déterministes interrompus avant cette exécution ont été déplacés vers la
Corbeille; aucun répertoire `nodra-i7-e2e-*` ne subsiste sous le dossier
temporaire macOS. Le runtime dev permanent du dépôt sur le port `7233`,
extérieur au harness, n'a pas été arrêté.

## Limites

I7 ne livre pas frontend React, manager, pipeline, budgets, OpenCode,
`ProviderRegistry`, packaging/supervision Temporal I10, MCP/attachments Codex,
options provider non vides ou validation JSON Schema runtime. Le test Codex
réel reste opt-in, coûteux et n'appartient jamais à `npm test`.
