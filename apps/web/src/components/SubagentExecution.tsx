import { subagentStatusLabel, subagentToolLabel } from "../services/subagent-labels";
import type { ProviderSubagentExecutionView } from "../types";

function durationLabel(execution: ProviderSubagentExecutionView) {
  if (!execution.startedAt) return null;
  const start = new Date(execution.startedAt).getTime();
  const end = execution.finishedAt ? new Date(execution.finishedAt).getTime() : null;
  const elapsed = end !== null ? end - start : null;
  if (elapsed === null || Number.isNaN(elapsed)) return null;
  if (elapsed < 1000) return `${elapsed} ms`;
  return `${(elapsed / 1000).toFixed(1)} s`;
}

function formatAt(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function transcriptItemKindLabel(kind: string) {
  if (kind === "message") return "réponse";
  if (kind === "reasoning") return "réflexion";
  if (kind === "tool_call") return "outil";
  if (kind === "tool_result") return "résultat";
  if (kind === "subagent") return "sous-agent";
  return kind;
}

export function SubagentExecution({ execution }: { execution: ProviderSubagentExecutionView }) {
  const duration = durationLabel(execution);
  const statusLabel = subagentStatusLabel(execution.status);
  return (
    <details className="subagent-execution" open={execution.transcript.length === 0}>
      <summary>
        <span className="subagent-execution-title">
          <strong>Exécution du sous-agent</strong>
          {execution.model ? <code>{execution.model}</code> : null}
          {statusLabel ? <span className="subagent-chip">{statusLabel}</span> : null}
          {duration ? <small>{duration}</small> : null}
        </span>
        <span className="subagent-execution-session"><code>{execution.subSessionId}</code></span>
      </summary>
      {execution.report ? (
        <section className="subagent-execution-report">
          <h4>Rapport du sous-agent</h4>
          <pre>{execution.report}</pre>
        </section>
      ) : null}
      {execution.transcript.length > 0 ? (
        <section className="subagent-execution-transcript">
          <h4>Étapes ({execution.transcript.length})</h4>
          <ol>
            {execution.transcript.map((step) => (
              <li key={step.externalItemId} className={`subagent-step ${step.kind}`}>
                <header>
                  <span>{transcriptItemKindLabel(step.kind)}</span>
                  {step.name ? <code>{subagentToolLabel(step.name) ?? step.name}</code> : null}
                  {formatAt(step.sourceAt) ? <time>{formatAt(step.sourceAt)}</time> : null}
                </header>
                {step.text ? <p>{step.text}</p> : null}
              </li>
            ))}
          </ol>
        </section>
      ) : (
        <p className="subagent-execution-empty">Transcript non disponible pour cette sous-session.</p>
      )}
    </details>
  );
}
