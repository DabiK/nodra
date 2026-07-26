import { Body, Controller, Get, HttpCode, Inject, Param, Post } from "@nestjs/common";
import type { GetProviderStatus, ProbeProvider } from "@nodra/application";
import { GET_PROVIDER_STATUS, PROBE_PROVIDER } from "./tokens.js";
/* eslint-disable @typescript-eslint/consistent-type-imports */
import { ProviderProbeDto } from "./dto/provider-probe.dto.js";

@Controller("api/providers")
export class ProviderController {
  constructor(
    @Inject(GET_PROVIDER_STATUS) private readonly status: GetProviderStatus,
    @Inject(PROBE_PROVIDER) private readonly probeProvider: ProbeProvider
  ) {}

  @Get("capabilities")
  capabilities() {
    return this.status.execute("codex");
  }

  @Get(":providerId/health")
  health(@Param("providerId") providerId: string) {
    return this.status.execute(providerId);
  }

  @Post(":providerId/probe")
  @HttpCode(200)
  probe(@Param("providerId") providerId: string, @Body() body: ProviderProbeDto) {
    return this.probeProvider.execute({ providerId, optIn: body.optIn });
  }
}
