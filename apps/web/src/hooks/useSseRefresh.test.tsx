// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { useSseRefresh } from "./useSseRefresh";

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

function Harness({ onRefresh }: { onRefresh: () => void }) {
  useSseRefresh(onRefresh);
  return null;
}

afterEach(() => {
  cleanup();
  FakeEventSource.instances = [];
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("useSseRefresh", () => {
  it("refreshes on data_changed events and ignores ping", async () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    const onRefresh = vi.fn();
    render(<Harness onRefresh={onRefresh} />);
    const source = FakeEventSource.instances[0];
    expect(source.url).toBe("/api/events/stream");

    source.dispatch("message", JSON.stringify({ type: "ping" }));
    await Promise.resolve();
    expect(onRefresh).not.toHaveBeenCalled();

    source.dispatch("message", JSON.stringify({ type: "data_changed", source: "http" }));
    await Promise.resolve();
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("coalesces a burst of events into a single refresh", async () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    const onRefresh = vi.fn();
    render(<Harness onRefresh={onRefresh} />);
    const source = FakeEventSource.instances[0];

    source.dispatch("message", JSON.stringify({ type: "data_changed", source: "http" }));
    source.dispatch("message", JSON.stringify({ type: "hello" }));
    await Promise.resolve();
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("closes the stream on unmount", () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    const { unmount } = render(<Harness onRefresh={vi.fn()} />);
    const source = FakeEventSource.instances[0];
    expect(source.closed).toBe(false);
    unmount();
    expect(source.closed).toBe(true);
  });

  it("falls back to a slow poll when SSE is unavailable", () => {
    vi.useFakeTimers();
    const onRefresh = vi.fn();
    render(<Harness onRefresh={onRefresh} />);
    expect(onRefresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(30_000);
    expect(onRefresh).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(30_000);
    expect(onRefresh).toHaveBeenCalledTimes(2);
  });
});
