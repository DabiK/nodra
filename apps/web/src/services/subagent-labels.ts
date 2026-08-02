export function subagentStatusLabel(text: string | null): string | null {
  if (text === "started") return "Démarré";
  if (text === "interacted") return "Activité en cours";
  if (text === "interrupted") return "Interrompu";
  if (text === "completed") return "Terminé";
  if (text === "running") return "En cours";
  if (text === "pending") return "En attente";
  if (text === "failed") return "Échoué";
  return null;
}
export function subagentToolLabel(name: string | null): string | null {
  if (name === "spawnAgent") return "Lancer un sous-agent";
  if (name === "task") return "Déléguer à un sous-agent";
  if (name === "sendInput") return "Envoyer une entrée";
  if (name === "resumeAgent") return "Reprendre le sous-agent";
  if (name === "wait") return "Attendre le sous-agent";
  if (name === "closeAgent") return "Fermer le sous-agent";
  return null;
}
