import { useEffect, useMemo, useState } from "react";
import type { ProviderOptionsCatalog, ProviderReasoningEffort } from "../types";
import { reasoningLabels } from "../services/provider-service";
import { enhancePrompt } from "../services/prompt-enhance-service";
import { selectDefaultModel } from "../services/provider-service";
import { ModelPicker } from "./ModelPicker";

export function PromptEnhanceDialog({
  prompt,
  catalog,
  initialProviderId,
  initialModelId,
  initialReasoningEffort,
  onClose,
  onEnhanced
}: {
  prompt: string;
  catalog: ProviderOptionsCatalog;
  initialProviderId?: string;
  initialModelId?: string;
  initialReasoningEffort?: ProviderReasoningEffort;
  onClose(): void;
  onEnhanced(prompt: string): void;
}) {
  const [providerId, setProviderId] = useState("");
  const [modelId, setModelId] = useState("");
  const [reasoningEffort, setReasoningEffort] = useState<ProviderReasoningEffort>("provider_default");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const providers = catalog.providers.filter((provider) => provider.models.some((model) => !model.hidden));
    const requested = catalog.providers.find((candidate) => candidate.id === initialProviderId && candidate.models.length > 0);
    const fallback = requested ?? providers[0] ?? catalog.providers[0];
    if (!fallback) return;
    const requestedModel = initialModelId && fallback.models.some((model) => model.id === initialModelId)
      ? initialModelId
      : selectDefaultModel(catalog, fallback.id);
    setProviderId(fallback.id);
    setModelId(requestedModel);
    setReasoningEffort(initialReasoningEffort ?? "provider_default");
  }, [catalog, initialModelId, initialProviderId, initialReasoningEffort]);

  const provider = catalog.providers.find((candidate) => candidate.id === providerId) ?? null;
  const models = useMemo(() => (provider?.models.filter((model) => !model.hidden) ?? []), [provider]);
  const selectedModel = models.find((model) => model.id === modelId) ?? null;
  const effortOptions = selectedModel && selectedModel.supportedReasoningEfforts.length > 0
    ? selectedModel.supportedReasoningEfforts
    : catalog.reasoningEfforts;

  useEffect(() => {
    if (!selectedModel || !selectedModel.supportedReasoningEfforts.includes(reasoningEffort)) {
      setReasoningEffort("provider_default");
    }
  }, [reasoningEffort, selectedModel]);

  const submit = async () => {
    if (busy || !prompt.trim() || !providerId) return;
    setBusy(true);
    setError("");
    try {
      const result = await enhancePrompt({
        prompt,
        providerId,
        ...(modelId ? { modelId } : {}),
        ...(reasoningEffort !== "provider_default" ? { reasoningEffort } : {})
      });
      onEnhanced(result.prompt);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="model-picker-backdrop prompt-enhance-backdrop" role="presentation" onClick={busy ? undefined : onClose}>
      <div
        className="prompt-enhance-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Améliorer le prompt"
        onClick={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <span className="eyebrow">AUGMENTATION ONE-SHOT</span>
            <h2>Améliorer le prompt</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Fermer" disabled={busy}>×</button>
        </header>
        <p className="prompt-enhance-source">Le provider enrichit le prompt avec plus de détails, en un seul appel, avant envoi au fil provider.</p>
        <div className="prompt-enhance-preview"><strong>Prompt actuel</strong><p>{prompt.length > 240 ? `${prompt.slice(0, 240)}…` : prompt}</p></div>
        <div className="prompt-enhance-fields">
          <label className="prompt-enhance-field">
            <span>Moteur</span>
            <select value={providerId} onChange={(event) => setProviderId(event.target.value)} disabled={busy}>
              {catalog.providers.map((candidate) => (
                <option key={candidate.id} value={candidate.id} disabled={candidate.models.length === 0}>
                  {candidate.label}{candidate.models.length === 0 ? " (aucun modèle)" : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="prompt-enhance-field">
            <span>Modèle</span>
            <ModelPicker models={models} value={modelId} onChange={setModelId} disabled={busy || models.length === 0} idPrefix="prompt-enhance" />
          </label>
          <label className="prompt-enhance-field">
            <span>Réflexion</span>
            <select value={reasoningEffort} onChange={(event) => setReasoningEffort(event.target.value as ProviderReasoningEffort)} disabled={busy}>
              {effortOptions.map((effort) => <option key={effort} value={effort}>{reasoningLabels[effort] ?? effort}</option>)}
            </select>
          </label>
        </div>
        {error ? <p className="inspector-error" role="alert">{error}</p> : null}
        <footer>
          <button type="button" className="secondary" onClick={onClose} disabled={busy}>Annuler</button>
          <button type="button" className="prompt-enhance-primary" onClick={() => void submit()} disabled={busy || !prompt.trim() || models.length === 0}>
            {busy ? "Amélioration…" : "✦ Améliorer le prompt"}
          </button>
        </footer>
      </div>
    </div>
  );
}
