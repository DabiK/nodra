// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { AgentConfigView, MissionRunsView, MissionView } from "../types";
import { MissionInspector } from "./MissionInspector";
import { loadMissionInspector, loadMissionRuns } from "../services/mission-service";
import { loadMissionAudit } from "../services/mission-audit-service";
import type { MissionAuditView } from "../services/mission-audit-service";
import { loadWorkspaceDiff } from "../services/mission-diff-service";
import type { WorkspaceDiffView } from "../services/mission-diff-service";

vi.mock("../services/mission-service", () => ({
  loadMissionInspector: vi.fn().mockResolvedValue({
    mission: {
      id: "m1",
      projectId: null,
      title: "Mission test",
      executionKind: "agent",
      state: "READY",
      version: 1,
      createdAt: "2026-08-02T08:00:00Z",
      updatedAt: "2026-08-02T09:00:00Z"
    },
    config: null,
    providerSession: null
  }),
  loadMissionRuns: vi.fn().mockRejectedValue(new Error("mock: pas de runs")),
  updateAgentConfig: vi.fn()
}));
vi.mock("../services/mission-result-service", () => ({
  loadMissionResult: vi.fn().mockRejectedValue(new Error("mock: pas de run"))
}));
vi.mock("../services/mission-audit-service", () => ({
  loadMissionAudit: vi.fn().mockRejectedValue(new Error("mock: pas d'audit"))
}));
vi.mock("../services/mission-diff-service", () => ({
  loadWorkspaceDiff: vi.fn().mockRejectedValue(new Error("mock: pas de workspace")),
  DIFF_FILE_STATUS_LABELS: {
    added: { code: "A", label: "Ajouté" },
    modified: { code: "M", label: "Modifié" },
    deleted: { code: "D", label: "Supprimé" },
    renamed: { code: "R", label: "Renommé" }
  }
}));
vi.mock("../services/mission-notes-service", () => ({
  loadMissionNotes: vi.fn().mockReturnValue(""),
  saveMissionNotes: vi.fn()
}));
vi.mock("../services/worktree-service", () => ({
  showWorkspace: vi.fn().mockRejectedValue(new Error("mock: pas de workspace"))
}));
vi.mock("./WorktreeResolutionDialog", () => ({
  WorktreeResolutionDialog: () => null
}));
vi.mock("./ModelPicker", () => ({
  ModelPicker: () => null
}));
vi.mock("./MissionExportDialog", () => ({
  MissionExportDialog: ({ mission, onClose }: { mission: MissionView; onClose(): void }) => (
    <div data-testid="export-dialog">
      <span>EXPORT {mission.title}</span>
      <button type="button" onClick={onClose}>Fermer export</button>
    </div>
  )
}));
vi.mock("./MissionReplayDialog", () => ({
  MissionReplayDialog: ({ mission, onClose, onReplayed }: { mission: MissionView; onClose(): void; onReplayed(created: MissionView): void }) => (
    <div data-testid="replay-dialog">
      <span>REPLAY {mission.title}</span>
      <button type="button" onClick={() => onReplayed({ ...mission, id: "m2", state: "READY", version: 1 })}>
        Simuler rejoué
      </button>
      <button type="button" onClick={onClose}>Fermer replay</button>
    </div>
  )
}));

afterEach(cleanup);

const mission: MissionView = {
  id: "m1",
  projectId: null,
  title: "Mission test",
  executionKind: "agent",
  state: "READY",
  version: 1,
  createdAt: "2026-08-02T08:00:00Z",
  updatedAt: "2026-08-02T09:00:00Z",
  runState: null,
  runStartedAt: null,
  lastAssistantMessage: null
};

function renderInspector(onClose = vi.fn(), onSaved = vi.fn()) {
  render(
    <MissionInspector
      missionId="m1"
      missions={[mission]}
      providerOptions={null}
      onClose={onClose}
      onSaved={onSaved}
    />
  );
  return { onClose, onSaved };
}

describe("MissionInspector keyboard", () => {
  it("ferme la fiche avec Escape", () => {
    const { onClose } = renderInspector();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("ignore Escape pendant la saisie dans un champ", () => {
    const { onClose } = renderInspector();
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    input.remove();
  });

  it("ignore Escape quand le model picker est ouvert", () => {
    const { onClose } = renderInspector();
    const picker = document.createElement("div");
    picker.className = "model-picker-backdrop";
    document.body.appendChild(picker);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    picker.remove();
  });
});

describe("MissionInspector budget panel", () => {
  it("masque le panneau tant que l'historique des runs n'est pas chargé", () => {
    renderInspector();
    expect(screen.queryByLabelText("Budget et usage de la mission")).toBeNull();
  });

  it("affiche le coût total et le détail par run quand l'historique est chargé", async () => {
    const history: MissionRunsView = {
      totalCostMicros: 18_888,
      runs: [
        {
          id: "run-1",
          attempt: 1,
          state: "SUCCEEDED",
          providerId: "opencode",
          modelId: "model-a",
          startedAt: "2026-08-02T08:00:00Z",
          endedAt: "2026-08-02T08:30:00Z",
          durationMs: 1_800_000,
          inputTokens: 1000,
          outputTokens: 500,
          cacheReadTokens: null,
          cacheWriteTokens: null,
          costMicros: 12_345,
          usageKind: "reported"
        },
        {
          id: "run-2",
          attempt: 2,
          state: "FAILED",
          providerId: "opencode",
          modelId: "model-a",
          startedAt: "2026-08-02T09:00:00Z",
          endedAt: "2026-08-02T09:01:00Z",
          durationMs: 60_000,
          inputTokens: 200,
          outputTokens: 100,
          cacheReadTokens: null,
          cacheWriteTokens: null,
          costMicros: 6_543,
          usageKind: "reported"
        }
      ]
    };
    vi.mocked(loadMissionRuns).mockResolvedValueOnce(history);
    renderInspector();

    const panel = await screen.findByLabelText("Budget et usage de la mission");
    expect(panel.textContent).toContain("Total : $0.0189");
    const rows = panel.querySelectorAll("li");
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("$0.0123");
    expect(rows[0].textContent).toContain("1,5 k tokens");
    expect(rows[0].textContent).toContain("essai 1");
    expect(rows[1].textContent).toContain("essai 2");
  });

  it("affiche l'état vide quand la mission n'a aucun run", async () => {
    vi.mocked(loadMissionRuns).mockResolvedValueOnce({ totalCostMicros: null, runs: [] });
    renderInspector();

    const panel = await screen.findByLabelText("Budget et usage de la mission");
    expect(panel.textContent).toContain("Aucun run à ce jour");
  });
});

describe("MissionInspector export markdown", () => {
  it("ouvre le dialog d'export depuis le bouton Exporter de la fiche", async () => {
    renderInspector();
    const button = await screen.findByRole("button", { name: /Exporter/ });
    fireEvent.click(button);
    expect(await screen.findByTestId("export-dialog")).toBeTruthy();
    expect(screen.getByText("EXPORT Mission test")).toBeTruthy();
  });

  it("ferme le dialog d'export sans fermer la fiche", async () => {
    const { onClose } = renderInspector();
    fireEvent.click(await screen.findByRole("button", { name: /Exporter/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Fermer export" }));
    expect(screen.queryByTestId("export-dialog")).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("n'affiche pas le bouton Exporter tant que la fiche n'est pas chargée", () => {
    renderInspector();
    expect(screen.queryByRole("button", { name: /Exporter/ })).toBeNull();
  });
});

describe("MissionInspector audit timeline panel", () => {
  const audit: MissionAuditView[] = [
    {
      id: "audit/1",
      commandId: "cmd-1",
      eventType: "MISSION_CREATED",
      actor: "user",
      payload: { schemaVersion: 1, fromState: null, toState: "DRAFT" },
      occurredAt: "2026-08-02T08:00:00.000Z"
    },
    {
      id: "audit/2",
      commandId: "cmd-2",
      eventType: "MISSION_PREPARED",
      actor: "user",
      payload: { schemaVersion: 1, fromState: "DRAFT", toState: "READY" },
      occurredAt: "2026-08-02T08:30:00.000Z"
    },
    {
      id: "audit/3",
      commandId: "cmd-3",
      eventType: "DELIVERY_DECIDED",
      actor: "user",
      payload: { schemaVersion: 1, decision: "accept", missionId: "m1" },
      occurredAt: "2026-08-02T09:00:00.000Z"
    },
    {
      id: "audit/4",
      commandId: "cmd-4",
      eventType: "GATE_EVALUATED",
      actor: "manager",
      payload: { schemaVersion: 1, state: "passed" },
      occurredAt: "2026-08-02T09:10:00.000Z"
    }
  ];

  it("masque le panneau tant que l'historique d'audit n'est pas chargé", () => {
    renderInspector();
    expect(screen.queryByLabelText("Historique de la mission")).toBeNull();
  });

  it("affiche la timeline avec libellés, acteur et horodatage", async () => {
    vi.mocked(loadMissionAudit).mockResolvedValueOnce(audit);
    renderInspector();

    const panel = await screen.findByLabelText("Historique de la mission");
    expect(panel.textContent).toContain("4 événements");
    expect(panel.textContent).toContain("Création (null → DRAFT)");
    expect(panel.textContent).toContain("Mise en file (DRAFT → READY)");
    expect(panel.textContent).toContain("Décision de delivery — acceptée");
    expect(panel.textContent).toContain("Gate évaluée — passée");
    const rows = panel.querySelectorAll(".mission-audit-list li");
    expect(rows).toHaveLength(4);
    // Acteur et horodatage affichés.
    expect(panel.textContent).toContain("Utilisateur");
    expect(panel.textContent).toContain("Manager");
    expect(panel.textContent).toMatch(/\d{2} [a-zéû]+ · \d{2}:\d{2}/);
  });

  it("filtre la timeline par catégorie d'événement", async () => {
    vi.mocked(loadMissionAudit).mockResolvedValueOnce(audit);
    renderInspector();
    const panel = await screen.findByLabelText("Historique de la mission");

    fireEvent.click(within(panel).getByRole("button", { name: /Gates/ }));
    const rows = panel.querySelectorAll(".mission-audit-list li");
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain("Gate évaluée — passée");

    fireEvent.click(within(panel).getByRole("button", { name: /Transitions/ }));
    expect(panel.querySelectorAll(".mission-audit-list li")).toHaveLength(2);

    fireEvent.click(within(panel).getByRole("button", { name: /Tout/ }));
    expect(panel.querySelectorAll(".mission-audit-list li")).toHaveLength(4);
  });

  it("affiche l'état vide quand la mission n'a aucun événement d'audit", async () => {
    vi.mocked(loadMissionAudit).mockResolvedValueOnce([]);
    renderInspector();
    const panel = await screen.findByLabelText("Historique de la mission");
    expect(panel.textContent).toContain("Aucun événement d'audit");
  });

  it("affiche un message dédié quand un filtre ne correspond à rien", async () => {
    vi.mocked(loadMissionAudit).mockResolvedValueOnce(audit);
    renderInspector();
    const panel = await screen.findByLabelText("Historique de la mission");
    fireEvent.click(within(panel).getByRole("button", { name: /Provider/ }));
    expect(panel.querySelector(".mission-audit-none")?.textContent).toContain("Aucun événement de ce type");
  });
});

describe("MissionInspector diff git panel", () => {
  const config: AgentConfigView = {
    missionId: "m1",
    version: 3,
    providerId: "opencode",
    modelId: "model-a",
    reasoningEffort: "provider_default",
    providerOptions: { schemaVersion: 1, value: {} },
    missionPrompt: "Fais la mission.",
    permissionPreset: "workspace",
    workspaceId: "ws-1",
    autoCommitAuthorized: false,
    integrationTargetRef: null,
    updatedAt: "2026-08-02T09:00:00Z"
  };
  const diff: WorkspaceDiffView = {
    base: "abc123",
    head: null,
    files: [
      {
        path: "src/main.ts",
        oldPath: null,
        status: "modified",
        additions: 3,
        deletions: 1,
        content: "diff --git a/src/main.ts b/src/main.ts\n@@ -1,2 +1,4 @@\n-ancien\n+nouveau\n+nouvelle ligne"
      },
      {
        path: "new-file.txt",
        oldPath: null,
        status: "added",
        additions: 2,
        deletions: 0,
        content: "diff --git a/new-file.txt b/new-file.txt\nnew file mode 100644\n+hello"
      },
      {
        path: "old-name.ts",
        oldPath: "renamed.ts",
        status: "renamed",
        additions: 0,
        deletions: 0,
        content: "diff --git a/renamed.ts b/old-name.ts"
      }
    ]
  };

  function renderWithWorkspace() {
    vi.mocked(loadMissionInspector).mockResolvedValueOnce({
      mission,
      config,
      providerSession: null
    });
    renderInspector();
  }

  it("masque le panneau tant que le diff n'est pas chargé", () => {
    renderInspector();
    expect(screen.queryByLabelText("Fichiers modifiés du workspace")).toBeNull();
  });

  it("affiche la liste des fichiers avec statut, compteurs et total", async () => {
    vi.mocked(loadWorkspaceDiff).mockResolvedValueOnce(diff);
    renderWithWorkspace();

    const panel = await screen.findByLabelText("Fichiers modifiés du workspace");
    expect(panel.textContent).toContain("3 fichiers");
    const rows = panel.querySelectorAll(".mission-diff-files li");
    expect(rows).toHaveLength(3);
    expect(rows[0]!.textContent).toContain("src/main.ts");
    expect(rows[0]!.textContent).toContain("Modifié");
    expect(rows[0]!.textContent).toContain("+3");
    expect(rows[0]!.textContent).toContain("−1");
    expect(rows[1]!.textContent).toContain("new-file.txt");
    expect(rows[1]!.textContent).toContain("Ajouté");
    expect(rows[2]!.textContent).toContain("renamed.ts → old-name.ts");
    expect(rows[2]!.textContent).toContain("Renommé");
  });

  it("affiche le diff unifié du fichier au clic sur sa ligne", async () => {
    vi.mocked(loadWorkspaceDiff).mockResolvedValueOnce(diff);
    renderWithWorkspace();

    const panel = await screen.findByLabelText("Fichiers modifiés du workspace");
    expect(screen.queryByLabelText("Diff de src/main.ts")).toBeNull();
    fireEvent.click(within(panel).getByRole("button", { name: /src\/main\.ts/ }));

    const content = await screen.findByLabelText("Diff de src/main.ts");
    expect(content.textContent).toContain("@@ -1,2 +1,4 @@");
    expect(content.textContent).toContain("-ancien");
    expect(content.textContent).toContain("+nouvelle ligne");

    // Un second clic replie le diff.
    fireEvent.click(within(panel).getByRole("button", { name: /src\/main\.ts/ }));
    expect(screen.queryByLabelText("Diff de src/main.ts")).toBeNull();
  });

  it("affiche l'état vide quand aucun fichier n'a changé", async () => {
    vi.mocked(loadWorkspaceDiff).mockResolvedValueOnce({ base: "abc123", head: null, files: [] });
    renderWithWorkspace();

    const panel = await screen.findByLabelText("Fichiers modifiés du workspace");
    expect(panel.textContent).toContain("Aucune modification depuis le snapshot initial");
  });
});

describe("MissionInspector replay (rejouer / dupliquer)", () => {
  const config: AgentConfigView = {
    missionId: "m1",
    version: 3,
    providerId: "opencode",
    modelId: "model-a",
    reasoningEffort: "high",
    providerOptions: { schemaVersion: 1, value: {} },
    missionPrompt: "Fais la mission.",
    permissionPreset: "workspace",
    workspaceId: "ws-1",
    autoCommitAuthorized: false,
    integrationTargetRef: null,
    updatedAt: "2026-08-02T09:00:00Z"
  };

  function renderWithConfig(overrides: Partial<MissionView> = {}, onSaved = vi.fn()) {
    vi.mocked(loadMissionInspector).mockResolvedValueOnce({
      mission: { ...mission, ...overrides },
      config,
      providerSession: null
    });
    renderInspector(vi.fn(), onSaved);
    return onSaved;
  }

  it("n'affiche pas Rejouer tant que la config agent n'est pas chargée", () => {
    renderInspector();
    expect(screen.queryByRole("button", { name: /Rejouer/ })).toBeNull();
  });

  it("affiche Rejouer pour une mission agent configurée", async () => {
    renderWithConfig();
    expect(await screen.findByRole("button", { name: /Rejouer/ })).toBeTruthy();
  });

  it("masque Rejouer pendant qu'une mission est en cours (ACTIVE)", async () => {
    renderWithConfig({ state: "ACTIVE" });
    await screen.findByRole("heading", { name: "Mission test" });
    expect(screen.queryByRole("button", { name: /Rejouer/ })).toBeNull();
  });

  it("masque Rejouer pour une mission humaine", async () => {
    vi.mocked(loadMissionInspector).mockResolvedValueOnce({
      mission: { ...mission, executionKind: "human" },
      config: null,
      providerSession: null
    });
    renderInspector();
    await screen.findByRole("heading", { name: "Mission test" });
    expect(screen.queryByRole("button", { name: /Rejouer/ })).toBeNull();
  });

  it("ouvre le dialog de replay et rafraîchit le board après duplication", async () => {
    const onSaved = renderWithConfig();
    fireEvent.click(await screen.findByRole("button", { name: /Rejouer/ }));
    expect(await screen.findByTestId("replay-dialog")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Simuler rejoué" }));
    expect(screen.queryByTestId("replay-dialog")).toBeNull();
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect((await screen.findByRole("status")).textContent).toContain("dupliquée");
  });

  it("ferme le dialog de replay sans fermer la fiche ni rafraîchir", async () => {
    const onSaved = renderWithConfig();
    fireEvent.click(await screen.findByRole("button", { name: /Rejouer/ }));
    fireEvent.click(screen.getByRole("button", { name: "Fermer replay" }));
    expect(screen.queryByTestId("replay-dialog")).toBeNull();
    expect(onSaved).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Mission test" })).toBeTruthy();
  });
});
