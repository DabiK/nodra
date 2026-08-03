import { DomainError, type Id } from "@nodra/domain";
import type { TagRepository } from "./tag-repository.js";

export class DeleteTag {
  constructor(private readonly repository: TagRepository) {}

  async execute(id: Id): Promise<void> {
    const deleted = await this.repository.delete(id);
    if (!deleted) throw new DomainError(`Tag ${id} was not found`, "TAG_NOT_FOUND");
  }
}
