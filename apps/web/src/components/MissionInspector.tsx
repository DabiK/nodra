import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import type { AgentConfigView, MissionInspectorData, MissionRunsView, MissionView, ProviderOptionsCatalog, ProviderReasoningEffort, WorkspaceDraftKind } from "../types";
import { permissionLabels, reasoningLabels, selectDefaultModel } from "../services/provider-service";
import { loadMissionInspector, loadMissionRuns, updateAgentConfig } from "../services/mission-service";
import { formatCostMicros, formatTokenCount, runTokenTotal, usageKindLabel } from "../services/budget-service";
import { formatDuration } from "../services/pipeline-timeline-service";
import { createWorkspace, workspacePathFromName } from "../services/workspace-service";
import { branchNameFromTitle, validateWorkspaceMode } from "../services/workspace-mode";
import { createPrerequisitePipeline } from "../services/pipeline-service";
import { loadMissionResult, type MissionResultView } from "../services/mission-result-service";
import { loadMissionNotes, saveMissionNotes } from "../services/mission-notes-service";
import { loadMissionAudit, type MissionAuditView } from "../services/mission-audit-service";
import {
  DIFF_FILE_STATUS_LABELS,
  loadWorkspaceDiff,
  type WorkspaceDiffView
} from "../services/mission-diff-service";
import {
  AUDIT_FILTERS,
  auditActorLabel,
  auditEventCategory,
  countAuditCategories,
  describeAuditEvent,
  filterAuditEvents,
  formatAuditTime,
  type AuditCategory
} from "../services/mission-audit-view-service";
import { performMissionAction } from "../services/mission-action-service";
import { getMissionUiPolicy, type MissionUiAction, type MissionUiPolicy } from "../services/mission-ui-policy";
import { showWorkspace } from "../services/worktree-service";
import { loadMissionTags, loadTags, setMissionTags, type MissionTag } from "../services/tag-service";
import { WorkspaceModePicker } from "./WorkspaceModePicker";
import { WorktreeResolutionDialog } from "./WorktreeResolutionDialog";
import { MissionExportDialog } from "./MissionExportDialog";
import { MissionReplayDialog } from "./MissionReplayDialog";
import { TagManagerDialog } from "./TagManagerDialog";
import { PixelAvatar } from "./PixelAvatar";
import { ModelPicker } from "./ModelPicker";
import { MissionRunComparator } from "./MissionRunComparator";

export interface InspectorForm {
  providerId: string;
  modelId: string;
  reasoningEffort: ProviderReasoningEffort;
  missionPrompt: string;
  permissionPreset: NonNullable<AgentConfigView["permissionPreset"]>;
  workspaceId: string;
  autoCommitAuthorized: boolean;
  integrationTargetRef: string;
  workspaceKind: WorkspaceDraftKind;
  workspacePath: string;
  workspaceName: string;
  sourceWorkspaceId: string;
  sourceRepositoryPath: string;
  baseRef: string;
  branchName: string;
  prerequisiteMissionIds: string[];
}

export function MissionInspector({
  missionId,
  missions,
  providerOptions,
  onClose,
  onSaved
}: {
  missionId: string;
  missions: MissionView[];
  providerOptions: ProviderOptionsCatalog | null;
  onClose(): void;
  onSaved(): void;
}) {
  const [step, setStep] = useState<"inspect" | "configure">("inspect");
  const [data, setData] = useState<MissionInspectorData | null>(null);
  const [result, setResult] = useState<MissionResultView | null>(null);
  const [runs, setRuns] = useState<MissionRunsView | null>(null);
  const [audit, setAudit] = useState<MissionAuditView[] | null>(null);
  const [form, setForm] = useState<InspectorForm | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [worktree, setWorktree] = useState<{ id: string; branchName: string | null } | null>(null);
  const [showWorktreeDialog, setShowWorktreeDialog] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [showReplay, setShowReplay] = useState(false);
  const [showTagManager, setShowTagManager] = useState(false);
  /** Incrémenté quand le gestionnaire de tags modifie le catalogue → le panneau recharge. */
  const [tagManagerVersion, setTagManagerVersion] = useState(0);

  // Raccourci clavier : Escape ferme la fiche. Ignoré pendant la saisie et
  // quand un sous-dialog (model picker, worktree) est ouvert — ces derniers
  // gèrent leur propre Escape.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const target = event.target as HTMLElement | null;
      if (target?.isContentEditable) return;
      const tag = target?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      if (document.querySelector(".model-picker-backdrop") || showWorktreeDialog || showReplay || showTagManager) return;
      onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, showWorktreeDialog, showReplay, showTagManager]);

  useEffect(() => {
    void loadMissionInspector(missionId)
      .then((result) => {
        setData(result);
        setForm(formFrom(result, providerOptions));
      })
      .catch((reason: Error) => setError(reason.message));
  }, [missionId, providerOptions]);
  useEffect(() => {
    let cancelled = false;
    void loadMissionResult(missionId)
      .then((next) => { if (!cancelled) setResult(next); })
      .catch(() => { if (!cancelled) setResult(null); });
    return () => { cancelled = true; };
  }, [missionId, data?.mission.state]);

  useEffect(() => {
    let cancelled = false;
    void loadMissionRuns(missionId)
      .then((next) => { if (!cancelled) setRuns(next); })
      .catch(() => { if (!cancelled) setRuns(null); });
    return () => { cancelled = true; };
  }, [missionId, data?.mission.state]);

  useEffect(() => {
    let cancelled = false;
    void loadMissionAudit(missionId)
      .then((next) => { if (!cancelled) setAudit(next); })
      .catch(() => { if (!cancelled) setAudit(null); });
    return () => { cancelled = true; };
    // L'historique est immuable et rechargé explicitement après chaque action
    // (applyAction) : dépendre de l'état de la mission double-fetcherait l'audit
    // à l'ouverture (state undefined → READY) et démonterait le panneau.
  }, [missionId]);

  useEffect(() => {
    let cancelled = false;
    const workspaceId = data?.config?.workspaceId;
    if (!workspaceId) { setWorktree(null); return; }
    void showWorkspace(workspaceId)
      .then((record) => {
        if (cancelled) return;
        setWorktree(record.kind === "worktree" && record.state !== "deleted"
          ? { id: record.id, branchName: null }
          : null);
      })
      .catch(() => { if (!cancelled) setWorktree(null); });
    return () => { cancelled = true; };
  }, [data?.config?.workspaceId]);

  const sequenceCandidates = useMemo(
    () => missions.filter((mission) => mission.id !== missionId),
    [missionId, missions]
  );
  const selectedProvider = providerOptions?.providers.find((provider) => provider.id === form?.providerId);
  const selectedModel = selectedProvider?.models.find((model) => model.id === form?.modelId);
  const reasoningOptions = selectedModel?.supportedReasoningEfforts.length
    ? selectedModel.supportedReasoningEfforts
    : providerOptions?.reasoningEfforts ?? [];
  const policy = data?.mission ? getMissionUiPolicy({
    mission: data.mission,
    hasAgentConfig: Boolean(data.config),
    latestRunId: result?.latestRunId ?? null,
    latestRunState: result?.latestRunState ?? null,
    hasDelivery: Boolean(result?.hasStructuredDelivery),
    hasResultText: Boolean(result?.assistantMessage?.trim()),
    hasProviderSession: Boolean(data.providerSession)
  }) : null;

  const patch = (patchValue: Partial<InspectorForm>) => setForm((current) => current ? { ...current, ...patchValue } : current);
  // Rejouer / dupliquer : dispo pour toute mission agent configurée, hors run en cours.
  const canReplay = Boolean(
    data?.mission
    && data.mission.executionKind === "agent"
    && data.config
    && data.mission.state !== "ACTIVE"
  );
  const replayDone = (created: MissionView) => {
    setShowReplay(false);
    onSaved();
    setNotice(`Mission « ${created.title} » dupliquée — prête dans le board (READY).`);
  };
  const setProvider = (providerId: string) => {
    if (!providerOptions) return;
    const modelId = selectDefaultModel(providerOptions, providerId);
    const model = providerOptions.providers.find((provider) => provider.id === providerId)?.models.find((item) => item.id === modelId);
    patch({ providerId, modelId, reasoningEffort: model?.defaultReasoningEffort ?? providerOptions.defaults.reasoningEffort });
  };
  const togglePrerequisite = (missionIdValue: string) => {
    if (!form) return;
    const selected = new Set(form.prerequisiteMissionIds);
    if (selected.has(missionIdValue)) selected.delete(missionIdValue);
    else selected.add(missionIdValue);
    patch({ prerequisiteMissionIds: [...selected] });
  };

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!data?.config || !data.mission || !form) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const workspace = await createWorkspaceFromForm(form, data.mission.title);
      await updateAgentConfig({
        missionId,
        config: data.config,
        values: {
          providerId: form.providerId,
          modelId: form.modelId,
          reasoningEffort: form.reasoningEffort,
          missionPrompt: form.missionPrompt,
          permissionPreset: form.permissionPreset,
          workspaceId: workspace.id,
          autoCommitAuthorized: form.autoCommitAuthorized,
          integrationTargetRef: form.integrationTargetRef || null
        }
      });
      if (form.prerequisiteMissionIds.length) {
        await createPrerequisitePipeline({
          mission: data.mission,
          prerequisiteMissionIds: form.prerequisiteMissionIds
        });
      }
      onSaved();
      setNotice("Configuration sauvegardée");
      setStep("inspect");
      const reloaded = await loadMissionInspector(missionId);
      setData(reloaded);
      setForm(formFrom(reloaded, providerOptions));
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const runAction = async (action: MissionUiAction) => {
    if (!data?.mission || !policy) return;
    if (action.id === "configure") {
      setStep("configure");
      return;
    }
    if (!action.enabled) {
      setError(action.disabledReason ?? "Action indisponible pour cet état de mission.");
      return;
    }
    setBusyAction(action.id);
    setError("");
    setNotice("");
    try {
      await performMissionAction({
        actionId: action.id,
        mission: data.mission,
        latestRunId: result?.latestRunId ?? null,
        declaredResult: result?.assistantMessage ?? undefined
      });
      const [reloaded, reloadedResult, reloadedRuns, reloadedAudit] = await Promise.all([
        loadMissionInspector(missionId),
        loadMissionResult(missionId),
        loadMissionRuns(missionId).catch(() => null),
        loadMissionAudit(missionId).catch(() => null)
      ]);
      setData(reloaded);
      setForm(formFrom(reloaded, providerOptions));
      setResult(reloadedResult);
      setRuns(reloadedRuns);
      setAudit(reloadedAudit);
      setNotice(`${action.label} · action appliquée`);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <div className="inspector-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="agent-inspector" role="dialog" aria-modal="true" aria-labelledby="agentInspectorTitle">
        <header className="agent-modal-head">
          {data?.mission && <PixelAvatar id={data.mission.id} title={data.mission.title} />}
          <div>
            <span className="eyebrow">{step === "inspect" ? "FICHE DE MISSION" : "CONFIGURATION"}</span>
            <h2 id="agentInspectorTitle">{data?.mission.title ?? "Chargement..."}</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Fermer la fiche de mission">×</button>
        </header>

        {step === "inspect" ? (
          <InspectStep
            data={data}
            result={result}
            runs={runs}
            audit={audit}
            policy={policy}
            tagManagerVersion={tagManagerVersion}
            onOpenTagManager={() => setShowTagManager(true)}
            onTagsChanged={onSaved}
          />
        ) : (
          <form id="mission-inspector-form" className="mission-configurator" onSubmit={save}>
            {!data?.config || !form ? (
              <p className="empty">Cette mission n'a pas encore de configuration agent éditable.</p>
            ) : (
              <ConfigureStep
                form={form}
                providerOptions={providerOptions}
                selectedProvider={selectedProvider}
                reasoningOptions={reasoningOptions}
                sequenceCandidates={sequenceCandidates}
                onPatch={patch}
                onProviderChange={setProvider}
                onTogglePrerequisite={togglePrerequisite}
              />
            )}
          </form>
        )}

        {error && <p className="inspector-error" role="alert">{error}</p>}
        {notice && <p className="inspector-notice" role="status">{notice}</p>}
        <footer>
          {step === "configure" && <button className="secondary-button" type="button" onClick={() => setStep("inspect")}>Retour</button>}
          <button className="secondary-button" type="button" onClick={onClose}>Fermer</button>
          {step === "inspect" && worktree && (
            <button className="secondary-button worktree-resolve-button" type="button" onClick={() => setShowWorktreeDialog(true)}>
              🌿 Résoudre le terrain de travail
            </button>
          )}
          {step === "inspect" && canReplay && (
            <button className="secondary-button" type="button" onClick={() => setShowReplay(true)}>
              ↻ Rejouer
            </button>
          )}
          {step === "inspect" && data?.mission && (
            <button className="secondary-button" type="button" onClick={() => setShowExport(true)}>
              ⤓ Exporter
            </button>
          )}
          {step === "inspect" && policy?.actions.map((action) => (
            <button
              className={`${action.primary ? "primary-button" : "secondary-button"} ${action.danger ? "danger-action" : ""}`}
              type="button"
              disabled={busyAction !== null || !action.enabled}
              title={action.enabled ? undefined : action.disabledReason}
              onClick={() => void runAction(action)}
              key={action.id}
            >
              {busyAction === action.id ? "Patiente..." : action.label}
            </button>
          ))}
          {step === "configure" && data?.config && <button className="primary-button session-button" type="submit" form="mission-inspector-form" disabled={saving}>{saving ? "Sauvegarde..." : "Sauvegarder →"}</button>}
        </footer>
        <p className="inspector-safety">Configuration en deux étapes : lecture d'abord, édition explicite ensuite.</p>
      </section>
      {showWorktreeDialog && worktree && (
        <WorktreeResolutionDialog
          workspaceId={worktree.id}
          branchHint={worktree.branchName}
          onClose={(resolved) => {
            setShowWorktreeDialog(false);
            if (resolved) { onSaved(); setNotice("Terrain de travail résolu"); void loadMissionInspector(missionId).then(setData).catch(() => undefined); }
          }}
        />
      )}
      {showExport && data?.mission && (
        <MissionExportDialog
          mission={data.mission}
          config={data.config}
          result={result}
          runs={runs}
          onClose={() => setShowExport(false)}
        />
      )}
      {showReplay && data?.mission && data.config && (
        <MissionReplayDialog
          mission={data.mission}
          config={data.config}
          providerOptions={providerOptions}
          onClose={() => setShowReplay(false)}
          onReplayed={replayDone}
        />
      )}
      {showTagManager && (
        <TagManagerDialog
          open
          onClose={() => setShowTagManager(false)}
          onChanged={() => setTagManagerVersion((version) => version + 1)}
        />
      )}
    </div>
  );
}

function MissionNotesPanel({ missionId }: { missionId: string }) {
  const [notes, setNotes] = useState("");
  const [saved, setSaved] = useState(true);

  useEffect(() => { setNotes(loadMissionNotes(missionId)); setSaved(true); }, [missionId]);
  useEffect(() => {
    if (saved) return;
    const timer = window.setTimeout(() => { saveMissionNotes(missionId, notes); setSaved(true); }, 500);
    return () => window.clearTimeout(timer);
  }, [notes, saved, missionId]);

  return (
    <section className="mission-notes-panel" aria-label="Espace de travail · notes">
      <header>
        <div>
          <span className="eyebrow">ESPACE DE TRAVAIL</span>
          <strong>Bloc-notes de la mission</strong>
        </div>
        <span className={`notes-save-state${saved ? " saved" : ""}`}>{saved ? "✓ Enregistré" : "Enregistrement…"}</span>
      </header>
      <textarea
        value={notes}
        onChange={(event) => { setNotes(event.target.value); setSaved(false); }}
        onBlur={() => { saveMissionNotes(missionId, notes); setSaved(true); }}
        rows={8}
        maxLength={20000}
        placeholder="Contexte, étapes, liens, checklist, décisions… Tout ce qui t'aide à avancer sur cette tâche."
      />
    </section>
  );
}

/**
 * Panneau Tags (issue #23) : tags attachés à la mission (ajout/retrait) et
 * accès au gestionnaire de tags (créer, renommer, recolorer, supprimer).
 * Le catalogue et la liaison sont chargés côté serveur ; chaque mutation
 * notifie le board (`onChanged` → refreshBoard).
 */
function MissionTagsPanel({
  missionId,
  version,
  onOpenManager,
  onChanged
}: {
  missionId: string;
  /** Incrémenté quand le gestionnaire de tags modifie le catalogue. */
  version: number;
  onOpenManager(): void;
  onChanged(): void;
}) {
  const [catalog, setCatalog] = useState<MissionTag[]>([]);
  const [attached, setAttached] = useState<MissionTag[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const reload = useCallback(async () => {
    try {
      const [nextCatalog, nextAttached] = await Promise.all([loadTags(), loadMissionTags(missionId)]);
      setCatalog(nextCatalog);
      setAttached(nextAttached);
      setLoaded(true);
    } catch (reason) {
      setError((reason as Error).message);
    }
  }, [missionId]);

  useEffect(() => { void reload(); }, [reload, version]);

  if (!loaded) return null;

  const available = catalog.filter((tag) => !attached.some((item) => item.id === tag.id));

  const applyTagIds = async (tagIds: string[]) => {
    setBusy(true);
    setError("");
    try {
      await setMissionTags(missionId, tagIds);
      await reload();
      onChanged();
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const addTag = (tagId: string) => applyTagIds([...attached.map((tag) => tag.id), tagId]);
  const removeTag = (tagId: string) => applyTagIds(attached.filter((tag) => tag.id !== tagId).map((tag) => tag.id));

  return (
    <section className="mission-tags-panel" aria-label="Tags de la mission">
      <header>
        <div>
          <span className="eyebrow">TAGS</span>
          <strong>Étiquettes de la mission</strong>
        </div>
        {attached.length > 0 && (
          <span className="mission-tags-total" title={`${attached.length} tag(s) attaché(s)`}>
            {attached.length} tag{attached.length > 1 ? "s" : ""}
          </span>
        )}
      </header>
      {error && <p className="mission-tags-error" role="alert">{error}</p>}
      <div className="mission-tags-editor">
        {attached.length > 0 ? (
          <ul className="mission-tags-list">
            {attached.map((tag) => (
              <li className="mission-tag-chip" style={{ ["--tag-color" as string]: tag.color }} key={tag.id}>
                <i className="tag-dot" aria-hidden="true" />
                <span>{tag.label}</span>
                <button
                  type="button"
                  className="mission-tag-remove"
                  disabled={busy}
                  aria-label={`Retirer le tag ${tag.label}`}
                  onClick={() => void removeTag(tag.id)}
                >×</button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="empty">Aucun tag pour le moment.</p>
        )}
        <div className="mission-tags-actions">
          {available.length > 0 && (
            <select
              aria-label="Ajouter un tag à la mission"
              disabled={busy}
              value=""
              onChange={(event) => { if (event.target.value) void addTag(event.target.value); }}
            >
              <option value="" disabled>＋ Ajouter un tag…</option>
              {available.map((tag) => <option value={tag.id} key={tag.id}>{tag.label}</option>)}
            </select>
          )}
          <button type="button" className="secondary-button mission-tags-manage" disabled={busy} onClick={onOpenManager}>
            ⚙ Gérer les tags
          </button>
        </div>
      </div>
    </section>
  );
}

function MissionBudgetPanel({ runs }: { runs: MissionRunsView | null }) {
  if (!runs) return null;
  const total = formatCostMicros(runs.totalCostMicros);
  return (
    <section className="mission-budget-panel" aria-label="Budget et usage de la mission">
      <header>
        <div>
          <span className="eyebrow">BUDGET &amp; USAGE</span>
          <strong>Coût par run et total</strong>
        </div>
        {runs.runs.length > 0 && (
          <span className={`mission-budget-total${total === null ? " unknown" : ""}`}>
            {total !== null ? `Total : ${total}` : "Coût non rapporté"}
          </span>
        )}
      </header>
      {runs.runs.length === 0 ? (
        <p className="empty">Aucun run à ce jour — le coût apparaîtra dès la première exécution.</p>
      ) : (
        <ol className="mission-budget-runs">
          {runs.runs.map((run) => {
            const cost = formatCostMicros(run.costMicros);
            const tokens = runTokenTotal(run);
            const kind = usageKindLabel(run.usageKind);
            return (
              <li key={run.id} className={`run-state-${run.state.toLowerCase()}`}>
                <span className="mission-budget-run-head">
                  <strong>{run.state}</strong>
                  <code title={run.id}>essai {run.attempt}</code>
                  <small>{run.modelId}{run.providerId ? ` · ${run.providerId}` : ""}</small>
                </span>
                <span className="mission-budget-run-meta">
                  {run.durationMs != null && <span>{formatDuration(run.durationMs)}</span>}
                  {tokens !== null && <span>{formatTokenCount(tokens)} tokens</span>}
                  {cost !== null
                    ? <b className="mission-budget-cost">{cost}</b>
                    : <b className="mission-budget-cost unknown">coût —</b>}
                </span>
                {kind && <small className="mission-budget-usage-kind">{kind}</small>}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

function MissionDiffPanel({ workspaceId }: { workspaceId: string }) {
  const [diff, setDiff] = useState<WorkspaceDiffView | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadWorkspaceDiff(workspaceId)
      .then((next) => { if (!cancelled) setDiff(next); })
      .catch(() => { if (!cancelled) setDiff(null); });
    return () => { cancelled = true; };
  }, [workspaceId]);

  if (!diff) return null;
  return (
    <section className="mission-diff-panel" aria-label="Fichiers modifiés du workspace">
      <header>
        <div>
          <span className="eyebrow">DIFF GIT</span>
          <strong>Fichiers modifiés</strong>
        </div>
        {diff.files.length > 0 && (
          <span className="mission-diff-total" title={`${diff.files.length} fichier(s) modifié(s) depuis le snapshot initial`}>
            {diff.files.length} fichier{diff.files.length > 1 ? "s" : ""}
          </span>
        )}
      </header>
      {diff.files.length === 0 ? (
        <p className="empty">Aucune modification depuis le snapshot initial du workspace.</p>
      ) : (
        <ol className="mission-diff-files">
          {diff.files.map((file) => {
            const status = DIFF_FILE_STATUS_LABELS[file.status];
            const isOpen = expanded === file.path;
            return (
              <li key={`${file.oldPath ?? ""}/${file.path}`} className={`diff-status-${file.status}${isOpen ? " open" : ""}`}>
                <button
                  type="button"
                  className="mission-diff-file"
                  onClick={() => setExpanded(isOpen ? null : file.path)}
                  aria-expanded={isOpen}
                >
                  <span className={`diff-status-badge ${file.status}`} title={status.label}>
                    {status.code}
                  </span>
                  <span className="mission-diff-file-path">
                    {file.status === "renamed" && file.oldPath
                      ? <><code>{file.oldPath}</code> → <code>{file.path}</code></>
                      : <code>{file.path}</code>}
                    <small>{status.label}</small>
                  </span>
                  {(file.additions !== null || file.deletions !== null) && (
                    <span className="mission-diff-counts">
                      {file.additions !== null && <b className="adds">+{file.additions}</b>}
                      {file.deletions !== null && <b className="dels">−{file.deletions}</b>}
                    </span>
                  )}
                </button>
                {isOpen && <pre className="mission-diff-content" role="region" aria-label={`Diff de ${file.path}`}>{file.content || "Diff indisponible pour ce fichier."}</pre>}
              </li>
            );
          })}
        </ol>
      )}
      <small className="mission-diff-refs" title={`base: ${diff.base ?? "—"} · head: ${diff.head ?? "arbre de travail"}`}>
        Snapshot initial → état actuel du workspace.
      </small>
    </section>
  );
}

function MissionAuditPanel({ missionId, audit }: { missionId: string; audit: MissionAuditView[] | null }) {
  const [filter, setFilter] = useState<"all" | AuditCategory>("all");
  if (!audit) return null;
  const counts = countAuditCategories(audit);
  const visible = filterAuditEvents(audit, filter);
  return (
    <section className="mission-audit-panel" aria-label="Historique de la mission">
      <header>
        <div>
          <span className="eyebrow">HISTORIQUE</span>
          <strong>Timeline d'audit</strong>
        </div>
        {audit.length > 0 && (
          <span className="mission-audit-total" title={`${audit.length} événement(s) d'audit`}>
            {audit.length} événement{audit.length > 1 ? "s" : ""}
          </span>
        )}
      </header>
      {audit.length === 0 ? (
        <p className="empty">Aucun événement d'audit pour le moment — la timeline se remplira au fil des transitions et décisions.</p>
      ) : (
        <>
          <div className="mission-audit-chips" role="group" aria-label="Filtrer l'historique par type d'événement">
            {AUDIT_FILTERS.map((option) => {
              const count = option.key === "all" ? audit.length : counts[option.key];
              return (
                <button
                  type="button"
                  className={`view-chip${filter === option.key ? " active" : ""}`}
                  onClick={() => setFilter(option.key)}
                  key={option.key}
                >
                  {option.label}
                  {count > 0 && <small>{count}</small>}
                </button>
              );
            })}
          </div>
          <ol className="mission-audit-list">
            {visible.map((event) => {
              const category = auditEventCategory(event.eventType);
              return (
                <li key={event.id} className={`audit-cat-${category}`}>
                  <span className={`audit-cat-badge ${category}`} title={event.eventType}>{category}</span>
                  <span className="mission-audit-row-body">
                    <strong>{describeAuditEvent(event)}</strong>
                    <span className="mission-audit-row-meta">
                      <span>{auditActorLabel(event.actor)}</span>
                      <time dateTime={event.occurredAt}>{formatAuditTime(event.occurredAt)}</time>
                    </span>
                  </span>
                </li>
              );
            })}
            {visible.length === 0 && (
              <li className="mission-audit-none">Aucun événement de ce type pour le moment.</li>
            )}
          </ol>
        </>
      )}
      <small className="mission-audit-refresh" title={missionId}>
        Historique complet des transitions, décisions, runs et gates de la mission.
      </small>
    </section>
  );
}

function InspectStep({
  data,
  result,
  runs,
  audit,
  policy,
  tagManagerVersion,
  onOpenTagManager,
  onTagsChanged
}: {
  data: MissionInspectorData | null;
  result: MissionResultView | null;
  runs: MissionRunsView | null;
  audit: MissionAuditView[] | null;
  policy: MissionUiPolicy | null;
  /** Incrémenté quand le gestionnaire de tags modifie le catalogue. */
  tagManagerVersion: number;
  onOpenTagManager(): void;
  onTagsChanged(): void;
}) {
  return (
    <div className="agent-modal-body">
      {result?.latestRunState === "FAILED" && result.failure && (
        <div className="run-failure-banner" role="alert">
          <strong>⚠ {result.failure.title}</strong>
          <p>{result.failure.detail}</p>
        </div>
      )}
      <section className="agent-modal-context" aria-label="Contexte de la mission">
        <div className={`inspector-status ${data?.mission.state.toLowerCase() ?? "loading"}`}>
          <i />
          <span>
            <small>État mission</small>
            <strong>{data?.mission.state ?? "Chargement"}</strong>
          </span>
        </div>
        <dl>
          <div><dt>Type</dt><dd>{data?.mission.executionKind ?? "-"}</dd></div>
          <div><dt>Version mission</dt><dd>{data?.mission.version ?? "-"}</dd></div>
          <div><dt>Config agent</dt><dd>{data?.config ? `v${data.config.version}` : "Non activée"}</dd></div>
          <div><dt>Workspace</dt><dd>{data?.config?.workspaceId ?? "Non assigné"}</dd></div>
          <div><dt>Modèle</dt><dd>{data?.config?.modelId ?? "Non configuré"}</dd></div>
          <div><dt>Dernier run</dt><dd>{result?.latestRunId ?? "Aucun"}</dd></div>
          <div><dt>État run</dt><dd>{result?.latestRunState ?? "-"}</dd></div>
        </dl>
        <section className="inspector-prompt">
          <span>Mission confiée</span>
          <p>{data?.config?.missionPrompt || "Aucun prompt configuré."}</p>
        </section>
      </section>
      <section className="agent-modal-delivery" aria-label="Résumé mission">
        <div className={`agent-result-card ${data?.mission.state.toLowerCase() ?? "idle"}`}>
          <span className="eyebrow">{policy?.phaseLabel.toUpperCase() ?? "MISSION"}</span>
          <h3>{policy?.headline ?? "Chargement"}</h3>
          <p>{policy?.description ?? "Lecture de l'état mission..."}</p>
        </div>
        {data?.mission && <MissionNotesPanel missionId={data.mission.id} />}
        {data?.mission && (
          <MissionTagsPanel
            missionId={data.mission.id}
            version={tagManagerVersion}
            onOpenManager={onOpenTagManager}
            onChanged={onTagsChanged}
          />
        )}
        {data?.mission && <MissionBudgetPanel runs={runs} />}
        {data?.mission && runs && <MissionRunComparator runs={runs.runs} />}
        {data?.mission && <MissionAuditPanel missionId={data.mission.id} audit={audit} />}
        {data?.config?.workspaceId && <MissionDiffPanel workspaceId={data.config.workspaceId} />}
        {policy?.showResultPanel && (
          <section className="mission-result-panel" aria-label="Résultat produit">
            <header>
              <div>
                <span className="eyebrow">RÉSULTAT PRODUIT</span>
                <strong>{result?.hasStructuredDelivery ? "Delivery structurée" : "Fallback conversation"}</strong>
              </div>
              {result?.latestRunId && <code>{result.latestRunId}</code>}
            </header>
            <pre>{result?.assistantMessage || "Aucun message assistant exploitable pour l'instant."}</pre>
          </section>
        )}
        {policy?.showValidationActions && !result?.hasStructuredDelivery && (
          <p className="mission-result-warning">Cette mission attend une validation, mais aucun objet delivery structuré n'existe encore. Le résultat affiché vient du dernier message assistant.</p>
        )}
      </section>
    </div>
  );
}

function ConfigureStep({
  form,
  providerOptions,
  selectedProvider,
  reasoningOptions,
  sequenceCandidates,
  onPatch,
  onProviderChange,
  onTogglePrerequisite
}: {
  form: InspectorForm;
  providerOptions: ProviderOptionsCatalog | null;
  selectedProvider: ProviderOptionsCatalog["providers"][number] | undefined;
  reasoningOptions: ProviderReasoningEffort[];
  sequenceCandidates: MissionView[];
  onPatch(patch: Partial<InspectorForm>): void;
  onProviderChange(providerId: string): void;
  onTogglePrerequisite(missionId: string): void;
}) {
  return (
    <div className="mission-config-scroll">
      <div className="mission-config-intro">
        <div>
          <span className="eyebrow">RÉGLAGES DE MISSION</span>
          <h3>Modifier l'agent, le workspace et la séquence</h3>
        </div>
        <span>PRÊT À AJUSTER</span>
      </div>

      <label>
        Prompt agent
        <textarea value={form.missionPrompt} onChange={(event) => onPatch({ missionPrompt: event.target.value })} rows={8} />
      </label>

      <section className="mission-config-agent">
        <div className="mission-config-grid agent-options">
          <label>
            Moteur
            <select value={form.providerId} onChange={(event) => onProviderChange(event.target.value)}>
              {providerOptions?.providers.map((provider) => <option value={provider.id} key={provider.id}>{provider.label}</option>)}
            </select>
          </label>
          <label>
            Modèle
            <ModelPicker
              idPrefix="mission-config"
              models={selectedProvider?.models ?? []}
              value={form.modelId}
              onChange={(modelId) => onPatch({ modelId })}
            />
          </label>
          <label>
            Réflexion
            <select value={form.reasoningEffort} onChange={(event) => onPatch({ reasoningEffort: event.target.value as ProviderReasoningEffort })}>
              {reasoningOptions.map((effort) => <option value={effort} key={effort}>{reasoningLabels[effort] ?? effort}</option>)}
            </select>
          </label>
          <label>
            Permissions
            <select value={form.permissionPreset} onChange={(event) => onPatch({ permissionPreset: event.target.value as InspectorForm["permissionPreset"] })}>
              {providerOptions?.permissionPresets.map((preset) => <option value={preset} key={preset}>{permissionLabels[preset] ?? preset}</option>)}
            </select>
          </label>
        </div>

        <WorkspaceModeEditor form={form} onPatch={onPatch} />
      </section>

      <section className="task-sequence-picker">
        <div className="task-sequence-head">
          <div>
            <span className="eyebrow">SÉQUENCE PIPELINE</span>
            <strong>Pré-requis avant cette mission</strong>
          </div>
          <span className="task-sequence-count">{form.prerequisiteMissionIds.length}</span>
        </div>
        <div className="task-sequence-list">
          {sequenceCandidates.slice(0, 12).map((mission) => (
            <button
              type="button"
              className={form.prerequisiteMissionIds.includes(mission.id) ? "selected" : ""}
              onClick={() => onTogglePrerequisite(mission.id)}
              key={mission.id}
            >
              <strong>{mission.title}</strong>
              <small>{mission.state} · {mission.executionKind}</small>
            </button>
          ))}
          {!sequenceCandidates.length && <p className="empty">Aucune autre mission disponible.</p>}
        </div>
      </section>
    </div>
  );
}

export function WorkspaceModeEditor({ form, onPatch }: { form: InspectorForm; onPatch(patch: Partial<InspectorForm>): void }) {
  const generatedScratchPath = workspacePathFromName(form.workspaceName || form.missionPrompt.slice(0, 40) || "workspace");
  return (
    <>
      <WorkspaceModePicker
        value={form}
        onChange={onPatch}
        generatedScratchPath={generatedScratchPath}
        idPrefix="mission-workspace"
      />
      <div className="mission-config-grid identity">
        <label>
          Target ref
          <input value={form.integrationTargetRef} onChange={(event) => onPatch({ integrationTargetRef: event.target.value })} placeholder="optionnel" />
        </label>
        <label className="toggle-label">
          Auto commit
          <input type="checkbox" checked={form.autoCommitAuthorized} onChange={(event) => onPatch({ autoCommitAuthorized: event.target.checked })} />
        </label>
      </div>
    </>
  );
}

async function createWorkspaceFromForm(form: InspectorForm, fallbackName: string) {
  const validationError = validateWorkspaceMode(form);
  if (validationError) throw new Error(validationError);
  if (form.workspaceKind === "repo") {
    if (!form.workspacePath.trim()) {
      return createWorkspace({ kind: "scratch", path: workspacePathFromName(form.workspaceName || fallbackName) });
    }
    return createWorkspace({ kind: "repo", path: form.workspacePath });
  }
  if (form.workspaceKind === "scratch") {
    return createWorkspace({ kind: "scratch", path: workspacePathFromName(form.workspaceName || fallbackName) });
  }
  return createWorkspace({
    kind: "worktree",
    ...(form.workspacePath.trim() ? { path: form.workspacePath.trim() } : {}),
    ...(form.sourceWorkspaceId ? { sourceWorkspaceId: form.sourceWorkspaceId } : { sourceRepositoryPath: form.sourceRepositoryPath }),
    baseRef: form.baseRef || "HEAD",
    branchName: form.branchName || branchNameFromTitle(fallbackName),
    integrationTargetRef: form.integrationTargetRef || null
  });
}

function formFrom(data: MissionInspectorData, catalog: ProviderOptionsCatalog | null): InspectorForm | null {
  const config = data.config;
  if (!config) return null;
  const providerId = config.providerId ?? catalog?.defaults.providerId ?? "opencode";
  const titleSlug = data.mission.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return {
    providerId,
    modelId: config.modelId ?? (catalog ? selectDefaultModel(catalog, providerId) : "default"),
    reasoningEffort: config.reasoningEffort ?? catalog?.defaults.reasoningEffort ?? "provider_default",
    missionPrompt: config.missionPrompt,
    permissionPreset: config.permissionPreset ?? catalog?.defaults.permissionPreset ?? "workspace",
    workspaceId: config.workspaceId ?? "",
    autoCommitAuthorized: config.autoCommitAuthorized,
    integrationTargetRef: config.integrationTargetRef ?? "",
    workspaceKind: "scratch",
    workspacePath: "",
    workspaceName: titleSlug,
    sourceWorkspaceId: config.workspaceId ?? "",
    sourceRepositoryPath: "",
    baseRef: "HEAD",
    branchName: branchNameFromTitle(titleSlug || data.mission.id),
    prerequisiteMissionIds: []
  };
}
