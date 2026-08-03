import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { ManagerView, ProviderOptionsCatalog, ProviderPermissionPreset, ProviderReasoningEffort } from "../types";
import { archiveManager, createManager, updateManager } from "../services/manager-service";
import { serverConfig } from "../services/config-service";
import { ManagerChat } from "./ManagerChat";
import { PixelAvatar } from "./PixelAvatar";
import { ModelPicker } from "./ModelPicker";

const DEFAULT_INSTRUCTION =
  "Transforme mes demandes en lots autonomes, explicites et testables. Vérifie l'état avant d'agir et privilégie des séquences simples avant de créer un pipeline.";

const stateCopy: Record<string, string> = {
  draft: "à configurer",
  ready: "prêt pour un brief",
  active: "en orchestration",
  blocked: "a besoin d'aide",
  archived: "archivé"
};

interface Editable {
  name: string;
  instruction: string;
  providerId: string;
  modelId: string;
  reasoningEffort: string;
  permissionPreset: string;
}

export function ManagersPage({
  managers,
  providerOptions,
  onChanged,
  initialManagerId = null
}: {
  managers: ManagerView[];
  providerOptions: ProviderOptionsCatalog | null;
  onChanged(): void;
  /** Ouvre directement le chat de ce manager au montage (navigation glance). */
  initialManagerId?: string | null;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(initialManagerId);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<Editable & { workspacePath: string }>(() => initialDraft(providerOptions));
  const [edit, setEdit] = useState<Editable | null>(null);

  // Un clic glance (barre « Runs actifs ») sur un manager ouvre son chat même
  // si la page est déjà affichée avec un autre chat ouvert.
  useEffect(() => {
    if (initialManagerId) setSelectedId(initialManagerId);
  }, [initialManagerId]);

  const selected = useMemo(() => managers.find((manager) => manager.id === selectedId) ?? null, [managers, selectedId]);
  const providers = providerOptions?.providers ?? [];
  const modelsFor = (providerId: string) => providers.find((provider) => provider.id === providerId)?.models.filter((model) => !model.hidden) ?? [];

  if (selected) {
    return <ManagerChat manager={selected} onBack={() => setSelectedId(null)} onChanged={onChanged} />;
  }

  const submitCreate = async (event: FormEvent) => {
    event.preventDefault();
    setBusy("create");
    setError("");
    try {
      await createManager({
        name: draft.name,
        instruction: draft.instruction,
        workspacePath: draft.workspacePath,
        ...(draft.providerId ? { providerId: draft.providerId } : {}),
        ...(draft.modelId ? { modelId: draft.modelId } : {}),
        ...(draft.reasoningEffort ? { reasoningEffort: draft.reasoningEffort as ProviderReasoningEffort } : {}),
        ...(draft.permissionPreset ? { permissionPreset: draft.permissionPreset as ProviderPermissionPreset } : {})
      });
      setDraft(initialDraft(providerOptions));
      setCreating(false);
      onChanged();
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy("");
    }
  };

  const saveEdit = async (manager: ManagerView) => {
    if (!edit) return;
    setBusy(`edit:${manager.id}`);
    setError("");
    try {
      await updateManager(manager.id, {
        name: edit.name,
        instruction: edit.instruction,
        ...(edit.providerId ? { providerId: edit.providerId } : {}),
        ...(edit.modelId ? { modelId: edit.modelId } : {}),
        ...(edit.reasoningEffort ? { reasoningEffort: edit.reasoningEffort as ProviderReasoningEffort } : {}),
        ...(edit.permissionPreset ? { permissionPreset: edit.permissionPreset as ProviderPermissionPreset } : {})
      });
      setEditingId(null);
      setEdit(null);
      onChanged();
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy("");
    }
  };

  const remove = async (manager: ManagerView) => {
    if (!confirm(`Archiver ${manager.name} ?`)) return;
    setBusy(`archive:${manager.id}`);
    try {
      await archiveManager(manager.id);
      onChanged();
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="managers-page">
      <section className="manager-manifesto">
        <div>
          <span className="manager-kicker">THE GUILD DESK</span>
          <h2>Des chefs d'équipe qui tiennent le fil.</h2>
          <p>Un manager est un agent méta: une identité durable, une instruction système, et un accès au CLI DevFlow pour créer et orchestrer des missions. Ouvre autant de conversations que nécessaire.</p>
        </div>
        <button className="primary-button" onClick={() => setCreating((value) => !value)}>
          {creating ? "Fermer" : "+ Nouveau manager"}
        </button>
      </section>

      {error && <p className="manager-error" role="alert">{error}</p>}

      {creating && (
        <form className="manager-create" onSubmit={submitCreate}>
          <label>Nom
            <input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Nova, Atlas…" required />
          </label>
          <label className="wide">Instruction système
            <textarea rows={3} value={draft.instruction} onChange={(event) => setDraft({ ...draft, instruction: event.target.value })} required />
          </label>
          <label>Moteur
            <select value={draft.providerId} onChange={(event) => setDraft({ ...draft, providerId: event.target.value, modelId: modelsFor(event.target.value)[0]?.id ?? "" })}>
              {providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.label}</option>)}
            </select>
          </label>
          <label>Modèle
            <ModelPicker idPrefix="manager-create" models={modelsFor(draft.providerId)} value={draft.modelId} onChange={(modelId) => setDraft({ ...draft, modelId })} />
          </label>
          <label>Réflexion
            <select value={draft.reasoningEffort} onChange={(event) => setDraft({ ...draft, reasoningEffort: event.target.value })}>
              {(providerOptions?.reasoningEfforts ?? []).map((effort) => <option key={effort} value={effort}>{effort}</option>)}
            </select>
          </label>
          <label>Permissions
            <select value={draft.permissionPreset} onChange={(event) => setDraft({ ...draft, permissionPreset: event.target.value })}>
              {(providerOptions?.permissionPresets ?? ["read_only", "workspace", "full_access"]).map((preset) => <option key={preset} value={preset}>{preset}</option>)}
            </select>
          </label>
          <label className="wide">Dépôt de travail (le manager exécute le CLI depuis ce chemin)
            <input value={draft.workspacePath} onChange={(event) => setDraft({ ...draft, workspacePath: event.target.value })} placeholder={serverConfig()?.repositoryRoot ?? "chemin absolu du dépôt"} />
          </label>
          <button type="submit" disabled={busy === "create"}>{busy === "create" ? "Création…" : "Inviter le manager"}</button>
        </form>
      )}

      <div className="manager-grid">
        {managers.map((manager, index) => (
          <article className={`manager-card manager-tone-${index % 3}`} key={manager.id}>
            <header>
              <PixelAvatar id={manager.id} title={manager.name} />
              <div>
                <span className="manager-role">MANAGER {String(index + 1).padStart(2, "0")}</span>
                <h3>{manager.name}</h3>
                <p><i className={`dot dot-${manager.state}`} /> {stateCopy[manager.state] ?? manager.state}</p>
              </div>
              <button className="manager-delete" aria-label={`Archiver ${manager.name}`} disabled={busy === `archive:${manager.id}`} onClick={() => void remove(manager)}>×</button>
            </header>
            <blockquote>{manager.instruction}</blockquote>
            {manager.lastMessage && (
              <div className="manager-last"><span>DERNIER RETOUR</span><p>{manager.lastMessage}</p></div>
            )}
            <div className="manager-card-meta">
              <span>{manager.modelId ?? "modèle ?"}</span>
              <span>{manager.conversationCount} conversation{manager.conversationCount > 1 ? "s" : ""}</span>
            </div>
            <div className="manager-card-actions">
              <button className="primary" disabled={manager.state === "draft" && !manager.workspaceId} onClick={() => setSelectedId(manager.id)}>💬 Ouvrir</button>
              <button onClick={() => { setEditingId(editingId === manager.id ? null : manager.id); setEdit(toEditable(manager)); }}>⚙ Configurer</button>
            </div>
            {editingId === manager.id && edit && (
              <section className="manager-settings">
                <label>Nom<input value={edit.name} onChange={(event) => setEdit({ ...edit, name: event.target.value })} /></label>
                <label className="wide">Instruction<textarea rows={3} value={edit.instruction} onChange={(event) => setEdit({ ...edit, instruction: event.target.value })} /></label>
                <label>Moteur
                  <select value={edit.providerId} onChange={(event) => setEdit({ ...edit, providerId: event.target.value, modelId: modelsFor(event.target.value)[0]?.id ?? "" })}>
                    {providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.label}</option>)}
                  </select>
                </label>
                <label>Modèle
                  <ModelPicker idPrefix="manager-edit" models={modelsFor(edit.providerId)} value={edit.modelId} onChange={(modelId) => setEdit({ ...edit, modelId })} />
                </label>
                <label>Réflexion
                  <select value={edit.reasoningEffort} onChange={(event) => setEdit({ ...edit, reasoningEffort: event.target.value })}>
                    {(providerOptions?.reasoningEfforts ?? []).map((effort) => <option key={effort} value={effort}>{effort}</option>)}
                  </select>
                </label>
                <label>Permissions
                  <select value={edit.permissionPreset} onChange={(event) => setEdit({ ...edit, permissionPreset: event.target.value })}>
                    {(providerOptions?.permissionPresets ?? ["read_only", "workspace", "full_access"]).map((preset) => <option key={preset} value={preset}>{preset}</option>)}
                  </select>
                </label>
                <footer>
                  <button onClick={() => { setEditingId(null); setEdit(null); }}>Annuler</button>
                  <button className="save" disabled={busy === `edit:${manager.id}`} onClick={() => void saveEdit(manager)}>Enregistrer</button>
                </footer>
              </section>
            )}
          </article>
        ))}
        {!managers.length && !creating && (
          <button className="manager-empty" onClick={() => setCreating(true)}>
            <span>＋</span>
            <strong>Inviter un chef d'équipe</strong>
            <small>Une instruction, un modèle, un accès CLI.</small>
          </button>
        )}
      </div>
    </div>
  );
}

function initialDraft(providerOptions: ProviderOptionsCatalog | null): Editable & { workspacePath: string } {
  const providerId = providerOptions?.defaults.providerId ?? "";
  const modelId = providerOptions?.defaults.modelId ?? "";
  return {
    name: "",
    instruction: DEFAULT_INSTRUCTION,
    providerId,
    modelId,
    reasoningEffort: providerOptions?.defaults.reasoningEffort ?? "provider_default",
    permissionPreset: "full_access",
    workspacePath: serverConfig()?.repositoryRoot ?? ""
  };
}

function toEditable(manager: ManagerView): Editable {
  return {
    name: manager.name,
    instruction: manager.instruction,
    providerId: manager.providerId ?? "",
    modelId: manager.modelId ?? "",
    reasoningEffort: manager.reasoningEffort ?? "provider_default",
    permissionPreset: manager.permissionPreset
  };
}
