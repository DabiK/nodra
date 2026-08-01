import { useEffect, useState } from "react";
import { loadAgentSession } from "../services/agent-session-service";
import { ProviderMissionConversationPage } from "./ProviderMissionConversationPage";

export function AgentPage() {
  const parameters = new URLSearchParams(location.search);
  const missionId = parameters.get("missionId") ?? "";
  const threadId = parameters.get("threadId") ?? "";

  if (missionId) return <ProviderMissionConversationPage missionId={missionId} />;
  if (threadId) return <LegacyThreadRedirect threadId={threadId} />;

  return (
    <main className="agent-migration-page">
      <section>
        <span className="eyebrow">CONVERSATION MIGRÉE</span>
        <h1>Cette adresse de run n’est plus utilisée.</h1>
        <p>Les conversations agent s’ouvrent désormais depuis leur mission et affichent directement le fil du provider.</p>
        <a className="primary-button" href="/">Retour aux missions</a>
      </section>
    </main>
  );
}

function LegacyThreadRedirect({ threadId }: { threadId: string }) {
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    void loadAgentSession(threadId)
      .then((session) => {
        if (cancelled) return;
        if (!session.run.missionId) throw new Error("Ce run n’est rattaché à aucune mission.");
        location.replace(`/agent.html?missionId=${encodeURIComponent(session.run.missionId)}`);
      })
      .catch((reason: Error) => { if (!cancelled) setError(reason.message); });
    return () => { cancelled = true; };
  }, [threadId]);

  return (
    <main className="agent-migration-page">
      <section>
        <span className="eyebrow">CONVERSATION PROVIDER</span>
        <h1>Ouverture du fil provider…</h1>
        <p>{error || "Résolution de la mission liée à cette ancienne adresse."}</p>
        {error ? <a className="primary-button" href="/">Retour aux missions</a> : null}
      </section>
    </main>
  );
}
