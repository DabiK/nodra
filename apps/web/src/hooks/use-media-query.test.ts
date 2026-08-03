// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TABLET_BREAKPOINT, useMediaQuery } from "./use-media-query";

function stubMatchMedia(matches: boolean) {
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const mql = {
    matches,
    media: TABLET_BREAKPOINT,
    addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => { listeners.add(listener); },
    removeEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => { listeners.delete(listener); },
    dispatchEvent: () => true,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined
  };
  vi.stubGlobal("matchMedia", vi.fn(() => mql));
  return { mql, listeners, fire: (next: boolean) => {
    mql.matches = next;
    listeners.forEach((listener) => listener({ matches: next } as MediaQueryListEvent));
  } };
}

describe("useMediaQuery", () => {
  it("retourne false quand matchMedia est indisponible (jsdom, anciens navigateurs)", () => {
    const { result } = renderHook(() => useMediaQuery(TABLET_BREAKPOINT));
    expect(result.current).toBe(false);
  });

  it("retourne true quand la requête est satisfaite au montage", () => {
    stubMatchMedia(true);
    const { result } = renderHook(() => useMediaQuery(TABLET_BREAKPOINT));
    expect(result.current).toBe(true);
  });

  it("retourne false quand la requête n'est pas satisfaite au montage", () => {
    stubMatchMedia(false);
    const { result } = renderHook(() => useMediaQuery(TABLET_BREAKPOINT));
    expect(result.current).toBe(false);
  });

  it("met à jour la valeur quand la requête change (resize / rotation)", () => {
    const { fire } = stubMatchMedia(false);
    const { result } = renderHook(() => useMediaQuery(TABLET_BREAKPOINT));
    expect(result.current).toBe(false);
    act(() => fire(true));
    expect(result.current).toBe(true);
    act(() => fire(false));
    expect(result.current).toBe(false);
  });

  it("se désabonne du listener au démontage", () => {
    const { listeners } = stubMatchMedia(false);
    const { unmount } = renderHook(() => useMediaQuery(TABLET_BREAKPOINT));
    expect(listeners.size).toBe(1);
    unmount();
    expect(listeners.size).toBe(0);
  });
});
