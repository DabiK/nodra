import { Controller, Get, Inject } from "@nestjs/common";
import { join } from "node:path";
import { DATA_ROOT, REPOSITORY_ROOT } from "./tokens.js";

/**
 * Exposes server-computed, OS-appropriate default paths so the web client never
 * has to hardcode absolute filesystem locations (which would be wrong on other
 * machines and break on Windows).
 */
@Controller("api/config")
export class ConfigController {
  constructor(
    @Inject(REPOSITORY_ROOT) private readonly repositoryRoot: string,
    @Inject(DATA_ROOT) private readonly dataRoot: string
  ) {}

  @Get()
  get() {
    return {
      platform: process.platform,
      repositoryRoot: this.repositoryRoot,
      dataRoot: this.dataRoot,
      workspacesRoot: join(this.dataRoot, "workspaces")
    };
  }
}
