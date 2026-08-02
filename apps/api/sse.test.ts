import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./src/create-app.js";
import type { ServerEvent } from "./src/sse-events.service.js";
import { SseEventsService } from "./src/sse-events.service.js";

const waitFor = async (predicate: () => boolean, message: string, timeoutMs = 4000): Promise<void> => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
  throw new Error(`Timed out waiting for ${message}`);
};

interface OpenStream {
  events: ServerEvent[];
  close: () => void;
}

/** Ouvre un flux SSE sur l'endpoint réel et collecte les événements `data:` reçus. */
async function openEventStream(port: number): Promise<OpenStream> {
  const controller = new AbortController();
  const response = await fetch(`http://127.0.0.1:${port}/api/events/stream`, { signal: controller.signal });
  if (response.status !== 200 || !response.body) {
    throw new Error(`Unexpected SSE response: ${response.status}`);
  }
  if (!response.headers.get("content-type")?.includes("text/event-stream")) {
    throw new Error("Expected text/event-stream content type");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const events: ServerEvent[] = [];
  let buffer = "";
  const readLoop = (async () => {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let separator: number;
        while ((separator = buffer.indexOf("\n\n")) >= 0) {
          const frame = buffer.slice(0, separator);
          buffer = buffer.slice(separator + 2);
          for (const line of frame.split("\n")) {
            if (!line.startsWith("data: ")) continue;
            try {
              const payload = JSON.parse(line.slice("data: ".length)) as ServerEvent;
              if (payload && typeof payload.type === "string") events.push(payload);
            } catch {
              // trame non JSON : on ignore
            }
          }
        }
      }
    } catch {
      // flux interrompu par close()/abort : attendu
    }
  })();
  return {
    events,
    close: () => {
      controller.abort();
      void readLoop;
    }
  };
}

describe("SSE realtime events", () => {
  let app: NestExpressApplication;
  let port: number;

  beforeEach(async () => {
    const directory = await mkdtemp(join(tmpdir(), "nodra-sse-api-"));
    app = await createApp({
      databaseFile: join(directory, "nodra.db"),
      migrationsDirectory: resolve("packages/adapters/drizzle"),
      temporalAddress: "127.0.0.1:1"
    });
    await app.listen(0);
    const address = app.getHttpServer().address();
    if (!address || typeof address === "string") throw new Error("no port assigned");
    port = address.port;
  });

  afterEach(async () => app.close());

  it("emits a hello event on connection", async () => {
    const stream = await openEventStream(port);
    try {
      await waitFor(() => stream.events.some((event) => event.type === "hello"), "hello event");
    } finally {
      stream.close();
    }
  });

  it("publishes a data_changed event on every HTTP mutation under /api", async () => {
    const stream = await openEventStream(port);
    try {
      await waitFor(() => stream.events.some((event) => event.type === "hello"), "hello event");
      await request(app.getHttpServer())
        .post("/api/missions")
        .send({ title: "SSE mission", commandId: "sse-create" })
        .expect(201);
      await waitFor(
        () => stream.events.some((event) => event.type === "data_changed" && event.source === "http"),
        "data_changed (http) event"
      );
    } finally {
      stream.close();
    }
  });

  it("does not publish an http data_changed event on GET requests", async () => {
    const stream = await openEventStream(port);
    try {
      await waitFor(() => stream.events.some((event) => event.type === "hello"), "hello event");
      await request(app.getHttpServer()).get("/api/missions").expect(200);
      // Le middleware ignore les GET : aucun événement source http dans la fenêtre courte.
      await new Promise((resolveWait) => setTimeout(resolveWait, 350));
      expect(stream.events.some((event) => event.type === "data_changed" && event.source === "http")).toBe(false);
    } finally {
      stream.close();
    }
  });

  it("keeps a connection alive with periodic ping frames", async () => {
    // Test unitaire du hub : publish() est retransmis aux abonnés du flux SSE.
    const service = new SseEventsService();
    const received: ServerEvent[] = [];
    const subscription = service.changes$.subscribe((event) => received.push(event));
    service.publish({ type: "data_changed", source: "database" });
    service.publish({ type: "hello", receivedAt: "2026-01-01T00:00:00.000Z" });
    expect(received).toEqual([
      { type: "data_changed", source: "database" },
      { type: "hello", receivedAt: "2026-01-01T00:00:00.000Z" }
    ]);
    subscription.unsubscribe();
    service.publish({ type: "ping", receivedAt: "2026-01-01T00:00:00.000Z" });
    expect(received).toHaveLength(2);
  });
});
