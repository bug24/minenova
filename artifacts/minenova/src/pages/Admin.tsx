import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Pencil, Trash2, Plus, Save, X, Check, KeyRound, LogOut, Eye, EyeOff,
  Users, Wallet, ArrowDownCircle, BarChart3, Cpu, Share2, Package, Settings, RefreshCw,
  ShieldOff, Shield, CircleDollarSign, LayoutDashboard, type LucideIcon,
} from "lucide-react";

function apiFetch(path: string, options?: RequestInit) {
  return fetch(`/api${path}`, options);
}

// ─── Types ──────────────────────────────────────────────────────────────────

interface AdminUser {
  id: number; username: string; email: string; coinBalance: number;
  miningLevel: number; totalEarned: number; totalWithdrawn: number;
  isSuspended: boolean; referralCode: string; createdAt: string;
}
interface Withdrawal {
  id: number; userId: number; username: string | null; email: string | null;
  amount: number; status: string; walletAddress: string | null;
  paymentTag: string | null; adminNote: string | null; createdAt: string;
}
interface TxRow {
  id: number; userId: number; username: string | null; type: string;
  amount: number; status: string; description: string; adminNote: string | null; createdAt: string;
}
interface MiningSession {
  id: number; userId: number; username: string | null; hashRate: number;
  boostMultiplier: number; startedAt: string; endsAt: string;
}
interface Referral {
  id: number; referrerId: number; referredId: number;
  referrerUsername: string; referredUsername: string;
  totalEarned: number; bonusPaid: boolean; createdAt: string;
}
interface UpgradePurchase {
  id: number; userId: number; upgradeId: number; username: string | null;
  upgradeName: string | null; tier: number | null; usdtCost: number | null; purchasedAt: string;
}
interface Analytics {
  totalUsers: number; activeMiners: number; totalCoinsDistributed: number;
  totalUsdtWithdrawn: number; totalReferralPayout: number; pendingWithdrawals: number;
}
interface Settings { min_withdrawal_usdt: string; referral_bonus_coins: string; referral_commission_pct: string; maintenance_mode: string; }
interface ShareMessage { id: number; platform: string; message: string; isActive: boolean; sortOrder: number; }

type Tab = "dashboard" | "users" | "withdrawals" | "transactions" | "mining" | "referrals" | "upgrades" | "settings" | "share";

const PLATFORMS = ["general", "twitter", "whatsapp", "facebook"] as const;
type Platform = typeof PLATFORMS[number];
const PLATFORM_COLORS: Record<string, string> = {
  twitter: "bg-sky-500/20 text-sky-500 border-sky-500/30",
  whatsapp: "bg-emerald-500/20 text-emerald-500 border-emerald-500/30",
  facebook: "bg-blue-500/20 text-blue-500 border-blue-500/30",
  general: "bg-purple-500/20 text-purple-500 border-purple-500/30",
};

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    pending: "bg-yellow-500/20 text-yellow-500 border-yellow-500/30",
    approved: "bg-emerald-500/20 text-emerald-500 border-emerald-500/30",
    completed: "bg-emerald-500/20 text-emerald-500 border-emerald-500/30",
    rejected: "bg-red-500/20 text-red-500 border-red-500/30",
    mining: "bg-purple-500/20 text-purple-500 border-purple-500/30",
    referral: "bg-blue-500/20 text-blue-500 border-blue-500/30",
    adjustment: "bg-orange-500/20 text-orange-500 border-orange-500/30",
    withdrawal: "bg-red-500/20 text-red-400 border-red-500/30",
  };
  return <Badge className={`text-xs border capitalize ${map[status] ?? "bg-muted text-muted-foreground border-border"}`}>{status}</Badge>;
}

function fmt(d: string) { return new Date(d).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" }); }
function fmtCoins(n: number) { return n.toLocaleString(undefined, { maximumFractionDigits: 2 }); }

// ─── Dashboard Tab ───────────────────────────────────────────────────────────

function DashboardTab({ secret }: { secret: string }) {
  const [data, setData] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);
  const headers = { "x-admin-secret": secret, "Content-Type": "application/json" };

  useEffect(() => {
    apiFetch("/admin/analytics", { headers }).then(r => r.json()).then(setData).finally(() => setLoading(false));
  }, [secret]);

  if (loading) return <p className="text-muted-foreground text-sm py-8 text-center">Loading…</p>;
  if (!data) return <p className="text-destructive text-sm py-8 text-center">Failed to load analytics</p>;

  const cards = [
    { label: "Total Users", value: data.totalUsers.toLocaleString(), icon: Users, color: "text-blue-400" },
    { label: "Active Miners", value: data.activeMiners.toLocaleString(), icon: Cpu, color: "text-purple-400" },
    { label: "Coins Distributed", value: fmtCoins(data.totalCoinsDistributed), icon: CircleDollarSign, color: "text-yellow-400" },
    { label: "USDT Withdrawn", value: `$${data.totalUsdtWithdrawn.toFixed(2)}`, icon: ArrowDownCircle, color: "text-emerald-400" },
    { label: "Referral Payouts", value: fmtCoins(data.totalReferralPayout) + " coins", icon: Share2, color: "text-sky-400" },
    { label: "Pending Withdrawals", value: data.pendingWithdrawals.toLocaleString(), icon: Wallet, color: "text-orange-400" },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {cards.map(c => (
        <div key={c.label} className="bg-card border border-card-border rounded-2xl p-5 flex items-center gap-4">
          <div className={`p-2.5 rounded-xl bg-muted ${c.color}`}><c.icon className="w-5 h-5" /></div>
          <div>
            <p className="text-xs text-muted-foreground">{c.label}</p>
            <p className="text-xl font-bold">{c.value}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Users Tab ───────────────────────────────────────────────────────────────

function UsersTab({ secret }: { secret: string }) {
  const { toast } = useToast();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [adjustingId, setAdjustingId] = useState<number | null>(null);
  const [adjustDelta, setAdjustDelta] = useState("");
  const [adjustNote, setAdjustNote] = useState("");
  const headers = { "x-admin-secret": secret, "Content-Type": "application/json" };

  const load = useCallback(async () => {
    setLoading(true);
    const q = search.trim() ? `?search=${encodeURIComponent(search.trim())}` : "";
    const res = await apiFetch(`/admin/users${q}`, { headers: { "x-admin-secret": secret, "Content-Type": "application/json" } });
    const data = await res.json();
    setUsers(Array.isArray(data) ? data : []);
    setLoading(false);
  }, [search, secret]);

  useEffect(() => { load(); }, [load]);

  const handleSuspend = async (u: AdminUser) => {
    await apiFetch(`/admin/users/${u.id}/suspend`, { method: "POST", headers });
    toast({ title: u.isSuspended ? "User unsuspended" : "User suspended" });
    load();
  };

  const handleDelete = async (u: AdminUser) => {
    if (!confirm(`Delete account "${u.username}"? This cannot be undone.`)) return;
    const res = await apiFetch(`/admin/users/${u.id}`, { method: "DELETE", headers });
    if (res.ok) { toast({ title: "Account deleted" }); load(); }
    else toast({ variant: "destructive", title: "Failed to delete" });
  };

  const handleAdjust = async (id: number) => {
    const delta = parseFloat(adjustDelta);
    if (isNaN(delta) || !adjustNote.trim()) { toast({ variant: "destructive", title: "Fill in all fields" }); return; }
    const res = await apiFetch(`/admin/users/${id}/adjust-balance`, {
      method: "POST", headers, body: JSON.stringify({ delta, note: adjustNote }),
    });
    if (res.ok) { toast({ title: "Balance adjusted" }); setAdjustingId(null); setAdjustDelta(""); setAdjustNote(""); load(); }
    else toast({ variant: "destructive", title: "Failed to adjust" });
  };

  const filtered = search.trim()
    ? users.filter(u => u.username.toLowerCase().includes(search.toLowerCase()) || u.email.toLowerCase().includes(search.toLowerCase()))
    : users;

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Input placeholder="Search by username, email, or referral code…" value={search} onChange={e => setSearch(e.target.value)} className="max-w-sm" />
        <Button variant="outline" size="sm" onClick={load}><RefreshCw className="w-3.5 h-3.5" /></Button>
      </div>
      {loading ? <p className="text-muted-foreground text-sm text-center py-8">Loading…</p> : (
        <div className="space-y-2">
          {filtered.length === 0 && <p className="text-muted-foreground text-sm text-center py-8">No users found</p>}
          {filtered.map(u => (
            <div key={u.id} className="bg-card border border-card-border rounded-xl p-4 space-y-3">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{u.username}</span>
                    {u.isSuspended && <Badge className="text-xs border bg-red-500/20 text-red-400 border-red-500/30">Suspended</Badge>}
                  </div>
                  <p className="text-xs text-muted-foreground">{u.email} · #{u.referralCode}</p>
                  <p className="text-xs text-muted-foreground">Joined {fmt(u.createdAt)}</p>
                </div>
                <div className="text-right space-y-0.5">
                  <p className="text-sm font-medium">{fmtCoins(u.coinBalance)} coins</p>
                  <p className="text-xs text-muted-foreground">Level {u.miningLevel} · Earned {fmtCoins(u.totalEarned)}</p>
                  <p className="text-xs text-muted-foreground">Withdrawn ${u.totalWithdrawn.toFixed(2)} USDT</p>
                </div>
              </div>
              {adjustingId === u.id ? (
                <div className="bg-muted/50 rounded-xl p-3 space-y-2">
                  <p className="text-xs font-medium text-muted-foreground">Adjust Balance (positive = add, negative = deduct)</p>
                  <div className="flex gap-2 flex-wrap">
                    <Input type="number" placeholder="Delta (coins)" value={adjustDelta} onChange={e => setAdjustDelta(e.target.value)} className="w-36" />
                    <Input placeholder="Reason / note" value={adjustNote} onChange={e => setAdjustNote(e.target.value)} className="flex-1 min-w-[140px]" />
                    <Button size="sm" onClick={() => handleAdjust(u.id)} className="gap-1"><Save className="w-3 h-3" /> Apply</Button>
                    <Button size="sm" variant="outline" onClick={() => setAdjustingId(null)}><X className="w-3 h-3" /></Button>
                  </div>
                </div>
              ) : (
                <div className="flex gap-2 flex-wrap">
                  <Button size="sm" variant="outline" className="gap-1 text-xs h-7" onClick={() => { setAdjustingId(u.id); setAdjustDelta(""); setAdjustNote(""); }}>
                    <CircleDollarSign className="w-3 h-3" /> Adjust Balance
                  </Button>
                  <Button size="sm" variant="outline" className={`gap-1 text-xs h-7 ${u.isSuspended ? "text-emerald-500" : "text-orange-400"}`} onClick={() => handleSuspend(u)}>
                    {u.isSuspended ? <><Shield className="w-3 h-3" /> Unsuspend</> : <><ShieldOff className="w-3 h-3" /> Suspend</>}
                  </Button>
                  <Button size="sm" variant="ghost" className="gap-1 text-xs h-7 text-destructive hover:text-destructive" onClick={() => handleDelete(u)}>
                    <Trash2 className="w-3 h-3" /> Delete
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Withdrawals Tab ─────────────────────────────────────────────────────────

function WithdrawalsTab({ secret }: { secret: string }) {
  const { toast } = useToast();
  const [items, setItems] = useState<Withdrawal[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [rejectNote, setRejectNote] = useState<Record<number, string>>({});
  const [rejectingId, setRejectingId] = useState<number | null>(null);
  const headers = { "x-admin-secret": secret, "Content-Type": "application/json" };

  const load = useCallback(async () => {
    setLoading(true);
    const q = filter !== "all" ? `?status=${filter}` : "";
    const res = await apiFetch(`/admin/withdrawals${q}`, { headers: { "x-admin-secret": secret, "Content-Type": "application/json" } });
    const data = await res.json();
    setItems(Array.isArray(data) ? data : []);
    setLoading(false);
  }, [filter, secret]);

  useEffect(() => { load(); }, [load]);

  const handleApprove = async (id: number) => {
    const res = await apiFetch(`/admin/withdrawals/${id}/approve`, { method: "POST", headers, body: JSON.stringify({}) });
    if (res.ok) { toast({ title: "Withdrawal approved" }); load(); }
    else toast({ variant: "destructive", title: "Failed to approve" });
  };

  const handleReject = async (id: number) => {
    const res = await apiFetch(`/admin/withdrawals/${id}/reject`, {
      method: "POST", headers, body: JSON.stringify({ adminNote: rejectNote[id] ?? "" }),
    });
    if (res.ok) { toast({ title: "Withdrawal rejected · Coins refunded" }); setRejectingId(null); load(); }
    else toast({ variant: "destructive", title: "Failed to reject" });
  };

  const FILTERS = ["all", "pending", "completed", "rejected"];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        {FILTERS.map(f => (
          <Button key={f} size="sm" variant={filter === f ? "default" : "outline"} className="capitalize text-xs h-7" onClick={() => setFilter(f)}>{f}</Button>
        ))}
        <Button variant="outline" size="sm" className="ml-auto" onClick={load}><RefreshCw className="w-3.5 h-3.5" /></Button>
      </div>
      {loading ? <p className="text-muted-foreground text-sm text-center py-8">Loading…</p> : (
        <div className="space-y-2">
          {items.length === 0 && <p className="text-muted-foreground text-sm text-center py-8">No withdrawals</p>}
          {items.map(w => (
            <div key={w.id} className="bg-card border border-card-border rounded-xl p-4 space-y-3">
              <div className="flex items-start justify-between gap-2 flex-wrap">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{w.username ?? `User #${w.userId}`}</span>
                    <StatusBadge status={w.status} />
                  </div>
                  <p className="text-xs text-muted-foreground">{w.email}</p>
                  <p className="text-xs text-muted-foreground">Wallet: {w.walletAddress ? `${w.walletAddress.slice(0, 12)}…` : "—"}</p>
                  {w.paymentTag && <p className="text-xs text-muted-foreground font-mono">Tag: {w.paymentTag}</p>}
                  {w.adminNote && <p className="text-xs text-muted-foreground">Note: {w.adminNote}</p>}
                </div>
                <div className="text-right">
                  <p className="text-lg font-bold">${w.amount.toFixed(2)} USDT</p>
                  <p className="text-xs text-muted-foreground">{fmt(w.createdAt)}</p>
                </div>
              </div>
              {w.status === "pending" && (
                rejectingId === w.id ? (
                  <div className="space-y-2 bg-muted/50 rounded-xl p-3">
                    <Input
                      placeholder="Rejection reason (optional)"
                      value={rejectNote[w.id] ?? ""}
                      onChange={e => setRejectNote(prev => ({ ...prev, [w.id]: e.target.value }))}
                    />
                    <div className="flex gap-2">
                      <Button size="sm" className="gap-1 bg-red-500 hover:bg-red-600 text-white" onClick={() => handleReject(w.id)}><X className="w-3 h-3" /> Confirm Reject</Button>
                      <Button size="sm" variant="outline" onClick={() => setRejectingId(null)}>Cancel</Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <Button size="sm" className="gap-1 bg-emerald-500 hover:bg-emerald-600 text-white text-xs h-7" onClick={() => handleApprove(w.id)}><Check className="w-3 h-3" /> Approve</Button>
                    <Button size="sm" variant="outline" className="gap-1 text-red-400 border-red-500/30 text-xs h-7" onClick={() => setRejectingId(w.id)}><X className="w-3 h-3" /> Reject</Button>
                  </div>
                )
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Transactions Tab ────────────────────────────────────────────────────────

function TransactionsTab({ secret }: { secret: string }) {
  const [items, setItems] = useState<TxRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState("all");
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (typeFilter !== "all") params.set("type", typeFilter);
    if (search.trim()) params.set("search", search.trim());
    const res = await apiFetch(`/admin/transactions?${params}`, { headers: { "x-admin-secret": secret, "Content-Type": "application/json" } });
    const data = await res.json();
    setItems(Array.isArray(data) ? data : []);
    setLoading(false);
  }, [typeFilter, search, secret]);

  useEffect(() => { load(); }, [load]);

  const TYPES = ["all", "mining", "referral", "withdrawal", "adjustment"];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {TYPES.map(t => (
          <Button key={t} size="sm" variant={typeFilter === t ? "default" : "outline"} className="capitalize text-xs h-7" onClick={() => setTypeFilter(t)}>{t}</Button>
        ))}
      </div>
      <div className="flex gap-2">
        <Input placeholder="Search by username…" value={search} onChange={e => setSearch(e.target.value)} className="max-w-xs" onKeyDown={e => e.key === "Enter" && load()} />
        <Button variant="outline" size="sm" onClick={load}><RefreshCw className="w-3.5 h-3.5" /></Button>
      </div>
      {loading ? <p className="text-muted-foreground text-sm text-center py-8">Loading…</p> : (
        <div className="space-y-2">
          {items.length === 0 && <p className="text-muted-foreground text-sm text-center py-8">No transactions</p>}
          {items.map(tx => (
            <div key={tx.id} className="bg-card border border-card-border rounded-xl p-3 flex items-center justify-between gap-3 flex-wrap">
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{tx.username ?? `User #${tx.userId}`}</span>
                  <StatusBadge status={tx.type} />
                  <StatusBadge status={tx.status} />
                </div>
                <p className="text-xs text-muted-foreground">{tx.description}</p>
                {tx.adminNote && <p className="text-xs text-muted-foreground italic">Admin: {tx.adminNote}</p>}
                <p className="text-xs text-muted-foreground">{fmt(tx.createdAt)}</p>
              </div>
              <p className={`text-sm font-bold ${tx.amount < 0 ? "text-red-400" : "text-emerald-400"}`}>
                {tx.amount >= 0 ? "+" : ""}{fmtCoins(tx.amount)}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Mining Tab ──────────────────────────────────────────────────────────────

function MiningTab({ secret }: { secret: string }) {
  const { toast } = useToast();
  const [sessions, setSessions] = useState<MiningSession[]>([]);
  const [loading, setLoading] = useState(true);
  const headers = { "x-admin-secret": secret, "Content-Type": "application/json" };

  const load = useCallback(async () => {
    setLoading(true);
    const res = await apiFetch("/admin/mining-sessions", { headers: { "x-admin-secret": secret, "Content-Type": "application/json" } });
    const data = await res.json();
    setSessions(Array.isArray(data) ? data : []);
    setLoading(false);
  }, [secret]);

  useEffect(() => { load(); }, [load]);

  const handleStop = async (id: number, username: string | null) => {
    if (!confirm(`Force-stop ${username ?? "this user"}'s mining session?`)) return;
    const res = await apiFetch(`/admin/mining-sessions/${id}/stop`, { method: "POST", headers });
    if (res.ok) { toast({ title: "Session stopped" }); load(); }
    else toast({ variant: "destructive", title: "Failed to stop session" });
  };

  const timeLeft = (endsAt: string) => {
    const ms = new Date(endsAt).getTime() - Date.now();
    if (ms <= 0) return "Complete";
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    return `${h}h ${m}m left`;
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">{sessions.length} active session{sessions.length !== 1 ? "s" : ""}</p>
        <Button variant="outline" size="sm" onClick={load}><RefreshCw className="w-3.5 h-3.5" /></Button>
      </div>
      {loading ? <p className="text-muted-foreground text-sm text-center py-8">Loading…</p> : (
        <div className="space-y-2">
          {sessions.length === 0 && <p className="text-muted-foreground text-sm text-center py-8">No active sessions</p>}
          {sessions.map(s => (
            <div key={s.id} className="bg-card border border-card-border rounded-xl p-4 flex items-center justify-between gap-3 flex-wrap">
              <div className="space-y-0.5">
                <span className="font-semibold">{s.username ?? `User #${s.userId}`}</span>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span>Hash rate: {s.hashRate}</span>
                  {s.boostMultiplier > 1 && <Badge className="text-xs border bg-purple-500/20 text-purple-400 border-purple-500/30">{s.boostMultiplier}x boost</Badge>}
                  <span>{timeLeft(s.endsAt)}</span>
                </div>
                <p className="text-xs text-muted-foreground">Started: {fmt(s.startedAt)}</p>
              </div>
              <Button size="sm" variant="outline" className="text-red-400 border-red-500/30 text-xs h-7 gap-1" onClick={() => handleStop(s.id, s.username)}>
                <X className="w-3 h-3" /> Force Stop
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Referrals Tab ───────────────────────────────────────────────────────────

function ReferralsTab({ secret }: { secret: string }) {
  const [items, setItems] = useState<Referral[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch("/admin/referrals", { headers: { "x-admin-secret": secret, "Content-Type": "application/json" } }).then(r => r.json()).then(data => {
      setItems(Array.isArray(data) ? data : []);
      setLoading(false);
    });
  }, [secret]);

  return (
    <div className="space-y-2">
      {loading ? <p className="text-muted-foreground text-sm text-center py-8">Loading…</p> : (
        <>
          {items.length === 0 && <p className="text-muted-foreground text-sm text-center py-8">No referral relationships</p>}
          {items.map(r => (
            <div key={r.id} className="bg-card border border-card-border rounded-xl p-4 flex items-center justify-between gap-3 flex-wrap">
              <div className="space-y-0.5">
                <div className="flex items-center gap-2 text-sm">
                  <span className="font-medium">{r.referrerUsername}</span>
                  <span className="text-muted-foreground">→</span>
                  <span className="font-medium">{r.referredUsername}</span>
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span>Earned: {fmtCoins(r.totalEarned)} coins</span>
                  {r.bonusPaid
                    ? <Badge className="text-xs border bg-emerald-500/20 text-emerald-500 border-emerald-500/30">Bonus paid</Badge>
                    : <Badge className="text-xs border bg-muted text-muted-foreground border-border">Bonus pending</Badge>
                  }
                </div>
                <p className="text-xs text-muted-foreground">{fmt(r.createdAt)}</p>
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

// ─── Upgrades Tab ────────────────────────────────────────────────────────────

function UpgradesTab({ secret }: { secret: string }) {
  const [items, setItems] = useState<UpgradePurchase[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch("/admin/upgrade-purchases", { headers: { "x-admin-secret": secret, "Content-Type": "application/json" } }).then(r => r.json()).then(data => {
      setItems(Array.isArray(data) ? data : []);
      setLoading(false);
    });
  }, [secret]);

  return (
    <div className="space-y-2">
      {loading ? <p className="text-muted-foreground text-sm text-center py-8">Loading…</p> : (
        <>
          {items.length === 0 && <p className="text-muted-foreground text-sm text-center py-8">No upgrade purchases yet</p>}
          {items.map(u => (
            <div key={u.id} className="bg-card border border-card-border rounded-xl p-4 flex items-center justify-between gap-3 flex-wrap">
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <span className="font-semibold">{u.username ?? `User #${u.userId}`}</span>
                  {u.tier && <Badge className="text-xs border bg-purple-500/20 text-purple-400 border-purple-500/30">Tier {u.tier}</Badge>}
                </div>
                <p className="text-sm text-muted-foreground">{u.upgradeName ?? `Upgrade #${u.upgradeId}`}</p>
                <p className="text-xs text-muted-foreground">{fmt(u.purchasedAt)}</p>
              </div>
              {u.usdtCost && <p className="text-sm font-bold text-emerald-400">${u.usdtCost.toFixed(2)} USDT</p>}
            </div>
          ))}
        </>
      )}
    </div>
  );
}

// ─── Settings Tab ────────────────────────────────────────────────────────────

function SettingsTab({ secret }: { secret: string }) {
  const { toast } = useToast();
  const [settings, setSettings] = useState<Settings>({
    min_withdrawal_usdt: "5",
    referral_bonus_coins: "250",
    referral_commission_pct: "7",
    maintenance_mode: "false",
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const headers = { "x-admin-secret": secret, "Content-Type": "application/json" };

  useEffect(() => {
    apiFetch("/admin/settings", { headers: { "x-admin-secret": secret, "Content-Type": "application/json" } }).then(r => r.json()).then(data => {
      setSettings(prev => ({ ...prev, ...data }));
      setLoading(false);
    });
  }, [secret]);

  const handleSave = async () => {
    setSaving(true);
    const res = await apiFetch("/admin/settings", { method: "PUT", headers, body: JSON.stringify(settings) });
    if (res.ok) toast({ title: "Settings saved" });
    else toast({ variant: "destructive", title: "Failed to save settings" });
    setSaving(false);
  };

  if (loading) return <p className="text-muted-foreground text-sm py-8 text-center">Loading…</p>;

  return (
    <div className="max-w-md space-y-5">
      <div className="bg-card border border-card-border rounded-2xl p-5 space-y-4">
        <h3 className="font-semibold text-sm">Economy Settings</h3>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground font-medium">Minimum Withdrawal (USDT)</label>
            <Input type="number" value={settings.min_withdrawal_usdt} onChange={e => setSettings(p => ({ ...p, min_withdrawal_usdt: e.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground font-medium">Referral Bonus (coins)</label>
            <Input type="number" value={settings.referral_bonus_coins} onChange={e => setSettings(p => ({ ...p, referral_bonus_coins: e.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground font-medium">Referral Commission (%)</label>
            <Input type="number" value={settings.referral_commission_pct} onChange={e => setSettings(p => ({ ...p, referral_commission_pct: e.target.value }))} />
          </div>
        </div>
      </div>
      <div className="bg-card border border-card-border rounded-2xl p-5 space-y-3">
        <h3 className="font-semibold text-sm">System</h3>
        <label className="flex items-center gap-3 cursor-pointer">
          <button
            type="button"
            onClick={() => setSettings(p => ({ ...p, maintenance_mode: p.maintenance_mode === "true" ? "false" : "true" }))}
            className={`relative w-10 h-6 rounded-full transition-colors ${settings.maintenance_mode === "true" ? "bg-red-500" : "bg-muted"}`}
          >
            <span className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform ${settings.maintenance_mode === "true" ? "translate-x-4" : ""}`} />
          </button>
          <div>
            <p className="text-sm font-medium">Maintenance Mode</p>
            <p className="text-xs text-muted-foreground">Blocks new mining sessions when enabled</p>
          </div>
        </label>
      </div>
      <Button onClick={handleSave} disabled={saving} className="gap-1.5">
        <Save className="w-3.5 h-3.5" />
        {saving ? "Saving…" : "Save Settings"}
      </Button>
    </div>
  );
}

// ─── Share Messages Tab ──────────────────────────────────────────────────────

function ShareMessagesTab({ secret }: { secret: string }) {
  const { toast } = useToast();
  const [messages, setMessages] = useState<ShareMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editText, setEditText] = useState("");
  const [editActive, setEditActive] = useState(true);
  const [addingPlatform, setAddingPlatform] = useState<Platform | null>(null);
  const [newMessage, setNewMessage] = useState("");
  const headers = { "x-admin-secret": secret, "Content-Type": "application/json" };

  const fetchMessages = useCallback(async () => {
    setLoading(true);
    const res = await apiFetch("/admin/share-messages", { headers: { "x-admin-secret": secret, "Content-Type": "application/json" } });
    const data = await res.json();
    setMessages(Array.isArray(data) ? data : []);
    setLoading(false);
  }, [secret]);

  useEffect(() => { fetchMessages(); }, [fetchMessages]);

  const handleSaveEdit = async (id: number) => {
    const res = await apiFetch(`/admin/share-messages/${id}`, { method: "PUT", headers, body: JSON.stringify({ message: editText, isActive: editActive }) });
    if (res.ok) { toast({ title: "Saved!" }); setEditingId(null); fetchMessages(); }
    else toast({ variant: "destructive", title: "Failed to save" });
  };

  const handleToggle = async (msg: ShareMessage) => {
    const res = await apiFetch(`/admin/share-messages/${msg.id}`, { method: "PUT", headers, body: JSON.stringify({ isActive: !msg.isActive }) });
    if (res.ok) fetchMessages();
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Delete this message?")) return;
    const res = await apiFetch(`/admin/share-messages/${id}`, { method: "DELETE", headers });
    if (res.ok) { toast({ title: "Deleted" }); fetchMessages(); }
  };

  const handleAdd = async () => {
    if (!addingPlatform || !newMessage.trim()) return;
    const res = await apiFetch("/admin/share-messages", { method: "POST", headers, body: JSON.stringify({ platform: addingPlatform, message: newMessage, isActive: true, sortOrder: 0 }) });
    if (res.ok) { toast({ title: "Added!" }); setAddingPlatform(null); setNewMessage(""); fetchMessages(); }
    else toast({ variant: "destructive", title: "Failed to add" });
  };

  const grouped = PLATFORMS.reduce<Record<string, ShareMessage[]>>((acc, p) => {
    acc[p] = messages.filter(m => m.platform === p);
    return acc;
  }, {} as Record<string, ShareMessage[]>);

  return (
    <div className="space-y-4">
      <div className="bg-primary/10 border border-primary/20 rounded-xl p-3 text-xs text-primary">
        Use <code className="font-mono bg-primary/10 px-1 rounded">{`{url}`}</code> to insert the referral link, and <code className="font-mono bg-primary/10 px-1 rounded">{`{referral_code}`}</code> for the code.
      </div>
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={fetchMessages} disabled={loading}><RefreshCw className="w-3.5 h-3.5" /></Button>
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
                <textarea className="w-full text-sm bg-background border border-border rounded-lg p-3 resize-none min-h-[100px] focus:outline-none focus:ring-1 focus:ring-primary" placeholder={`New ${platform} message…`} value={newMessage} onChange={e => setNewMessage(e.target.value)} />
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
                      <textarea className="w-full text-sm bg-background border border-border rounded-lg p-3 resize-none min-h-[100px] focus:outline-none focus:ring-1 focus:ring-primary" value={editText} onChange={e => setEditText(e.target.value)} />
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
                        <button onClick={() => handleToggle(msg)} className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border transition-colors ${msg.isActive ? "bg-emerald-500/20 text-emerald-500 border-emerald-500/30" : "bg-muted text-muted-foreground border-border"}`}>
                          {msg.isActive ? <><Check className="w-2.5 h-2.5" /> Active</> : "Inactive"}
                        </button>
                        <div className="ml-auto flex gap-1">
                          <Button size="sm" variant="ghost" className="w-7 h-7 p-0" onClick={() => { setEditingId(msg.id); setEditText(msg.message); setEditActive(msg.isActive); }}><Pencil className="w-3 h-3" /></Button>
                          <Button size="sm" variant="ghost" className="w-7 h-7 p-0 text-destructive hover:text-destructive" onClick={() => handleDelete(msg.id)}><Trash2 className="w-3 h-3" /></Button>
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

// ─── Main Component ───────────────────────────────────────────────────────────

export default function Admin() {
  const { toast } = useToast();
  const [secret, setSecret] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<Tab>("dashboard");

  const [showChangePassword, setShowChangePassword] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showNewPw, setShowNewPw] = useState(false);
  const [changingPw, setChangingPw] = useState(false);

  const headers = { "x-admin-secret": secret, "Content-Type": "application/json" };

  const handleLogin = async () => {
    if (!secret.trim()) return;
    setLoading(true);
    try {
      const res = await apiFetch("/admin/analytics", { headers: { "x-admin-secret": secret } });
      if (res.status === 401) {
        toast({ variant: "destructive", title: "Wrong password" });
        return;
      }
      setAuthed(true);
    } catch {
      toast({ variant: "destructive", title: "Connection error" });
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => { setAuthed(false); setSecret(""); setShowChangePassword(false); };

  const handleChangePassword = async () => {
    if (newPassword.length < 8) { toast({ variant: "destructive", title: "Password too short", description: "Min. 8 characters." }); return; }
    if (newPassword !== confirmPassword) { toast({ variant: "destructive", title: "Passwords don't match" }); return; }
    setChangingPw(true);
    try {
      const res = await apiFetch("/admin/change-password", { method: "POST", headers, body: JSON.stringify({ newPassword }) });
      if (res.ok) {
        setSecret(newPassword);
        toast({ title: "Password changed!" });
        setNewPassword(""); setConfirmPassword(""); setShowChangePassword(false);
      } else {
        const err = await res.json();
        toast({ variant: "destructive", title: "Failed", description: err.error });
      }
    } catch { toast({ variant: "destructive", title: "Connection error" }); }
    finally { setChangingPw(false); }
  };

  if (!authed) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <div className="w-full max-w-sm space-y-4">
          <div className="text-center">
            <h1 className="text-2xl font-black font-serif text-foreground">Admin Panel</h1>
            <p className="text-muted-foreground text-sm mt-1">Enter your admin password to continue</p>
          </div>
          <div className="bg-card border border-card-border rounded-2xl p-6 space-y-4">
            <div className="relative">
              <Input type={showSecret ? "text" : "password"} placeholder="Admin password" value={secret} onChange={e => setSecret(e.target.value)} onKeyDown={e => e.key === "Enter" && handleLogin()} className="pr-10" />
              <button type="button" onClick={() => setShowSecret(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                {showSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <Button className="w-full" onClick={handleLogin} disabled={loading}>{loading ? "Checking…" : "Login"}</Button>
          </div>
        </div>
      </div>
    );
  }

  const TABS: { id: Tab; label: string; icon: LucideIcon }[] = [
    { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
    { id: "users", label: "Users", icon: Users },
    { id: "withdrawals", label: "Withdrawals", icon: Wallet },
    { id: "transactions", label: "Transactions", icon: BarChart3 },
    { id: "mining", label: "Mining", icon: Cpu },
    { id: "referrals", label: "Referrals", icon: Share2 },
    { id: "upgrades", label: "Upgrades", icon: Package },
    { id: "settings", label: "Settings", icon: Settings },
    { id: "share", label: "Share Links", icon: ArrowDownCircle },
  ];

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b border-border sticky top-0 bg-background z-10">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <h1 className="text-lg font-black font-serif shrink-0">Admin Panel</h1>
          <div className="flex gap-2 shrink-0">
            <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={() => setShowChangePassword(v => !v)}>
              <KeyRound className="w-3.5 h-3.5" /> Password
            </Button>
            <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground text-xs" onClick={handleLogout}>
              <LogOut className="w-3.5 h-3.5" /> Logout
            </Button>
          </div>
        </div>

        {showChangePassword && (
          <div className="max-w-6xl mx-auto px-4 pb-3">
            <div className="bg-card border border-card-border rounded-xl p-4 space-y-3">
              <div className="flex gap-3 flex-wrap">
                <div className="relative flex-1 min-w-[160px]">
                  <Input type={showNewPw ? "text" : "password"} placeholder="New password (min. 8 chars)" value={newPassword} onChange={e => setNewPassword(e.target.value)} className="pr-10" />
                  <button type="button" onClick={() => setShowNewPw(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                    {showNewPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                <Input type={showNewPw ? "text" : "password"} placeholder="Confirm password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} className="flex-1 min-w-[160px]" />
                <Button size="sm" onClick={handleChangePassword} disabled={changingPw || !newPassword || !confirmPassword} className="gap-1">
                  <Save className="w-3 h-3" /> {changingPw ? "Saving…" : "Save"}
                </Button>
                <Button size="sm" variant="outline" onClick={() => { setShowChangePassword(false); setNewPassword(""); setConfirmPassword(""); }}><X className="w-3 h-3" /></Button>
              </div>
              {newPassword && confirmPassword && newPassword !== confirmPassword && <p className="text-xs text-destructive">Passwords don't match</p>}
            </div>
          </div>
        )}

        <div className="max-w-6xl mx-auto px-4 flex gap-1 overflow-x-auto pb-0 scrollbar-none">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium whitespace-nowrap border-b-2 transition-colors ${tab === t.id ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
            >
              <t.icon className="w-3.5 h-3.5" />
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-6">
        {tab === "dashboard" && <DashboardTab secret={secret} />}
        {tab === "users" && <UsersTab secret={secret} />}
        {tab === "withdrawals" && <WithdrawalsTab secret={secret} />}
        {tab === "transactions" && <TransactionsTab secret={secret} />}
        {tab === "mining" && <MiningTab secret={secret} />}
        {tab === "referrals" && <ReferralsTab secret={secret} />}
        {tab === "upgrades" && <UpgradesTab secret={secret} />}
        {tab === "settings" && <SettingsTab secret={secret} />}
        {tab === "share" && <ShareMessagesTab secret={secret} />}
      </div>
    </div>
  );
}
