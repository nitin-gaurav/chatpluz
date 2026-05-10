import React, { useEffect, useMemo, useRef, useState } from "react";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000/chat";
const STORAGE_KEY = "ai-support-assistant-conversations";
const ACTIVE_CONVERSATION_KEY = "ai-support-assistant-active-id";
const DEFAULT_AI_MESSAGE = {
  id: crypto.randomUUID(),
  sender: "ai",
  text: "Hi! I am your AI support assistant. How can I help today?",
  createdAt: new Date().toISOString(),
};

const SUPPORT_INTENTS = [
  {
    label: "Billing",
    prompt: "I need help understanding a charge on my account.",
  },
  {
    label: "Bug report",
    prompt: "I found a bug and need help documenting it clearly.",
  },
  {
    label: "Account access",
    prompt: "I cannot access my account and need troubleshooting steps.",
  },
  {
    label: "Feature request",
    prompt: "I want to request a new product feature.",
  },
];

function createConversation(title = "New support chat") {
  return {
    id: crypto.randomUUID(),
    title,
    status: "Open",
    satisfaction: null,
    handoff: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    messages: [DEFAULT_AI_MESSAGE],
  };
}

function getInitialConversations() {
  try {
    const savedConversations = JSON.parse(localStorage.getItem(STORAGE_KEY));

    if (Array.isArray(savedConversations) && savedConversations.length > 0) {
      return savedConversations;
    }
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }

  return [createConversation()];
}

function getInitialActiveId(conversations) {
  const savedActiveId = localStorage.getItem(ACTIVE_CONVERSATION_KEY);
  const savedConversation = conversations.find(
    (conversation) => conversation.id === savedActiveId
  );

  return savedConversation?.id || conversations[0].id;
}

function buildTitle(message) {
  const compactMessage = message.replace(/\s+/g, " ").trim();
  return compactMessage.length > 34
    ? `${compactMessage.slice(0, 34)}...`
    : compactMessage || "New support chat";
}

function formatTime(value) {
  if (!value) {
    return "";
  }

  return new Intl.DateTimeFormat("en", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderMarkdown(text) {
  const escapedText = escapeHtml(text);

  return escapedText
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\n/g, "<br />");
}

function buildSummary(messages) {
  const userMessages = messages.filter((message) => message.sender === "user");

  if (userMessages.length === 0) {
    return "Waiting for the customer to describe their issue.";
  }

  return userMessages[userMessages.length - 1].text;
}

function App() {
  const initialConversationsRef = useRef(null);

  if (!initialConversationsRef.current) {
    initialConversationsRef.current = getInitialConversations();
  }

  const [conversations, setConversations] = useState(
    initialConversationsRef.current
  );
  const [activeConversationId, setActiveConversationId] = useState(() =>
    getInitialActiveId(initialConversationsRef.current)
  );
  const [input, setInput] = useState("");
  const [isThinking, setIsThinking] = useState(false);
  const [handoffEmail, setHandoffEmail] = useState("");
  const [handoffNote, setHandoffNote] = useState("");
  const chatEndRef = useRef(null);
  const requestInFlightRef = useRef(false);

  const activeConversation = useMemo(
    () =>
      conversations.find((conversation) => conversation.id === activeConversationId) ||
      conversations[0],
    [activeConversationId, conversations]
  );
  const messages = activeConversation?.messages || [];
  const customerMessageCount = messages.filter(
    (message) => message.sender === "user"
  ).length;

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations));
  }, [conversations]);

  useEffect(() => {
    localStorage.setItem(ACTIVE_CONVERSATION_KEY, activeConversationId);
  }, [activeConversationId]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isThinking]);

  function updateActiveConversation(updater) {
    setConversations((currentConversations) =>
      currentConversations.map((conversation) => {
        if (conversation.id !== activeConversationId) {
          return conversation;
        }

        return {
          ...updater(conversation),
          updatedAt: new Date().toISOString(),
        };
      })
    );
  }

  function startNewConversation() {
    const conversation = createConversation();
    setConversations((currentConversations) => [conversation, ...currentConversations]);
    setActiveConversationId(conversation.id);
    setInput("");
  }

  function clearActiveConversation() {
    updateActiveConversation((conversation) => ({
      ...conversation,
      title: "New support chat",
      status: "Open",
      satisfaction: null,
      handoff: null,
      messages: [
        {
          ...DEFAULT_AI_MESSAGE,
          id: crypto.randomUUID(),
          createdAt: new Date().toISOString(),
        },
      ],
    }));
  }

  async function sendMessage(messageOverride) {
    const trimmedMessage = (messageOverride || input).trim();

    if (!trimmedMessage || isThinking || requestInFlightRef.current) {
      return;
    }

    const userMessage = {
      id: crypto.randomUUID(),
      sender: "user",
      text: trimmedMessage,
      createdAt: new Date().toISOString(),
    };

    const historyBeforeSend = messages;
    updateActiveConversation((conversation) => ({
      ...conversation,
      title:
        conversation.title === "New support chat"
          ? buildTitle(trimmedMessage)
          : conversation.title,
      messages: [...conversation.messages, userMessage],
    }));
    setInput("");
    requestInFlightRef.current = true;
    setIsThinking(true);

    try {
      const response = await fetch(API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: trimmedMessage,
          history: historyBeforeSend,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "The server could not process your request.");
      }

      updateActiveConversation((conversation) => ({
        ...conversation,
        messages: [
          ...conversation.messages,
          {
            id: crypto.randomUUID(),
            sender: "ai",
            text: data.reply,
            createdAt: new Date().toISOString(),
          },
        ],
      }));
    } catch (error) {
      updateActiveConversation((conversation) => ({
        ...conversation,
        messages: [
          ...conversation.messages,
          {
            id: crypto.randomUUID(),
            sender: "ai",
            text: `Sorry, I could not reach support right now. ${error.message}`,
            createdAt: new Date().toISOString(),
          },
        ],
      }));
    } finally {
      requestInFlightRef.current = false;
      setIsThinking(false);
    }
  }

  function handleKeyDown(event) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  }

  function updateSatisfaction(score) {
    updateActiveConversation((conversation) => ({
      ...conversation,
      satisfaction: score,
    }));
  }

  function submitHandoff(event) {
    event.preventDefault();

    if (!handoffEmail.trim()) {
      return;
    }

    updateActiveConversation((conversation) => ({
      ...conversation,
      status: "Escalated",
      handoff: {
        email: handoffEmail.trim(),
        note: handoffNote.trim(),
        createdAt: new Date().toISOString(),
      },
      messages: [
        ...conversation.messages,
        {
          id: crypto.randomUUID(),
          sender: "ai",
          text: `I created a human handoff request for ${handoffEmail.trim()}. A support teammate can review this transcript and follow up.`,
          createdAt: new Date().toISOString(),
        },
      ],
    }));
    setHandoffEmail("");
    setHandoffNote("");
  }

  function exportTranscript() {
    const transcript = messages
      .map((message) => {
        const speaker = message.sender === "user" ? "Customer" : "Assistant";
        return `[${formatTime(message.createdAt)}] ${speaker}: ${message.text}`;
      })
      .join("\n\n");
    const blob = new Blob([transcript], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${activeConversation.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-transcript.txt`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="app-shell">
      <aside className="conversation-sidebar" aria-label="Support conversations">
        <div className="sidebar-header">
          <h2>Cases</h2>
          <button onClick={startNewConversation} type="button">
            New
          </button>
        </div>

        <div className="conversation-list">
          {conversations.map((conversation) => (
            <button
              className={`conversation-item ${
                conversation.id === activeConversationId ? "active" : ""
              }`}
              key={conversation.id}
              onClick={() => setActiveConversationId(conversation.id)}
              type="button"
            >
              <span>{conversation.title}</span>
              <small>{conversation.status}</small>
            </button>
          ))}
        </div>
      </aside>

      <section className="chat-panel" aria-label="AI support chat">
        <header className="chat-header">
          <div>
            <h1>AI Support Assistant</h1>
            <p>Friendly help for your startup customers</p>
          </div>
          <div className="header-actions">
            <span className="status-pill">{activeConversation.status}</span>
            <button onClick={clearActiveConversation} type="button">
              Clear
            </button>
            <button onClick={exportTranscript} type="button">
              Export
            </button>
          </div>
        </header>

        <div className="intent-bar" aria-label="Quick support topics">
          {SUPPORT_INTENTS.map((intent) => (
            <button
              disabled={isThinking}
              key={intent.label}
              onClick={() => sendMessage(intent.prompt)}
              type="button"
            >
              {intent.label}
            </button>
          ))}
        </div>

        <div className="workspace">
          <div className="messages">
            {messages.map((message) => (
              <div
                className={`message-row ${
                  message.sender === "user" ? "message-row-user" : "message-row-ai"
                }`}
                key={message.id}
              >
                <div className={`message-bubble ${message.sender}`}>
                  <div
                    dangerouslySetInnerHTML={{ __html: renderMarkdown(message.text) }}
                  />
                  {message.createdAt && <time>{formatTime(message.createdAt)}</time>}
                </div>
              </div>
            ))}

            {isThinking && (
              <div className="message-row message-row-ai">
                <div className="message-bubble ai thinking">Thinking...</div>
              </div>
            )}

            <div ref={chatEndRef} />
          </div>

          <aside className="insights-panel" aria-label="Case insights">
            <section>
              <h2>Case Summary</h2>
              <p>{buildSummary(messages)}</p>
            </section>

            <section className="metric-grid">
              <div>
                <strong>{customerMessageCount}</strong>
                <span>Customer turns</span>
              </div>
              <div>
                <strong>{activeConversation.satisfaction || "-"}</strong>
                <span>CSAT</span>
              </div>
            </section>

            <section>
              <h2>Rate Answer</h2>
              <div className="rating-row">
                {[1, 2, 3, 4, 5].map((score) => (
                  <button
                    className={
                      activeConversation.satisfaction === score ? "selected" : ""
                    }
                    key={score}
                    onClick={() => updateSatisfaction(score)}
                    type="button"
                  >
                    {score}
                  </button>
                ))}
              </div>
            </section>

            <form className="handoff-form" onSubmit={submitHandoff}>
              <h2>Human Handoff</h2>
              <input
                onChange={(event) => setHandoffEmail(event.target.value)}
                placeholder="customer@email.com"
                type="email"
                value={handoffEmail}
              />
              <textarea
                onChange={(event) => setHandoffNote(event.target.value)}
                placeholder="Short internal note"
                rows="3"
                value={handoffNote}
              />
              <button disabled={!handoffEmail.trim()} type="submit">
                Escalate
              </button>
            </form>
          </aside>
        </div>

        <form
          className="composer"
          onSubmit={(event) => {
            event.preventDefault();
            sendMessage();
          }}
        >
          <textarea
            aria-label="Message"
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type your question..."
            rows="1"
            value={input}
          />
          <button disabled={!input.trim() || isThinking} type="submit">
            Send
          </button>
        </form>
      </section>
    </main>
  );
}

export default App;
