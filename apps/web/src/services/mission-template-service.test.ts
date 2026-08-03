// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { ProviderOptionsCatalog } from "../types";
import { findMissionTemplate, MISSION_TEMPLATES, templateDraft } from "./mission-template-service";

const catalog: ProviderOptionsCatalog = {
  providers: [],
  reasoningEfforts: ["provider_default", "minimal", "low", "medium", "high", "xhigh"],
  permissionPresets: ["read_only", "workspace", "full_access"],
  defaults: {
    providerId: "codex",
    modelId: "gpt-5.4-mini",
    reasoningEffort: "medium",
    permissionPreset: "read_only",
    providerOptions: { schemaVersion: 1, value: {} }
  }
};

describe("mission-template-service", () => {
  it("définit les 3 modèles attendus (refactor, test, release) avec des contenus complets", () => {
    expect(MISSION_TEMPLATES.map((template) => template.id)).toEqual(["refactor", "test", "release"]);
    for (const template of MISSION_TEMPLATES) {
      expect(template.label.length).toBeGreaterThan(0);
      expect(template.description.length).toBeGreaterThan(0);
      expect(template.title.length).toBeGreaterThan(0);
      expect(template.prompt.length).toBeGreaterThan(0);
    }
  });

  it("retrouve un modèle par id et rend undefined pour un id inconnu", () => {
    expect(findMissionTemplate("test")?.label).toBe("Écrire des tests");
    expect(findMissionTemplate("inconnu")).toBeUndefined();
  });

  it("pré-remplit un brouillon agent avec le prompt du modèle et les réglages par défaut du catalogue", () => {
    const draft = templateDraft(MISSION_TEMPLATES[0], catalog);
    expect(draft.kind).toBe("agent");
    expect(draft.title).toBe("Refactorer un module");
    expect(draft.prompt).toContain("Refactore");
    expect(draft.providerId).toBe("codex");
    expect(draft.modelId).toBe("gpt-5.4-mini");
    expect(draft.reasoningEffort).toBe("medium");
    expect(draft.permissionPreset).toBe("read_only");
    expect(draft.workspaceKind).toBe("scratch");
  });
});
