import { useState, useEffect, useRef, useCallback } from "react";
import { useAuth } from "@/contexts/useAuth";
import { X, MessageCircle, Send, Paperclip, CheckCheck, ImageIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

interface SupportMessage {
  id: number;
  userId: number;
  senderRole: "user" | "admin";
  message: string | null;
  imageUrl: string | null;
  isRead: boolean;
  createdAt: string;
}

function Avatar({ username, size = 6 }: { username: string; size?: number }) {
  const sizeClass = `w-${size} h-${size}`;
  return (
    <div className={`${sizeClass} rounded-full bg-primary/20 flex items-center justify-center shrink-0`}>
      <span className="text-[10px] font-bold text-primary">{username[0]?.toUpperCase()}</span>
    </div>
  );
}

function AdminAvatar({ size = 6 }: { size?: number }) {
  const sizeClass = `w-${size} h-${size}`;
  return (
    <div className={`${sizeClass} rounded-full bg-amber-500/20 flex items-center justify-center shrink-0`}>
      <span className="text-[10px] font-bold text-amber-500">A</span>
    </div>
  );
}

interface SupportChatProps {
  initialMessage?: string;
  onUnreadChange?: (count: number) => void;
}

export default function SupportChat({ initialMessage, onUnreadChange }: SupportChatProps) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [pendingImageUrl, setPendingImageUrl] = useState<string | null>(null);
  const [pendingObjectPath, setPendingObjectPath] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const initialMessageUsed = useRef(false);

  const token = typeof window !== "undefined" ? localStorage.getItem("minenova_token") : null;

  const scrollToBottom = useCallback(() => {
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
  }, []);

  const fetchMessages = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch("/api/support/messages", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data: SupportMessage[] = await res.json();
        setMessages(data);
        scrollToBottom();
      }
    } catch { /* ignore */ }
  }, [token, scrollToBottom]);

  const fetchUnread = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch("/api/support/unread-count", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const { count } = await res.json() as { count: number };
        setUnreadCount(count);
        onUnreadChange?.(count);
      }
    } catch { /* ignore */ }
  }, [token, onUnreadChange]);

  useEffect(() => {
    if (open) {
      fetchMessages();
      // Clear unread when chat is opened
      setUnreadCount(0);
      onUnreadChange?.(0);
      pollingRef.current = setInterval(fetchMessages, 8000);
    } else {
      if (pollingRef.current) clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [open, fetchMessages, onUnreadChange]);

  // Poll unread when closed
  useEffect(() => {
    if (open) return;
    fetchUnread();
    const id = setInterval(fetchUnread, 10000);
    return () => clearInterval(id);
  }, [open, fetchUnread]);

  // Pre-fill initial message when opened
  useEffect(() => {
    if (open && initialMessage && !initialMessageUsed.current) {
      setInput(initialMessage);
      initialMessageUsed.current = true;
    }
  }, [open, initialMessage]);

  const handleSend = async () => {
    if (!token || (!input.trim() && !pendingObjectPath)) return;
    setSending(true);
    try {
      const body: Record<string, string> = {};
      if (input.trim()) body.message = input.trim();
      if (pendingObjectPath) body.objectPath = pendingObjectPath;

      const res = await fetch("/api/support/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const msg: SupportMessage = await res.json();
        setMessages(prev => [...prev, msg]);
        setInput("");
        setPendingImageUrl(null);
        setPendingObjectPath(null);
        scrollToBottom();
      }
    } catch { /* ignore */ }
    finally { setSending(false); }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !token) return;

    if (!["image/jpeg", "image/png"].includes(file.type)) {
      return;
    }
    if (file.size > 5 * 1024 * 1024) return;

    setUploading(true);
    try {
      const urlRes = await fetch("/api/support/uploads/request-url", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type }),
      });
      if (!urlRes.ok) throw new Error("Failed to get upload URL");

      const { uploadURL, objectPath } = await urlRes.json() as { uploadURL: string; objectPath: string };

      const putRes = await fetch(uploadURL, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type },
      });
      if (!putRes.ok) throw new Error("Upload failed");

      const previewUrl = URL.createObjectURL(file);
      setPendingImageUrl(previewUrl);
      setPendingObjectPath(objectPath);
    } catch { /* ignore */ }
    finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (!user) return null;

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => setOpen(v => !v)}
        className="fixed bottom-20 right-4 z-40 w-12 h-12 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center justify-center hover:bg-primary/90 transition-colors"
        aria-label="Support chat"
        data-testid="button-support-chat-open"
      >
        <MessageCircle className="w-5 h-5" />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {/* Chat panel */}
      {open && (
        <div className="fixed bottom-36 right-4 z-50 w-80 sm:w-96 bg-card border border-card-border rounded-2xl shadow-2xl flex flex-col overflow-hidden"
          style={{ maxHeight: "min(520px, calc(100vh - 160px))" }}>
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-card-border bg-card/80 backdrop-blur-sm">
            <div className="flex items-center gap-2.5">
              <AdminAvatar size={7} />
              <div>
                <p className="text-sm font-semibold leading-tight">Support</p>
                <p className="text-[10px] text-muted-foreground">MineNova Admin</p>
              </div>
            </div>
            <button onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-3 space-y-3 min-h-0">
            {messages.length === 0 && (
              <div className="text-center py-8 text-sm text-muted-foreground">
                <MessageCircle className="w-8 h-8 mx-auto mb-2 opacity-30" />
                <p>How can we help?</p>
                <p className="text-xs mt-1">Send a message to get support</p>
              </div>
            )}
            {messages.map(msg => {
              const isUser = msg.senderRole === "user";
              return (
                <div key={msg.id} className={`flex gap-2 ${isUser ? "flex-row-reverse" : "flex-row"}`}>
                  {isUser ? <Avatar username={user.username} /> : <AdminAvatar />}
                  <div className={`max-w-[75%] space-y-1 ${isUser ? "items-end" : "items-start"} flex flex-col`}>
                    {msg.imageUrl && (
                      <a href={msg.imageUrl} target="_blank" rel="noopener noreferrer">
                        <img
                          src={msg.imageUrl}
                          alt="attachment"
                          className={`rounded-xl max-w-full max-h-40 object-cover border ${isUser ? "border-primary/20" : "border-card-border"}`}
                        />
                      </a>
                    )}
                    {msg.message && (
                      <div className={`px-3 py-2 rounded-2xl text-sm leading-relaxed ${
                        isUser
                          ? "bg-primary text-primary-foreground rounded-tr-sm"
                          : "bg-muted text-foreground rounded-tl-sm"
                      }`}>
                        {msg.message}
                      </div>
                    )}
                    <div className={`flex items-center gap-1 ${isUser ? "flex-row-reverse" : ""}`}>
                      <span className="text-[10px] text-muted-foreground">
                        {new Date(msg.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </span>
                      {isUser && msg.isRead && <CheckCheck className="w-3 h-3 text-primary" />}
                    </div>
                  </div>
                </div>
              );
            })}
            <div ref={bottomRef} />
          </div>

          {/* Pending image preview */}
          {pendingImageUrl && (
            <div className="px-3 pb-1 flex items-center gap-2">
              <div className="relative inline-block">
                <img src={pendingImageUrl} alt="preview" className="h-14 w-14 object-cover rounded-lg border border-card-border" />
                <button
                  onClick={() => { setPendingImageUrl(null); setPendingObjectPath(null); }}
                  className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-destructive text-white flex items-center justify-center"
                >
                  <X className="w-2.5 h-2.5" />
                </button>
              </div>
              <span className="text-xs text-muted-foreground">Image ready to send</span>
            </div>
          )}

          {/* Input area */}
          <div className="border-t border-card-border p-3 flex items-end gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept=".jpg,.jpeg,.png"
              className="sr-only"
              onChange={handleFileChange}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="text-muted-foreground hover:text-foreground transition-colors shrink-0 mb-1"
              title="Attach image"
            >
              {uploading ? (
                <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              ) : (
                <Paperclip className="w-4 h-4" />
              )}
            </button>
            <Textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type a message…"
              rows={1}
              className="resize-none min-h-0 h-9 py-2 text-sm flex-1"
              disabled={sending}
            />
            <Button
              size="icon"
              className="shrink-0 h-9 w-9"
              onClick={handleSend}
              disabled={sending || (!input.trim() && !pendingObjectPath)}
              data-testid="button-support-send"
            >
              {sending ? (
                <div className="w-4 h-4 border-2 border-primary-foreground border-t-transparent rounded-full animate-spin" />
              ) : (
                <Send className="w-3.5 h-3.5" />
              )}
            </Button>
          </div>
        </div>
      )}
    </>
  );
}

