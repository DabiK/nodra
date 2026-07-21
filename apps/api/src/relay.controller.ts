import { Controller, Get, Inject, Query } from "@nestjs/common";
import { toId, type GetRelay, type MissionListFilter } from "@nodra/application";
import { GET_RELAY } from "./tokens.js";

@Controller("api/relay")
export class RelayController {
  constructor(@Inject(GET_RELAY) private readonly getRelay: GetRelay) {}

  @Get()
  relay(@Query("projectId") projectId?: string) {
    const filter: MissionListFilter | undefined = projectId === undefined ? undefined : { projectId: toId(projectId) };
    return this.getRelay.execute(filter);
  }
}
