import { useEffect, useMemo, useRef, useState } from "react";
import type { ProviderModelOption } from "../types";

export function ModelPicker({
  models,
  value,
  onChange,
  disabled,
  idPrefix
}: {
  models: ProviderModelOption[];
  value: string;
  onChange(modelId: string): void;
  disabled?: boolean;
  idPrefix: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement | null>(null);

  const selected = models.find((model) => model.id === value) ?? null;

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return models;
    return models.filter((model) =>
      model.id.toLowerCase().includes(needle)
      || model.label.toLowerCase().includes(needle)
      || model.description.toLowerCase().includes(needle)
    );
  }, [models, query]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    const frame = requestAnimationFrame(() => searchRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <>
      <button
        type="button"
        className="model-picker-trigger"
        id={`${idPrefix}-model`}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled || models.length === 0}
        onClick={() => setOpen(true)}
      >
        <span className="model-picker-value">{selected?.label ?? (value || "Choisir un modèle")}</span>
        <span className="model-picker-count">{models.length}</span>
      </button>

      {open && (
        <div className="model-picker-backdrop" role="presentation" onClick={() => setOpen(false)}>
          <div
            className="model-picker-dialog"
            role="listbox"
            aria-labelledby={`${idPrefix}-model`}
            onClick={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <span className="eyebrow">MOTEUR · MODÈLE</span>
                <h2>Choisir un modèle</h2>
              </div>
              <button type="button" className="icon-button" onClick={() => setOpen(false)} aria-label="Fermer">×</button>
            </header>
            <label className="model-picker-search">
              <input
                ref={searchRef}
                type="search"
                placeholder="Rechercher par nom, fournisseur, description…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <div className="model-picker-list">
              {filtered.map((model) => (
                <button
                  type="button"
                  key={model.id}
                  role="option"
                  aria-selected={model.id === value}
                  className={`model-picker-option${model.id === value ? " selected" : ""}`}
                  onClick={() => {
                    onChange(model.id);
                    setOpen(false);
                  }}
                >
                  <span className="model-picker-option-label">
                    {model.label}
                    {model.isDefault && <em>défaut</em>}
                    {model.hidden && <em>hidden</em>}
                  </span>
                  <span className="model-picker-option-id">{model.id}</span>
                  {model.description && <span className="model-picker-option-desc">{model.description}</span>}
                </button>
              ))}
              {!filtered.length && <p className="model-picker-empty">Aucun modèle ne correspond à « {query} ».</p>}
            </div>
            <footer>
              <span>{filtered.length} / {models.length} modèles</span>
              <button type="button" className="secondary" onClick={() => setOpen(false)}>Fermer</button>
            </footer>
          </div>
        </div>
      )}
    </>
  );
}
