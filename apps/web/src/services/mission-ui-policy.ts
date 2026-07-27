import type { MissionState, MissionView } from "../types";

export type MissionActionId =
  | "configure"
  | "start"
  | "open-run"
  | "view-result"
  | "validate"
  | "accept-result"
  | "request-changes"
  | "reject-result"
  | "resume"
  | "abandon"
  | "mark-ready"
  | "pickup"
  | "complete-human";

export interface MissionUiContext {
  mission: MissionView;
  hasAgentConfig: boolean;
  latestRunId: string | null;
  latestRunState: string | null;
  hasDelivery: boolean;
  hasResultText: boolean;
}

export interface MissionUiAction {
  id: MissionActionId;
  label: string;
  enabled: boolean;
  primary?: boolean;
  danger?: boolean;
  disabledReason?: string;
}

export interface MissionUiPolicy {
  phaseLabel: string;
  headline: string;
  description: string;
  actions: MissionUiAction[];
  primaryAction: MissionUiAction | null;
  showConfigPanel: boolean;
  showResultPanel: boolean;
  showConversationLink: boolean;
  showValidationActions: boolean;
  canEditConfig: boolean;
  canStart: boolean;
}

const labels: Record<MissionState, string> = {
  DRAFT: "Brouillon",
  BACKLOG: "Backlog",
  READY: "Prête",
  ACTIVE: "En cours",
  BLOCKED: "Bloquée",
  VALIDATION: "Validation",
  DONE: "Terminée",
  ABANDONED: "Abandonnée"
};

function action(input: MissionUiAction): MissionUiAction {
  return input;
}

function primary(actions: MissionUiAction[]) {
  return actions.find((item) => item.primary) ?? actions.find((item) => item.enabled) ?? null;
}

export function getMissionUiPolicy(context: MissionUiContext): MissionUiPolicy {
  const { mission } = context;
  const isAgent = mission.executionKind === "agent";
  const canEditConfig = isAgent && mission.state === "DRAFT" && context.hasAgentConfig;
  const canStart = isAgent && ["DRAFT", "READY"].includes(mission.state) && context.hasAgentConfig;
  const showConversationLink = Boolean(context.latestRunId);
  const showResultPanel = Boolean(context.latestRunId) || ["VALIDATION", "DONE", "BLOCKED"].includes(mission.state);
  const showValidationActions = isAgent && mission.state === "VALIDATION";
  const actions = isAgent ? agentActions(context, canEditConfig, canStart) : humanActions(context);

  return {
    phaseLabel: labels[mission.state],
    headline: headline(context),
    description: description(context),
    actions,
    primaryAction: primary(actions),
    showConfigPanel: canEditConfig || (isAgent && mission.state === "DRAFT"),
    showResultPanel,
    showConversationLink,
    showValidationActions,
    canEditConfig,
    canStart
  };
}

function agentActions(context: MissionUiContext, canEditConfig: boolean, canStart: boolean): MissionUiAction[] {
  const hasRun = Boolean(context.latestRunId);
  const hasResult = context.hasResultText || hasRun;
  const deliveryReason = context.hasDelivery ? undefined : "Résultat structuré indisponible";

  switch (context.mission.state) {
    case "DRAFT":
      return [
        action({ id: canStart ? "start" : "configure", label: canStart ? "Lancer →" : "Configurer", enabled: canStart || canEditConfig, primary: true }),
        action({ id: "configure", label: "Configurer", enabled: canEditConfig }),
        action({ id: "open-run", label: "Voir dernier run", enabled: hasRun, disabledReason: "Aucun run disponible" }),
        action({ id: "abandon", label: "Abandonner", enabled: true, danger: true })
      ];
    case "READY":
      return [
        action({ id: "start", label: "Lancer →", enabled: canStart, primary: true, disabledReason: "Configuration agent manquante" }),
        action({ id: "open-run", label: "Voir dernier run", enabled: hasRun, disabledReason: "Aucun run disponible" }),
        action({ id: "abandon", label: "Abandonner", enabled: true, danger: true })
      ];
    case "ACTIVE":
      return [
        action({ id: "open-run", label: "Ouvrir le run", enabled: hasRun, primary: true, disabledReason: "Run introuvable" })
      ];
    case "VALIDATION":
      return [
        action({ id: "validate", label: "Valider ✓", enabled: true, primary: true }),
        action({ id: "view-result", label: "Voir résultat", enabled: hasResult, disabledReason: "Aucun résultat disponible" }),
        action({ id: "open-run", label: "Ouvrir conversation", enabled: hasRun, disabledReason: "Run introuvable" }),
        action({ id: "accept-result", label: "Accepter (delivery)", enabled: context.hasDelivery, disabledReason: deliveryReason }),
        action({ id: "request-changes", label: "Demander corrections", enabled: context.hasDelivery, disabledReason: deliveryReason }),
        action({ id: "abandon", label: "Abandonner", enabled: true, danger: true })
      ];
    case "DONE":
      return [
        action({ id: "view-result", label: "Voir résultat", enabled: hasResult, primary: true, disabledReason: "Aucun résultat disponible" }),
        action({ id: "open-run", label: "Ouvrir conversation", enabled: hasRun, disabledReason: "Run introuvable" })
      ];
    case "BLOCKED":
      return [
        action({ id: "open-run", label: "Voir erreur / run", enabled: hasRun, primary: hasRun, disabledReason: "Run introuvable" }),
        action({ id: "resume", label: "Remettre READY", enabled: true, primary: !hasRun }),
        action({ id: "abandon", label: "Abandonner", enabled: true, danger: true })
      ];
    case "ABANDONED":
      return [action({ id: "open-run", label: "Ouvrir conversation", enabled: hasRun, disabledReason: "Aucun run disponible" })];
    default:
      return [];
  }
}

function humanActions(context: MissionUiContext): MissionUiAction[] {
  switch (context.mission.state) {
    case "DRAFT":
      return [
        action({ id: "mark-ready", label: "Marquer READY", enabled: true, primary: true }),
        action({ id: "complete-human", label: "Terminer", enabled: true }),
        action({ id: "abandon", label: "Abandonner", enabled: true, danger: true })
      ];
    case "READY":
      return [
        action({ id: "pickup", label: "Prendre en charge", enabled: true, primary: true }),
        action({ id: "complete-human", label: "Terminer", enabled: true }),
        action({ id: "abandon", label: "Abandonner", enabled: true, danger: true })
      ];
    case "ACTIVE":
      return [
        action({ id: "complete-human", label: "Terminer ✓", enabled: true, primary: true })
      ];
    case "BLOCKED":
      return [
        action({ id: "resume", label: "Reprendre", enabled: true, primary: true }),
        action({ id: "abandon", label: "Abandonner", enabled: true, danger: true })
      ];
    default:
      return [];
  }
}

function headline(context: MissionUiContext) {
  if (context.mission.executionKind === "human") {
    if (context.mission.state === "ACTIVE") return "Mission humaine en cours";
    return labels[context.mission.state];
  }
  if (context.mission.state === "VALIDATION") return "Résultat à valider";
  if (context.mission.state === "DONE") return "Mission terminée";
  if (context.mission.state === "ACTIVE") return "Agent en cours d'exécution";
  if (context.mission.state === "BLOCKED") return "Mission agent bloquée";
  if (context.mission.state === "READY") return "Prête à lancer";
  if (context.mission.state === "DRAFT") return "Préparer le lancement";
  return labels[context.mission.state];
}

function description(context: MissionUiContext) {
  if (context.mission.state === "VALIDATION") return "Consulte le résultat produit puis accepte ou demande une correction quand une delivery structurée existe.";
  if (context.mission.state === "DONE") return "La mission est close. Le dernier run reste consultable.";
  if (context.mission.state === "ACTIVE") return "Suis la conversation et les événements du run en cours.";
  if (context.mission.state === "BLOCKED") return "Inspecte le dernier run ou remets la mission en READY avant un nouveau lancement.";
  if (context.mission.state === "READY") return "La mission peut démarrer si sa configuration agent est complète.";
  if (context.mission.state === "DRAFT") return "La configuration reste éditable avant le premier lancement.";
  return "Aucune action principale n'est disponible pour cet état.";
}
