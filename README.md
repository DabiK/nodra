# Nodra / DevFlow Next

Nodra is a local‑first mission‑control platform for orchestrating **agent** and **human** work. It runs coding agents (via [OpenCode](https://opencode.ai) / Codex) inside durable [Temporal](https://temporal.io) workflows, tracks their missions on a live board, chains them into multi‑mission **pipelines**, and lets you delegate to **managers** — meta‑agents that pilot DevFlow through its own CLI.

It is a TypeScript monorepo (npm workspaces) following a hexagonal architecture: `domain` → `application` → `adapters` → apps (`api`, `web`, `worker`, `cli`).

---

## Prerequisites

| Tool | Version | Required for | Notes |
| --- | --- | --- | --- |
| **Node.js** | **≥ 22.12.0** | everything | enforced by `engines`; ships with npm |
| **npm** | ≥ 10 | everything | bundled with Node |
| **git** | any recent | workspaces / worktrees | resolved from `PATH` |
| **Temporal CLI** (`temporal`) | ≥ 1.8 | running agent workflows | provides the local dev server; not needed for pure `build`/`test`/`lint` |
| **OpenCode** (`opencode`) | recent | running agents | the default agent provider; not needed to build or run the UI without agents |

`temporal` and `opencode` are resolved from your `PATH`. Override the exact
binaries with `NODRA_TEMPORAL_BINARY` / `NODRA_OPENCODE_BINARY` if they are not on
`PATH`.

**Supported platforms:** macOS and Linux natively. On **Windows**, use **WSL2**
for the local runtime supervisor — see the [Windows](#windows) section.

---

## Install

```bash
npm install
npm run db:setup   # creates and migrates the local SQLite database
```

The database defaults to `data/nodra.db` (override with `NODRA_DATABASE_FILE`).
The local runtime writes to `data/local/` by default.

---

## Running the app

Nodra has four backend components — **Temporal**, **OpenCode**, the **API**, and
the **worker** — plus the **web** UI. The easiest way to run all four backend
components is the runtime supervisor.

### 1. Start the backend (runtime supervisor — macOS / Linux / WSL2)

```bash
npm run runtime:start    # starts temporal → opencode → api → worker
npm run runtime:status   # health of every component
npm run runtime:logs     # tail component logs
npm run runtime:doctor   # environment diagnostics
npm run runtime:stop     # graceful stop (reverse order)
```

- API health: `http://127.0.0.1:4100/health`
- The supervisor tracks each component as a Unix process group, so it is
  **POSIX‑only** (macOS, Linux, or Windows via WSL2). On native Windows it exits
  with `RUNTIME_PLATFORM_UNSUPPORTED`; start the components manually instead
  (see [Windows](#windows)).

### 2. Start the web UI

```bash
npm run web    # Vite dev server on http://127.0.0.1:5174 (proxies /api → 4100)
```

- Agent chat page: `http://127.0.0.1:5174/agent.html?threadId=<runId>`
- Sidebar sections: **Flux · Tâches** (mission board), **Pipelines**, **Managers**.

### Running components manually (no supervisor)

Every component is a standalone process, which is the path to use on native
Windows or for debugging:

```bash
# Terminal 1 — Temporal dev server
temporal server start-dev --namespace nodra --ip 127.0.0.1 --port 7233 \
  --db-filename data/local/temporal/dev-server.db

# Terminal 2 — OpenCode server (agent provider)
opencode serve --hostname 127.0.0.1 --port 4096

# Terminal 3 — API
npm run dev            # tsx watch, http://127.0.0.1:4100

# Terminal 4 — Worker (Temporal activities/workflows)
npm run worker

# Terminal 5 — Web UI
npm run web
```

---

## CLI

The CLI shares the same use‑cases and SQLite database as the API (it does **not**
go through HTTP). It can create missions, configure agents, drive pipelines and
manage managers.

```bash
npm run cli -- health
npm run cli -- mission:create "Prepare release"
npm run cli -- mission:list
npm run cli -- manager:create "Nova" --instruction "Orchestrate the team"
npm run cli -- --help          # full command reference
```

Dispatching a queued agent workflow requires the runtime to be up:

```bash
npm run cli -- mission:start <mission-id> <version>
npm run cli -- temporal:dispatch
```

---

## Quality gates

```bash
npm run typecheck   # tsc, whole repo
npm run lint        # eslint
npm test            # vitest (unit + integration)
npm run build       # tsc build of every workspace + web bundle
```

All four are cross‑platform (they run natively on Windows, macOS and Linux).

> The two `temporal-envelope.integration.test.ts` cases spin up a real Temporal
> test server and are environment‑sensitive; they may be flaky on a busy machine
> and are unrelated to application logic.

---

## Environment variables

All are optional; sensible defaults are used. See `.env.example` for a copyable
list.

| Variable | Default | Purpose |
| --- | --- | --- |
| `NODRA_DATABASE_FILE` | `data/nodra.db` | SQLite database file |
| `NODRA_DATA_ROOT` | `data/local` | runtime data (workspaces, temporal db, logs) |
| `NODRA_RUNTIME_ROOT` | `<data-root>/runtime` | supervisor manifests and logs |
| `NODRA_RUNTIME_PROFILE` | `user` | `user` or `local` |
| `NODRA_TEMPORAL_ADDRESS` | `127.0.0.1:7233` | Temporal host:port (loopback only) |
| `NODRA_TEMPORAL_NAMESPACE` | `nodra` | Temporal namespace |
| `NODRA_TEMPORAL_BINARY` | resolved from `PATH` | explicit `temporal` binary |
| `NODRA_OPENCODE_URL` | `http://127.0.0.1:4096` | OpenCode server URL |
| `NODRA_OPENCODE_BINARY` | resolved from `PATH` | explicit `opencode` binary |
| `NODRA_OPENCODE_EXECUTION_TIMEOUT_MS` | `300000` | per‑turn agent timeout |
| `NODRA_API_URL` | `http://127.0.0.1:4100` | API base URL (runtime health checks) |
| `NODRA_RUNTIME_STOP_TIMEOUT_MS` | `5000` | grace period before force‑stop |

Environment variables are read directly by Node (`process.env`); no `.env` file
is loaded automatically. Export them in your shell or a process manager.

---

## Project structure

```
packages/
  domain/        Pure aggregates & value objects (Mission, Manager, Id, …)
  application/   Use‑cases + ports (repositories, workflow, provider)
  adapters/      SQLite (Drizzle), Temporal, OpenCode/Codex, git, filesystem
apps/
  api/           NestJS HTTP API (controllers over the use‑cases)
  web/           React + Vite UI (mission board, pipelines, managers, agent chat)
  worker/        Temporal worker (runs workflows & provider activities)
  cli/           Command‑line front‑end over the same use‑cases
scripts/runtime/ Local runtime supervisor (start/stop/status/doctor/logs)
packages/adapters/drizzle/  SQL migrations (append‑only)
```

---

## How it works

- **Missions** have a lifecycle (`DRAFT → READY → ACTIVE → VALIDATION → DONE`,
  plus `BLOCKED`/`ABANDONED`). Agent missions run in a Temporal workflow that
  executes the provider (OpenCode/Codex) in a workspace, streams events, and
  records the result for human validation.
- **Conversations & ids**: each run belongs to a conversation; agent chat pages
  are addressed by a stable `threadId` (the run id). Follow‑up messages reuse the
  same provider session. Assistant messages are persisted as conversation items.
- **Streaming**: provider events are polled by the UI (~1.5 s) and rendered
  incrementally, with a “thinking” indicator while a run is active.
- **Pipelines** chain missions into a DAG with auto/human transition gates and
  handover of the previous step’s result.
- **Managers** are durable meta‑agents (provider, model, thinking level,
  permissions, workspace, plus a system instruction). They hold multiple
  conversations and orchestrate DevFlow by calling its CLI
  (`npm --silent run dev -w @nodra/cli -- …`) from their workspace. The chat
  supports multi‑turn sessions, **emergency stop**, and **conversation deletion**.

---

## Windows

**Status:** the developer commands (`install`, `build`, `typecheck`, `lint`,
`test`, `db:setup`, the CLI against an existing database) run **natively** on
Windows 10/11 in **PowerShell** and `cmd.exe`. The **local runtime supervisor**
(`npm run runtime:*`) is **POSIX‑only** and requires **WSL2** on Windows.

### What works natively (PowerShell / cmd.exe)

```powershell
npm install
npm run db:setup
npm run build
npm run typecheck
npm run lint
npm test
npm run cli -- health
```

`temporal` / `opencode` are resolved from `PATH` honouring `PATHEXT`
(`temporal.exe`, `opencode.cmd`, …). Set `NODRA_TEMPORAL_BINARY` /
`NODRA_OPENCODE_BINARY` if they live outside `PATH`; the native PowerShell
starter uses these overrides too.

### Running the full stack on Windows

The runtime supervisor relies on Unix process groups and the `ps`/`lsof` tools,
which do not exist on native Windows. You have two options:

1. **WSL2 (recommended)** — run everything inside a WSL2 distribution exactly as
   on Linux:
   ```bash
   npm install
   npm run runtime:start
   npm run web
   ```
2. **Native Windows (PowerShell)** — use the bundled starter, which launches
   Temporal, OpenCode, the API and the worker each in their own window (no Unix
   process groups involved):
   ```powershell
   npm run win:start          # backend only
   npm run win:start:web      # backend + web UI (http://127.0.0.1:5174)
   npm run win:stop           # stop everything (by port)
   ```
   Flags: `-Web`, `-SkipTemporal`, `-SkipOpenCode` (e.g.
   `powershell -ExecutionPolicy Bypass -File scripts\windows\start.ps1 -Web -SkipOpenCode`).
   Or start each component manually — see
   [Running components manually](#running-components-manually-no-supervisor).
   The API, worker, web and CLI are all cross‑platform; only the supervisor is
   not.

### Windows notes & limitations

- Do **not** use `npm run runtime:start` on native Windows; it fails fast with
  `RUNTIME_PLATFORM_UNSUPPORTED`. Use WSL2 or manual startup.
- The four `test:e2e:*` scripts set an environment variable inline; they use
  `cross-env` so they work in PowerShell/cmd.
- OpenCode/Temporal must be installed and on `PATH` (or pointed at via the
  `NODRA_*_BINARY` variables).
- Paths shown in the UI are computed server‑side (`GET /api/config`), so no
  absolute path is hardcoded for any OS.
- The repository's Ralph automation/helpers are shell scripts and are
  **WSL2-only on Windows**. Run them from a WSL2 checkout; use the PowerShell
  commands above for the native Windows stack and quality gates.

### Not yet validated on Windows

This audit was performed on macOS. The following still need a real Windows
machine to confirm end‑to‑end: launching Temporal/OpenCode natively, agent runs
that shell out from OpenCode, and git‑worktree workspaces on NTFS. See
`docs/windows-compatibility.md` for the full analysis and remaining items.

---

## Troubleshooting

- **`RUNTIME_PLATFORM_UNSUPPORTED`** — you ran the supervisor on native Windows;
  use WSL2 or start components manually.
- **`temporal`/`opencode` not found** — install them and ensure they are on
  `PATH`, or set `NODRA_TEMPORAL_BINARY` / `NODRA_OPENCODE_BINARY`.
- **API not reaching Temporal** — check `npm run runtime:status` /
  `npm run temporal:health`; the address must be loopback (`127.0.0.1:7233`).
- **Web shows no data** — ensure the API is up on `127.0.0.1:4100` (the Vite dev
  server proxies `/api` there).
- **Ports busy** — Temporal `7233`, OpenCode `4096`, API `4100`, web `5174`.
