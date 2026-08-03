import type { MissionIntakeDraft, ProviderOptionsCatalog } from "../types";
import { createInitialDraft } from "./mission-intake-service";
import { DEFAULT_WORKSPACE_MODE } from "./workspace-mode";

export type MissionTemplateId = "refactor" | "test" | "release";

export interface MissionTemplate {
  id: MissionTemplateId;
  label: string;
  emoji: string;
  description: string;
  title: string;
  prompt: string;
  workspaceKind?: MissionIntakeDraft["workspaceKind"];
}

/** Modèles de mission : config agent pré-remplie (provider/modèle par défaut + prompt type). */
export const MISSION_TEMPLATES: MissionTemplate[] = [
  {
    id: "refactor",
    label: "Refactorer",
    emoji: "🧹",
    description: "Nettoyer un module : structure, lisibilité, maintenabilité, sans casser le comportement.",
    title: "Refactorer un module",
    prompt: `Refactore le code de la mission de bout en bout.

Objectif : améliorer la structure, la lisibilité et la maintenabilité du code SANS en changer le comportement observable.

Contraintes :
- Ne modifie aucune API publique ni contrat de données.
- La suite de tests existante doit rester verte ; ajoute des tests si le refactoring le justifie.
- Découpe en étapes courtes et commitables, avec des messages de commit explicites.
- Termine par un récapitulatif : fichiers touchés, décisions de structure, risques résiduels.`
  },
  {
    id: "test",
    label: "Écrire des tests",
    emoji: "🧪",
    description: "Couvrir le comportement clé : cas nominaux, erreurs, limites — suite verte incluse.",
    title: "Écrire une suite de tests",
    prompt: `Écris une suite de tests pour la mission de bout en bout.

Objectif : couvrir le comportement clé du code concerné (cas nominaux, erreurs, limites).

Contraintes :
- Suis le framework et les conventions de tests déjà présents dans le projet.
- Chaque test doit être déterministe et isolé ; évite les dépendances réseau ou système sauf si inévitable (mock).
- Vise la couverture des chemins critiques plutôt que le nombre de tests.
- Lance la suite pour vérifier qu'elle passe, puis termine par un récapitulatif des fichiers et de la couverture ajoutée.`
  },
  {
    id: "release",
    label: "Préparer une release",
    emoji: "📦",
    description: "Changelog, version semver, notes de release prêtes à partager et archiver.",
    title: "Préparer une release",
    prompt: `Prépare la release de la mission de bout en bout.

Objectif : produire un livrable prêt à être partagé et archivé (changelog, version, notes de release).

Contraintes :
- Inventorie les changements livrés depuis la dernière version connue (commits, fichiers, comportements).
- Rédige un changelog clair : ajouts, corrections, changements de comportement, migration nécessaire.
- Vérifie que la version proposée est cohérente (semver) avec les changements.
- Termine par un récapitulatif : notes de release prêtes à coller, version proposée, points de vigilance.`
  }
];

export function findMissionTemplate(id: string): MissionTemplate | undefined {
  return MISSION_TEMPLATES.find((template) => template.id === id);
}

/** Brouillon pré-rempli depuis un modèle : réglages par défaut du catalogue, prompt du modèle. */
export function templateDraft(template: MissionTemplate, catalog: ProviderOptionsCatalog): MissionIntakeDraft {
  const base = createInitialDraft(catalog);
  return {
    ...base,
    title: template.title,
    kind: "agent",
    prompt: template.prompt,
    workspaceKind: template.workspaceKind ?? DEFAULT_WORKSPACE_MODE,
    workspaceName: template.id
  };
}
