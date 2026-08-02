import { describe, expect, it } from "vitest";
import type { MissionAuditView } from "./mission-audit-service";
import {
  AUDIT_FILTERS,
  auditActorLabel,
  auditEventCategory,
  countAuditCategories,
  describeAuditEvent,
  filterAuditEvents,
  formatAuditTime
} from "./mission-audit-view-service";

const event = (overrides: Partial<MissionAuditView>): MissionAuditView => ({
  id: "audit/1",
  commandId: "cmd-1",
  eventType: "MISSION_PREPARED",
  actor: "user",
  payload: { schemaVersion: 1, fromState: "DRAFT", toState: "READY" },
  occurredAt: "2026-08-02T08:30:00.000Z",
  ...overrides
});

describe("auditEventCategory", () => {
  it("classe les transitions d'état", () => {
    expect(auditEventCategory("MISSION_CREATED")).toBe("transition");
    expect(auditEventCategory("MISSION_ACCEPTED")).toBe("transition");
    expect(auditEventCategory("MISSION_ABANDONED")).toBe("transition");
  });

  it("classe les décisions de delivery", () => {
    expect(auditEventCategory("DELIVERY_DECLARED")).toBe("delivery");
    expect(auditEventCategory("DELIVERY_DECIDED")).toBe("delivery");
  });

  it("classe les événements de run, gate, config et provider", () => {
    expect(auditEventCategory("RUN_TERMINAL_RECORDED")).toBe("run");
    expect(auditEventCategory("EVIDENCE_RECORDED")).toBe("run");
    expect(auditEventCategory("GATE_EVALUATED")).toBe("gate");
    expect(auditEventCategory("MISSION_AGENT_CONFIG_UPDATED")).toBe("config");
    expect(auditEventCategory("PROVIDER_SESSION_MISSION_ACTIVATED")).toBe("provider");
  });

  it("classe les types inconnus en other", () => {
    expect(auditEventCategory("EVENT_INCONNU")).toBe("other");
  });
});

describe("filterAuditEvents", () => {
  const events: MissionAuditView[] = [
    event({ id: "audit/a", eventType: "MISSION_CREATED" }),
    event({ id: "audit/b", eventType: "DELIVERY_DECIDED" }),
    event({ id: "audit/c", eventType: "GATE_EVALUATED" }),
    event({ id: "audit/d", eventType: "EVENT_INCONNU" })
  ];

  it("ne filtre rien sur all", () => {
    expect(filterAuditEvents(events, "all")).toHaveLength(4);
  });

  it("filtre par catégorie", () => {
    expect(filterAuditEvents(events, "transition").map((item) => item.id)).toEqual(["audit/a"]);
    expect(filterAuditEvents(events, "delivery").map((item) => item.id)).toEqual(["audit/b"]);
    expect(filterAuditEvents(events, "gate").map((item) => item.id)).toEqual(["audit/c"]);
    expect(filterAuditEvents(events, "other").map((item) => item.id)).toEqual(["audit/d"]);
  });

  it("expose les filtres dans l'ordre du panneau", () => {
    expect(AUDIT_FILTERS.map((filter) => filter.key)).toEqual([
      "all", "transition", "delivery", "run", "gate", "config", "provider"
    ]);
  });
});

describe("countAuditCategories", () => {
  it("compte les événements par catégorie", () => {
    const counts = countAuditCategories([
      event({ id: "audit/a", eventType: "MISSION_CREATED" }),
      event({ id: "audit/b", eventType: "MISSION_ACCEPTED" }),
      event({ id: "audit/c", eventType: "DELIVERY_DECIDED" }),
      event({ id: "audit/d", eventType: "EVENT_INCONNU" })
    ]);
    expect(counts).toEqual({
      transition: 2, delivery: 1, run: 0, gate: 0, config: 0, provider: 0, other: 1
    });
  });
});

describe("describeAuditEvent", () => {
  it("décrit une transition avec le libellé et le changement d'état", () => {
    expect(describeAuditEvent(event())).toBe("Mise en file (DRAFT → READY)");
  });

  it("décrit une décision de delivery acceptée", () => {
    expect(describeAuditEvent(event({
      eventType: "DELIVERY_DECIDED",
      payload: { schemaVersion: 1, decision: "accept", missionId: "m1" }
    }))).toBe("Décision de delivery — acceptée");
  });

  it("décrit une décision de delivery rejetée", () => {
    expect(describeAuditEvent(event({
      eventType: "DELIVERY_DECIDED",
      payload: { schemaVersion: 1, decision: "reject", missionId: "m1" }
    }))).toBe("Décision de delivery — rejetée");
  });

  it("décrit une gate évaluée avec son état", () => {
    expect(describeAuditEvent(event({
      eventType: "GATE_EVALUATED",
      payload: { schemaVersion: 1, state: "passed" }
    }))).toBe("Gate évaluée — passée");
  });

  it("retombe sur le libellé seul sans payload décision/état", () => {
    expect(describeAuditEvent(event({ eventType: "RUN_TERMINAL_RECORDED", payload: { schemaVersion: 1 } }))).toBe("Fin de run");
    expect(describeAuditEvent(event({
      eventType: "DELIVERY_DECIDED",
      payload: { schemaVersion: 1 }
    }))).toBe("Décision de delivery");
  });
});

describe("auditActorLabel", () => {
  it("traduit les acteurs", () => {
    expect(auditActorLabel("user")).toBe("Utilisateur");
    expect(auditActorLabel("manager")).toBe("Manager");
  });
});

describe("formatAuditTime", () => {
  it("formate un horodatage ISO en date courte + heure", () => {
    const formatted = formatAuditTime("2026-08-02T08:30:00.000Z");
    expect(formatted).toMatch(/^\d{2} [a-zéû]+ · \d{2}:\d{2}$/);
  });

  it("retourne l'entrée brute si la date est invalide", () => {
    expect(formatAuditTime("pas-une-date")).toBe("pas-une-date");
  });
});
