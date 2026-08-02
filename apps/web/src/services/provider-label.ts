export function providerLabel(providerId: string): string {
  if (providerId === "codex") return "Codex";
  if (providerId === "opencode") return "OpenCode";
  return providerId;
}
