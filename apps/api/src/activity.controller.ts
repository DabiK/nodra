import { Controller, Get, HttpCode, Inject, Param, Post } from "@nestjs/common";
import { toId, type ListActivity, type MarkActivityRead } from "@nodra/application";
import { LIST_ACTIVITY, MARK_ACTIVITY_READ } from "./tokens.js";

/**
 * Hub d'activité (issue #13) : items du relay qui attendent une décision
 * humaine (missions en VALIDATION/BLOCKED, deliveries à accepter, approbations
 * en attente, transitions de pipeline à approuver).
 */
@Controller("api/activity")
export class ActivityController {
  constructor(
    @Inject(LIST_ACTIVITY) private readonly listActivity: ListActivity,
    @Inject(MARK_ACTIVITY_READ) private readonly markActivityRead: MarkActivityRead
  ) {}

  @Get()
  list() {
    return this.listActivity.execute();
  }

  @Post(":relayId/read")
  @HttpCode(200)
  async read(@Param("relayId") relayId: string) {
    await this.markActivityRead.execute({
      relayId: toId(relayId),
      readAt: new Date().toISOString()
    });
    return { ok: true };
  }
}
