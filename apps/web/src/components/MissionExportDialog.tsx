import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { AgentConfigView, MissionRunsView, MissionView } from "../types";
import type { MissionResultView } from "../services/mission-result-service";
import { loadMissionNotes } from "../services/mission-notes-service";
import { loadMissionAudit, type MissionAuditView } from "../services/mission-audit-service";
import { loadRunEvidence, type EvidenceView } from "../services/evidence-service";
import { buildMissionMarkdown, exportFileName } from "../services/mission-export-service";

/** Copie du texte dans le presse-papier (fallback textarea/execCommand). */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return true;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const ok = document.execCommand("copy");
  textarea.remove();
  return ok;
}

/** Télécharge un texte comme fichier `.md`. */
export function downloadMarkdown(filename: string, text: string): void {
  const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/**
 * Dialog d'export Markdown d'une mission : prévisualisation GFM, copie dans le
 * presse-papier et téléchargement `.md` (issue #8).
 */
export function MissionExportDialog({
  mission,
  config,
  result,
  runs,
  onClose
}: {
  mission: MissionView;
  config: AgentConfigView | null;
  result: MissionResultView | null;
  runs: MissionRunsView | null;
  onClose(): void;
}) {
  const [audit, setAudit] = useState<MissionAuditView[]>([]);
  const [evidence, setEvidence] = useState<EvidenceView[]>([]);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    const latestRunId = result?.latestRunId ?? null;
    setLoading(true);
    void Promise.all([
      loadMissionAudit(mission.id).catch(() => []),
      latestRunId ? loadRunEvidence(latestRunId).catch(() => []) : Promise.resolve([])
    ]).then(([auditEvents, evidenceItems]) => {
      if (cancelled) return;
      setAudit(auditEvents);
      setEvidence(evidenceItems);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [mission.id, result?.latestRunId]);

  const markdown = useMemo(() => buildMissionMarkdown({
    mission,
    config,
    result,
    runs,
    notes: loadMissionNotes(mission.id),
    audit,
    evidence
  }), [mission, config, result, runs, audit, evidence]);

  const copy = async () => {
    setError("");
    try {
      const ok = await copyToClipboard(markdown);
      setCopied(ok);
      if (!ok) setError("Copie impossible : presse-papier indisponible dans ce navigateur.");
    } catch {
      setError("Copie impossible : presse-papier indisponible dans ce navigateur.");
    }
  };

  const download = () => {
    setError("");
    downloadMarkdown(exportFileName(mission), markdown);
  };

  return (
    <div className="inspector-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="mission-export-dialog" role="dialog" aria-modal="true" aria-labelledby="missionExportTitle">
        <header>
          <span className="eyebrow">EXPORT MARKDOWN</span>
          <h2 id="missionExportTitle">Prévisualisation avant export</h2>
          <p className="mission-export-subtitle">
            {mission.title} · {exportFileName(mission)}
          </p>
        </header>

        {loading ? (
          <p className="mission-export-loading" role="status">Chargement de la timeline d'audit et des preuves…</p>
        ) : (
          <div className="mission-export-preview">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> }}>
              {markdown}
            </ReactMarkdown>
          </div>
        )}

        {error && <p className="inspector-error" role="alert">{error}</p>}
        {copied && !error && <p className="inspector-notice" role="status">Markdown copié dans le presse-papier.</p>}

        <footer className="mission-export-footer">
          <button className="secondary-button" type="button" onClick={onClose}>Fermer</button>
          <button className="secondary-button" type="button" onClick={() => void copy()} disabled={loading}>Copier</button>
          <button className="primary-button" type="button" onClick={download} disabled={loading}>Télécharger .md</button>
        </footer>
      </section>
    </div>
  );
}
