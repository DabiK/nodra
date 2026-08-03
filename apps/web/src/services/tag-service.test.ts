// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTag, deleteTag, loadMissionTags, loadTags, setMissionTags, updateTag } from "./tag-service";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const tag = { id: "tag-1", label: "Urgent", color: "#e5484d", createdAt: "2026-08-03T10:00:00Z", updatedAt: "2026-08-03T10:00:00Z" };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("tag-service (issue #23)", () => {
  it("loads all tags from /api/tags", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse([tag])));
    await expect(loadTags()).resolves.toEqual([tag]);
    expect(fetch).toHaveBeenCalledWith("/api/tags", expect.objectContaining({ cache: "no-store" }));
  });

  it("creates a tag with label + color", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(tag, 201)));
    await expect(createTag({ label: "Urgent", color: "#e5484d" })).resolves.toEqual(tag);
    expect(fetch).toHaveBeenCalledWith("/api/tags", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ label: "Urgent", color: "#e5484d" })
    }));
  });

  it("updates a tag (rename / recolor)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ ...tag, label: "Critique" })));
    await expect(updateTag({ id: "tag-1", label: "Critique", color: "#e5484d" })).resolves.toEqual({ ...tag, label: "Critique" });
    expect(fetch).toHaveBeenCalledWith("/api/tags/tag-1", expect.objectContaining({
      method: "PUT",
      body: JSON.stringify({ label: "Critique", color: "#e5484d" })
    }));
  });

  it("deletes a tag", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ ok: true })));
    await expect(deleteTag("tag-1")).resolves.toBeUndefined();
    expect(fetch).toHaveBeenCalledWith("/api/tags/tag-1", expect.objectContaining({ method: "DELETE" }));
  });

  it("loads the tags of a mission", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse([tag])));
    await expect(loadMissionTags("mission-a")).resolves.toEqual([tag]);
    expect(fetch).toHaveBeenCalledWith("/api/missions/mission-a/tags", expect.anything());
  });

  it("replaces the mission tag set", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ ok: true })));
    await expect(setMissionTags("mission-a", ["tag-1", "tag-2"])).resolves.toBeUndefined();
    expect(fetch).toHaveBeenCalledWith("/api/missions/mission-a/tags", expect.objectContaining({
      method: "PUT",
      body: JSON.stringify({ tagIds: ["tag-1", "tag-2"] })
    }));
  });

  it("clears every tag of a mission with an empty array", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ ok: true })));
    await setMissionTags("mission-a", []);
    expect(fetch).toHaveBeenCalledWith("/api/missions/mission-a/tags", expect.objectContaining({
      body: JSON.stringify({ tagIds: [] })
    }));
  });

  it("propagates HTTP errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("duplicate label", { status: 409 })));
    await expect(createTag({ label: "Urgent", color: "#e5484d" })).rejects.toThrow("duplicate label");
  });
});
