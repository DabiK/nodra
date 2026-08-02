// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { HighlightedText } from "./HighlightedText";

afterEach(() => { cleanup(); });

describe("HighlightedText", () => {
  it("renders plain text without a query", () => {
    const { container } = render(<HighlightedText text="hello world" query="" />);
    expect(container.querySelectorAll("mark")).toHaveLength(0);
    expect(container.textContent).toBe("hello world");
  });

  it("wraps every occurrence in a mark", () => {
    const { container } = render(<HighlightedText text="a b a" query="a" />);
    const marks = container.querySelectorAll("mark.conversation-search-hit");
    expect(marks).toHaveLength(2);
    expect(marks[0].textContent).toBe("a");
    expect(marks[1].textContent).toBe("a");
  });

  it("matches case-insensitively while preserving the source text", () => {
    const { container } = render(<HighlightedText text="Foo FOO" query="foo" />);
    expect(container.querySelectorAll("mark")).toHaveLength(2);
    expect(container.textContent).toBe("Foo FOO");
  });

  it("leaves the text untouched when there is no match", () => {
    const { container } = render(<HighlightedText text="hello" query="zzz" />);
    expect(container.querySelectorAll("mark")).toHaveLength(0);
    expect(container.textContent).toBe("hello");
  });
});
