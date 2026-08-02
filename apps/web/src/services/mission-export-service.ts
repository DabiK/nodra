import type { AgentConfigView, MissionRunsView, MissionView } from "../types";
import { formatCostMicros, formatTokenCount, runTokenTotal } from "./budget-service";
import { formatDuration } from "./pipeline-timeline-service";
import type { MissionAuditView } from "./mission-audit-service";
import type { EvidenceView } from "./evidence-service";
import type { MissionResultView } from "./mission-result-service";

/** Données nécessaires à l'export Markdown d'une mission. */
export interface MissionExportInput {
  mission: MissionView;
  config: AgentConfigView | null;
  result: MissionResultView | null;
  runs: MissionRunsView | null;
  notes: string;
  audit: MissionAuditView[];
  evidence: EvidenceView[];
}

/** Libellés lisibles des événements d'audit liés à une mission (mission, runs, gates). */
const AUDIT_EVENT_LABELS: Record<string, string> = {
  MISSION_CREATED: "Création",
  MISSION_PREPARED: "Mise en file",
  MISSION_PICKED_UP: "Démarrage du run",
  MISSION_BLOCKED: "Blocage",
  MISSION_RESUMED: "Reprise",
  MISSION_CORRECTION_REQUESTED: "Corrections demandées",
  MISSION_SUBMITTED_FOR_VALIDATION: "Soumission en validation",
  MISSION_ACCEPTED: "Acceptation de la delivery",
  MISSION_CLOSED: "Clôture",
  MISSION_ABANDONED: "Abandon",
  MISSION_AGENT_ENABLED: "Config agent activée",
  MISSION_AGENT_CONFIG_UPDATED: "Config agent mise à jour",
  MISSION_START_REQUESTED: "Démarrage demandé",
  PROVIDER_SESSION_MISSION_ACTIVATED: "Session provider activée",
  READY_AGENT_MISSION_CREATED_FROM_PROVIDER_SESSION: "Mission créée depuis une session",
  DELIVERY_DECLARED: "Delivery déclarée",
  DELIVERY_DECIDED: "Décision de delivery",
  RUN_TERMINAL_RECORDED: "Fin de run",
  RUN_TERMINAL_MISSION_TRANSITION_SKIPPED: "Transition de fin de run ignorée",
  EVIDENCE_RECORDED: "Preuve enregistrée",
  GATE_DEFINED: "Gate définie",
  GATE_EVALUATED: "Gate évaluée",
  GATE_EVIDENCE_STALE: "Preuve de gate périmée"
};

/** Échappe une cellule de tableau GFM (barres verticales + retours à la ligne). */
export function escapeCell(value: string | null | undefined): string {
  return (value ?? "").replaceAll("|", "\\|").replaceAll("\n", " ");
}

/** Prépare un texte multi-lignes en blockquote GFM (`> ` par ligne). */
export function toBlockquote(text: string | null | undefined): string {
  const value = (text ?? "").trim();
  if (!value) return "";
  return value
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
}

/** Détail lisible d'un événement d'audit : libellé + transition d'état. */
export function describeAuditEvent(event: MissionAuditView): string {
  const label = AUDIT_EVENT_LABELS[event.eventType] ?? event.eventType;
  const from = event.payload?.fromState;
  const to = event.payload?.toState;
  if (typeof from === "string" && typeof to === "string") {
    return `${label} (${from} → ${to})`;
  }
  return label;
}

/** Construit le Markdown GFM d'export d'une mission. */
export function buildMissionMarkdown(input: MissionExportInput): string {
  const { mission, config, result, runs, notes, audit, evidence } = input;
  const sections: string[] = [];

  sections.push(`# Mission : ${escapeCell(mission.title)}`);
  sections.push("");
  sections.push("| Champ | Valeur |");
  sections.push("| --- | --- |");
  sections.push(`| Statut | ${escapeCell(mission.state)} |`);
  sections.push(`| Type | ${escapeCell(mission.executionKind)} |`);
  sections.push(`| Version | ${escapeCell(String(mission.version))} |`);
  sections.push(`| Créée le | ${escapeCell(mission.createdAt)} |`);
  sections.push(`| Mise à jour | ${escapeCell(mission.updatedAt)} |`);
  sections.push(`| Dernier run | ${escapeCell(result?.latestRunId)} ${escapeCell(result?.latestRunState)} |`);

  sections.push("");
  sections.push("## Configuration agent");
  if (config) {
    sections.push("");
    sections.push("| Champ | Valeur |");
    sections.push("| --- | --- |");
    sections.push(`| Version config | ${escapeCell(String(config.version))} |`);
    sections.push(`| Provider | ${escapeCell(config.providerId)} |`);
    sections.push(`| Modèle | ${escapeCell(config.modelId)} |`);
    sections.push(`| Réflexion | ${escapeCell(config.reasoningEffort)} |`);
    sections.push(`| Permissions | ${escapeCell(config.permissionPreset)} |`);
    sections.push(`| Workspace | ${escapeCell(config.workspaceId)} |`);
    sections.push(`| Auto-commit | ${config.autoCommitAuthorized ? "autorisé" : "non"} |`);
    sections.push(`| Intégration | ${escapeCell(config.integrationTargetRef)} |`);
  } else {
    sections.push("");
    sections.push("_Non activée._");
  }

  sections.push("");
  sections.push("## Prompt");
  sections.push("");
  sections.push(config?.missionPrompt?.trim() ? toBlockquote(config.missionPrompt) : "_Aucun prompt configuré._");

  sections.push("");
  sections.push("## Résultat déclaré");
  sections.push("");
  sections.push(result?.assistantMessage?.trim() ? toBlockquote(result.assistantMessage) : "_Aucun résultat déclaré._");
  if (result?.delivery?.decisionComment?.trim()) {
    sections.push("");
    sections.push(`Commentaire de décision : ${escapeCell(result.delivery.decisionComment)}`);
  }

  sections.push("");
  sections.push("## Preuves");
  if (evidence.length === 0) {
    sections.push("");
    sections.push("_Aucune preuve collectée._");
  } else {
    sections.push("");
    for (const item of evidence) {
      const blobs = item.blobs.map((entry) => entry.blob.relativePath).join(", ");
      sections.push(`- ${escapeCell(item.kind)} — \`${escapeCell(item.id)}\` (${escapeCell(item.collectorId)} v${escapeCell(item.collectorVersion)})${blobs ? ` — ${escapeCell(blobs)}` : ""}`);
    }
  }

  sections.push("");
  sections.push("## Notes");
  sections.push("");
  sections.push(notes.trim() ? toBlockquote(notes) : "_Aucune note._");

  sections.push("");
  sections.push("## Historique des runs");
  if (!runs || runs.runs.length === 0) {
    sections.push("");
    sections.push("_Aucun run à ce jour._");
  } else {
    sections.push("");
    sections.push("| Essai | État | Modèle | Durée | Tokens | Coût |");
    sections.push("| --- | --- | --- | --- | --- | --- |");
    for (const run of runs.runs) {
      const tokens = runTokenTotal(run);
      const cost = formatCostMicros(run.costMicros);
      sections.push([
        escapeCell(String(run.attempt)),
        escapeCell(run.state),
        escapeCell(run.modelId),
        run.durationMs != null ? escapeCell(formatDuration(run.durationMs)) : "—",
        tokens !== null ? escapeCell(formatTokenCount(tokens)) : "—",
        cost !== null ? escapeCell(cost) : "—"
      ].join(" | ").replace(/^/, "| ").concat(" |"));
    }
    const total = formatCostMicros(runs.totalCostMicros);
    sections.push(`| **Total** | | | | | ${total !== null ? `**${escapeCell(total)}**` : "—"} |`);
  }

  sections.push("");
  sections.push("## Timeline d'audit");
  if (audit.length === 0) {
    sections.push("");
    sections.push("_Aucun événement d'audit._");
  } else {
    sections.push("");
    sections.push("| Date | Événement | Acteur |");
    sections.push("| --- | --- | --- |");
    for (const event of audit) {
      sections.push(`| ${escapeCell(event.occurredAt)} | ${escapeCell(describeAuditEvent(event))} | ${escapeCell(event.actor)} |`);
    }
  }

  sections.push("");
  sections.push(`_Exporté depuis nodra le ${new Date().toISOString()}._`);
  return sections.join("\n");
}

/** Nom de fichier d'export : `mission-<titre-slug>-<id>.md`. */
export function exportFileName(mission: MissionView): string {
  const slug = mission.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const idSlug = mission.id.replace(/[^a-z0-9-]+/gi, "-");
  return `mission-${slug || "export"}-${idSlug}.md`;
}
