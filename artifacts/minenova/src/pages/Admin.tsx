import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Pencil, Trash2, Plus, Save, X, Check } from "lucide-react";

const PLATFORMS = ["general", "twitter", "whatsapp", "facebook"] as const;
type Platform = typeof PLATFORMS[number];

interface ShareMessage {
  id: number;
  platform: string;
  message: string;
  isActive: boolean;
  sortOrder: number;
}

const PLATFORM_COLORS: Record<string, string> = {
  twitter: "bg-sky-500/20 text-sky-500 border-sky-500/30",
  whatsapp: "bg-emerald-500/20 text-emerald-500 border-emerald-500/30",
  facebook: "bg-blue-500/20 text-blue-500 border-blue-500/30",
  general: "bg-purple-500/20 text-purple-500 border-purple-500/30",
};

function getApiUrl() {
  return import.meta.env.BASE_URL.replace(/\/$/, "");
}

export default function Admin() {
  const { toast } = useToast();
  const [secret, setSecret] = useState("");
  const [authed, setAuthed] = useState(false);
  const [messages, setMessages] = useState<ShareMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editText, setEditText] = useState("");
  const [editActive, setEditActive] = useState(true);
  const [addingPlatform, setAddingPlatform] = useState<Platform | null>(null);
  const [newMessage, setNewMessage] = useState("");
  const [usdtAddress, setUsdtAddress] = useState("");
  const [usdtAddressSaving, setUsdtAddressSaving] = useState(false);

  const headers = { "x-admin-secret": secret, "Content-Type": "application/json" };
  const base = getApiUrl();

  const fetchMessages = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${base}/api/admin/share-messages`, { headers });
      if (res.status === 401) { toast({ variant: "destructive", title: "Wrong password" }); setAuthed(false); return; }
      const data = await res.json();
      setMessages(data);
      setAuthed(true);
    } catch {
      toast({ variant: "destructive", title: "Connection error" });
    } finally {
      setLoading(false);
    }
  };

  const fetchConfig = async () => {
    try {
      const res = await fetch(`${base}/api/admin/config`, { headers });
      if (res.ok) {
        const data = await res.json();
        setUsdtAddress(data.usdt_wallet_address ?? "");
      }
    } catch { /* silent */ }
  };

  const handleLogin = async () => {
    if (!secret.trim()) return;
    await fetchMessages();
    await fetchConfig();
  };

  const handleSaveUsdtAddress = async () => {
    setUsdtAddressSaving(true);
    try {
      const res = await fetch(`${base}/api/admin/config`, {
        method: "POST",
        headers,
        body: JSON.stringify({ key: "usdt_wallet_address", value: usdtAddress }),
      });
      if (res.ok) {
        toast({ title: "USDT address saved!" });
      } else {
        toast({ variant: "destructive", title: "Failed to save address" });
      }
    } catch {
      toast({ variant: "destructive", title: "Connection error" });
    } finally {
      setUsdtAddressSaving(false);
    }
  };

  const handleSaveEdit = async (id: number) => {
    const res = await fetch(`${base}/api/admin/share-messages/${id}`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ message: editText, isActive: editActive }),
    });
    if (res.ok) {
      toast({ title: "Saved!" });
      setEditingId(null);
      fetchMessages();
    } else {
      toast({ variant: "destructive", title: "Failed to save" });
    }
  };

  const handleToggle = async (msg: ShareMessage) => {
    const res = await fetch(`${base}/api/admin/share-messages/${msg.id}`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ isActive: !msg.isActive }),
    });
    if (res.ok) fetchMessages();
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Delete this message?")) return;
    const res = await fetch(`${base}/api/admin/share-messages/${id}`, { method: "DELETE", headers });
    if (res.ok) { toast({ title: "Deleted" }); fetchMessages(); }
  };

  const handleAdd = async () => {
    if (!addingPlatform || !newMessage.trim()) return;
    const res = await fetch(`${base}/api/admin/share-messages`, {
      method: "POST",
      headers,
      body: JSON.stringify({ platform: addingPlatform, message: newMessage, isActive: true, sortOrder: 0 }),
    });
    if (res.ok) {
      toast({ title: "Added!" });
      setAddingPlatform(null);
      setNewMessage("");
      fetchMessages();
    } else {
      toast({ variant: "destructive", title: "Failed to add" });
    }
  };

  const grouped = PLATFORMS.reduce<Record<string, ShareMessage[]>>((acc, p) => {
    acc[p] = messages.filter(m => m.platform === p);
    return acc;
  }, {} as Record<string, ShareMessage[]>);

  if (!authed) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <div className="w-full max-w-sm space-y-4">
          <div className="text-center">
            <h1 className="text-2xl font-black font-serif text-foreground">Admin Panel</h1>
            <p className="text-muted-foreground text-sm mt-1">Enter your admin password to continue</p>
          </div>
          <div className="bg-card border border-card-border rounded-2xl p-6 space-y-4">
            <Input
              type="password"
              placeholder="Admin password"
              value={secret}
              onChange={e => setSecret(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleLogin()}
              data-testid="input-admin-password"
            />
            <Button className="w-full" onClick={handleLogin} disabled={loading}>
              {loading ? "Checking…" : "Login"}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-4 md:p-8 max-w-4xl mx-auto pb-12">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-black font-serif">Admin Panel</h1>
          <p className="text-muted-foreground text-sm mt-0.5">Manage social share messages</p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchMessages} disabled={loading}>
          Refresh
        </Button>
      </div>

      <div className="mb-6 bg-card border border-card-border rounded-2xl p-5 space-y-3">
        <div>
          <h2 className="font-semibold text-sm">USDT Wallet Address (TRC20)</h2>
          <p className="text-xs text-muted-foreground mt-0.5">This address is shown to users when they pay for upgrades via USDT.</p>
        </div>
        <div className="flex gap-2">
          <Input
            placeholder="T... (TRC20 wallet address)"
            value={usdtAddress}
            onChange={e => setUsdtAddress(e.target.value)}
            className="font-mono text-sm"
          />
          <Button size="sm" onClick={handleSaveUsdtAddress} disabled={usdtAddressSaving} className="shrink-0">
            <Save className="w-3.5 h-3.5 mr-1.5" />
            {usdtAddressSaving ? "Saving…" : "Save"}
          </Button>
        </div>
        {!usdtAddress && (
          <p className="text-xs text-amber-500">⚠ No address set — users will see a placeholder until you configure this.</p>
        )}
      </div>

      <div className="mb-4 bg-primary/10 border border-primary/20 rounded-xl p-3 text-xs text-primary">
        Use <code className="font-mono bg-primary/10 px-1 rounded">{`{url}`}</code> to insert the referral link, and <code className="font-mono bg-primary/10 px-1 rounded">{`{referral_code}`}</code> for the code. Messages with the specific platform take priority over "general" messages.
      </div>

      <div className="space-y-6">
        {PLATFORMS.map(platform => (
          <div key={platform} className="bg-card border border-card-border rounded-2xl p-5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Badge className={`text-xs border ${PLATFORM_COLORS[platform]}`}>{platform}</Badge>
                <span className="text-sm text-muted-foreground">{grouped[platform].length} message{grouped[platform].length !== 1 ? "s" : ""}</span>
              </div>
              <Button size="sm" variant="outline" className="gap-1.5 h-7 text-xs" onClick={() => { setAddingPlatform(platform); setNewMessage(""); }}>
                <Plus className="w-3 h-3" /> Add
              </Button>
            </div>

            {addingPlatform === platform && (
              <div className="space-y-2 bg-muted/50 rounded-xl p-3">
                <textarea
                  className="w-full text-sm bg-background border border-border rounded-lg p-3 resize-none min-h-[100px] focus:outline-none focus:ring-1 focus:ring-primary"
                  placeholder={`New ${platform} message… use {url} for the share link`}
                  value={newMessage}
                  onChange={e => setNewMessage(e.target.value)}
                />
                <div className="flex gap-2">
                  <Button size="sm" className="flex-1 gap-1" onClick={handleAdd}><Save className="w-3 h-3" /> Save</Button>
                  <Button size="sm" variant="outline" className="flex-1 gap-1" onClick={() => setAddingPlatform(null)}><X className="w-3 h-3" /> Cancel</Button>
                </div>
              </div>
            )}

            <div className="space-y-2">
              {grouped[platform].length === 0 && <p className="text-xs text-muted-foreground text-center py-2">No messages yet</p>}
              {grouped[platform].map(msg => (
                <div key={msg.id} className={`border rounded-xl p-3 space-y-2 transition-opacity ${msg.isActive ? "border-card-border" : "border-border opacity-60"}`}>
                  {editingId === msg.id ? (
                    <div className="space-y-2">
                      <textarea
                        className="w-full text-sm bg-background border border-border rounded-lg p-3 resize-none min-h-[100px] focus:outline-none focus:ring-1 focus:ring-primary"
                        value={editText}
                        onChange={e => setEditText(e.target.value)}
                      />
                      <div className="flex items-center gap-2">
                        <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
                          <input type="checkbox" checked={editActive} onChange={e => setEditActive(e.target.checked)} className="w-3 h-3" />
                          Active
                        </label>
                        <div className="ml-auto flex gap-2">
                          <Button size="sm" className="gap-1 h-7 text-xs" onClick={() => handleSaveEdit(msg.id)}><Save className="w-3 h-3" /> Save</Button>
                          <Button size="sm" variant="outline" className="gap-1 h-7 text-xs" onClick={() => setEditingId(null)}><X className="w-3 h-3" /> Cancel</Button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <>
                      <p className="text-sm whitespace-pre-wrap">{msg.message}</p>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleToggle(msg)}
                          className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border transition-colors ${msg.isActive ? "bg-emerald-500/20 text-emerald-500 border-emerald-500/30" : "bg-muted text-muted-foreground border-border"}`}
                        >
                          {msg.isActive ? <><Check className="w-2.5 h-2.5" /> Active</> : "Inactive"}
                        </button>
                        <div className="ml-auto flex gap-1">
                          <Button size="sm" variant="ghost" className="w-7 h-7 p-0" onClick={() => { setEditingId(msg.id); setEditText(msg.message); setEditActive(msg.isActive); }}>
                            <Pencil className="w-3 h-3" />
                          </Button>
                          <Button size="sm" variant="ghost" className="w-7 h-7 p-0 text-destructive hover:text-destructive" onClick={() => handleDelete(msg.id)}>
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
