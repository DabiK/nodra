// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { serverEventsSupported, subscribeToServerEvents } from "./events-service";

type Listener = (event: MessageEvent<string>) => void;

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  readonly url: string;
  listeners = new Map<string, Listener[]>();
  closed = false;
  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, listener: Listener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  close() {
    this.closed = true;
  }
  dispatch(type: string, data: string) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener({ data } as MessageEvent<string>);
    }
  }
}

const originalEventSource = globalThis.EventSource;

afterEach(() => {
  FakeEventSource.instances = [];
  if (originalEventSource === undefined) {
    // @ts-expect-error restaure l'absence d'EventSource (jsdom n'en fournit pas)
    delete globalThis.EventSource;
  } else {
    globalThis.EventSource = originalEventSource;
  }
  vi.restoreAllMocks();
});

describe("events-service", () => {
  it("reports SSE as unsupported when EventSource is absent", () => {
    expect(serverEventsSupported()).toBe(false);
  });

  it("opens the stream and forwards parsed payloads", () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    const onEvent = vi.fn();
    const unsubscribe = subscribeToServerEvents(onEvent);
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.instances[0].url).toBe("/api/events/stream");

    FakeEventSource.instances[0].dispatch("message", JSON.stringify({ type: "data_changed", source: "database" }));
    expect(onEvent).toHaveBeenCalledWith({ type: "data_changed", source: "database" });

    // les trames non JSON ou sans type sont ignorées
    FakeEventSource.instances[0].dispatch("message", "pas du json");
    FakeEventSource.instances[0].dispatch("message", JSON.stringify({ source: "database" }));
    expect(onEvent).toHaveBeenCalledTimes(1);

    unsubscribe();
    expect(FakeEventSource.instances[0].closed).toBe(true);
  });

  it("returns a no-op unsubscribe when SSE is unavailable", () => {
    const unsubscribe = subscribeToServerEvents(vi.fn());
    expect(unsubscribe).toBeDefined();
    expect(() => unsubscribe()).not.toThrow();
  });
});
