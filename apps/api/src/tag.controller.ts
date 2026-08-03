import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Put } from "@nestjs/common";
import { toId, type CreateTag, type DeleteTag, type ListTags, type UpdateTag } from "@nodra/application";
import { randomUUID } from "node:crypto";
import { CREATE_TAG, DELETE_TAG, LIST_TAGS, UPDATE_TAG } from "./tokens.js";
import { TagDto } from "./dto/tag.dto.js";

/**
 * Tags libres des missions (issue #23) : libellé + couleur, attachables à
 * plusieurs missions. Le CRUD vit ici ; la liaison mission → tags est exposée
 * par MissionController (GET/PUT /api/missions/:id/tags).
 */
@Controller("api/tags")
export class TagController {
  constructor(
    @Inject(LIST_TAGS) private readonly listTags: ListTags,
    @Inject(CREATE_TAG) private readonly createTag: CreateTag,
    @Inject(UPDATE_TAG) private readonly updateTag: UpdateTag,
    @Inject(DELETE_TAG) private readonly deleteTag: DeleteTag
  ) {}

  @Get()
  list() {
    return this.listTags.execute();
  }

  @Post()
  @HttpCode(201)
  create(@Body() body: TagDto) {
    return this.createTag.execute({
      id: toId(randomUUID()),
      label: body.label,
      color: body.color,
      context: this.context(body.commandId)
    });
  }

  @Put(":id")
  update(@Param("id") id: string, @Body() body: TagDto) {
    return this.updateTag.execute({
      id: toId(id),
      label: body.label,
      color: body.color,
      context: this.context(body.commandId)
    });
  }

  @Delete(":id")
  @HttpCode(200)
  async remove(@Param("id") id: string) {
    await this.deleteTag.execute(toId(id));
    return { ok: true };
  }

  private context(commandId?: string) {
    return {
      commandId: toId(commandId?.trim() ? commandId : randomUUID()),
      actor: "user" as const,
      occurredAt: new Date().toISOString()
    };
  }
}
