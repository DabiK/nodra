import { useRef, useState, type FormEvent } from "react";
import type { MissionView } from "../types";

function commandId() {
  return globalThis.crypto?.randomUUID?.() ?? `provider-session-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function ProviderSessionAttachDialog({ missions, suggestedTitle, workspacePath, submitting, error, onClose, onAttach, onCreate }: {
  missions: MissionView[];
  suggestedTitle?: string | null;
  workspacePath?: string | null;
  submitting: boolean;
  error: string;
  onClose(): void;
  onAttach(input: { missionId: string; commandId: string }): Promise<void>;
  onCreate(input: { title: string; projectId?: string; commandId: string }): Promise<void>;
}) {
  const [mode, setMode] = useState<"existing" | "new">("existing");
  const [missionId, setMissionId] = useState(missions[0]?.id ?? "");
  const [title, setTitle] = useState(suggestedTitle ?? "");
  const [projectId, setProjectId] = useState("");
  const intentionCommandId = useRef(commandId());
  const changeMode = (next: "existing" | "new") => {
    intentionCommandId.current = commandId();
    setMode(next);
  };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    if (mode === "existing") await onAttach({ missionId, commandId: intentionCommandId.current });
    else await onCreate({ title, ...(projectId ? { projectId } : {}), commandId: intentionCommandId.current });
  };
  return (
    <div className="provider-session-dialog-backdrop" role="presentation">
      <form className="provider-session-dialog" onSubmit={(event) => void submit(event)} aria-labelledby="provider-session-attach-title">
        <header><div><span className="eyebrow">LECTURE SEULE</span><h2 id="provider-session-attach-title">Lier cette session</h2></div><button type="button" className="icon-button" onClick={onClose} aria-label="Fermer">×</button></header>
        <p>La mission agent est préparée depuis le snapshot Codex. Aucun message ne sera envoyé à Codex.</p>
        <fieldset disabled={submitting}><legend>Destination</legend><label><input type="radio" checked={mode === "existing"} onChange={() => changeMode("existing")} /> Mission existante</label><label><input type="radio" checked={mode === "new"} onChange={() => changeMode("new")} /> Nouvelle mission</label></fieldset>
        {mode === "existing" ? <label>Mission<select value={missionId} onChange={(event) => setMissionId(event.target.value)} required>{missions.map((mission) => <option key={mission.id} value={mission.id}>{mission.title} · {mission.state}</option>)}</select></label> : <><label>Titre de la mission<input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Dérivé de la session Codex" /></label>{workspacePath ? <p className="provider-session-workspace-preview"><span>Dossier de travail</span><code>{workspacePath}</code></p> : <p className="provider-session-workspace-preview missing"><span>Dossier de travail</span>Indisponible : cette session ne pourra pas créer une mission agent.</p>}<p className="provider-session-prefill-note">Provider Codex, modèle par défaut, effort, permissions workspace et premier message utilisateur seront préremplis depuis Nodra et la session.</p><label>Projet (optionnel)<input value={projectId} onChange={(event) => setProjectId(event.target.value)} /></label></>}
        {error ? <p role="alert" className="provider-session-form-error">{error}</p> : null}
        <footer><button type="button" className="secondary" onClick={onClose} disabled={submitting}>Annuler</button><button type="submit" disabled={submitting || (mode === "existing" && !missionId) || (mode === "new" && !workspacePath)}>{submitting ? "En cours…" : mode === "existing" ? "Lier en lecture seule" : "Créer la mission agent"}</button></footer>
      </form>
    </div>
  );
}
