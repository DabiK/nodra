# I10 — Superviseur du runtime local Nodra

Date : 26 juillet 2026

## Périmètre livré

I10 ajoute un superviseur local mono-utilisateur pour SQLite, Temporal,
OpenCode Serve, l'API Nest et le worker Temporal. Il ne télécharge, n'installe,
ne met à jour et ne désinstalle aucun binaire. Il ne lance aucune mission,
session ou requête modèle. Codex app-server reste un processus à la demande de
son adapter et ne devient pas un daemon.

Commandes :

```bash
npm run runtime:start
npm run runtime:status
npm run runtime:doctor
npm run runtime:logs
npm run runtime:stop
```

`runtime:start` et `runtime:stop` sont les commandes uniques de cycle de vie.
`status` et `doctor` écrivent d'abord le rapport JSON complet, puis un résumé
humain. `logs` affiche les cent dernières entrées de chaque log disponible.

## Root et état local

Par défaut :

```text
data/local/
  nodra.db
  temporal/dev-server.db
  runtime/
    runtime-state.json
    runtime.lock
    worker-ready.json
    opencode-local.json       # profil local seulement
    logs/
      temporal.jsonl
      opencode.jsonl
      api.jsonl
      worker.jsonl
```

`runtime-state.json` est écrit par renommage atomique avec permissions
restrictives. Il contient le runtime ID, les roots, la base, le profil, le
namespace, les timestamps et, pour chaque composant, ownership, PID/PGID,
heure de démarrage observée par l'OS, signature SHA-256 de la commande
observée, port/URL, santé et chemin de log. Un PID est persisté immédiatement
après le spawn, avant la boucle de readiness.

Les logs JSONL persistent après `stop`. Le launcher remplace les valeurs des
variables dont le nom ressemble à un secret, token, mot de passe, API key ou
auth, et masque les formes usuelles `key=value`. Le manifest n'enregistre
jamais l'environnement, la configuration provider ou un credential.

## Lifecycle et readiness

Le verrou `runtime.lock` sérialise start/stop. Le démarrage :

1. récupère ou qualifie l'ancien manifest ;
2. crée les roots et applique les migrations SQLite avec l'adapter officiel ;
3. rejoint un Temporal externe sain ou lance le CLI Temporal installé ;
4. rejoint un OpenCode Serve externe sain ou lance son binaire installé ;
5. lance l'API sur loopback et exige santé API + SQLite + namespace Temporal ;
6. lance le worker et attend ses pollers Workflow et Activity sur
   `nodra.workflow`.

Le serveur Temporal local utilise les flags confirmés pour CLI `1.8.1` :

```text
temporal --disable-config-file --disable-config-env server start-dev
  --headless --ip 127.0.0.1 --port <port>
  --namespace <namespace> --db-filename <data-root>/temporal/dev-server.db
```

OpenCode `1.18.5` utilise les flags observés par `opencode serve --help` :

```text
opencode serve --hostname 127.0.0.1 --port <port> --pure --print-logs
```

Le probe supporte le contrat I8 (`/global/health`, `/doc`,
`/config/providers`) et accepte aussi le nouvel endpoint de santé
`/api/health` documenté en amont. Les flags ne sont jamais déduits de ce
contrat HTTP.

Un override occupé mais malsain échoue avec le service en cause. Sans
override, le superviseur essaie le port conventionnel puis choisit un port
loopback libre. Les adresses finales sont conservées dans le manifest et
imprimées par `start`/`status`; elles sont exportées à tous les enfants sous
`NODRA_TEMPORAL_ADDRESS`, `NODRA_TEMPORAL_NAMESPACE`,
`NODRA_OPENCODE_URL`, `NODRA_DATA_ROOT` et `NODRA_DATABASE_FILE`.

Un second `runtime:start` retourne l'état courant lorsque tous les composants
sont prêts : aucun processus n'est dupliqué.

## Ownership et arrêt

Un service déjà sain sur une adresse demandée est `external`. Son PID peut
être affiché lorsqu'il est observable, mais Nodra ne l'arrête jamais. Tous les
processus lancés par Nodra ont un groupe isolé dont le leader est le launcher
enregistré dans le manifest.

Avant tout signal, Nodra relit le processus et exige simultanément :

- le même PID ;
- le même PGID ;
- la même heure de démarrage OS ;
- la même signature de commande.

Une identité absente est déjà arrêtée. Une identité différente devient
`stale` et n'est jamais signalée. Le démarrage archive un ancien manifest
stale sous `runtime-state.stale-<timestamp>.json` après avoir arrêté seulement
ses autres groupes encore validés.

`runtime:stop` traite exactement `API → worker → OpenCode → Temporal`. Il
envoie `SIGTERM` au groupe validé, attend le délai borné, puis envoie
`SIGKILL` uniquement au même groupe dont le leader possède toujours
l'identité validée. Il n'emploie jamais `pkill`, `killall`, une recherche de
port comme cible de kill, un glob ou un PID non attesté. Il ne supprime ni
data, SQLite, store Temporal, artefact, log, configuration utilisateur,
credential ou configuration provider.

Après un crash du superviseur, `runtime:status` recalcule santé et identité.
`runtime:start` rejoint l'état intégralement prêt, arrête les enfants encore
validés d'un boot partiel, archive le manifest stale, puis reprend. Une
signature divergente reste visible et doit être arbitrée par l'utilisateur.

## Profils OpenCode

Le profil se choisit explicitement :

```bash
NODRA_RUNTIME_PROFILE=local npm run runtime:start
NODRA_RUNTIME_PROFILE=user npm run runtime:start
```

`local` écrit uniquement `runtime/opencode-local.json`, sélectionne
`ollama/<NODRA_OPENCODE_LOCAL_MODEL>` (`gemma3:4b` par défaut) et configure
l'URL Ollama loopback. Il ne contient aucune clé. `doctor` appelle
`POST /api/show` sans génération et exige la capacité `tools`. Un modèle sans
tool calling rend le diagnostic rouge et OpenCode non prêt pour les missions
agent, même si OpenCode l'annonce dans son catalogue.

`user` ne fabrique aucun profil ni modèle. OpenCode lit exclusivement sa
configuration utilisateur/provider, ou le fichier déjà choisi par
`OPENCODE_CONFIG`. Cela couvre notamment OpenCode Zen sans que Nodra copie ou
stocke ses credentials. Aucun fallback de profil, modèle ou provider n'existe.

## Doctor sans tour

`runtime:doctor` vérifie :

- Node `>=22.12.0`, Temporal et OpenCode installés ;
- serveur Temporal et namespace configuré ;
- santé et catalogue OpenCode ;
- probe/snapshot provider OpenCode certifié ou compatible ;
- API, SQLite, Temporal vus par l'API ;
- fichier de readiness lié au PID du worker et pollers Temporal ;
- Ollama et tool calling dans le profil `local`.

Le probe OpenCode appelle la commande explicite I8
`provider:probe opencode --allow-process`; il ne crée ni session ni message.
Le probe Codex optionnel est :

```bash
NODRA_DOCTOR_CODEX=1 npm run runtime:doctor
```

Il vérifie binaire/auth/contrat app-server sans thread ni turn. La santé
normale et `runtime:status` ne lancent jamais Codex ou un autre binaire.

## Configuration

| Variable | Rôle |
| --- | --- |
| `NODRA_DATA_ROOT` | données Nodra, défaut `data/local` |
| `NODRA_RUNTIME_ROOT` | manifest/readiness/logs, défaut `<data-root>/runtime` |
| `NODRA_DATABASE_FILE` | SQLite métier |
| `NODRA_RUNTIME_PROFILE` | `local` ou `user`, défaut `user` |
| `NODRA_TEMPORAL_ADDRESS` | override `127.0.0.1:<port>` |
| `NODRA_TEMPORAL_NAMESPACE` | défaut `nodra` |
| `NODRA_OPENCODE_URL` | override HTTP loopback |
| `NODRA_API_URL` | override HTTP loopback |
| `NODRA_TEMPORAL_BINARY` | chemin explicite du CLI installé |
| `NODRA_OPENCODE_BINARY` | chemin explicite du binaire installé |
| `OPENCODE_CONFIG` | configuration choisie par l'utilisateur |
| `NODRA_OLLAMA_URL` | URL loopback du profil local |
| `NODRA_OPENCODE_LOCAL_MODEL` | modèle interne du profil local |
| `NODRA_RUNTIME_STOP_TIMEOUT_MS` | délai SIGTERM borné |

Toutes les adresses supervisées doivent être loopback.

## Tests et limites

Les tests unitaires couvrent config, manifest atomique, lock, archive stale,
PID/PGID/start-time/signature, refus de kill en cas de mismatch, commandes npm
et survie d'un processus `external`.

Le test opt-in :

```bash
npm run test:e2e:i10:runtime
```

utilise les vrais binaires Temporal et OpenCode déjà installés sans LLM. Il
lance Temporal, API et worker, rejoint un OpenCode externe, exécute
status/doctor, persiste un snapshot, stoppe le runtime, vérifie les ports
fermés et l'absence d'identité managed restante, puis prouve que l'externe n'a
pas été tué.

Cette tranche reste un runtime local de développement fondé sur
`temporal server start-dev`. Elle ne le qualifie pas comme distribution
Temporal de production et ne livre ni téléchargement/checksum, packaging
Windows, backend Temporal de production, crash-loop automatique,
backup/restore complet, upgrade/rollback, frontend, manager, pipeline, budget
ou nouveau provider.
