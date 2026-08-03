import type { MissionIntakeDraft, PipelineView, ProviderOptionsCatalog } from "../types";
import { createConfiguredMission, createHumanMission } from "./mission-service";
import { createPipeline } from "./pipeline-service";
import { createInitialDraft } from "./mission-intake-service";
import { DEFAULT_WORKSPACE_MODE } from "./workspace-mode";

export const EXAMPLE_PIPELINE_NAME = "Exemple · Revue puis livraison";

export const EXAMPLE_REVIEW_PROMPT = `Fais une revue de code de la mission de bout en bout.

Objectif : identifier les problèmes (bugs, régressions, dette, sécurité) et proposer des améliorations actionnables.

Contraintes :
- Lis le code livré et confronte-le au contexte de la mission.
- Classe les retours par sévérité : bloquant, important, suggestion.
- Ne modifie le code que pour les corrections bloquantes évidentes ; documente les autres.
- Termine par un récapitulatif : verdict, points bloquants, suggestions prioritaires.`;

/** Brouillon de l'étape agent du pipeline d'exemple (réglages par défaut + prompt de revue). */
export function exampleAgentDraft(catalog: ProviderOptionsCatalog): MissionIntakeDraft {
  const base = createInitialDraft(catalog);
  return {
    ...base,
    title: "Revue de code",
    kind: "agent",
    prompt: EXAMPLE_REVIEW_PROMPT,
    workspaceKind: DEFAULT_WORKSPACE_MODE,
    workspaceName: "example-review"
  };
}

/**
 * Pipeline d'exemple en 1 clic : une mission agent (« Revue de code ») puis une
 * mission humaine (« Livraison manuelle ») qui matérialise la validation finale.
 */
export async function createExamplePipeline(catalog: ProviderOptionsCatalog): Promise<PipelineView> {
  const review = await createConfiguredMission(exampleAgentDraft(catalog), catalog);
  const ship = await createHumanMission({ title: "Livraison manuelle" });
  return createPipeline({
    name: EXAMPLE_PIPELINE_NAME,
    nodes: [
      { nodeKey: "review", missionId: review.id },
      { nodeKey: "ship", missionId: ship.id }
    ],
    edges: [{ fromNodeKey: "review", toNodeKey: "ship" }]
  });
}
