// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { duplicateMission, showMission } from "./mission-service";
import type { AgentConfigView, MissionView } from "../types";

afterEach(() => vi.restoreAllMocks());

/** Mock fetch en dispatchant sur URL + méthode, avec des réponses JSON. */
function stubFetch(routes: Array<{ match: RegExp; method?: string; response: unknown }>) {
  const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    const route = routes.find((item) =>
      item.match.test(url) && (!item.method || (init?.method ?? "GET") === item.method)
    );
    if (!route) return Promise.reject(new Error(`mock: aucun route pour ${init?.method ?? "GET"} ${url}`));
    return Promise.resolve(new Response(JSON.stringify(route.response), {
      status: 200,
      headers: { "content-type": "application/json" }
    }));
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const sourceConfig: AgentConfigView = {
  missionId: "m1",
  version: 3,
  providerId: "opencode",
  modelId: "model-a",
  reasoningEffort: "high",
  providerOptions: { schemaVersion: 1, value: { some: "option" } },
  missionPrompt: "Refactorise le module auth.",
  permissionPreset: "workspace",
  workspaceId: "ws-1",
  autoCommitAuthorized: true,
  integrationTargetRef: "refs/heads/main",
  updatedAt: "2026-08-03T08:00:00Z"
};

describe("mission service — duplicateMission (rejouer un run)", () => {
  it("duplique avec les mêmes réglages, le modèle choisi, en READY", async () => {
    const created: MissionView = {
      id: "m2", projectId: null, title: "Refactorise le module auth.",
      executionKind: "human", state: "DRAFT", version: 0,
      createdAt: "2026-08-03T09:00:00Z", updatedAt: "2026-08-03T09:00:00Z",
      runState: null, runStartedAt: null, lastAssistantMessage: null, tagIds: []
    };
    const ready: MissionView = { ...created, id: "m2", executionKind: "agent", state: "READY", version: 1 };
    const fetchMock = stubFetch([
      { match: /\/api\/missions$/, method: "POST", response: created },
      { match: /\/api\/missions\/m2\/agent-config\/enable$/, method: "POST", response: { ...sourceConfig, missionId: "m2", version: 0 } },
      { match: /\/api\/missions\/m2\/agent-config$/, method: "PUT", response: { ...sourceConfig, missionId: "m2", version: 1, modelId: "model-b" } },
      { match: /\/api\/missions\/m2\/ready$/, method: "POST", response: ready }
    ]);

    const result = await duplicateMission({
      title: "Refactorise le module auth.",
      projectId: null,
      source: sourceConfig,
      modelId: "model-b"
    });

    expect(result).toEqual(ready);
    const calls = fetchMock.mock.calls;
    // 1. Création de la copie (mission humaine DRAFT).
    expect(calls[0]).toEqual(["/api/missions", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ title: "Refactorise le module auth.", projectId: null })
    })]);
    // 2. Enable de la config agent sur la copie.
    expect(calls[1]).toEqual(["/api/missions/m2/agent-config/enable", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ expectedVersion: 0 })
    })]);
    // 3. Mise à jour avec les réglages sources + le nouveau modèle, même workspace.
    expect(calls[2]).toEqual(["/api/missions/m2/agent-config", expect.objectContaining({
      method: "PUT",
      body: JSON.stringify({
        expectedVersion: 0,
        providerId: "opencode",
        modelId: "model-b",
        reasoningEffort: "high",
        providerOptions: { schemaVersion: 1, value: { some: "option" } },
        missionPrompt: "Refactorise le module auth.",
        permissionPreset: "workspace",
        workspaceId: "ws-1",
        autoCommitAuthorized: true,
        integrationTargetRef: "refs/heads/main"
      })
    })]);
    // 4. Passage en READY (version mission = créée 0 + enable 1).
    expect(calls[3]).toEqual(["/api/missions/m2/ready", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ expectedVersion: 1 })
    })]);
  });

  it("crée un workspace scratch quand la source n'en a pas", async () => {
    const created: MissionView = {
      id: "m3", projectId: "p1", title: "Sans workspace",
      executionKind: "human", state: "DRAFT", version: 0,
      createdAt: "2026-08-03T09:00:00Z", updatedAt: "2026-08-03T09:00:00Z",
      runState: null, runStartedAt: null, lastAssistantMessage: null, tagIds: []
    };
    const ready: MissionView = { ...created, executionKind: "agent", state: "READY", version: 1 };
    const fetchMock = stubFetch([
      { match: /\/api\/workspaces$/, method: "POST", response: { id: "ws-scratch", projectId: "p1", kind: "scratch", path: "data/local/workspaces/sans-workspace", state: "ready" } },
      { match: /\/api\/missions$/, method: "POST", response: created },
      { match: /\/api\/missions\/m3\/agent-config\/enable$/, method: "POST", response: { ...sourceConfig, missionId: "m3", version: 0 } },
      { match: /\/api\/missions\/m3\/agent-config$/, method: "PUT", response: { ...sourceConfig, missionId: "m3", version: 1 } },
      { match: /\/api\/missions\/m3\/ready$/, method: "POST", response: ready }
    ]);

    await duplicateMission({
      title: "Sans workspace",
      projectId: "p1",
      source: { ...sourceConfig, workspaceId: null },
      modelId: "model-a"
    });

    // Le workspace scratch est créé après la mission, puis référencé dans la config.
    expect(fetchMock.mock.calls[1]![0]).toBe("/api/workspaces");
    const putBody = JSON.parse(fetchMock.mock.calls[3]![1]!.body as string);
    expect(putBody.workspaceId).toBe("ws-scratch");
  });

  it("replie sur le prompt par défaut et les valeurs par défaut quand la source est vide", async () => {
    const created: MissionView = {
      id: "m4", projectId: null, title: "Vide",
      executionKind: "human", state: "DRAFT", version: 0,
      createdAt: "2026-08-03T09:00:00Z", updatedAt: "2026-08-03T09:00:00Z",
      runState: null, runStartedAt: null, lastAssistantMessage: null, tagIds: []
    };
    const ready: MissionView = { ...created, executionKind: "agent", state: "READY", version: 1 };
    const fetchMock = stubFetch([
      { match: /\/api\/missions$/, method: "POST", response: created },
      { match: /\/api\/missions\/m4\/agent-config\/enable$/, method: "POST", response: { ...sourceConfig, missionId: "m4", version: 0 } },
      { match: /\/api\/missions\/m4\/agent-config$/, method: "PUT", response: { ...sourceConfig, missionId: "m4", version: 1 } },
      { match: /\/api\/missions\/m4\/ready$/, method: "POST", response: ready }
    ]);

    await duplicateMission({
      title: "Vide",
      projectId: null,
      source: { ...sourceConfig, missionPrompt: "   ", reasoningEffort: null, permissionPreset: null, autoCommitAuthorized: false, integrationTargetRef: null },
      modelId: "model-a"
    });

    const putBody = JSON.parse(fetchMock.mock.calls[2]![1]!.body as string);
    expect(putBody.missionPrompt).toBe("Traite la mission « Vide » de bout en bout.");
    expect(putBody.reasoningEffort).toBe("provider_default");
    expect(putBody.permissionPreset).toBe("workspace");
  });
});

describe("mission service", () => {
  it("uses the lookup endpoint for mission identifiers that contain path separators", async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response("{}", {
      status: 200,
      headers: { "content-type": "application/json" }
    })));
    vi.stubGlobal("fetch", fetchMock);

    await showMission("mission/provider-session/uuid");
    await showMission("mission-uuid");

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/missions/lookup?missionId=mission%2Fprovider-session%2Fuuid",
      expect.anything()
    );
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/missions/mission-uuid", expect.anything());
  });
});
