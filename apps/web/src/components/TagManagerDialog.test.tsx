// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { TagManagerDialog } from "./TagManagerDialog";
import { createTag, deleteTag, loadTags, updateTag } from "../services/tag-service";

vi.mock("../services/tag-service", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    loadTags: vi.fn(),
    createTag: vi.fn(),
    updateTag: vi.fn(),
    deleteTag: vi.fn()
  };
});

const catalog = [
  { id: "tag-1", label: "Urgent", color: "#e5484d", createdAt: "2026-01-01", updatedAt: "2026-01-01" },
  { id: "tag-2", label: "WIP", color: "#46a758", createdAt: "2026-01-01", updatedAt: "2026-01-01" }
];

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderManager(onChanged = vi.fn(), onClose = vi.fn()) {
  render(<TagManagerDialog open onClose={onClose} onChanged={onChanged} />);
  return { onChanged, onClose };
}

describe("TagManagerDialog (issue #23)", () => {
  it("lists the existing tags", async () => {
    vi.mocked(loadTags).mockResolvedValue(catalog);
    renderManager();
    expect(await screen.findByText("Urgent")).toBeTruthy();
    expect(screen.getByText("WIP")).toBeTruthy();
  });

  it("creates a tag with the chosen label and color", async () => {
    vi.mocked(loadTags).mockResolvedValue([]);
    vi.mocked(createTag).mockResolvedValue({ id: "tag-3", label: "Client-X", color: "#3e63dd", createdAt: "2026-01-01", updatedAt: "2026-01-01" });
    vi.mocked(loadTags).mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: "tag-3", label: "Client-X", color: "#3e63dd", createdAt: "2026-01-01", updatedAt: "2026-01-01" }]);
    const { onChanged } = renderManager();
    fireEvent.change(screen.getByLabelText("Libellé du nouveau tag"), { target: { value: "Client-X" } });
    fireEvent.click(screen.getByRole("button", { name: "＋ Créer" }));
    await waitFor(() => expect(createTag).toHaveBeenCalledWith({ label: "Client-X", color: "#e5484d" }));
    expect(onChanged).toHaveBeenCalled();
  });

  it("does not create an empty tag", () => {
    vi.mocked(loadTags).mockResolvedValue([]);
    renderManager();
    const button = screen.getByRole("button", { name: "＋ Créer" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Libellé du nouveau tag"), { target: { value: "   " } });
    expect(button.disabled).toBe(true);
  });

  it("renames and recolors a tag in place", async () => {
    vi.mocked(loadTags).mockResolvedValue(catalog);
    vi.mocked(updateTag).mockResolvedValue({ ...catalog[0], label: "Critique" });
    vi.mocked(loadTags).mockResolvedValueOnce(catalog).mockResolvedValueOnce([{ ...catalog[0], label: "Critique" }, catalog[1]]);
    const { onChanged } = renderManager();
    fireEvent.click(await screen.findByLabelText("Renommer ou recolorer Urgent"));
    fireEvent.change(screen.getByLabelText("Libellé du tag tag-1"), { target: { value: "Critique" } });
    fireEvent.click(screen.getByLabelText("Couleur du tag").querySelector(".tag-swatch:nth-child(2)")!);
    fireEvent.click(screen.getByText("✓"));
    await waitFor(() => expect(updateTag).toHaveBeenCalledWith({ id: "tag-1", label: "Critique", color: "#f76b15" }));
    expect(onChanged).toHaveBeenCalled();
  });

  it("deletes a tag", async () => {
    vi.mocked(loadTags).mockResolvedValue(catalog);
    vi.mocked(deleteTag).mockResolvedValue(undefined);
    vi.mocked(loadTags).mockResolvedValueOnce(catalog).mockResolvedValueOnce([catalog[1]]);
    const { onChanged } = renderManager();
    fireEvent.click(await screen.findByLabelText("Supprimer le tag Urgent"));
    await waitFor(() => expect(deleteTag).toHaveBeenCalledWith("tag-1"));
    expect(onChanged).toHaveBeenCalled();
  });

  it("surfaces errors from the API", async () => {
    vi.mocked(loadTags).mockResolvedValue([]);
    vi.mocked(createTag).mockRejectedValue(new Error("A tag with this label already exists"));
    renderManager();
    fireEvent.change(screen.getByLabelText("Libellé du nouveau tag"), { target: { value: "Urgent" } });
    fireEvent.click(screen.getByRole("button", { name: "＋ Créer" }));
    expect((await screen.findByRole("alert")).textContent).toContain("already exists");
  });

  it("closes on Escape and on the close button", async () => {
    vi.mocked(loadTags).mockResolvedValue(catalog);
    const { onClose } = renderManager();
    await screen.findByText("Urgent");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText("Fermer"));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("renders nothing when closed", () => {
    render(<TagManagerDialog open={false} onClose={vi.fn()} onChanged={vi.fn()} />);
    expect(screen.queryByText("Gérer les tags")).toBeNull();
  });
});
