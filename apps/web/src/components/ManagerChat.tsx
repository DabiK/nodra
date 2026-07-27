import { useEffect, useMemo, useRef, useState } from "react";
import type { ManagerConversationView, ManagerThreadView, ManagerView } from "../types";
import { latestManagerThread, listManagerConversations, loadManagerThread, sendManagerMessage } from "../services/manager-service";
import { PixelAvatar } from "./PixelAvatar";

const ACTIVE_RUN = new Set(["QUEUED", "STARTING", "RUNNING", "WAITING_APPROVAL", "CANCELLING"]);

function toolLabel(type: string): string | null {
  if (type.includes("permission")) return "demande une permission";
  if (type.includes("tool") || type.includes("command") || type.includes("bash")) return "utilise un outil";
  return null;
}

export function ManagerChat({
  manager,
  onBack,
  onChanged
}: {
  manager: ManagerView;
  onBack(): void;
  onChanged(): void;
}) {
  const [conversations, setConversations] = useState<ManagerConversationView[]>([]);
  const [threadId, setThreadId] = useState<string | null>(manager.currentThreadId);
  const [thread, setThread] = useState<ManagerThreadView | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void listManagerConversations(manager.id).then(setConversations).catch(() => undefined);
  }, [manager.id]);

  useEffect(() => {
    if (threadId) return;
    void latestManagerThread(manager.id).then((result) => setThreadId(result.threadId)).catch(() => undefined);
  }, [manager.id, threadId]);

  useEffect(() => {
    if (!threadId) { setThread(null); return; }
    let cancelled = false;
    const tick = () => {
      void loadManagerThread(manager.id, threadId)
        .then((next) => { if (!cancelled) setThread(next); })
        .catch(() => undefined);
    };
    tick();
    const timer = window.setInterval(tick, 1800);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [manager.id, threadId]);

  const running = useMemo(() => {
    if (manager.activeRunId) return true;
    return thread?.run ? ACTIVE_RUN.has(thread.run.state) : false;
  }, [manager.activeRunId, thread]);

  const messages = useMemo(() => (thread?.items ?? []).filter((item) => item.body?.trim()), [thread]);
  const toolActivity = useMemo(() => {
    const events = thread?.events ?? [];
    const labels = events.map((event) => toolLabel(event.type)).filter(Boolean) as string[];
    return labels.length ? labels[labels.length - 1] : null;
  }, [thread]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, running]);

  const send = async (newConversation = false) => {
    const text = draft.trim();
    if (!text || busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await sendManagerMessage(manager.id, {
        message: text,
        threadId: newConversation ? null : threadId,
        newConversation
      });
      setDraft("");
      if (result.threadId) setThreadId(result.threadId);
      onChanged();
      void listManagerConversations(manager.id).then(setConversations).catch(() => undefined);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="manager-chat">
      <aside className="manager-chat-rail">
        <button className="manager-chat-back" onClick={onBack}>← Managers</button>
        <div className="manager-chat-identity">
          <PixelAvatar id={manager.id} title={manager.name} />
          <div>
            <strong>{manager.name}</strong>
            <small><i className={`dot dot-${manager.state}`} /> {manager.state}</small>
          </div>
        </div>
        <button className="manager-new-chat" onClick={() => { setThreadId(null); setThread(null); }}>＋ Nouvelle conversation</button>
        <div className="manager-chat-history">
          <span className="manager-chat-history-title">CONVERSATIONS</span>
          {conversations.map((conversation, index) => (
            <button
              key={conversation.id}
              className={conversation.id === threadId ? "active" : ""}
              onClick={() => setThreadId(conversation.id)}
            >
              <b>{String(conversations.length - index).padStart(2, "0")}</b>
              <span>
                <strong>{conversation.turns[0]?.summary || "Conversation"}</strong>
                <small>{new Date(conversation.createdAt).toLocaleString("fr-FR")} · {conversation.turns.length} tour{conversation.turns.length > 1 ? "s" : ""}</small>
              </span>
            </button>
          ))}
          {!conversations.length && <p className="manager-chat-empty">Aucune conversation. Envoie un premier brief.</p>}
        </div>
      </aside>

      <section className="manager-chat-main">
        <header className="manager-chat-head">
          <div>
            <span className="eyebrow">GUILD CHANNEL</span>
            <h2>{threadId ? "Conversation" : "Nouvelle conversation"}</h2>
          </div>
          <small>{manager.modelId ?? "—"} · {manager.reasoningEffort ?? "provider_default"} · {manager.permissionPreset}</small>
        </header>

        <div className="manager-chat-log" ref={scrollRef}>
          {!threadId && !messages.length && (
            <div className="manager-chat-hello">
              <PixelAvatar id={manager.id} title={manager.name} />
              <p>{manager.instruction}</p>
              <small>Ce manager pilote DevFlow via son CLI. Demande-lui de créer des missions, de vérifier un état, ou d'orchestrer un pipeline.</small>
            </div>
          )}
          {messages.map((item) => (
            <div key={item.id} className={`manager-bubble ${item.kind === "user" ? "from-user" : "from-agent"}`}>
              {item.kind !== "user" && <PixelAvatar id={manager.id} title={manager.name} mini />}
              <div className="manager-bubble-body">{item.body}</div>
            </div>
          ))}
          {running && (
            <div className="manager-bubble from-agent">
              <PixelAvatar id={manager.id} title={manager.name} mini />
              <div className="manager-bubble-body thinking">
                <span className="thinking-dots"><i /><i /><i /></span>
                {toolActivity ?? "réfléchit"}
              </div>
            </div>
          )}
        </div>

        {error && <p className="manager-error" role="alert">{error}</p>}

        <div className="manager-composer">
          <textarea
            rows={3}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void send(); }
            }}
            placeholder={running ? "Ajoute une indication à sa file…" : "Qu'est-ce qu'on orchestre ?"}
          />
          <div className="manager-composer-actions">
            <small>⌘⏎ pour envoyer</small>
            <button disabled={busy || !draft.trim()} onClick={() => void send()}>
              {busy ? "…" : running ? "Ajouter à sa file →" : "Envoyer →"}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
