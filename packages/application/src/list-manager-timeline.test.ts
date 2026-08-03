import { describe, expect, it, vi } from "vitest";
import { asId, type Id } from "@nodra/domain";
import type {
  ManagerConversationView,
  ManagerListFilter,
  ManagerReadModel,
  ManagerTimelineFilter,
  ManagerTimelineView,
  ManagerView
} from "./manager-repository.js";
import { ListManagerTimeline } from "./list-manager-timeline.js";

class FakeManagerReadModel implements ManagerReadModel {
  constructor(private readonly timelineResult: ManagerTimelineView = { items: [], truncated: false }) {}
  list(_filter?: ManagerListFilter): Promise<ManagerView[]> {
    throw new Error("not used");
  }
  show = vi.fn(async (id: Id) => (id === asId("manager-known") ? ({ id, name: "Atlas" } as ManagerView) : null));
  conversations(_id: string): Promise<ManagerConversationView[]> {
    throw new Error("not used");
  }
  timeline = vi.fn(async (_filter: ManagerTimelineFilter) => this.timelineResult);
}

describe("ListManagerTimeline (issue #24)", () => {
  it("delegates to the read model without a filter", async () => {
    const readModel = new FakeManagerReadModel();
    const useCase = new ListManagerTimeline(readModel);
    await expect(useCase.execute()).resolves.toEqual({ items: [], truncated: false });
    expect(readModel.timeline).toHaveBeenCalledWith({});
  });

  it("passes the filter through", async () => {
    const readModel = new FakeManagerReadModel();
    const useCase = new ListManagerTimeline(readModel);
    await useCase.execute({
      managerId: asId("manager-known"),
      missionId: asId("mission/abc"),
      query: "gate",
      since: "2026-08-01T00:00:00.000Z",
      until: "2026-08-03T00:00:00.000Z",
      limit: 42
    });
    expect(readModel.timeline).toHaveBeenCalledWith({
      managerId: asId("manager-known"),
      missionId: asId("mission/abc"),
      query: "gate",
      since: "2026-08-01T00:00:00.000Z",
      until: "2026-08-03T00:00:00.000Z",
      limit: 42
    });
  });

  it("rejects an unknown manager with MANAGER_NOT_FOUND", async () => {
    const readModel = new FakeManagerReadModel();
    const useCase = new ListManagerTimeline(readModel);
    const error = await useCase.execute({ managerId: asId("manager-unknown") }).catch((reason: Error) => reason);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error & { code?: string }).code).toBe("MANAGER_NOT_FOUND");
    expect(readModel.timeline).not.toHaveBeenCalled();
  });
});
