import type { MissionTagView, TagRepository } from "./tag-repository.js";

export class ListTags {
  constructor(private readonly repository: TagRepository) {}

  execute(): Promise<MissionTagView[]> {
    return this.repository.list();
  }
}
