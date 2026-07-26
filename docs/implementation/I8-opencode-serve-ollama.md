# I8 — OpenCode Serve, registre providers et test local

## Contrat et frontière

Nodra expose deux adapters enregistrés par `ProviderRegistry`, `codex` et
`opencode`. Le registre résout exactement le `providerId` du snapshot/run.
Provider absent ou indisponible produit `CAPABILITY_UNAVAILABLE`; aucun
fallback n'existe.

OpenCode est le seul ProviderPort Nodra livré par I8. Pour le test gratuit,
Ollama est uniquement un fournisseur de modèle interne à OpenCode Serve. Le
catalogue Nodra normalise ses modèles sous la forme
`<provider-interne>/<model-interne>`, par exemple `ollama/gemma3:4b`, tout en
conservant `providerId=opencode`. Il n'existe aucun adapter, port, choix API,
CLI ou UX Nodra nommé Ollama.

`OpenCodeProviderAdapter` est confiné à
`packages/adapters/src/opencode`. Il utilise le SDK officiel
`@opencode-ai/sdk@1.18.5` en mode client-only pour catalogue, sessions,
messages, abort, permissions et SSE. Deux lectures `fetch` restent isolées au
probe pour les endpoints officiels que le client stable n'expose pas :
`/global/health` et `/doc`.

## Probe, compatibilité et capacités

Le probe est explicite :

```bash
npm run cli -- provider:probe opencode --allow-process
```

Il ne lance ni serveur, ni session, ni message. Il vérifie santé/version,
télécharge `/doc`, calcule son digest, vérifie les méthodes/chemins consommés
et transforme `/config/providers` en snapshot catalogue persistant.

Forme certifiée :

- OpenCode Serve `1.18.5` ;
- digest `/doc`
  `f5cb443f0d160fc4b17190f64c2401f199160eb2137ce4e00ca319b99aa34005` ;
- SDK `@opencode-ai/sdk@1.18.5`.

Un digest/version différent reste `compatible_unverified` avec run autorisé si
les primitives nécessaires existent. Seule une primitive absente ou une
réponse indispensable incompatible bloque. La procédure complète est dans
[OPENCODE_CONTRACT_UPGRADE.md](../../OPENCODE_CONTRACT_UPGRADE.md).

I8 prouve `start`, événements SSE, reprise de session, abort et interception de
permission documentée. `steer`, attachments, MCP et usage restent indisponibles
avec une raison explicite : aucune sémantique non documentée n'est inventée.

## Mapping et persistance

L'adapter souscrit `/event` avant d'envoyer `prompt_async`, filtre par session,
persiste les événements bruts sous `opencode/<type>` et projette les événements
Nodra `provider/executionStarted`, `provider/assistantMessage` et
`provider/executionCompleted`. À `session.idle`, il relit les messages
persistants de la session et conserve le dernier résultat assistant.

Une `permission.updated` devient une confirmation Nodra exacte. La décision
générique `approved|denied` est traduite exclusivement dans l'adapter en
`once|reject`. Une permission inconnue ne reçoit jamais d'acceptation
automatique.

Le terminal `SUCCEEDED` place le run en `SUCCEEDED` et la mission en
`VALIDATION`; il ne l'accepte jamais.

## Processus manuel isolé

Le serveur n'est jamais installé, lancé ou supervisé par health, preview, start
normal ou probe. I10 conserve cette responsabilité. Pour un test manuel,
utiliser un root temporaire :

```bash
export NODRA_I8_ROOT="$(mktemp -d /tmp/nodra-i8-manual.XXXXXX)"
export NODRA_I8_PORT="<port-libre>"
export NODRA_OPENCODE_URL="http://127.0.0.1:$NODRA_I8_PORT"
export NODRA_DATABASE_FILE="$NODRA_I8_ROOT/nodra.db"
export NODRA_DATA_ROOT="$NODRA_I8_ROOT/nodra-data"
```

Le fichier `$NODRA_I8_ROOT/opencode.json` contient seulement :

```json
{
  "$schema": "https://opencode.ai/config.json",
  "model": "ollama/gemma3:4b",
  "enabled_providers": ["ollama"],
  "provider": {
    "ollama": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Ollama local isolated I8",
      "options": { "baseURL": "http://127.0.0.1:11434/v1" },
      "models": { "gemma3:4b": { "name": "Gemma 3 4B" } }
    }
  }
}
```

Lancer le binaire résolu par chemin absolu avec `HOME`, les trois répertoires
XDG, `OPENCODE_CONFIG` et `OPENCODE_CONFIG_DIR` dirigés vers ce root :

```bash
/chemin/absolu/opencode serve \
  --hostname 127.0.0.1 \
  --port "$NODRA_I8_PORT" \
  --pure \
  --print-logs
```

Ces quatre flags ont été confirmés par `opencode serve --help`. Un premier
essai isolé a échoué avec `env: opencode: No such file or directory` parce que
le `PATH` nettoyé ne résolvait plus le binaire ; aucun serveur n'avait alors
démarré. La procédure utilise donc le chemin absolu observé, sans attribuer
l'échec à `--pure`.

Preuve CLI sans tour :

```bash
npm run db:setup -- "$NODRA_DATABASE_FILE"
npm run cli -- provider:probe opencode --allow-process
npm run cli -- provider:status opencode
```

Puis arrêter le serveur, vérifier la fermeture du port et déplacer le root
temporaire à la Corbeille. Ces commandes ne créent aucune session/message.

## Tests

Tests sans modèle :

```bash
npm run test:e2e:i8:deterministic
```

Test réel opt-in, une seule exécution après validations déterministes :

```bash
NODRA_TEST_REAL_OPENCODE_I8=1 npm run test:e2e:i8:opencode
```

Le profil par défaut vérifie OpenCode et Ollama locaux. Le profil Zen explicite
se lance avec `NODRA_I8_INTERNAL_PROFILE=zen`. Dans les deux cas, le harness
crée un HOME/XDG/config temporaires sans hériter de credentials, démarre
Temporal et OpenCode sur des ports loopback libres, exécute API Nodra →
Temporal → OpenCode Serve → modèle interne sélectionné, exige
`NODRA_I8_OPENCODE_OK`, puis ferme API/worker/serveurs et supprime le root dans
un `finally`.

## Résultats observés le 26 juillet 2026

Validation déterministe :

- `npm run test:e2e:i8:deterministic` : vert ;
- `providerId=opencode`, une exécution, 3 événements ;
- run `SUCCEEDED`, mission `VALIDATION` ;
- cleanup API/worker/Temporal/root complet.

Preuve CLI isolée, sans tour :

```bash
env NODRA_OPENCODE_URL=http://127.0.0.1:52798 \
  NODRA_DATABASE_FILE=/tmp/nodra-i8-cli.hxMrCI/nodra.db \
  NODRA_DATA_ROOT=/tmp/nodra-i8-cli.hxMrCI/nodra-data \
  npm run cli -- provider:probe opencode --allow-process

env NODRA_OPENCODE_URL=http://127.0.0.1:52798 \
  NODRA_DATABASE_FILE=/tmp/nodra-i8-cli.hxMrCI/nodra.db \
  NODRA_DATA_ROOT=/tmp/nodra-i8-cli.hxMrCI/nodra-data \
  npm run cli -- provider:status opencode
```

Le snapshot unique était `ready/certified`, OpenCode `1.18.5`, digest attendu,
catalogue limité à `ollama/gemma3:4b`. SQLite contenait un snapshot, zéro run
et zéro événement provider ; `GET /session` rendait `[]`. Le port `52798` a
ensuite refusé la connexion et le root a été déplacé à la Corbeille.

L'unique E2E réel autorisé a été lancé exactement avec :

```bash
NODRA_TEST_REAL_OPENCODE_I8=1 npm run test:e2e:i8:opencode
```

Il a échoué après `127,6 s` par timeout avant un run `SUCCEEDED`; le cleanup a
fermé worker/API/Temporal/OpenCode et supprimé le root. Aucun second essai n'a
été effectué.

La primitive locale manquante est observée sans appel modèle :

```bash
curl http://127.0.0.1:11434/api/show \
  -d '{"model":"gemma3:4b"}'
```

Ollama `0.30.11` annonce pour `gemma3:4b` seulement `completion` et `vision`,
sans `tools`. En revanche, `/config/providers` d'OpenCode `1.18.5` infère
`capabilities.toolcall=true` pour ce modèle OpenAI-compatible. Le parcours
agent OpenCode requiert donc le tool calling que ce modèle installé ne fournit
pas. Cette incompatibilité modèle/runtime bloque la preuve réelle ; elle ne
transforme pas Ollama en provider Nodra et n'autorise aucun fallback.

Après instruction explicite, un probe isolé sans session ni message a exposé :

- provider interne OpenCode `id=opencode`, nom `OpenCode Zen` ;
- modèle interne `id=deepseek-v4-flash-free`, nom
  `DeepSeek V4 Flash Free` ;
- variante `high` avec `reasoningEffort=high` ;
- `options.apiKey=public`, sans `OPENCODE_API_KEY`, `OPENROUTER_API_KEY`,
  `ANTHROPIC_API_KEY` ou `OPENAI_API_KEY` dans l'environnement isolé.

L'unique E2E additionnel autorisé a ensuite été lancé exactement avec :

```bash
NODRA_TEST_REAL_OPENCODE_I8=1 \
  NODRA_I8_INTERNAL_PROFILE=zen \
  npm run test:e2e:i8:opencode
```

Résultat observé :

- provider Nodra `opencode` ;
- provider/modèle internes OpenCode
  `opencode/deepseek-v4-flash-free`, effort `high` ;
- run `8b4d750d-7a85-4830-bae6-f90fefe10abe` `SUCCEEDED` ;
- mission `9b107887-3101-43d7-bd2a-f8087bad858c` `VALIDATION` ;
- 55 événements provider et marqueur `NODRA_I8_OPENCODE_OK` persisté ;
- worker, API, Temporal, OpenCode Serve et root temporaire nettoyés.

## Limites

I8 ne télécharge, installe, supervise ou package pas OpenCode. Il ne certifie
pas steer/queue, attachments, MCP, usage, frontend React ni un moteur de modèle
comme provider Nodra. Il ne touche pas aux credentials utilisateur et
n'utilise ni Copilot, OpenRouter, abonnement ou clé externe. Zen et DeepSeek
restent exclusivement des choix internes au catalogue OpenCode ; Nodra
conserve uniquement `providerId=opencode`.
