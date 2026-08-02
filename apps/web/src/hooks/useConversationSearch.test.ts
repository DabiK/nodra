// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useConversationSearch } from "./useConversationSearch";
import type { SearchableMessage } from "../services/conversation-search-service";

const messages: SearchableMessage[] = [
  { id: "a", fields: ["hello world"] },
  { id: "b", fields: ["hello again", "world tour"] }
];

describe("useConversationSearch", () => {
  it("starts empty", () => {
    const { result } = renderHook(() => useConversationSearch(messages));
    expect(result.current.query).toBe("");
    expect(result.current.matchCount).toBe(0);
    expect(result.current.activeMatch).toBeNull();
  });

  it("indexes matches and starts on the first occurrence", () => {
    const { result } = renderHook(() => useConversationSearch(messages));
    act(() => result.current.setQuery("hello"));
    expect(result.current.matchCount).toBe(2);
    expect(result.current.current).toBe(0);
    expect(result.current.activeMatch?.messageId).toBe("a");
  });

  it("navigates next and previous with wraparound", () => {
    const { result } = renderHook(() => useConversationSearch(messages));
    act(() => result.current.setQuery("world"));
    expect(result.current.matchCount).toBe(2);
    act(() => result.current.next());
    expect(result.current.current).toBe(1);
    act(() => result.current.next());
    expect(result.current.current).toBe(0);
    act(() => result.current.prev());
    expect(result.current.current).toBe(1);
  });

  it("does not navigate when there are no matches", () => {
    const { result } = renderHook(() => useConversationSearch(messages));
    act(() => result.current.setQuery("zzz"));
    expect(result.current.matchCount).toBe(0);
    act(() => result.current.next());
    act(() => result.current.prev());
    expect(result.current.current).toBe(0);
  });

  it("resets the cursor when the query changes", () => {
    const { result } = renderHook(() => useConversationSearch(messages));
    act(() => result.current.setQuery("world"));
    act(() => result.current.next());
    expect(result.current.current).toBe(1);
    act(() => result.current.setQuery("hello"));
    expect(result.current.current).toBe(0);
  });

  it("clears the query and the cursor", () => {
    const { result } = renderHook(() => useConversationSearch(messages));
    act(() => result.current.setQuery("hello"));
    act(() => result.current.next());
    act(() => result.current.clear());
    expect(result.current.query).toBe("");
    expect(result.current.matchCount).toBe(0);
    expect(result.current.current).toBe(0);
    expect(result.current.activeMatch).toBeNull();
  });

  it("clamps the cursor when the result set shrinks", () => {
    const { result, rerender } = renderHook(
      ({ msgs }) => useConversationSearch(msgs),
      { initialProps: { msgs: messages } }
    );
    act(() => result.current.setQuery("world"));
    expect(result.current.matchCount).toBe(2);
    act(() => result.current.next());
    expect(result.current.current).toBe(1);
    rerender({ msgs: [{ id: "a", fields: ["hello world"] }] });
    expect(result.current.matchCount).toBe(1);
    expect(result.current.current).toBe(0);
  });
});
