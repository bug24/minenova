import { useState, useEffect, useRef, useCallback } from "react";
import { io, Socket } from "socket.io-client";
import { useAuth } from "@/contexts/useAuth";
import { X, MessageCircle, Send, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface ChatMessage {
  id: number;
  userId: number;
  username: string;
  avatarUrl?: string | null;
  message: string;
  createdAt: string;
}

function Avatar({ username, avatarUrl, size = 6 }: { username: string; avatarUrl?: string | null; size?: number }) {
  const sizeClass = `w-${size} h-${size}`;
  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={username}
        className={`${sizeClass} rounded-full object-cover shrink-0`}
      />
    );
  }
  return (
    <div className={`${sizeClass} rounded-full bg-primary/20 flex items-center justify-center shrink-0`}>
      <span className="text-[10px] font-bold text-primary">{username[0]?.toUpperCase()}</span>
    </div>
  );
}

export default function Chat() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [onlineCount, setOnlineCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [disabled, setDisabled] = useState(false);
  const [connected, setConnected] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    if (messages.length) scrollToBottom();
  }, [messages, scrollToBottom]);

  useEffect(() => {
    if (!open || !user) return;

    const token = localStorage.getItem("minenova_token");
    if (!token) return;

    const socketPath = `${import.meta.env.BASE_URL.replace(/\/$/, "")}/api/socket.io`.replace(/\/\//g, "/");

    const s = io({
      path: socketPath,
      auth: { token },
      transports: ["websocket", "polling"],
    });

    s.on("connect", () => setConnected(true));
    s.on("disconnect", () => setConnected(false));

    s.on("chat_history", (history: ChatMessage[]) => {
      setMessages(history);
    });

    s.on("message", (msg: ChatMessage) => {
      setMessages(prev => [...prev, msg]);
    });

    s.on("online_users_count", (count: number) => {
      setOnlineCount(count);
    });

    s.on("chat_error", ({ message }: { code: string; message: string }) => {
      setError(message);
      setTimeout(() => setError(null), 4000);
    });

    s.on("chat_disabled", () => {
      setDisabled(true);
      s.disconnect();
    });

    s.on("connect_error", (err) => {
      setConnected(false);
      if (err.message === "chat_disabled") {
        setDisabled(true);
        s.disconnect();
      }
    });

    setSocket(s);
    setDisabled(false);

    return () => {
      s.disconnect();
      setSocket(null);
      setConnected(false);
    };
  }, [open, user]);

  const handleSend = () => {
    if (!socket || !input.trim() || disabled) return;
    socket.emit("send_message", input.trim());
    setInput("");
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  };

  if (!user) return null;

  return (
    <>
      {/* Floating chat button */}
      <button
        onClick={() => setOpen(o => !o)}
        className="fixed bottom-20 right-4 z-40 w-12 h-12 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center justify-center transition-all active:scale-95 hover:scale-105"
        data-testid="chat-fab"
        aria-label="Open chat"
      >
        {open ? <X className="w-5 h-5" /> : <MessageCircle className="w-5 h-5" />}
      </button>

      {/* Chat panel */}
      {open && (
        <div className="fixed bottom-[4.5rem] right-4 z-40 w-[22rem] max-w-[calc(100vw-2rem)] bg-card border border-card-border rounded-2xl shadow-2xl flex flex-col overflow-hidden" style={{ height: "26rem" }}>
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-card-border bg-card shrink-0">
            <div className="flex items-center gap-2">
              <MessageCircle className="w-4 h-4 text-primary" />
              <span className="font-semibold text-sm">Global Chat</span>
              {connected && (
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              )}
            </div>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <Users className="w-3 h-3" />
                <span>{onlineCount}</span>
              </div>
              <Button variant="ghost" size="sm" className="w-6 h-6 p-0" onClick={() => setOpen(false)}>
                <X className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
            {disabled ? (
              <div className="flex items-center justify-center h-full">
                <p className="text-sm text-muted-foreground text-center px-4">Chat is currently offline.</p>
              </div>
            ) : messages.length === 0 ? (
              <div className="flex items-center justify-center h-full">
                <p className="text-sm text-muted-foreground text-center px-4">
                  {connected ? "No messages yet. Be the first to say hi!" : "Connecting…"}
                </p>
              </div>
            ) : (
              messages.map(msg => {
                const isOwn = msg.userId === user.id;
                return (
                  <div key={msg.id} className={`flex gap-1.5 ${isOwn ? "flex-row-reverse" : "flex-row"} items-end`}>
                    {!isOwn && (
                      <Avatar username={msg.username} avatarUrl={msg.avatarUrl} size={6} />
                    )}
                    <div className={`flex flex-col max-w-[75%] ${isOwn ? "items-end" : "items-start"}`}>
                      <div
                        className={`rounded-xl px-3 py-2 text-sm break-words ${
                          isOwn
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted text-foreground"
                        }`}
                      >
                        {!isOwn && (
                          <p className="text-[10px] font-semibold mb-0.5 opacity-70">{msg.username}</p>
                        )}
                        <p className="leading-snug">{msg.message}</p>
                      </div>
                      <span className="text-[10px] text-muted-foreground mt-0.5 px-1">{formatTime(msg.createdAt)}</span>
                    </div>
                    {isOwn && (
                      <Avatar username={msg.username} avatarUrl={msg.avatarUrl} size={6} />
                    )}
                  </div>
                );
              })
            )}
            <div ref={bottomRef} />
          </div>

          {/* Error banner */}
          {error && (
            <div className="px-3 py-1.5 bg-red-500/10 border-t border-red-500/20 text-xs text-red-400 text-center shrink-0">
              {error}
            </div>
          )}

          {/* Input */}
          {!disabled && (
            <div className="px-3 py-2 border-t border-card-border bg-card shrink-0 flex gap-2">
              <Input
                ref={inputRef}
                placeholder={connected ? "Type a message…" : "Connecting…"}
                value={input}
                onChange={e => setInput(e.target.value.slice(0, 200))}
                onKeyDown={handleKeyDown}
                disabled={!connected}
                className="text-sm h-9"
              />
              <Button
                size="sm"
                className="h-9 w-9 p-0 shrink-0"
                onClick={handleSend}
                disabled={!connected || !input.trim()}
              >
                <Send className="w-3.5 h-3.5" />
              </Button>
            </div>
          )}
        </div>
      )}
    </>
  );
}
