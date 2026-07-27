import { Controller, Get, Query } from "@nestjs/common";
import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, resolve } from "node:path";

interface FolderEntry {
  name: string;
  path: string;
  selectable: boolean;
}

@Controller("api/folders")
export class FolderController {
  @Get()
  async browse(@Query("path") requestedPath?: string) {
    const current = resolve(requestedPath?.trim() || homedir());
    const entries = await readdir(current, { withFileTypes: true });
    const folders: FolderEntry[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === "node_modules") continue;
      const path = resolve(current, entry.name);
      folders.push({
        name: entry.name,
        path,
        selectable: await this.isDirectory(path)
      });
    }
    return {
      current,
      parent: dirname(current) === current ? null : dirname(current),
      roots: [homedir(), process.cwd()],
      entries: folders.sort((left, right) => left.name.localeCompare(right.name, "fr")),
      selectedName: basename(current)
    };
  }

  private async isDirectory(path: string) {
    return stat(path).then((value) => value.isDirectory()).catch(() => false);
  }
}
