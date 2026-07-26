# I6 — Premier provider réel Codex app-server

## Frontière et orchestration

I6 livre uniquement le backend API/CLI et le worker. `ProviderPort` reste dans
l'application et ne contient que configuration résolue, session externe,
événements, capacités, modèles et demandes de permission provider-neutral.
Tous les noms de méthodes et champs Codex restent dans
`packages/adapters/src/codex`.

Temporal conserve l'enveloppe durable : le workflow mission lance le workflow
run, puis une Activity longue appelle le provider et heartbeate. SQLite reste la
vérité métier pour le snapshot de capacités, la session externe, la référence
du tour, les `provider_event` séquencés et les projections du run. Une erreur de
processus laisse le workflow attendre un signal `resume`; l'Activity suivante
relit la session persistée et utilise `thread/resume`.

## Transport Codex certifié

L'adaptateur lance uniquement :

```text
codex app-server --listen stdio://
```

Le client corrèle les IDs JSON-RPC et lit/écrit une valeur JSON par ligne, sans
en-tête `Content-Length`, WebSocket, `codex exec` ni parsing de sortie CLI.
Après `initialize`, il envoie `initialized`, puis utilise seulement les
méthodes stables couvertes par fixtures.

La première forme certifiée est exactement `codex_cli_rs/0.145.0`. Les types
ont été générés depuis ce binaire avec `codex app-server generate-ts` :

- `approvalPolicy: "on-request"`;
- `approvalsReviewer: "user"`;
- `sandbox: "read-only"|"workspace-write"|"danger-full-access"`;
- `thread/resume` sans `excludeTurns`, absent du schéma généré 0.145.0.

Une autre valeur `initialize.userAgent` devient `compatible_unverified` si le
handshake, `account/read` et `model/list` respectent le sous-contrat consommé.
Le start reste autorisé avec un warning dans le snapshot et dans
`provider_event`. Les propriétés additionnelles et notifications inconnues sont
tolérées. Seule une rupture d'un ID, résultat essentiel, terminal ou contrat de
permission réellement utilisé produit `protocol_incompatible`, échoue le run et
marque le health `incompatible`.

Les notifications sont placées dans une chaîne asynchrone sérialisée avant
l'appel au sink SQLite. Une écriture lente ne peut donc pas laisser une
notification ultérieure obtenir une séquence antérieure. La terminaison vient
exclusivement de `turn/completed`.

## I6.1 — Smoke app-server explicite

Le diagnostic CLI suivant est distinct du domaine mission/run et de
l'orchestration Temporal :

```text
nodra provider:smoke codex --allow-turn --model gpt-5.4-mini --effort low
```

`--allow-turn` est obligatoire car le smoke crée réellement un thread et un
tour Codex. Sans ce flag, aucune méthode de création n'est appelée. Le modèle
est obligatoire; l'effort est optionnel. Toute valeur fournie doit exister dans
le dernier snapshot persistant du probe pour ce modèle, sans fallback. En
l'absence d'effort, le champ app-server est omis et le résultat indique
`provider_default`.

La commande passe par `ProviderPort.execute`, sans mission, run métier,
conversation, agent-config, outbox ou workflow Temporal. Elle crée un dossier
temporaire vide sous `NODRA_DATA_ROOT`, le supprime en sortie et applique le
preset provider-neutral `read_only`. Le prompt demande exactement
`NODRA_SMOKE_OK` et interdit les outils. Une demande de permission ou un
événement d'activité outil fait échouer le diagnostic.

Le smoke attend un terminal provider, exige `SUCCEEDED`, puis vérifie
`NODRA_SMOKE_OK` comme message assistant complet. Sa sortie JSON redacted
contient seulement `provider`, `model`, `effort`, `terminalState`, le message
tronqué et une liste bornée de types d'événements utiles. Les références
externes de thread/tour et les payloads bruts restent en mémoire et ne sont pas
persistés. Une absence de terminal, une rupture de protocole ou un marqueur
incorrect produit une erreur stable et explicite.

## Probe et capacités

Le probe réel exige un opt-in explicite :

```text
nodra provider:probe codex --allow-process
POST /api/providers/codex/probe {"optIn":true}
```

Il effectue seulement handshake, `account/read` sans refresh et `model/list`;
il ne crée ni thread ni turn. Le catalogue conserve la version, le type
d'authentification, les modèles et capacités, jamais l'e-mail de compte, un
token ou une clé.

Le health sépare `availability`, `authentication`, `models` et `contract`.
Il expose aussi un résumé `ready|degraded|unavailable` avec une action
`update_required|authenticate|discover_models|install_or_start_binary`.

`start/events/cancel/resume/steer/permissionInterception` sont disponibles pour
un contrat `certified` ou `compatible_unverified`, authentifié et doté d'au
moins un modèle. Un contrat `incompatible` bloque les nouveaux runs Codex sans
empêcher Nodra de démarrer.
Pièces jointes et MCP restent indisponibles avec une raison explicite.
`usage` reste `none` avec `usage_not_observed_by_explicit_probe`; seul un
événement `thread/tokenUsage/updated` effectivement reçu avec des compteurs
valides fait passer la projection du run à `reported`.

Le health global ne lance jamais de probe ou de processus provider. Il projette
uniquement le dernier snapshot déjà persistant sous une forme provider-neutral :
`ok`, `degraded` ou `unconfigured`, avec `reason` et `action`. Sans snapshot,
il rend `unconfigured/no_explicit_probe`. Un contrat
`compatible_unverified` rend `degraded/update_required`. Cette projection ne
masque pas Temporal : un runtime Temporal absent reste
`workflow.status=error` avec `Temporal runtime is unavailable`.

## Permissions humaines

Les requêtes serveur stables
`item/permissions/requestApproval`,
`item/commandExecution/requestApproval` et
`item/fileChange/requestApproval` deviennent une confirmation Nodra exacte
liée au run, à l'action, à la cible canonique, au digest et au `cwd`. La réponse
JSON-RPC reste bloquée jusqu'à la décision humaine.

Une approbation de profil renvoie seulement les permissions demandées avec la
portée `turn`. Les anciennes demandes commande/fichier renvoient `accept` ou
`decline`. I6 ne produit jamais `acceptForSession` et ne configure jamais un
reviewer automatique.

## API, CLI et validation

- API : `GET /api/providers/capabilities`,
  `GET /api/providers/:providerId/health`,
  `POST /api/providers/:providerId/probe`,
  `POST /api/runs/:id/{cancel,resume,steer}`.
- CLI : `provider:health`, `provider:capabilities`,
  `provider:probe codex --allow-process`,
  `provider:smoke codex --allow-turn --model <modelId> [--effort <effort>]`,
  `run:cancel`, `run:resume`, `run:steer`.
- Le lancement reste la commande mission existante et exige désormais un
  snapshot de probe compatible pour une mission agent.

Les fixtures JSONL couvrent handshake, modèles, configuration 0.145.0, stream,
usage reçu, terminaison, reprise, steer, interruption et permissions. Les tests
de client couvrent aussi réponse non corrélée, JSON malformé, erreur distante et
arrêt de processus. Le test qui lance le vrai binaire est ignoré sauf si
`NODRA_TEST_REAL_CODEX_PROBE=1`.

Le test de tour réel I6.1 est lui aussi ignoré par défaut. Il consomme
volontairement un tour réel `gpt-5.4-mini` avec effort `low` :

```text
NODRA_TEST_REAL_CODEX_TURN=1 npx vitest run apps/cli/src/provider-smoke-real.test.ts
```

Ne pas l'inclure dans une boucle ni une suite CI automatique.
