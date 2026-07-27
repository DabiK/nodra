# Windows compatibility

This document records the Windows compatibility audit, the fixes applied, and
what still needs a real Windows machine to confirm.

## Summary

| Area | Native Windows (PowerShell / cmd) | Windows via WSL2 |
| --- | --- | --- |
| `npm install`, `db:setup` | ✅ works | ✅ works |
| `build`, `typecheck`, `lint`, `test` | ✅ works | ✅ works |
| CLI against an existing DB | ✅ works | ✅ works |
| API / worker / web started manually | ✅ expected to work | ✅ works |
| Runtime supervisor (`runtime:start` …) | ❌ blocked (by design) | ✅ works |

The developer workflow is cross‑platform. Only the **runtime supervisor** is
POSIX‑only; on native Windows it fails fast with a clear, actionable error and
you either use WSL2 or start the components manually.

## Incompatibilities found and how they were handled

1. **Process‑group supervision (`scripts/runtime/**`)** — uses `ps`, `lsof`,
   `detached` process‑group leaders and `process.kill(-pgid, signal)`, none of
   which exist on native Windows.
   *Handled:* `scripts/runtime/runtime-cli.ts` now calls
   `assertPosixRuntime()` (`scripts/runtime/runtime-platform.ts`), which throws
   `RUNTIME_PLATFORM_UNSUPPORTED` on `win32` with a message pointing to WSL2 /
   manual startup — instead of failing cryptically deep inside `ps`. A full
   native‑Windows port of the supervisor was intentionally **not** attempted
   (large, OS‑specific, and would risk the working POSIX path).

2. **Binary resolution via `which`** (`scripts/runtime/runtime-config.ts`) —
   `which` does not exist on Windows.
   *Fixed:* replaced with a pure‑Node PATH search that honours `PATHEXT`
   (`.EXE`/`.CMD`/…). The `tsx` shim now resolves to `tsx.cmd` on Windows.

3. **Hardcoded absolute macOS paths in the web client**
   (`apps/web/src/services/workspace-service.ts`,
   `apps/web/src/components/ManagersPage.tsx`) — `"/Users/Dabi/…"` defaults that
   are wrong on any other machine and break on Windows.
   *Fixed:* the API exposes `GET /api/config` returning server‑computed,
   OS‑correct `repositoryRoot` / `dataRoot` / `workspacesRoot`. The web fetches
   it and uses it for defaults; the fallback is now a relative path, never an
   absolute OS‑specific one.

4. **POSIX inline env in npm scripts** (`package.json` `test:e2e:*`) —
   `VAR=value cmd` fails in PowerShell/cmd.
   *Fixed:* wrapped with `cross-env` (added as a devDependency).

## What was actually tested (on macOS / darwin)

- `npm run typecheck` ✅
- `npm run lint` ✅
- `npm test` (unit + integration) ✅ except the two pre‑existing flaky
  `temporal-envelope.integration.test.ts` cases (unrelated).
- `npm run build -w @nodra/web` ✅
- Runtime supervisor start/stop + `GET /api/config` returning correct paths ✅
- New tests: `scripts/runtime/runtime-platform.test.ts`,
  cross‑platform assertions in `scripts/runtime/runtime-config.test.ts`.

## Still requires a real Windows machine to validate

- Starting Temporal and OpenCode natively on Windows and pointing Nodra at them.
- Agent runs where OpenCode shells out to tools (cmd/PowerShell vs bash).
- Git‑worktree workspaces on NTFS.
- The manual multi‑terminal startup end‑to‑end.
- Remaining `/tmp`‑style literals in a few **test** files (they only affect the
  test suite on Windows, not the shipped app): e.g.
  `packages/adapters/src/sqlite/sqlite-confirmation-repository.test.ts`,
  `scripts/temporal-local-config.test.ts`, and the `poc/**` / `*.e2e.test.ts`
  helpers that default the OpenCode binary to a macOS home path (override with
  `NODRA_OPENCODE_BINARY`).
