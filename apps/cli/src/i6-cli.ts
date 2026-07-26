import type {
  CancelRun,
  GetProviderStatus,
  ProbeProvider,
  ResumeRun,
  SteerRun
} from "@nodra/application";
import { toId } from "@nodra/application";

export class I6Cli {
  constructor(
    private readonly status: GetProviderStatus,
    private readonly probe: ProbeProvider,
    private readonly cancel: CancelRun,
    private readonly resume: ResumeRun,
    private readonly steer: SteerRun
  ) {}

  async execute(command: string, parameters: readonly string[]): Promise<unknown | undefined> {
    if (command === "provider:health" || command === "provider:capabilities") {
      if (parameters.length > 1) return undefined;
      return this.status.execute(parameters[0] ?? "codex");
    }
    if (command === "provider:probe") {
      if (parameters.length !== 2 || parameters[0] !== "codex" || parameters[1] !== "--allow-process") {
        return undefined;
      }
      return this.probe.execute({ providerId: "codex", optIn: true });
    }
    if (command === "run:cancel" && parameters.length === 1 && parameters[0]) {
      return this.cancel.execute(toId(parameters[0]));
    }
    if (command === "run:resume" && parameters.length === 1 && parameters[0]) {
      return this.resume.execute(toId(parameters[0]));
    }
    if (command === "run:steer" && parameters.length >= 2 && parameters[0]) {
      return this.steer.execute(toId(parameters[0]), parameters.slice(1).join(" "));
    }
    return undefined;
  }
}
