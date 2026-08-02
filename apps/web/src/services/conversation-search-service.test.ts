import { describe, expect, it } from "vitest";
import { findMatches, highlightParts, type SearchableMessage } from "./conversation-search-service";

describe("findMatches", () => {
  const messages: SearchableMessage[] = [
    { id: "a", fields: ["Plan the release", "run npm test"] },
    { id: "b", fields: ["plan the release again", null] },
    { id: "c", fields: [""] }
  ];

  it("returns no matches for an empty or whitespace query", () => {
    expect(findMatches("", messages)).toEqual([]);
    expect(findMatches("   ", messages)).toEqual([]);
  });

  it("returns no matches when nothing matches", () => {
    expect(findMatches("zzz", messages)).toEqual([]);
  });

  it("matches case-insensitively across messages", () => {
    const matches = findMatches("RELEASE", messages);
    expect(matches.map((match) => match.messageId)).toEqual(["a", "b"]);
  });

  it("finds every occurrence inside a single field", () => {
    const matches = findMatches("run", messages);
    const a = matches.filter((match) => match.messageId === "a");
    expect(a).toHaveLength(1);
    expect(a[0].start).toBe(0);
    expect(a[0].end).toBe(3);
  });

  it("finds multiple occurrences in the same field", () => {
    const text = { id: "d", fields: ["lol lol lol"] };
    expect(findMatches("lol", [text])).toHaveLength(3);
  });

  it("treats the query literally, without regex specials", () => {
    const text = { id: "e", fields: ["a.b and axb"] };
    const matches = findMatches("a.b", [text]);
    expect(matches).toHaveLength(1);
    expect(matches[0].start).toBe(0);
    expect(matches[0].end).toBe(3);
  });

  it("ignores null and empty fields", () => {
    expect(findMatches("npm", messages).map((match) => match.messageId)).toEqual(["a"]);
  });

  it("exposes the full field text with offsets", () => {
    const [match] = findMatches("plan", messages);
    expect(match.messageId).toBe("a");
    expect(match.text).toBe("Plan the release");
    expect(match.start).toBe(0);
    expect(match.end).toBe(4);
  });

  it("is stable when the messages array is empty", () => {
    expect(findMatches("x", [])).toEqual([]);
  });
});

describe("highlightParts", () => {
  it("returns a single plain part when there is no query", () => {
    expect(highlightParts("hello world", "")).toEqual([{ text: "hello world", hit: false }]);
  });

  it("returns a single plain part when the query does not match", () => {
    expect(highlightParts("hello world", "zzz")).toEqual([{ text: "hello world", hit: false }]);
  });

  it("splits text into hit and non-hit segments", () => {
    expect(highlightParts("a b a", "a")).toEqual([
      { text: "a", hit: true },
      { text: " b ", hit: false },
      { text: "a", hit: true }
    ]);
  });

  it("matches case-insensitively and preserves the original text", () => {
    const parts = highlightParts("Foo FOO", "foo");
    expect(parts.map((part) => part.text).join("")).toBe("Foo FOO");
    expect(parts.filter((part) => part.hit)).toHaveLength(2);
  });

  it("handles an empty text", () => {
    expect(highlightParts("", "x")).toEqual([{ text: "", hit: false }]);
  });

  it("handles adjacent occurrences", () => {
    expect(highlightParts("aaa", "aa")).toEqual([
      { text: "aa", hit: true },
      { text: "a", hit: false }
    ]);
  });
});
