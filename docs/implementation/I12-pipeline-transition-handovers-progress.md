# I12 — Pipeline transition modes and handovers progress

Date: 2026-07-26

## Goal

Allow each pipeline transition to run in `auto` or `human` mode, with the mode mutable after a pipeline run starts, and pass aggregated handovers from predecessor nodes to successor nodes.

## Scope

- [x] Store transition mode for pipeline edges, default `auto`.
- [x] Allow changing edge transition mode on a running pipeline.
- [x] Block successor readiness when an incoming edge is `human` until approved.
- [x] Expose transition approval through CLI and API.
- [x] Persist handovers from completed predecessor nodes.
- [x] Aggregate all incoming handovers for join nodes.
- [x] Ensure the successor mission receives the aggregated handover before start.
- [x] Add focused tests for `A+B+C -> D` handover aggregation.
- [x] Add focused tests for switching an already-started pipeline from `auto` to `human`.

## Implementation Log

- [x] Created progress checklist before I12 code changes.
- [x] Inspect existing pipeline schema and decide migration strategy.
- [x] Implement persistence changes.
- [x] Implement use cases/repository behavior.
- [x] Expose CLI/API.
- [x] Validate with tests.

## Decisions

- [x] Transition mode is stored on `pipeline_node.start_mode` for the successor node in I12. A run-level copy can be added later if per-run divergence from definition is required.
- [x] Handover comes from completed predecessor node metadata in I12; richer delivery/assistant-message payloads are deferred.
- [x] Handover injection uses a run-only prompt override in `StartMission`; it does not mutate the mission agent configuration.

## Handover Publishing

- [x] CLI exposes `pipeline:publish-handover <pipeline-run-id> <node-key>`.
- [x] API exposes `POST /api/pipelines/runs/:id/nodes/:nodeKey/publish-handover`.
- [x] Publishing snapshots the latest assistant message for the node mission.
- [x] Publishing is explicit; later conversation messages do not mutate already published handovers.
