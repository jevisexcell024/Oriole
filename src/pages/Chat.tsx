import { useState } from "react";
import { Send, MessageCircle, Info, LifeBuoy } from "lucide-react";
import { Shell } from "@/components/Shell";
import { PageHeader } from "@/components/PageHeader";
import { useAuth } from "@/lib/auth";
import { clsx } from "clsx";

interface Msg { id: string; from: "me" | "them"; text: string; at: string; }

const CONTACTS = [
  { id: "support", name: "Student Support", subtitle: "General help & questions" },
];

// There is no real-time messaging backend yet — this is a UI shell for the
// feature. Sent messages stay local to this session (not delivered to staff),
// and the page says so plainly instead of faking a working conversation.
export function Chat() {
  const { user } = useAuth();
  const [activeId, setActiveId] = useState(CONTACTS[0].id);
  const [messages, setMessages] = useState<Msg[]>([
    { id: "welcome", from: "them", text: "Hi! This is a preview of the chat experience — messages here aren't sent to staff yet.", at: new Date().toISOString() },
  ]);
  const [draft, setDraft] = useState("");

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    setMessages((m) => [...m, { id: crypto.randomUUID(), from: "me", text, at: new Date().toISOString() }]);
    setDraft("");
  };

  const active = CONTACTS.find((c) => c.id === activeId)!;

  return (
    <Shell>
      <div className="fade-in max-w-4xl">
        <PageHeader title="Chat" subtitle="Message student support." />

        <div className="mt-6 flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-500">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <p>Live messaging is coming soon. Anything you type here stays on this page and isn't sent to anyone yet.</p>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 overflow-hidden rounded-2xl border border-[var(--border)] sm:grid-cols-[220px_1fr]" style={{ minHeight: 480 }}>
          {/* Conversation list */}
          <div className="border-b border-[var(--border)] bg-[var(--card)] sm:border-b-0 sm:border-r">
            {CONTACTS.map((c) => (
              <button key={c.id} onClick={() => setActiveId(c.id)}
                className={clsx("flex w-full items-center gap-3 border-b border-[var(--border)] p-4 text-left transition",
                  c.id === activeId ? "bg-[var(--card-2)]" : "hover:bg-[var(--card-2)]")}>
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full" style={{ background: "rgba(198,255,52,0.14)" }}>
                  <LifeBuoy className="h-4 w-4" style={{ color: "#c6ff34" }} />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-[var(--fg)]">{c.name}</p>
                  <p className="truncate text-xs text-[var(--muted)]">{c.subtitle}</p>
                </div>
              </button>
            ))}
          </div>

          {/* Thread */}
          <div className="flex flex-col bg-[var(--card)]">
            <div className="border-b border-[var(--border)] p-4">
              <p className="text-sm font-bold text-[var(--fg)]">{active.name}</p>
            </div>
            <div className="flex-1 space-y-3 overflow-y-auto p-4">
              {messages.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-[var(--muted)]">
                  <MessageCircle className="h-8 w-8" />
                  <p className="text-sm">No messages yet.</p>
                </div>
              ) : messages.map((m) => (
                <div key={m.id} className={clsx("flex", m.from === "me" ? "justify-end" : "justify-start")}>
                  <div className={clsx("max-w-[75%] rounded-2xl px-4 py-2.5 text-sm",
                    m.from === "me" ? "text-[#111110]" : "border border-[var(--border)] text-[var(--fg)]")}
                    style={m.from === "me" ? { background: "#c6ff34" } : undefined}>
                    {m.text}
                  </div>
                </div>
              ))}
            </div>
            <form onSubmit={(e) => { e.preventDefault(); send(); }} className="flex items-center gap-2 border-t border-[var(--border)] p-3">
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={`Message as ${user?.name?.split(" ")[0] ?? "you"}…`}
                className="flex-1 rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3.5 py-2.5 text-sm text-[var(--fg)] outline-none transition focus:border-[#c6ff34]"
              />
              <button type="submit" disabled={!draft.trim()}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-[#111110] transition disabled:opacity-40"
                style={{ background: "#c6ff34" }} aria-label="Send">
                <Send className="h-4 w-4" />
              </button>
            </form>
          </div>
        </div>
      </div>
    </Shell>
  );
}
