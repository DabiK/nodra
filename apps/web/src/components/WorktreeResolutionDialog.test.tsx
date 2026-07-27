// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { WorktreeResolutionDialog } from "./WorktreeResolutionDialog";
import * as service from "../services/worktree-service";

vi.mock("../services/worktree-service", () => ({
  loadWorktreeStatus: vi.fn(),
  resolveWorktree: vi.fn(),
  showWorkspace: vi.fn()
}));

const loadWorktreeStatus = vi.mocked(service.loadWorktreeStatus);
const resolveWorktree = vi.mocked(service.resolveWorktree);

const cleanStatus: service.WorktreeStatusView = {
  mainRepositoryPath: "/repo", worktreeExists: true, branchExists: true, branchName: "nodra/task",
  baseRef: "HEAD", hasUncommittedChanges: false, hasUnmergedCommits: false, head: "abc"
};

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("WorktreeResolutionDialog", () => {
  it("checks git status then offers both resolution options", async () => {
    loadWorktreeStatus.mockResolvedValue(cleanStatus);
    render(<WorktreeResolutionDialog workspaceId="ws-1" onClose={vi.fn()} />);
    expect(await screen.findByText(/Supprimer le worktree et la branche/)).toBeTruthy();
    expect(screen.getByText(/Conserver la branche/)).toBeTruthy();
    expect(loadWorktreeStatus).toHaveBeenCalledWith("ws-1");
  });

  it("keeps the branch (Option B) immediately when the worktree is clean", async () => {
    loadWorktreeStatus.mockResolvedValue(cleanStatus);
    resolveWorktree.mockResolvedValue({
      status: cleanStatus, action: "keep-branch", worktreeRemoved: true, branchDeleted: false, branchKept: true, branchName: "nodra/task"
    });
    render(<WorktreeResolutionDialog workspaceId="ws-1" onClose={vi.fn()} />);
    fireEvent.click(await screen.findByText(/Conserver la branche/));
    await waitFor(() => expect(resolveWorktree).toHaveBeenCalledWith("ws-1", { action: "keep-branch", confirmDiscardChanges: undefined, confirmDeleteUnmerged: undefined }));
    expect(await screen.findByText(/Nettoyage terminé/)).toBeTruthy();
    expect(screen.getByText(/conservée dans le dépôt principal/)).toBeTruthy();
  });

  it("requires reinforced confirmation before deleting an unmerged branch (Option A)", async () => {
    loadWorktreeStatus.mockResolvedValue({ ...cleanStatus, hasUnmergedCommits: true });
    resolveWorktree.mockResolvedValue({
      status: cleanStatus, action: "remove-all", worktreeRemoved: true, branchDeleted: true, branchKept: false, branchName: "nodra/task"
    });
    render(<WorktreeResolutionDialog workspaceId="ws-1" onClose={vi.fn()} />);
    fireEvent.click(await screen.findByText(/Supprimer le worktree et la branche/));
    // Must not call the API yet — confirmation is required.
    expect(resolveWorktree).not.toHaveBeenCalled();
    const execute = await screen.findByText("Confirmer et exécuter");
    expect((execute as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox"));
    expect((execute as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(execute);
    await waitFor(() => expect(resolveWorktree).toHaveBeenCalledWith("ws-1", { action: "remove-all", confirmDiscardChanges: undefined, confirmDeleteUnmerged: true }));
  });

  it("closing without resolving keeps everything intact (onClose false)", async () => {
    loadWorktreeStatus.mockResolvedValue(cleanStatus);
    const onClose = vi.fn();
    render(<WorktreeResolutionDialog workspaceId="ws-1" onClose={onClose} />);
    fireEvent.click(await screen.findByText(/Annuler \(résoudre plus tard\)/));
    expect(onClose).toHaveBeenCalledWith(false);
    expect(resolveWorktree).not.toHaveBeenCalled();
  });
});
