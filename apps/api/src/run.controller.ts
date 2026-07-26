import { Body, Controller, HttpCode, Inject, Param, Post } from "@nestjs/common";
import type { CancelRun, ResumeRun, SteerRun } from "@nodra/application";
import { toId } from "@nodra/application";
import { CANCEL_RUN, RESUME_RUN, STEER_RUN } from "./tokens.js";
/* eslint-disable @typescript-eslint/consistent-type-imports */
import { SteerRunDto } from "./dto/steer-run.dto.js";

@Controller("api/runs")
export class RunController {
  constructor(
    @Inject(CANCEL_RUN) private readonly cancelRun: CancelRun,
    @Inject(RESUME_RUN) private readonly resumeRun: ResumeRun,
    @Inject(STEER_RUN) private readonly steerRun: SteerRun
  ) {}

  @Post(":id/cancel")
  @HttpCode(202)
  cancel(@Param("id") id: string) {
    return this.cancelRun.execute(toId(id));
  }

  @Post(":id/resume")
  @HttpCode(202)
  resume(@Param("id") id: string) {
    return this.resumeRun.execute(toId(id));
  }

  @Post(":id/steer")
  @HttpCode(202)
  steer(@Param("id") id: string, @Body() body: SteerRunDto) {
    return this.steerRun.execute(toId(id), body.text);
  }
}
