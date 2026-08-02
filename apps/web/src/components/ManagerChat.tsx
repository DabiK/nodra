import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { AgentSessionView, ManagerConversationView, ManagerThreadView, ManagerView } from "../types";
import { latestManagerThread, listManagerConversations, loadManagerThread, sendManagerMessage, stopManager, deleteManagerThread } from "../services/manager-service";
import { normalizeAgentConversation, extractRunFailure, type AgentConversationEvent } from "../services/agent-conversation-normalizer";
import { PixelAvatar } from "./PixelAvatar";

const ACTIVE_RUN = new Set(["QUEUED", "STARTING", "RUNNING", "WAITING_APPROVAL", "CANCELLING"]);

/** Adapt a manager thread into the shape the shared conversation normalizer expects. */
function toSession(thread: ManagerThreadView | null): AgentSessionView | null {
  if (!thread || !thread.run) return null;
  return {
    run: thread.run,
    conversation: thread.conversation,
    config: thread.config
      ? { promptEffective: thread.config.promptEffective, promptMission: null, cwd: thread.config.cwd, permissionPreset: thread.config.permissionPreset }
      : null,
    items: thread.items,
    events: thread.events
  };
}

function ManagerEvent({ event, manager }: { event: AgentConversationEvent; manager: ManagerView }) {
  if (event.kind === "system") {
    return <div className="manager-system">{event.text}</div>;
  }
  if (event.kind === "tool" || event.kind === "reasoning") {
    const title = event.kind === "reasoning" ? "🧠 Réflexion" : event.title;
    const command = event.kind === "tool" ? event.command : undefined;
    const output = event.kind === "tool" ? event.output : event.text;
    return (
      <div className="manager-tool">
        <div className="manager-tool-title">{title}</div>
        {command && <pre className="manager-tool-pre">{command}</pre>}
        {output && (
          <details className="manager-tool-details" open={!command}>
            <summary>Afficher la sortie</summary>
            <pre className="manager-tool-pre">{output}</pre>
          </details>
        )}
      </div>
    );
  }
  if (event.kind === "error") {
    return (
      <div className="manager-bubble from-agent">
        <div className="manager-bubble-body error">⚠ {event.text}</div>
      </div>
    );
  }
  return (
    <div className={`manager-bubble ${event.kind === "user" ? "from-user" : "from-agent"}`}>
      {event.kind !== "user" && <PixelAvatar id={manager.id} title={manager.name} mini />}
      <div className="manager-bubble-body">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
          }}
        >
          {event.text}
        </ReactMarkdown>
      </div>
    </div>
  );
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

  const events = useMemo(() => {
    // OpenCode streams the first run's *composed* prompt (system instruction +
    // DevFlow CLI preamble + brief) as a user part. The clean brief is already
    // shown from the persisted conversation item, so drop the composed one.
    return normalizeAgentConversation(toSession(thread))
      .filter((event) => !(event.kind === "user" && event.text.includes("--- Environnement DevFlow ---")));
  }, [thread]);

  const failure = useMemo(() => {
    if (!thread || thread.run?.state !== "FAILED") return null;
    return extractRunFailure(toSession(thread));
  }, [thread]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [events.length, running]);

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

  const emergencyStop = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await stopManager(manager.id);
      onChanged();
      if (threadId) void loadManagerThread(manager.id, threadId).then(setThread).catch(() => undefined);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const removeConversation = async (conversationId: string) => {
    if (!confirm("Supprimer cette conversation ? L'agent en cours sera arrêté. Cette action est définitive.")) return;
    setBusy(true);
    setError("");
    try {
      await deleteManagerThread(manager.id, conversationId);
      const next = await listManagerConversations(manager.id);
      setConversations(next);
      if (conversationId === threadId) {
        setThread(null);
        setThreadId(next[0]?.id ?? null);
      }
      onChanged();
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
            <div key={conversation.id} className={`manager-chat-history-item${conversation.id === threadId ? " active" : ""}`}>
              <button
                className="manager-chat-history-open"
                onClick={() => setThreadId(conversation.id)}
              >
                <b>{String(conversations.length - index).padStart(2, "0")}</b>
                <span>
                  <strong>{conversation.turns[0]?.summary || "Conversation"}</strong>
                  <small>{new Date(conversation.createdAt).toLocaleString("fr-FR")} · {conversation.turns.length} tour{conversation.turns.length > 1 ? "s" : ""}</small>
                </span>
              </button>
              <button
                className="manager-chat-history-delete"
                aria-label="Supprimer la conversation"
                title="Supprimer la conversation"
                disabled={busy}
                onClick={() => void removeConversation(conversation.id)}
              >🗑</button>
            </div>
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
          <div className="manager-chat-head-actions">
            {running && (
              <button className="manager-stop" disabled={busy} onClick={() => void emergencyStop()}>
                ⏹ Arrêt d'urgence
              </button>
            )}
            <small>{manager.modelId ?? "—"} · {manager.reasoningEffort ?? "provider_default"} · {manager.permissionPreset}</small>
          </div>
        </header>

        <div className="manager-chat-log" ref={scrollRef}>
          {!threadId && !events.length && (
            <div className="manager-chat-hello">
              <PixelAvatar id={manager.id} title={manager.name} />
              <p>{manager.instruction}</p>
              <small>Ce manager pilote DevFlow via son CLI. Demande-lui de créer des missions, de vérifier un état, ou d'orchestrer un pipeline.</small>
            </div>
          )}
          {failure && (
            <div className="manager-run-failure" role="alert">
              <strong>⚠ {failure.title}</strong>
              <p>{failure.detail}</p>
            </div>
          )}
          {events.map((event) => <ManagerEvent key={event.id} event={event} manager={manager} />)}
          {running && (
            <div className="manager-bubble from-agent">
              <PixelAvatar id={manager.id} title={manager.name} mini />
              <div className="manager-bubble-body thinking">
                <span className="thinking-dots"><i /><i /><i /></span>
                réfléchit
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
