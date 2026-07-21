import type { Id, Mission } from "@nodra/domain";

export interface MissionRepository {
  load(id: Id): Promise<Mission | null>;
  save(mission: Mission, expectedVersion: number): Promise<void>;
}
