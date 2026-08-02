import type { MissionView, PipelineListItem } from "../types";

/**
 * Catalogue de commandes pour la palette Cmd+K.
 * Le service est pur : il construit la liste des commandes depuis l'état du
 * board (missions + pipelines) et filtre selon la requête de recherche.
 */

export type PaletteGroup = "Navigation" | "Création" | "Runs de pipeline" | "Missions";

export type PaletteAction =
  | { kind: "navigate"; page: "tasks" | "pipelines" | "managers" | "provider-sessions" }
  | { kind: "create-mission" }
  | { kind: "start-pipeline"; pipelineId: string }
  | { kind: "advance-pipeline"; pipelineId: string; runId: string }
  | { kind: "accept-delivery"; missionId: string }
  | { kind: "open-mission"; missionId: string };

export interface PaletteCommand {
  id: string;
  label: string;
  hint: string;
  group: PaletteGroup;
  keywords: string[];
  action: PaletteAction;
}

export interface PaletteInput {
  page: string;
  missions: MissionView[];
  pipelines: PipelineListItem[];
}

type NavigablePage = "tasks" | "pipelines" | "managers" | "provider-sessions";

const NAVIGATION: Array<{ page: NavigablePage; label: string; hint: string; keywords: string[] }> = [
  { page: "tasks", label: "Aller aux Tâches", hint: "Flux · board des missions", keywords: ["flux", "board", "missions", "accueil"] },
  { page: "pipelines", label: "Aller aux Pipelines", hint: "Workflows multi-missions", keywords: ["workflow", "étapes", "runs"] },
  { page: "managers", label: "Aller aux Managers", hint: "Agents méta d'orchestration", keywords: ["méta", "orchestration", "guild"] },
  { page: "provider-sessions", label: "Aller aux Sessions provider", hint: "Observatoire des conversations", keywords: ["observatoire", "conversations", "provider"] }
];

const MAX_OPEN_MISSIONS = 30;

export function buildPaletteCommands(input: PaletteInput): PaletteCommand[] {
  const commands: PaletteCommand[] = [];

  for (const item of NAVIGATION) {
    commands.push({
      id: `nav-${item.page}`,
      label: item.label,
      hint: item.hint,
      group: "Navigation",
      keywords: item.keywords,
      action: { kind: "navigate", page: item.page }
    });
  }

  commands.push({
    id: "create-mission",
    label: "Créer une mission",
    hint: "Ouvre le formulaire de capture",
    group: "Création",
    keywords: ["nouvelle", "tâche", "intake", "ajouter", "capture"],
    action: { kind: "create-mission" }
  });

  for (const pipeline of input.pipelines) {
    const runId = pipeline.runId;
    const canStart = !runId || pipeline.runState === "completed" || pipeline.runState === "cancelled" || pipeline.runState === "failed";
    if (canStart) {
      commands.push({
        id: `start-pipeline:${pipeline.id}`,
        label: `Démarrer le run · ${pipeline.name}`,
        hint: runId ? "Relancer la pipeline" : "Lancer la première exécution",
        group: "Runs de pipeline",
        keywords: ["lancer", "run", "démarrer", "executer"],
        action: { kind: "start-pipeline", pipelineId: pipeline.id }
      });
    } else if (runId !== null && (pipeline.runState === "active" || pipeline.runState === "blocked")) {
      commands.push({
        id: `advance-pipeline:${pipeline.id}`,
        label: `Avancer le run · ${pipeline.name}`,
        hint: "Passer à l'étape suivante",
        group: "Runs de pipeline",
        keywords: ["avancer", "run", "suivant", "étape"],
        action: { kind: "advance-pipeline", pipelineId: pipeline.id, runId }
      });
    }
  }

  const openable = input.missions.slice(0, MAX_OPEN_MISSIONS);
  for (const mission of openable) {
    const waitingValidation = mission.executionKind === "agent" && mission.state === "VALIDATION";
    if (waitingValidation) {
      commands.push({
        id: `accept-delivery:${mission.id}`,
        label: `Accepter la delivery · ${mission.title}`,
        hint: `Mission ${mission.id} · résultat à valider`,
        group: "Missions",
        keywords: ["accepter", "valider", "delivery", "résultat", mission.id.toLowerCase()],
        action: { kind: "accept-delivery", missionId: mission.id }
      });
    }
    commands.push({
      id: `open-mission:${mission.id}`,
      label: `Ouvrir la mission · ${mission.title}`,
      hint: `${mission.id} · ${mission.executionKind === "agent" ? "agent" : "humain"} · ${mission.state}`,
      group: "Missions",
      keywords: ["ouvrir", "fiche", mission.id.toLowerCase()],
      action: { kind: "open-mission", missionId: mission.id }
    });
  }

  return commands;
}

export function filterPaletteCommands(commands: PaletteCommand[], query: string): PaletteCommand[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return commands;
  return commands.filter((command) =>
    [command.label, command.hint, command.keywords.join(" ")]
      .join(" ")
      .toLowerCase()
      .includes(needle)
  );
}

/** Regroupe les commandes filtrées dans l'ordre de leur groupe, pour l'affichage. */
export function groupPaletteCommands(commands: PaletteCommand[]): Array<{ group: PaletteGroup; commands: PaletteCommand[] }> {
  const groups: PaletteGroup[] = ["Navigation", "Création", "Runs de pipeline", "Missions"];
  return groups
    .map((group) => ({ group, commands: commands.filter((command) => command.group === group) }))
    .filter((entry) => entry.commands.length > 0);
}
