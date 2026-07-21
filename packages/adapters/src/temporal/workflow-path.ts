import { fileURLToPath } from "node:url";

export const missionWorkflowPath = (): string =>
  fileURLToPath(new URL("./workflows/mission-workflow.js", import.meta.url));
