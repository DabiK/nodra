# I13 - Task Search And Launch UI Foundation

## Goal

Build the new React task page as a clean port of the old DevFlow task intake UX, wired to the Nodra backend.

This page is the base for:

- searching existing missions;
- creating a task-like mission;
- selecting a project/workspace folder;
- selecting provider, model, reasoning effort, and permissions from the API;
- creating the workspace before the mission is configured;
- launching/starting the mission in a later iteration.

The visual baseline is the old app at:

- `/Users/Dabi/Documents/devflow/api-v2-refactor/apps/web/src/features/tasks/TaskFeature.tsx`
- `/Users/Dabi/Documents/devflow/api-v2-refactor/apps/web/src/styles.css`

Do not import the old `styles.css` wholesale. Reuse the same class vocabulary and visual rules for this page, but keep the new CSS scoped, short, and maintainable.

## UX Contract

The page must feel iso with the old `?page=tasks` screen:

- `create-task-card` as the main intake card;
- `quick-add` for the always-visible title/action row;
- `task-view-chips` for view/status/provider/filter controls;
- `configure-chip` to expand advanced agent/workspace settings;
- `create-details` for expanded task + agent config;
- `filter-row` and grouped mission rows for search results.

The old app's design system tokens should be preserved:

- `DM Sans` body font;
- `Manrope` display/control font;
- paper background `#f5f4ef`;
- panel background `#fcfbf8`;
- ink `#17231d`;
- green `#1f6b4f`;
- lime `#d8ec75`;
- thin grey lines and compact rounded controls.

Avoid changing the whole product style for one page. The implementation should adapt the old components to the new backend, not invent a new visual language.

## Backend Endpoints

Current endpoints used by the page:

- `GET /api/missions`
- `POST /api/missions`
- `GET /api/missions/:id`
- `POST /api/missions/:id/agent-config/enable`
- `PUT /api/missions/:id/agent-config`
- `GET /api/providers/options`
- `POST /api/providers/:providerId/probe`
- `GET /api/folders?path=...`
- `POST /api/workspaces`

Provider options must come from the API, not hardcoded React arrays.

`GET /api/providers/options` returns:

- registered providers from `ProviderRegistry`;
- latest provider catalog snapshot from `ProviderCatalogRepository`;
- all catalogued models, including hidden/deprecated models when the backend has them;
- supported reasoning efforts per model;
- permission presets;
- backend-safe defaults.

If a provider has not been probed yet, the UI must show that state and allow explicit probe via `POST /api/providers/:providerId/probe`.

## Creation Flow

The intended create flow is:

1. User enters title in `quick-add`.
2. User expands config with `configure-chip` when needed.
3. User selects workspace mode:
   - `repo`: existing folder/repo selected by folder browser;
   - `scratch`: new scratch workspace path;
   - `worktree`: later, when source workspace selection is available.
4. UI calls `POST /api/workspaces` first.
5. UI calls `POST /api/missions`.
6. UI calls `POST /api/missions/:id/agent-config/enable`.
7. UI calls `PUT /api/missions/:id/agent-config` using the created workspace id.
8. UI reloads `GET /api/missions`.

The mission config payload must use backend enum values:

- reasoning: `provider_default | minimal | low | medium | high | xhigh`;
- permissions: `read_only | workspace | full_access`;
- provider options: `{ schemaVersion: 1, value: {} }` unless the provider catalog later exposes schema-backed options.

## Frontend Services

Keep `App.tsx` as composition/state only. Network and business flow belong in services:

- `apps/web/src/services/provider-service.ts`
- `apps/web/src/services/mission-service.ts`
- `apps/web/src/services/mission-intake-service.ts`
- `apps/web/src/services/mission-filters.ts`
- `apps/web/src/services/workspace-service.ts`

Do not add large API flows directly to `App.tsx`.

## Search Rules

Mission search is currently client-side over `GET /api/missions`.

Filters:

- text query over title/id;
- mission state;
- execution kind;
- sort by recent/title/state.

Future backend search can replace this, but the UI contract should stay stable.

## Runtime Notes

The web app runs on `5174` to avoid collisions with old DevFlow apps on `5173`.

Open:

```text
http://127.0.0.1:5174/?page=tasks#create
```

The Vite proxy points to runtime API:

```text
http://127.0.0.1:4100
```

If new API endpoints return `404`, restart runtime because `npm run runtime:start` runs the Nest API process from current source at startup.

## Next UI Tasks

- Finish porting old `TaskFeature` layout classes into the new page.
- Add provider probe button/state in the provider picker.
- Make model dropdown searchable or grouped for large OpenCode catalogs.
- Complete folder drawer UX using `GET /api/folders`.
- Add explicit launch action once mission start UX is ready.
