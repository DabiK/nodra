import type { AgentSessionView, MissionView } from "../types";
import { listMissions } from "./mission-service";
import { latestRunForMission } from "./mission-result-service";
import { loadAgentSession } from "./agent-session-service";

export interface AgentConversationCatalogEntry {
  missionId: string;
  missionTitle: string;
  missionState: MissionView["state"];
  executionKind: MissionView["executionKind"];
  threadId: string;
  runId: string;
  runState: string;
  providerId: string;
  modelId: string;
  updatedAt: string;
}

const visibleStates = new Set<MissionView["state"]>(["ACTIVE", "VALIDATION", "BLOCKED", "DONE"]);

export async function loadAgentConversationCatalog(): Promise<AgentConversationCatalogEntry[]> {
  const missions = (await listMissions())
    .filter((mission) => mission.executionKind === "agent" && visibleStates.has(mission.state))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, 40);
  const entries = await Promise.all(missions.map(loadEntry));
  return entries.filter((entry): entry is AgentConversationCatalogEntry => Boolean(entry));
}

async function loadEntry(mission: MissionView) {
  const latest = await latestRunForMission(mission.id);
  if (!latest) return null;
  let session: AgentSessionView | null = null;
  try {
    session = await loadAgentSession(latest.runId);
  } catch {
    return null;
  }
  return {
    missionId: mission.id,
    missionTitle: mission.title,
    missionState: mission.state,
    executionKind: mission.executionKind,
    threadId: latest.threadId,
    runId: latest.runId,
    runState: session.run.state,
    providerId: session.run.providerId,
    modelId: session.run.modelId,
    updatedAt: session.run.endedAt ?? session.run.startedAt ?? session.run.createdAt ?? mission.updatedAt
  };
}
