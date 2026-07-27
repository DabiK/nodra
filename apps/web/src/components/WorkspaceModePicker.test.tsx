// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { WorkspaceModePicker } from "./WorkspaceModePicker";
import { TaskIntakeCard } from "./TaskIntakeCard";
import { WorkspaceModeEditor, type InspectorForm } from "./MissionInspector";
import type { MissionIntakeDraft, ProviderOptionsCatalog, WorkspaceDraftKind } from "../types";
import type { WorkspaceModeFields } from "../services/workspace-mode";

afterEach(cleanup);

const fields = (over: Partial<WorkspaceModeFields> = {}): WorkspaceModeFields => ({
  workspaceKind: "scratch",
  workspacePath: "",
  workspaceName: "",
  sourceWorkspaceId: "",
  sourceRepositoryPath: "",
  baseRef: "HEAD",
  branchName: "nodra/task",
  ...over
});

describe("WorkspaceModePicker (shared component)", () => {
  it("renders the three workspace modes", () => {
    render(<WorkspaceModePicker value={fields()} onChange={vi.fn()} generatedScratchPath="/ws/task" />);
    expect(screen.getByText("Dépôt existant")).toBeTruthy();
    expect(screen.getByText("Workspace neuf")).toBeTruthy();
    expect(screen.getByText("Git worktree")).toBeTruthy();
  });

  it("synchronises selection back to the parent", () => {
    const onChange = vi.fn();
    render(<WorkspaceModePicker value={fields()} onChange={onChange} generatedScratchPath="/ws/task" />);
    fireEvent.click(screen.getByText("Git worktree"));
    expect(onChange).toHaveBeenCalledWith({ workspaceKind: "worktree" });
  });

  it("shows the explicit-activation warning only for worktree", () => {
    const { rerender } = render(
      <WorkspaceModePicker value={fields({ workspaceKind: "scratch" })} onChange={vi.fn()} generatedScratchPath="/ws/task" />
    );
    expect(screen.queryByRole("note")).toBeNull();
    rerender(
      <WorkspaceModePicker value={fields({ workspaceKind: "worktree", sourceRepositoryPath: "/tmp/repo" })} onChange={vi.fn()} generatedScratchPath="/ws/task" />
    );
    expect(screen.getByRole("note").textContent).toMatch(/explicitement sélectionné/i);
  });

  it("surfaces validation errors (missing worktree source)", () => {
    render(<WorkspaceModePicker value={fields({ workspaceKind: "worktree" })} onChange={vi.fn()} generatedScratchPath="/ws/task" />);
    expect(screen.getByRole("alert").textContent).toMatch(/dépôt git source/i);
  });

  it("honours the disabled state", () => {
    const onChange = vi.fn();
    render(<WorkspaceModePicker value={fields()} onChange={onChange} generatedScratchPath="/ws/task" disabled />);
    fireEvent.click(screen.getByText("Git worktree"));
    expect(onChange).not.toHaveBeenCalled();
  });
});

const providerOptions: ProviderOptionsCatalog = {
  providers: [{ id: "opencode", label: "OpenCode", status: "ready", reason: null, models: [{ id: "m1", label: "Model 1", description: "", hidden: false, isDefault: true, supportedReasoningEfforts: ["medium"], defaultReasoningEffort: "medium" }] }],
  reasoningEfforts: ["medium"],
  permissionPresets: ["workspace"],
  defaults: { providerId: "opencode", modelId: "m1", reasoningEffort: "medium", permissionPreset: "workspace", providerOptions: { schemaVersion: 1, value: {} } }
};

const draft: MissionIntakeDraft = {
  title: "Ma tâche", kind: "agent", prompt: "", notes: "", projectId: "",
  workspaceKind: "scratch" as WorkspaceDraftKind, workspacePath: "", workspaceName: "",
  sourceWorkspaceId: "", sourceRepositoryPath: "", baseRef: "HEAD", branchName: "nodra/ma-tache",
  providerId: "opencode", modelId: "m1", reasoningEffort: "medium", permissionPreset: "workspace"
};

const noop = () => undefined;

describe("shared Terrain de travail is used by both screens", () => {
  it("new-task intake (Configuration de la nouvelle tâche) renders the shared picker with all modes", () => {
    render(
      <TaskIntakeCard
        draft={draft} providerOptions={providerOptions} selectedProvider={providerOptions.providers[0]}
        selectedModelId="m1" reasoningOptions={["medium"]} expanded creating={false} probingProviderId={null}
        folderOpen={false} folderBrowse={null} folderLoading={false} error="" notice="" missionCount={0}
        stateCounts={{}} stateFilter="all" kindFilter="all"
        onSubmit={noop} onDraftChange={noop} onExpandedChange={noop} onProviderChange={noop} onProbeProvider={noop}
        onStateFilterChange={noop} onKindFilterChange={noop} onFolderOpen={noop} onFolderClose={noop}
        onFolderBrowse={noop} onFolderSelect={noop}
      />
    );
    const config = screen.getByLabelText("Configuration de la nouvelle tâche");
    const picker = within(config).getByTestId("workspace-mode-picker");
    expect(within(picker).getByText("Git worktree")).toBeTruthy();
  });

  it("mission settings (WorkspaceModeEditor) renders the same shared picker", () => {
    const form: InspectorForm = {
      providerId: "opencode", modelId: "m1", reasoningEffort: "medium", missionPrompt: "do it",
      permissionPreset: "workspace", workspaceId: "", autoCommitAuthorized: false, integrationTargetRef: "",
      workspaceKind: "scratch", workspacePath: "", workspaceName: "task", sourceWorkspaceId: "",
      sourceRepositoryPath: "", baseRef: "HEAD", branchName: "nodra/task", prerequisiteMissionIds: []
    };
    render(<WorkspaceModeEditor form={form} onPatch={noop} />);
    const picker = screen.getByTestId("workspace-mode-picker");
    expect(within(picker).getByText("Git worktree")).toBeTruthy();
  });
});
