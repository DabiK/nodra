import type { MissionTemplate } from "../services/mission-template-service";

/** État vide du board des tâches : CTA de création + démarrage en 1 clic depuis un modèle. */
export function BoardEmptyState({
  templates,
  busyTemplateId,
  onTemplate,
  onCreateMission
}: {
  templates: MissionTemplate[];
  busyTemplateId: string | null;
  onTemplate(template: MissionTemplate): void;
  onCreateMission(): void;
}) {
  return (
    <section className="board-empty-state" aria-label="Aucune mission">
      <div className="board-empty-copy">
        <span className="board-empty-mark" aria-hidden="true">⌁</span>
        <h2>Aucune mission pour l'instant</h2>
        <p>
          Confie une mission à un agent (ou suis une tâche humaine) et elle apparaîtra ici,
          prête à être lancée. Pour démarrer vite, crée une mission depuis un modèle
          pré-rempli — réglages modifiables ensuite dans la fiche.
        </p>
        <button type="button" className="primary-button board-empty-cta" onClick={onCreateMission}>
          ＋ Confier une tâche
        </button>
      </div>
      <div className="template-grid">
        {templates.map((template) => (
          <button
            type="button"
            key={template.id}
            className="template-card"
            disabled={busyTemplateId !== null}
            onClick={() => onTemplate(template)}
          >
            <span className="template-emoji" aria-hidden="true">{template.emoji}</span>
            <strong className="template-label">{template.label}</strong>
            <small className="template-desc">{template.description}</small>
            <em className="template-create">{busyTemplateId === template.id ? "Création…" : "Créer en 1 clic →"}</em>
          </button>
        ))}
      </div>
    </section>
  );
}
