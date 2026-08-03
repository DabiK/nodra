import { DomainError, type Id } from "@nodra/domain";
import type { CommandContext } from "./command-context.js";
import { normalizeTagColor, normalizeTagLabel, type MissionTagView, type TagRepository } from "./tag-repository.js";

export class UpdateTag {
  constructor(private readonly repository: TagRepository) {}

  async execute(input: { id: Id; label: string; color: string; context: CommandContext }): Promise<MissionTagView> {
    const label = normalizeTagLabel(input.label);
    const color = normalizeTagColor(input.color);
    const existing = await this.repository.findByLabel(label);
    if (existing && existing.id !== input.id) {
      throw new DomainError(`Tag « ${label} » already exists`, "TAG_ALREADY_EXISTS");
    }
    const updated = await this.repository.update({ id: input.id, label, color, context: input.context });
    if (!updated) throw new DomainError(`Tag ${input.id} was not found`, "TAG_NOT_FOUND");
    return updated;
  }
}
