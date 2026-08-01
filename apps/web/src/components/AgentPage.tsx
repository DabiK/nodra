import { ProviderMissionConversationPage } from "./ProviderMissionConversationPage";

export function AgentPage() {
  const parameters = new URLSearchParams(location.search);
  const missionId = parameters.get("missionId") ?? "";

  if (missionId) return <ProviderMissionConversationPage missionId={missionId} />;

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
