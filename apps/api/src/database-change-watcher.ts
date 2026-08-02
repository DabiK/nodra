import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { basename, dirname } from "node:path";
import { watch, type FSWatcher } from "node:fs";
import { DATABASE_FILE } from "./tokens.js";
import { SseEventsService } from "./sse-events.service.js";
const DEBOUNCE_MS = 250;

/**
 * Publie un événement `data_changed` dès qu'une écriture touche la base
 * SQLite — y compris les écritures venues du process worker / des agents qui
 * tournent hors de la requête HTTP courante (c'est le cœur du temps réel).
 *
 * En mode WAL les écritures arrivent dans le fichier `-wal` : on observe le
 * dossier de la base et on filtre les noms db / db-wal / db-shm. L'événement
 * est debouncé pour coalescer les rafales d'écritures.
 *
 * Si `fs.watch` n'est pas disponible (système ou conteneur exotique), on
 * dégrade proprement : le temps réel repose alors sur les mutations HTTP + le
 * `hello` de reconnexion.
 */
@Injectable()
export class DatabaseChangeWatcher implements OnModuleInit, OnModuleDestroy {
  private watcher: FSWatcher | null = null;
  private timer: NodeJS.Timeout | null = null;
  private readonly watchDirectory: string;
  private readonly watchNames: ReadonlySet<string>;

  constructor(
    @Inject(DATABASE_FILE) databaseFile: string,
    @Inject(SseEventsService) private readonly events: SseEventsService
  ) {
    this.watchDirectory = dirname(databaseFile);
    const base = basename(databaseFile);
    this.watchNames = new Set([base, `${base}-wal`, `${base}-shm`]);
  }

  onModuleInit(): void {
    try {
      this.watcher = watch(this.watchDirectory, (_eventType, filename) => {
        if (typeof filename === "string" && this.watchNames.has(filename)) this.schedule();
      });
      this.watcher.on("error", () => {
        // L'observation du fichier n'est pas un canal critique : les mutations
        // HTTP et le hello de reconnexion couvrent déjà la majorité des cas.
        this.closeWatcher();
      });
    } catch {
      this.watcher = null;
    }
  }

  onModuleDestroy(): void {
    if (this.timer) clearTimeout(this.timer);
    this.closeWatcher();
  }

  private schedule(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.events.publish({ type: "data_changed", source: "database" });
    }, DEBOUNCE_MS);
  }

  private closeWatcher(): void {
    this.watcher?.close();
    this.watcher = null;
  }
}
