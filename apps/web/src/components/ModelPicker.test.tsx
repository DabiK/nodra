// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ModelPicker } from "./ModelPicker";
import type { ProviderModelOption } from "../types";

afterEach(cleanup);

const models: ProviderModelOption[] = [
  { id: "opencode/deepseek-v4-flash", label: "OpenCode Go / DeepSeek V4 Flash", description: "deepseek model exposed by OpenCode Serve", hidden: false, isDefault: true, supportedReasoningEfforts: ["provider_default"], defaultReasoningEffort: "provider_default" },
  { id: "opencode/big-pickle", label: "OpenCode Zen / Big Pickle", description: "opencode model exposed by OpenCode Serve", hidden: false, isDefault: false, supportedReasoningEfforts: ["provider_default"], defaultReasoningEffort: "provider_default" },
  { id: "openrouter/openai/gpt-5.6-sol", label: "OpenRouter / GPT-5.6 Sol", description: "openrouter model exposed by OpenCode Serve", hidden: false, isDefault: false, supportedReasoningEfforts: ["provider_default"], defaultReasoningEffort: "provider_default" }
];

describe("ModelPicker", () => {
  it("renders the selected model on the trigger", () => {
    render(<ModelPicker idPrefix="test" models={models} value="opencode/big-pickle" onChange={vi.fn()} />);
    expect(screen.getByText("OpenCode Zen / Big Pickle")).toBeTruthy();
  });

  it("opens the searchable dialog and filters models by label", () => {
    const onChange = vi.fn();
    render(<ModelPicker idPrefix="test" models={models} value="" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /Choisir un modèle/i }));
    expect(screen.getByText("OpenCode Go / DeepSeek V4 Flash")).toBeTruthy();
    const search = screen.getByPlaceholderText(/rechercher/i);
    fireEvent.change(search, { target: { value: "deepseek" } });
    expect(screen.queryByText("OpenCode Zen / Big Pickle")).toBeNull();
    expect(screen.getByText("OpenCode Go / DeepSeek V4 Flash")).toBeTruthy();
    fireEvent.click(screen.getByText("OpenCode Go / DeepSeek V4 Flash"));
    expect(onChange).toHaveBeenCalledWith("opencode/deepseek-v4-flash");
  });

  it("filters by model id as well as label", () => {
    render(<ModelPicker idPrefix="test" models={models} value="" onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Choisir un modèle/i }));
    fireEvent.change(screen.getByPlaceholderText(/rechercher/i), { target: { value: "gpt-5.6" } });
    expect(screen.getByText("OpenRouter / GPT-5.6 Sol")).toBeTruthy();
    expect(screen.queryByText("OpenCode Zen / Big Pickle")).toBeNull();
  });

  it("shows an empty state when nothing matches", () => {
    render(<ModelPicker idPrefix="test" models={models} value="" onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Choisir un modèle/i }));
    fireEvent.change(screen.getByPlaceholderText(/rechercher/i), { target: { value: "zzz-nothing" } });
    expect(screen.getByText(/Aucun modèle ne correspond/)).toBeTruthy();
  });

  it("closes on Escape", () => {
    render(<ModelPicker idPrefix="test" models={models} value="" onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Choisir un modèle/i }));
    expect(screen.getByRole("listbox")).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("is disabled when there are no models", () => {
    render(<ModelPicker idPrefix="test" models={[]} value="" onChange={vi.fn()} />);
    expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(true);
  });
});
