import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const missionWorkflowPath = (): string => {
  const compiled = fileURLToPath(new URL("./workflows/mission-workflow.js", import.meta.url));
  return existsSync(compiled)
    ? compiled
    : fileURLToPath(new URL("./workflows/mission-workflow.ts", import.meta.url));
};
