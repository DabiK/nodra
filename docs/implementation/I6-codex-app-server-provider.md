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
  `provider:probe codex --allow-process`, `run:cancel`, `run:resume`,
  `run:steer`.
- Le lancement reste la commande mission existante et exige désormais un
  snapshot de probe compatible pour une mission agent.

Les fixtures JSONL couvrent handshake, modèles, configuration 0.145.0, stream,
usage reçu, terminaison, reprise, steer, interruption et permissions. Les tests
de client couvrent aussi réponse non corrélée, JSON malformé, erreur distante et
arrêt de processus. Le test qui lance le vrai binaire est ignoré sauf si
`NODRA_TEST_REAL_CODEX_PROBE=1`.
