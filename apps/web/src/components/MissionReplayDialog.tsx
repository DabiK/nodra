import { useEffect, useState, type FormEvent } from "react";
import type { AgentConfigView, MissionView, ProviderOptionsCatalog } from "../types";
import { duplicateMission } from "../services/mission-service";
import { permissionLabels, reasoningLabels } from "../services/provider-service";
import { ModelPicker } from "./ModelPicker";

/**
 * Dialog "Rejouer / dupliquer" : relance une mission avec les mêmes réglages
 * (config agent + prompt + workspace) en READY, avec la possibilité de varier
 * le modèle du même provider avant de lancer (issue #16).
 */
export function MissionReplayDialog({
  mission,
  config,
  providerOptions,
  onClose,
  onReplayed
}: {
  mission: MissionView;
  config: AgentConfigView;
  providerOptions: ProviderOptionsCatalog | null;
  onClose(): void;
  onReplayed(created: MissionView): void;
}) {
  const [title, setTitle] = useState(mission.title);
  const [modelId, setModelId] = useState(config.modelId ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Escape ferme le dialog (le model picker gère son propre Escape).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, onClose]);

  const provider = providerOptions?.providers.find((item) => item.id === config.providerId);
  const models = provider?.models ?? [];

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!title.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      const created = await duplicateMission({
        title: title.trim(),
        projectId: mission.projectId,
        source: config,
        modelId: modelId || config.modelId || models[0]?.id || ""
      });
      onReplayed(created);
    } catch (reason) {
      setError((reason as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="inspector-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="mission-replay-dialog" role="dialog" aria-modal="true" aria-labelledby="missionReplayTitle">
        <header>
          <span className="eyebrow">REJOUER LE RUN</span>
          <h2 id="missionReplayTitle">Relancer avec les mêmes réglages</h2>
          <p className="mission-replay-subtitle">
            La mission sera dupliquée en READY avec la même config agent, le même prompt et le même workspace.
          </p>
        </header>

        <form className="mission-replay-form" onSubmit={submit}>
          <label>
            Titre de la copie
            <input
              className="mission-replay-title-input"
              type="text"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={120}
            />
          </label>

          <label>
            Modèle (même moteur)
            <ModelPicker
              idPrefix="mission-replay"
              models={models}
              value={modelId}
              onChange={setModelId}
              disabled={models.length === 0}
            />
          </label>

          <dl className="mission-replay-summary">
            <div><dt>Moteur</dt><dd>{provider?.label ?? config.providerId ?? "—"}</dd></div>
            <div><dt>Réflexion</dt><dd>{config.reasoningEffort ? (reasoningLabels[config.reasoningEffort] ?? config.reasoningEffort) : "—"}</dd></div>
            <div><dt>Permissions</dt><dd>{config.permissionPreset ? (permissionLabels[config.permissionPreset] ?? config.permissionPreset) : "—"}</dd></div>
            <div><dt>Workspace</dt><dd>{config.workspaceId ?? "scratche créé à la volée"}</dd></div>
          </dl>

          <div className="mission-replay-prompt">
            <span>Prompt copié tel quel</span>
            <p>{config.missionPrompt.trim() || "Aucun prompt configuré — un prompt par défaut sera utilisé."}</p>
          </div>

          {error && <p className="inspector-error" role="alert">{error}</p>}

          <footer className="mission-replay-footer">
            <button className="secondary-button" type="button" onClick={onClose} disabled={busy}>Annuler</button>
            <button className="primary-button" type="submit" disabled={busy || !title.trim()}>
              {busy ? "Duplication..." : "↻ Dupliquer en READY"}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
