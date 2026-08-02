// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ConversationContextBanner } from "./ConversationContextBanner";
import type { ConversationContextRisk } from "../services/conversation-context-service";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const warnRisk: ConversationContextRisk = {
  level: "warn",
  turnCount: 30,
  estimatedTokens: 90_000,
  tokenSource: "estimated",
  truncationRate: 0,
  truncatedEventCount: 0,
  reasons: ["Nombre de tours élevé"]
};

const criticalRisk: ConversationContextRisk = {
  level: "critical",
  turnCount: 60,
  estimatedTokens: 210_000,
  tokenSource: "reported",
  truncationRate: 0.25,
  truncatedEventCount: 5,
  reasons: ["Nombre de tours très élevé", "Volume très élevé (≈ 210 k tokens)", "Événements tronqués (25 %)"]
};

describe("ConversationContextBanner", () => {
  it("renders nothing without a risk", () => {
    render(<ConversationContextBanner risk={null} />);
    expect(document.querySelector(".context-risk-banner")).toBeNull();
  });

  it("renders nothing when the risk level is ok", () => {
    render(<ConversationContextBanner risk={{ ...warnRisk, level: "ok", reasons: [] }} />);
    expect(document.querySelector(".context-risk-banner")).toBeNull();
  });

  it("shows the warning title and the metrics for a warn risk", () => {
    render(<ConversationContextBanner risk={warnRisk} />);
    expect(screen.getByText("⚠ Conversation longue — risque de perte de contexte")).toBeTruthy();
    expect(screen.getByText("30 tours · ≈ 90 k tokens estimés")).toBeTruthy();
    expect(screen.getByText("Nombre de tours élevé")).toBeTruthy();
  });

  it("switches to the critical variant with truncation metrics", () => {
    render(<ConversationContextBanner risk={criticalRisk} />);
    expect(screen.getByText("⚠ Conversation très longue — risque élevé de perte de contexte")).toBeTruthy();
    expect(screen.getByText("60 tours · ≈ 210 k tokens rapportés · 25 % d'événements tronqués")).toBeTruthy();
    expect(document.querySelector(".context-risk-banner.critical")).toBeTruthy();
  });

  it("renders the action button and fires it", () => {
    const onAction = vi.fn();
    render(<ConversationContextBanner risk={warnRisk} actionLabel="＋ Nouveau fil" onAction={onAction} />);
    fireEvent.click(screen.getByRole("button", { name: "＋ Nouveau fil" }));
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it("hides the action button when no action is provided", () => {
    render(<ConversationContextBanner risk={warnRisk} />);
    expect(document.querySelector(".context-risk-action")).toBeNull();
  });

  it("disables the action while busy", () => {
    const onAction = vi.fn();
    render(<ConversationContextBanner risk={warnRisk} actionLabel="⟳ Compacter" onAction={onAction} busy />);
    const button = screen.getByRole("button", { name: "…" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(onAction).not.toHaveBeenCalled();
  });
});
