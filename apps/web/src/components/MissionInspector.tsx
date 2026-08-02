import { useEffect, useMemo, useState, type FormEvent } from "react";
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
import { performMissionAction } from "../services/mission-action-service";
import { getMissionUiPolicy, type MissionUiAction, type MissionUiPolicy } from "../services/mission-ui-policy";
import { showWorkspace } from "../services/worktree-service";
import { WorkspaceModePicker } from "./WorkspaceModePicker";
import { WorktreeResolutionDialog } from "./WorktreeResolutionDialog";
import { PixelAvatar } from "./PixelAvatar";
import { ModelPicker } from "./ModelPicker";

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
  const [form, setForm] = useState<InspectorForm | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [worktree, setWorktree] = useState<{ id: string; branchName: string | null } | null>(null);
  const [showWorktreeDialog, setShowWorktreeDialog] = useState(false);

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
      if (document.querySelector(".model-picker-backdrop") || showWorktreeDialog) return;
      onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, showWorktreeDialog]);

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
      const [reloaded, reloadedResult, reloadedRuns] = await Promise.all([
        loadMissionInspector(missionId),
        loadMissionResult(missionId),
        loadMissionRuns(missionId).catch(() => null)
      ]);
      setData(reloaded);
      setForm(formFrom(reloaded, providerOptions));
      setResult(reloadedResult);
      setRuns(reloadedRuns);
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
          <InspectStep data={data} result={result} runs={runs} policy={policy} />
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

function InspectStep({
  data,
  result,
  runs,
  policy
}: {
  data: MissionInspectorData | null;
  result: MissionResultView | null;
  runs: MissionRunsView | null;
  policy: MissionUiPolicy | null;
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
        {data?.mission && <MissionBudgetPanel runs={runs} />}
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
