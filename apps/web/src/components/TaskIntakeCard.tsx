import type { FormEvent } from "react";
import type { FolderBrowseResult, MissionIntakeDraft, MissionState, ProviderOptionsCatalog } from "../types";
import { permissionLabels, reasoningLabels } from "../services/provider-service";
import { workspacePathForDraft } from "../services/workspace-service";
import { FolderDrawer } from "./FolderDrawer";

export function TaskIntakeCard({
  draft,
  providerOptions,
  selectedProvider,
  selectedModelId,
  reasoningOptions,
  expanded,
  creating,
  probingProviderId,
  folderOpen,
  folderBrowse,
  folderLoading,
  error,
  notice,
  missionCount,
  stateCounts,
  stateFilter,
  kindFilter,
  onSubmit,
  onDraftChange,
  onExpandedChange,
  onProviderChange,
  onProbeProvider,
  onStateFilterChange,
  onKindFilterChange,
  onFolderOpen,
  onFolderClose,
  onFolderBrowse,
  onFolderSelect
}: {
  draft: MissionIntakeDraft | null;
  providerOptions: ProviderOptionsCatalog | null;
  selectedProvider: ProviderOptionsCatalog["providers"][number] | undefined;
  selectedModelId: string;
  reasoningOptions: MissionIntakeDraft["reasoningEffort"][];
  expanded: boolean;
  creating: boolean;
  probingProviderId: string | null;
  folderOpen: boolean;
  folderBrowse: FolderBrowseResult | null;
  folderLoading: boolean;
  error: string;
  notice: string;
  missionCount: number;
  stateCounts: Partial<Record<MissionState, number>>;
  stateFilter: string;
  kindFilter: string;
  onSubmit(event: FormEvent<HTMLFormElement>): void;
  onDraftChange(patch: Partial<MissionIntakeDraft>): void;
  onExpandedChange(value: boolean): void;
  onProviderChange(providerId: string): void;
  onProbeProvider(providerId: string): void;
  onStateFilterChange(value: string): void;
  onKindFilterChange(value: string): void;
  onFolderOpen(): void;
  onFolderClose(): void;
  onFolderBrowse(path?: string): void;
  onFolderSelect(path: string): void;
}) {
  return (
    <>
      <form className={`create-task-card${expanded ? " expanded" : ""}`} id="create" onSubmit={onSubmit}>
        {error && <p className="mission-config-error" role="alert">{error}</p>}
        {notice && <p className="task-batch-notice" role="status">✓ {notice}</p>}

        <div className="quick-add">
          <span className="add-icon">+</span>
          <input
            id="titleInput"
            aria-label="Titre"
            value={draft?.title ?? ""}
            onChange={(event) => onDraftChange({ title: event.target.value })}
            placeholder={draft?.kind === "human" ? "Une tâche à suivre toi-même…" : "Qu'est-ce qu'on ship aujourd'hui ?"}
            required
          />
          <div className="kind-switch" role="group" aria-label="Type de mission">
            <button type="button" className={draft?.kind !== "human" ? "active" : ""} onClick={() => onDraftChange({ kind: "agent" })}>Agent</button>
            <button type="button" className={draft?.kind === "human" ? "active" : ""} onClick={() => onDraftChange({ kind: "human" })}>Humain</button>
          </div>
          {draft?.kind !== "human" && (
            <select aria-label="Moteur" value={draft?.providerId ?? ""} disabled={!providerOptions} onChange={(event) => onProviderChange(event.target.value)}>
              {providerOptions?.providers.map((provider) => (
                <option value={provider.id} key={provider.id}>{provider.label}{provider.models.length ? "" : " · à prober"}</option>
              ))}
            </select>
          )}
          <button type="submit" disabled={creating || !draft?.title.trim() || (draft?.kind !== "human" && !providerOptions)}>
            {creating ? "Création..." : "Ajouter"} <span>↵</span>
          </button>
        </div>

        <div className="task-view-chips" aria-label="Vues des tâches">
          {[
            ["all", "Toutes", missionCount],
            ["DRAFT", "Draft", stateCounts.DRAFT],
            ["READY", "Ready", stateCounts.READY],
            ["ACTIVE", "Active", stateCounts.ACTIVE],
            ["VALIDATION", "Validation", stateCounts.VALIDATION],
            ["DONE", "Terminées", stateCounts.DONE]
          ].map(([value, label, count]) => (
            <button
              type="button"
              className={`view-chip${stateFilter === value ? " active" : ""}`}
              onClick={() => onStateFilterChange(String(value))}
              key={String(value)}
            >
              {label}
              {typeof count === "number" && <small>{count}</small>}
            </button>
          ))}
          <span className="chip-divider" />
          {[
            ["all", "Human + agent"],
            ["agent", "Agent"],
            ["human", "Humain"]
          ].map(([value, label]) => (
            <button
              type="button"
              className={`view-chip status${kindFilter === value ? " active" : ""}`}
              onClick={() => onKindFilterChange(value)}
              key={value}
            >
              {label}
            </button>
          ))}
          {draft?.kind !== "human" && (
            <button type="button" className="folder-chip active" onClick={onFolderOpen}>
              <span aria-hidden="true">▰</span>
              {draft?.workspaceKind === "scratch"
                ? (draft.workspaceName || draft.projectId || draft.title || "Workspace neuf")
                : draft?.workspacePath
                  ? draft.workspacePath.split(/[/\\]/).filter(Boolean).at(-1)
                  : "Dossier"}
              <small>{missionCount}</small>
            </button>
          )}
          {draft?.kind !== "human" && (
            <button type="button" className={`configure-chip${expanded ? " active" : ""}`} aria-expanded={expanded} onClick={() => onExpandedChange(!expanded)}>
              ⚙ {expanded ? "Réduire" : "Configurer l'agent"}
            </button>
          )}
        </div>

        {draft?.kind === "human" && (
          <div className="human-intake">
            <label className="human-notes-field">
              <span>Espace de travail · notes</span>
              <textarea
                value={draft.notes}
                onChange={(event) => onDraftChange({ notes: event.target.value })}
                rows={4}
                maxLength={20000}
                placeholder="Bloc-notes : contexte, étapes, liens, checklist… (éditable ensuite dans la fiche de mission)"
              />
            </label>
          </div>
        )}

        {draft?.kind !== "human" && expanded && draft && providerOptions && (
          <section className="create-details" aria-label="Configuration de la nouvelle tâche">
            <div className="create-details-head">
              <div>
                <span className="eyebrow">TÂCHE + AGENT</span>
                <strong>Tout préparer avant la création</strong>
              </div>
              <span className="full-access-badge">{draft.permissionPreset}</span>
            </div>

            <label>
              Prompt agent
              <textarea
                value={draft.prompt}
                onChange={(event) => onDraftChange({ prompt: event.target.value })}
                rows={6}
                maxLength={20000}
                placeholder="Décris précisément la mission, les validations attendues et le résultat à livrer..."
              />
            </label>

            <div className="form-grid">
              <label>
                Nom du projet / workspace
                <input value={draft.workspaceName} onChange={(event) => onDraftChange({ workspaceName: event.target.value })} placeholder="nom du folder workspace" />
              </label>
              <label>
                Permissions
                <select value={draft.permissionPreset} onChange={(event) => onDraftChange({ permissionPreset: event.target.value as MissionIntakeDraft["permissionPreset"] })}>
                  {providerOptions.permissionPresets.map((preset) => <option value={preset} key={preset}>{permissionLabels[preset] ?? preset}</option>)}
                </select>
              </label>
            </div>

            <div className="workspace-mode-field">
              <fieldset className="workspace-mode-picker">
                <legend>Terrain de travail</legend>
                <button type="button" className={draft.workspaceKind === "repo" ? "active" : ""} onClick={() => onDraftChange({ workspaceKind: "repo" })}>
                  <strong>Dépôt existant</strong>
                  <small>Utilise un repo Git déjà présent sur la machine.</small>
                </button>
                <button type="button" className={draft.workspaceKind === "scratch" ? "active" : ""} onClick={() => onDraftChange({ workspaceKind: "scratch" })}>
                  <strong>Workspace neuf</strong>
                  <small>Crée un dossier de travail dédié.</small>
                </button>
              </fieldset>
              {draft.workspaceKind === "repo" ? (
                <label>
                  Dossier workspace
                  <span className="repository-picker mission-repository">
                    <input value={draft.workspacePath} onChange={(event) => onDraftChange({ workspacePath: event.target.value })} placeholder="Chemin du dossier" required />
                    <button type="button" onClick={onFolderOpen}>Parcourir...</button>
                  </span>
                </label>
              ) : (
                <label>
                  Dossier généré
                  <input value={workspacePathForDraft(draft)} readOnly placeholder="Généré depuis le nom du projet" />
                </label>
              )}
            </div>

            <div className="form-grid">
              <label>
                Moteur
                <select value={draft.providerId} onChange={(event) => onProviderChange(event.target.value)}>
                  {providerOptions.providers.map((provider) => <option value={provider.id} key={provider.id}>{provider.label}</option>)}
                </select>
              </label>
              <label>
                Modèle
                <select value={selectedModelId} onChange={(event) => onDraftChange({ modelId: event.target.value })}>
                  {selectedProvider?.models.length
                    ? selectedProvider.models.map((model) => <option value={model.id} key={model.id}>{model.label}{model.hidden ? " · hidden" : ""}</option>)
                    : <option value={providerOptions.defaults.modelId}>{providerOptions.defaults.modelId}</option>}
                </select>
              </label>
              <label>
                Niveau de réflexion
                <select value={draft.reasoningEffort} onChange={(event) => onDraftChange({ reasoningEffort: event.target.value as MissionIntakeDraft["reasoningEffort"] })}>
                  {reasoningOptions.map((effort) => <option value={effort} key={effort}>{reasoningLabels[effort] ?? effort}</option>)}
                </select>
              </label>
              <label>
                Catalog
                <button type="button" className="settings-button" disabled={probingProviderId === draft.providerId} onClick={() => onProbeProvider(draft.providerId)}>
                  {probingProviderId === draft.providerId ? "Probe..." : selectedProvider?.models.length ? `${selectedProvider.models.length} modèles` : "Probe provider"}
                </button>
              </label>
            </div>
          </section>
        )}
      </form>

      {folderOpen && (
        <FolderDrawer
          browse={folderBrowse}
          loading={folderLoading}
          onBrowse={onFolderBrowse}
          onSelect={onFolderSelect}
          onClose={onFolderClose}
        />
      )}
    </>
  );
}
