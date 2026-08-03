import { useEffect, useRef, useState } from "react";
import type { MissionView } from "../types";
import { getAgentConfig } from "../services/mission-service";
import { loadMissionProviderSession } from "../services/mission-provider-session-service";
import { loadMissionResult, type MissionResultView } from "../services/mission-result-service";
import { getMissionUiPolicy, type MissionActionId, type MissionUiAction, type MissionUiPolicy } from "../services/mission-ui-policy";
import { performMissionAction } from "../services/mission-action-service";

const MENU_WIDTH = 236;
const MENU_MAX_HEIGHT = 420;

export interface MissionCardMenuProps {
  mission: MissionView;
  /** Point d'ancrage en coordonnées viewport (bouton ⋯ ou clic droit). */
  anchor: { x: number; y: number };
  /** Alignement horizontal du menu par rapport à l'ancre. */
  align?: "left" | "right";
  onClose(): void;
  /** « Configurer » n'a pas d'équivalent board : ouvre la fiche mission. */
  onInspect(): void;
  /** Appelé après une action exécutée avec succès (label de l'action). */
  onActionApplied?(label: string): void;
}

/**
 * Menu contextuel des actions rapides d'une carte mission (issue #19).
 *
 * Flotte en `position: fixed` au-dessus des listes défilantes du board ; le
 * contexte UI de la policy (`mission-ui-policy`) est chargé paresseusement à
 * l'ouverture (config agent, session provider, résultat du dernier run) pour
 * ne proposer que des actions valides pour l'état réel de la mission.
 */
export function MissionCardMenu({ mission, anchor, align = "left", onClose, onInspect, onActionApplied }: MissionCardMenuProps) {
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [policy, setPolicy] = useState<MissionUiPolicy | null>(null);
  const [result, setResult] = useState<MissionResultView | null>(null);
  const [busyId, setBusyId] = useState<MissionActionId | null>(null);
  const [actionError, setActionError] = useState("");
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Position : sous l'ancre, clampée dans la fenêtre (le menu flotte au-dessus
  // des listes à overflow des lanes).
  useEffect(() => {
    const left = align === "right"
      ? anchor.x - MENU_WIDTH + 8
      : anchor.x + 6;
    setPosition({
      left: Math.min(Math.max(8, left), Math.max(8, window.innerWidth - MENU_WIDTH - 8)),
      top: Math.min(Math.max(8, anchor.y + 6), Math.max(8, window.innerHeight - MENU_MAX_HEIGHT - 8))
    });
  }, [anchor.x, anchor.y, align]);

  // Chargement paresseux du contexte UI : config agent + session provider +
  // résultat du dernier run — la même base que l'inspecteur de mission.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const isAgent = mission.executionKind === "agent";
      try {
        const [config, providerSession, loadedResult] = await Promise.all([
          isAgent ? getAgentConfig(mission.id).catch(() => null) : Promise.resolve(null),
          isAgent ? loadMissionProviderSession(mission.id).catch(() => null) : Promise.resolve(null),
          loadMissionResult(mission.id)
        ]);
        if (cancelled) return;
        setResult(loadedResult);
        setPolicy(getMissionUiPolicy({
          mission,
          hasAgentConfig: Boolean(config),
          latestRunId: loadedResult?.latestRunId ?? null,
          latestRunState: loadedResult?.latestRunState ?? null,
          hasDelivery: Boolean(loadedResult?.hasStructuredDelivery),
          hasResultText: Boolean(loadedResult?.assistantMessage?.trim()),
          hasProviderSession: Boolean(providerSession)
        }));
        setPhase("ready");
      } catch {
        if (!cancelled) setPhase("error");
      }
    })();
    return () => { cancelled = true; };
  }, [mission]);

  // Focus du premier élément actif à l'ouverture (le menu est flottant :
  // le focus doit suivre l'interaction clavier).
  useEffect(() => {
    if (phase !== "ready") return;
    const firstEnabled = rootRef.current?.querySelector<HTMLButtonElement>(".card-menu-item:not(:disabled)");
    (firstEnabled ?? rootRef.current)?.focus();
  }, [phase]);

  // Échap ferme le menu même pendant le chargement (focus encore sur le
  // déclencheur). Le menu se referme aussi si la page défile (l'ancre
  // deviendrait fausse) ou si la fenêtre change de taille.
  useEffect(() => {
    const onWindowKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const close = () => onClose();
    window.addEventListener("keydown", onWindowKeyDown);
    window.addEventListener("scroll", close, { capture: true, passive: true });
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("keydown", onWindowKeyDown);
      window.removeEventListener("scroll", close, { capture: true });
      window.removeEventListener("resize", close);
    };
  }, [onClose]);

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    const items = Array.from(rootRef.current?.querySelectorAll<HTMLButtonElement>(".card-menu-item:not(:disabled)") ?? []);
    if (!items.length) return;
    const active = document.activeElement as HTMLElement | null;
    let index = active ? items.indexOf(active as HTMLButtonElement) : -1;
    if (event.key === "ArrowDown") index = (index + 1) % items.length;
    else if (event.key === "ArrowUp") index = (index - 1 + items.length) % items.length;
    else if (event.key === "Home") index = 0;
    else index = items.length - 1;
    items[index]?.focus();
  };

  const runAction = async (action: MissionUiAction) => {
    // « Configurer » est une navigation UI (pas d'endpoint) : ouvre la fiche.
    if (action.id === "configure") {
      onClose();
      onInspect();
      return;
    }
    if (!action.enabled || busyId !== null) return;
    setBusyId(action.id);
    setActionError("");
    try {
      await performMissionAction({
        actionId: action.id,
        mission,
        latestRunId: result?.latestRunId ?? null,
        declaredResult: result?.assistantMessage ?? undefined
      });
      onClose();
      onActionApplied?.(action.label);
    } catch (reason) {
      setBusyId(null);
      setActionError((reason as Error).message);
    }
  };

  return (
    <>
      <div className="card-menu-backdrop" onClick={onClose} aria-hidden="true" />
      <div
        ref={rootRef}
        className="card-menu"
        role="menu"
        tabIndex={-1}
        aria-label={`Actions pour ${mission.title}`}
        style={{ left: position.left, top: position.top }}
        onKeyDown={handleKeyDown}
      >
        <div className="card-menu-head" role="presentation">
          <span>{mission.executionKind === "agent" ? "Mission agent" : "Mission humaine"} · {policy?.phaseLabel ?? mission.state}</span>
          <strong>{mission.title}</strong>
        </div>

        {phase === "loading" && <div className="card-menu-status" role="presentation">Chargement des actions…</div>}

        {phase === "error" && <div className="card-menu-status card-menu-error" role="alert">Impossible de charger les actions.</div>}

        {phase === "ready" && policy && (policy.actions.length === 0
          ? <div className="card-menu-status" role="presentation">Aucune action disponible pour cet état.</div>
          : policy.actions.map((action) => (
            <button
              key={action.id}
              type="button"
              role="menuitem"
              className={`card-menu-item${action.danger ? " danger" : ""}`}
              disabled={!action.enabled || busyId !== null}
              title={action.enabled ? undefined : action.disabledReason}
              onClick={() => void runAction(action)}
            >
              {busyId === action.id ? "Patiente..." : action.label}
              {action.primary && <span className="card-menu-item-dot" aria-hidden="true" />}
            </button>
          )))}

        {actionError && <div className="card-menu-error" role="alert">{actionError}</div>}
      </div>
    </>
  );
}
