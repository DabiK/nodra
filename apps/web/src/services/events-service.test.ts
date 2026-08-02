// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { subscribeToServerEvents, suppressServerEventsFor } from "./events-service";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("server events suppression", () => {
  it("ignores events received inside the suppression window, then delivers them again", () => {
    vi.useFakeTimers();
    const listeners: Array<(message: MessageEvent<string>) => void> = [];
    class FakeEventSource {
      constructor(_url: string) { /* registre partagé */ }
      addEventListener(_type: string, callback: (message: MessageEvent<string>) => void): void {
        listeners.push(callback);
      }
      close(): void { /* no-op */ }
    }
    vi.stubGlobal("EventSource", FakeEventSource);

    const onEvent = vi.fn();
    const unsubscribe = subscribeToServerEvents(onEvent);
    const send = () => {
      const event = new MessageEvent("message", { data: JSON.stringify({ type: "data_changed", source: "database" }) });
      for (const listener of listeners) listener(event);
    };

    send();
    expect(onEvent).toHaveBeenCalledTimes(1);

    // L'écho d'une mutation locale (POST → data_changed) est ignoré…
    suppressServerEventsFor(2500);
    send();
    expect(onEvent).toHaveBeenCalledTimes(1);

    // …puis les événements redeviennent actifs une fois la fenêtre passée.
    vi.advanceTimersByTime(2501);
    send();
    expect(onEvent).toHaveBeenCalledTimes(2);

    unsubscribe();
  });
});
