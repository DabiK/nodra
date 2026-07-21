import { Controller, Get, Inject } from "@nestjs/common";
import type { GetHealth, HealthReport } from "@nodra/application";
import { GET_HEALTH } from "./tokens.js";

@Controller()
export class HealthController {
  constructor(@Inject(GET_HEALTH) private readonly getHealth: GetHealth) {}

  @Get("health")
  health(): Promise<HealthReport> {
    return this.getHealth.execute();
  }
}
