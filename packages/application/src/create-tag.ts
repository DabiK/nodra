import { DomainError, type Id } from "@nodra/domain";
import type { CommandContext } from "./command-context.js";
import { normalizeTagColor, normalizeTagLabel, type MissionTagView, type TagRepository } from "./tag-repository.js";

export class CreateTag {
  constructor(private readonly repository: TagRepository) {}

  async execute(input: { id: Id; label: string; color: string; context: CommandContext }): Promise<MissionTagView> {
    const label = normalizeTagLabel(input.label);
    const color = normalizeTagColor(input.color);
    const existing = await this.repository.findByLabel(label);
    if (existing) throw new DomainError(`Tag « ${label} » already exists`, "TAG_ALREADY_EXISTS");
    return this.repository.create({ id: input.id, label, color, context: input.context });
  }
}
