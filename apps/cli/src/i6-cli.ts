import type {
  CancelRun,
  GetProviderStatus,
  ProbeProvider,
  ResumeRun,
  SteerRun
} from "@nodra/application";
import { toId } from "@nodra/application";
import type { ProviderSmokeCli } from "./provider-smoke-cli.js";

export class I6Cli {
  constructor(
    private readonly status: GetProviderStatus,
    private readonly probe: ProbeProvider,
    private readonly cancel: CancelRun,
    private readonly resume: ResumeRun,
    private readonly steer: SteerRun,
    private readonly smoke?: ProviderSmokeCli
  ) {}

  async execute(command: string, parameters: readonly string[]): Promise<unknown | undefined> {
    if (
      command === "provider:health"
      || command === "provider:capabilities"
      || command === "provider:status"
    ) {
      if (parameters.length > 1) return undefined;
      return this.status.execute(parameters[0] ?? "codex");
    }
    if (command === "provider:probe") {
      if (parameters.length !== 2 || !parameters[0] || parameters[1] !== "--allow-process") {
        return undefined;
      }
      return this.probe.execute({ providerId: parameters[0], optIn: true });
    }
    if (command === "provider:smoke" && this.smoke) {
      return this.smoke.execute(command, parameters);
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
