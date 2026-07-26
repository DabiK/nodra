# I11 — Pipeline minimal progress

Date: 2026-07-26

## Goal

Implement a minimal pipeline vertical slice so existing missions can be composed and executed in order through the current Nodra runtime.

## Scope

- [ ] Define the minimal pipeline domain model and state transitions.
- [x] Persist pipeline definitions, nodes and runs in SQLite/Drizzle.
- [x] Add application use cases for create/read/start pipeline.
- [x] Execute a simple linear pipeline by starting mission nodes through existing mission/run/Temporal machinery.
- [x] Expose a minimal CLI surface for pipeline creation, inspection and start.
- [x] Add focused tests proving mission composition and execution ordering.
- [ ] Keep managers, advanced routers, budgets and UI out of I11 unless required by the minimal vertical slice.

## Implementation Log

- [x] Created this progress checklist before code changes.
- [x] Read current mission/run/workflow code and docs.
- [x] Decide exact minimal schema.
- [x] Implement persistence.
- [x] Implement use cases.
- [x] Implement CLI surface.
- [x] Implement API surface.
- [x] Run validation commands.

## Acceptance Criteria

- [x] A user can create a pipeline with at least two mission nodes.
- [x] A user can start the pipeline explicitly.
- [x] The second mission does not start before the first reaches a terminal/accepted state chosen for I11.
- [x] Pipeline state is queryable from CLI.
- [x] Pipeline state is queryable from API.
- [x] Existing mission start behavior remains unchanged.
- [x] `npm run typecheck` passes.
- [x] `npm run lint` passes.
- [x] Focused pipeline repository tests pass.
- [x] Focused pipeline API tests pass.

## Current Status

- CLI and repository vertical slice is working for existing human missions.
- Pipeline progression is explicit through `pipeline:advance`.
- Agent missions can be auto-started when a node becomes ready; human missions wait for manual completion.
- API endpoints are implemented for create/show/start/advance/show-run.

## Open Decisions

- [x] I11 gate between nodes: use human accepted `DONE` for automatic progression. `VALIDATION` blocks the next node and surfaces the pipeline as waiting on human decision.
- [x] I11 pipeline nodes reference existing missions only. Mission creation from node specs is deferred.
- [x] I11 execution lives in application/SQLite orchestration first. A dedicated Temporal pipeline parent workflow is deferred until the minimal behavior is proven.

## Discovery Notes

- Existing SQLite schema already has `pipeline`, `pipeline_definition`, `pipeline_node`, `pipeline_edge`, `pipeline_run`, `pipeline_node_run`, `handover` and `targeted_retry` tables.
- Existing triggers enforce published definition immutability and pipeline/node definition consistency.
- No application repository/use case/CLI/API currently uses the pipeline schema.
- Existing `StartMission` already provides the safe way to create mission runs and outbox entries.
- I11 should therefore add the smallest orchestration layer around existing missions instead of creating a new Temporal workflow immediately.

## Arbitrary Edge Extension

- [x] CLI accepts `--edge <from-key:to-key>` on `pipeline:create`.
- [x] API accepts `edges: [{ fromNodeKey, toNodeKey }]` on `POST /api/pipelines`.
- [x] Missing edges still default to linear order for backward-compatible minimal usage.
- [x] Join nodes wait for all predecessor node runs to become `completed` before becoming `ready`.
- [x] Focused tests cover `A + B + C -> D`.
