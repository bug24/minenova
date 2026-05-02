import { useState, useEffect, useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useTheme } from "@/contexts/ThemeContext";
import {
  Pencil, Trash2, Plus, Save, X, Check, KeyRound, LogOut, Eye, EyeOff,
  Users, Wallet, ArrowDownCircle, BarChart3, Cpu, Share2, Package, Settings, RefreshCw,
  ShieldOff, Shield, CircleDollarSign, LayoutDashboard, type LucideIcon,
  Sun, Moon, UserCircle, Copy, RotateCcw, Activity, ChevronRight,
  Play, Zap, AlertTriangle, ToggleLeft, ToggleRight, Menu, ChevronLeft,
  Film, Link, Clock, MonitorPlay, Code, Bell,
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
  miningLevel: number | null; coinRate: number; effectiveBaseRate: number; hasRateOverride: boolean;
}
interface MiningConfig {
  baseCoinRate: number; sessionDurationHours: number; maintenanceMode: boolean;
  userOverrides: { userId: number; rate: number; username: string }[];
}
interface Referral {
  id: number; referrerId: number; referredId: number;
  referrerUsername: string; referredUsername: string;
  totalEarned: number; bonusPaid: boolean; createdAt: string;
}
interface ReferralConfig {
  bonusCoins: number; commissionPct: number; referralDisabled: boolean;
}
interface ReferralStat {
  userId: number; username: string; referralCount: number;
  totalBonus: number; totalCommission: number; total: number;
}
interface SuspiciousReferral {
  referralId: number; referrerId: number; referredId: number;
  referrerUsername: string; referredUsername: string;
  reason: string; createdAt: string;
}
interface UpgradePurchase {
  id: number; userId: number; upgradeId: number; username: string | null;
  upgradeName: string | null; tier: number | null; usdtCost: number | null; purchasedAt: string;
}
interface UpgradePackage {
  id: number; name: string; description: string; tier: number;
  hashRateBoost: number; dailyCapBoost: number; coinCost: number | null;
  usdtCost: number | null; isAutoMining: boolean; sortOrder: number;
  badge: string | null; icon: string | null;
}
interface UpgradePayment {
  transactionId: number; userId: number; username: string; email: string;
  upgradeName: string; upgradeId: number; amount: number; paymentTag: string;
  status: string; adminNote: string | null; createdAt: string;
}
interface Analytics {
  totalUsers: number; activeMiners: number; totalCoinsDistributed: number;
  totalUsdtWithdrawn: number; totalReferralPayout: number; pendingWithdrawals: number;
}
interface WithdrawalStats {
  pendingCount: number; pendingValue: number; approvedTotal: number; rejectedTotal: number;
}
interface Settings {
  min_withdrawal_usdt: string;
  referral_bonus_coins: string;
  referral_commission_pct: string;
  maintenance_mode: string;
  global_base_coins_per_hour: string;
  session_duration_hours: string;
  referral_disabled: string;
  mining_disabled: string;
  ludo_platform_fee_pct: string;
  ludo_win_pct: string;
  ludo_min_fee: string;
  ludo_max_fee: string;
  ludo_solo_fee: string;
  ludo_solo_enabled: string;
  ludo_timeout_minutes: string;
  whot_platform_fee_pct: string;
  whot_win_pct: string;
  whot_min_fee: string;
  whot_max_fee: string;
  whot_solo_fee: string;
  whot_solo_enabled: string;
  whot_timeout_minutes: string;
  withdrawal_ticker_enabled: string;
  voice_chat_enabled: string;
  auto_miner_interval_minutes: string;
}
interface ShareMessage { id: number; platform: string; message: string; isActive: boolean; sortOrder: number; }
interface UserReferral { id: number; referredId: number; referredUsername: string; totalEarned: number; bonusPaid: boolean; createdAt: string; }
interface UserTransaction { id: number; type: string; amount: number; status: string; description: string; adminNote: string | null; createdAt: string; }
interface UserProfile extends AdminUser {
  activeSession: { id: number; startedAt: string; endsAt: string; hashRate: number; boostMultiplier: number } | null;
  referrals: UserReferral[];
  referredByUsername: string | null;
  totalReferralEarned: number;
  transactions: UserTransaction[];
}

type Tab = "dashboard" | "users" | "withdrawals" | "transactions" | "mining" | "referrals" | "upgrades" | "settings" | "share" | "ads" | "scripts";
type UpgradeSubTab = "manage" | "history" | "approve-reject";

interface AdminAd {
  id: number;
  title: string;
  type: "video" | "image" | "script" | "external_link";
  urlOrCode: string;
  providerScript?: string | null;
  durationSeconds: number;
  placement: string;
  isActive: boolean;
  createdAt: string;
}

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

// ─── User Profile Modal ───────────────────────────────────────────────────────

function UserProfileModal({ userId, secret, onClose, onRefreshList }: { userId: number; secret: string; onClose: () => void; onRefreshList: () => void }) {
  const { toast } = useToast();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [resettingPw, setResettingPw] = useState(false);
  const [newPw, setNewPw] = useState<string | null>(null);
  const headers = { "x-admin-secret": secret, "Content-Type": "application/json" };

  const loadProfile = useCallback(async () => {
    setLoading(true);
    const res = await apiFetch(`/admin/users/${userId}`, { headers: { "x-admin-secret": secret, "Content-Type": "application/json" } });
    const data = await res.json();
    setProfile(res.ok ? data : null);
    setLoading(false);
  }, [userId, secret]);

  useEffect(() => { loadProfile(); }, [loadProfile]);

  const handleSuspend = async () => {
    if (!profile) return;
    await apiFetch(`/admin/users/${userId}/suspend`, { method: "POST", headers });
    toast({ title: profile.isSuspended ? "User unsuspended" : "User suspended" });
    loadProfile(); onRefreshList();
  };

  const handleResetPassword = async () => {
    if (!confirm("Generate a new random password for this user?")) return;
    setResettingPw(true);
    const res = await apiFetch(`/admin/users/${userId}/reset-password`, { method: "POST", headers });
    if (res.ok) {
      const data = await res.json();
      setNewPw(data.newPassword);
      toast({ title: "Password reset" });
    } else toast({ variant: "destructive", title: "Failed to reset password" });
    setResettingPw(false);
  };

  const timeLeft = (endsAt: string) => {
    const ms = new Date(endsAt).getTime() - Date.now();
    if (ms <= 0) return "Complete";
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    return `${h}h ${m}m left`;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end bg-black/50 backdrop-blur-sm" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-lg h-full bg-background border-l border-border overflow-y-auto shadow-2xl flex flex-col">
        <div className="sticky top-0 bg-background border-b border-border px-5 py-4 flex items-center justify-between z-10">
          <div className="flex items-center gap-2">
            <UserCircle className="w-5 h-5 text-primary" />
            <span className="font-bold text-lg">{loading ? "Loading…" : (profile?.username ?? "User not found")}</span>
            {profile?.isSuspended && <Badge className="text-xs border bg-red-500/20 text-red-400 border-red-500/30">Suspended</Badge>}
          </div>
          <Button variant="ghost" size="sm" className="w-8 h-8 p-0" onClick={onClose}><X className="w-4 h-4" /></Button>
        </div>

        {loading ? (
          <div className="flex-1 flex items-center justify-center py-20">
            <p className="text-muted-foreground text-sm">Loading profile…</p>
          </div>
        ) : !profile ? (
          <div className="flex-1 flex items-center justify-center py-20">
            <p className="text-destructive text-sm">Failed to load user profile</p>
          </div>
        ) : (
          <div className="p-5 space-y-5">
            {/* Basic Info */}
            <div className="bg-card border border-card-border rounded-2xl p-4 space-y-3">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Account</h3>
              <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <div><span className="text-muted-foreground text-xs">Email</span><p className="font-medium truncate">{profile.email}</p></div>
                <div><span className="text-muted-foreground text-xs">Referral Code</span><p className="font-mono font-medium">#{profile.referralCode}</p></div>
                <div><span className="text-muted-foreground text-xs">Joined</span><p>{fmt(profile.createdAt)}</p></div>
                <div><span className="text-muted-foreground text-xs">Mining Level</span><p className="font-medium">Level {profile.miningLevel}</p></div>
              </div>
            </div>

            {/* Wallet Balance */}
            <div className="bg-card border border-card-border rounded-2xl p-4 space-y-3">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Wallet</h3>
              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="bg-muted/50 rounded-xl p-3">
                  <p className="text-xs text-muted-foreground">Balance</p>
                  <p className="text-lg font-bold text-primary">{fmtCoins(profile.coinBalance)}</p>
                  <p className="text-xs text-muted-foreground">coins</p>
                </div>
                <div className="bg-muted/50 rounded-xl p-3">
                  <p className="text-xs text-muted-foreground">Total Earned</p>
                  <p className="text-lg font-bold text-emerald-400">{fmtCoins(profile.totalEarned)}</p>
                  <p className="text-xs text-muted-foreground">coins</p>
                </div>
                <div className="bg-muted/50 rounded-xl p-3">
                  <p className="text-xs text-muted-foreground">Withdrawn</p>
                  <p className="text-lg font-bold text-orange-400">${profile.totalWithdrawn.toFixed(2)}</p>
                  <p className="text-xs text-muted-foreground">USDT</p>
                </div>
              </div>
            </div>

            {/* Mining Status */}
            <div className="bg-card border border-card-border rounded-2xl p-4 space-y-2">
              <div className="flex items-center gap-2">
                <Activity className="w-3.5 h-3.5 text-muted-foreground" />
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Mining Status</h3>
              </div>
              {profile.activeSession ? (
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse inline-block" />
                    <span className="text-sm font-medium text-emerald-400">Active</span>
                    {profile.activeSession.boostMultiplier > 1 && (
                      <Badge className="text-xs border bg-purple-500/20 text-purple-400 border-purple-500/30">{profile.activeSession.boostMultiplier}x boost</Badge>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                    <span>Hash rate: {profile.activeSession.hashRate}</span>
                    <span>{timeLeft(profile.activeSession.endsAt)}</span>
                    <span>Started: {fmt(profile.activeSession.startedAt)}</span>
                    <span>Ends: {fmt(profile.activeSession.endsAt)}</span>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No active mining session</p>
              )}
            </div>

            {/* Referral Stats */}
            <div className="bg-card border border-card-border rounded-2xl p-4 space-y-3">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Referrals</h3>
              {profile.referredByUsername && (
                <p className="text-xs text-muted-foreground">Referred by: <span className="font-medium text-foreground">{profile.referredByUsername}</span></p>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-muted/50 rounded-xl p-3 text-center">
                  <p className="text-xs text-muted-foreground">People Referred</p>
                  <p className="text-xl font-bold">{profile.referrals.length}</p>
                </div>
                <div className="bg-muted/50 rounded-xl p-3 text-center">
                  <p className="text-xs text-muted-foreground">Commission Earned</p>
                  <p className="text-xl font-bold text-sky-400">{fmtCoins(profile.totalReferralEarned)}</p>
                </div>
              </div>
              {profile.referrals.length > 0 && (
                <div className="space-y-1 max-h-32 overflow-y-auto">
                  {profile.referrals.map(r => (
                    <div key={r.id} className="flex items-center justify-between text-xs py-1 border-b border-border last:border-0">
                      <div className="flex items-center gap-1.5">
                        <ChevronRight className="w-3 h-3 text-muted-foreground" />
                        <span className="font-medium">{r.referredUsername}</span>
                        {r.bonusPaid && <Badge className="text-xs border bg-emerald-500/20 text-emerald-500 border-emerald-500/30 px-1 py-0">Bonus paid</Badge>}
                      </div>
                      <span className="text-muted-foreground">{fmtCoins(r.totalEarned)} coins</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Transaction History */}
            <div className="bg-card border border-card-border rounded-2xl p-4 space-y-3">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Transaction History</h3>
              {profile.transactions.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-2">No transactions yet</p>
              ) : (
                <div className="space-y-1.5 max-h-64 overflow-y-auto">
                  {profile.transactions.map(t => (
                    <div key={t.id} className="flex items-center justify-between text-xs py-1.5 border-b border-border last:border-0">
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-1.5">
                          <StatusBadge status={t.type} />
                          <StatusBadge status={t.status} />
                        </div>
                        <p className="text-muted-foreground">{t.description}</p>
                        <p className="text-muted-foreground">{fmt(t.createdAt)}</p>
                      </div>
                      <span className={`font-bold ${t.amount < 0 ? "text-red-400" : "text-emerald-400"}`}>
                        {t.amount >= 0 ? "+" : ""}{fmtCoins(t.amount)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Reset Password */}
            {newPw ? (
              <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-4 space-y-2">
                <p className="text-xs font-semibold text-emerald-400">New password generated — share with the user:</p>
                <div className="flex items-center gap-2">
                  <code className="font-mono text-base font-bold text-foreground bg-muted px-3 py-1.5 rounded-lg flex-1">{newPw}</code>
                  <Button size="sm" variant="outline" className="gap-1 shrink-0" onClick={() => { navigator.clipboard.writeText(newPw); toast({ title: "Copied!" }); }}>
                    <Copy className="w-3 h-3" /> Copy
                  </Button>
                </div>
                <Button size="sm" variant="ghost" className="text-xs text-muted-foreground" onClick={() => setNewPw(null)}>Dismiss</Button>
              </div>
            ) : null}

            {/* Actions */}
            <div className="flex flex-wrap gap-2 pb-2">
              <Button size="sm" variant="outline" className={`gap-1.5 text-xs ${profile.isSuspended ? "text-emerald-500" : "text-orange-400"}`} onClick={handleSuspend}>
                {profile.isSuspended ? <><Shield className="w-3.5 h-3.5" /> Unsuspend</> : <><ShieldOff className="w-3.5 h-3.5" /> Suspend</>}
              </Button>
              <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={handleResetPassword} disabled={resettingPw}>
                <RotateCcw className="w-3.5 h-3.5" /> {resettingPw ? "Resetting…" : "Reset Password"}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

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
  const [profileUserId, setProfileUserId] = useState<number | null>(null);
  const headers = { "x-admin-secret": secret, "Content-Type": "application/json" };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const q = search.trim() ? `?search=${encodeURIComponent(search.trim())}` : "";
      const res = await apiFetch(`/admin/users${q}`, { headers: { "x-admin-secret": secret, "Content-Type": "application/json" } });
      const data = await res.json();
      setUsers(Array.isArray(data) ? data : []);
    } catch {
      toast({ variant: "destructive", title: "Failed to load users" });
    } finally {
      setLoading(false);
    }
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
                  <Button size="sm" variant="outline" className="gap-1 text-xs h-7 text-primary border-primary/30" onClick={() => setProfileUserId(u.id)}>
                    <UserCircle className="w-3 h-3" /> View Profile
                  </Button>
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
      {profileUserId !== null && (
        <UserProfileModal
          userId={profileUserId}
          secret={secret}
          onClose={() => setProfileUserId(null)}
          onRefreshList={load}
        />
      )}
    </div>
  );
}

// ─── Withdrawals Tab ─────────────────────────────────────────────────────────

function WithdrawalsTab({ secret }: { secret: string }) {
  const { toast } = useToast();
  const h = useMemo(() => ({ "x-admin-secret": secret, "Content-Type": "application/json" }), [secret]);

  // Stats
  const [stats, setStats] = useState<WithdrawalStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);

  // Min-withdrawal settings
  const [minWithdrawal, setMinWithdrawal] = useState("5");
  const [minWdLoading, setMinWdLoading] = useState(true);
  const [minWdSaving, setMinWdSaving] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // List
  const [items, setItems] = useState<Withdrawal[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");

  // Per-card action state
  const [actionId, setActionId] = useState<number | null>(null);
  const [actionType, setActionType] = useState<"approve" | "reject" | "note" | null>(null);
  const [noteInput, setNoteInput] = useState<Record<number, string>>({});
  const [processing, setProcessing] = useState<number | null>(null);

  const loadStats = useCallback(() => {
    setStatsLoading(true);
    apiFetch("/admin/withdrawal-stats", { headers: h })
      .then(r => { if (!r.ok) throw new Error(); return r.json(); })
      .then((d: WithdrawalStats) => { setStats(d); setStatsLoading(false); })
      .catch(() => { toast({ variant: "destructive", title: "Failed to load withdrawal stats" }); setStatsLoading(false); });
  }, [h, toast]);

  const loadList = useCallback((q: string, f: string) => {
    setLoading(true);
    const params = new URLSearchParams();
    if (f !== "all") params.set("status", f);
    if (q.trim()) params.set("search", q.trim());
    apiFetch(`/admin/withdrawals?${params}`, { headers: h })
      .then(r => { if (!r.ok) throw new Error(); return r.json(); })
      .then((d: Withdrawal[]) => { setItems(Array.isArray(d) ? d : []); setLoading(false); })
      .catch(() => { toast({ variant: "destructive", title: "Failed to load withdrawals" }); setLoading(false); });
  }, [h, toast]);

  const loadMinWithdrawal = useCallback(() => {
    setMinWdLoading(true);
    apiFetch("/admin/settings", { headers: h })
      .then(r => { if (!r.ok) throw new Error(); return r.json(); })
      .then((d: Settings) => { setMinWithdrawal(d.min_withdrawal_usdt ?? "5"); setMinWdLoading(false); })
      .catch(() => { toast({ variant: "destructive", title: "Failed to load settings" }); setMinWdLoading(false); });
  }, [h, toast]);

  useEffect(() => { loadStats(); loadMinWithdrawal(); }, [loadStats, loadMinWithdrawal]);

  // Debounced list fetch
  useEffect(() => {
    const t = setTimeout(() => loadList(search, filter), search ? 350 : 0);
    return () => clearTimeout(t);
  }, [search, filter, loadList]);

  const refreshAll = () => { loadStats(); loadList(search, filter); };

  const openAction = (id: number, type: "approve" | "reject" | "note", existingNote = "") => {
    setActionId(id); setActionType(type);
    setNoteInput(prev => ({ ...prev, [id]: existingNote }));
  };
  const closeAction = () => { setActionId(null); setActionType(null); };

  const handleApprove = async (id: number) => {
    setProcessing(id);
    const rawNote = noteInput[id] ?? "";
    const adminNote = rawNote.trim() === "" ? null : rawNote.trim();
    try {
      const res = await apiFetch(`/admin/withdrawals/${id}/approve`, {
        method: "POST", headers: h, body: JSON.stringify({ adminNote }),
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error ?? "Failed"); }
      toast({ title: "Withdrawal approved" });
      closeAction();
      refreshAll();
    } catch (e: unknown) {
      toast({ variant: "destructive", title: e instanceof Error ? e.message : "Failed to approve" });
    } finally { setProcessing(null); }
  };

  const handleReject = async (id: number) => {
    setProcessing(id);
    const rawNote = noteInput[id] ?? "";
    const adminNote = rawNote.trim() === "" ? null : rawNote.trim();
    try {
      const res = await apiFetch(`/admin/withdrawals/${id}/reject`, {
        method: "POST", headers: h, body: JSON.stringify({ adminNote }),
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error ?? "Failed"); }
      toast({ title: "Withdrawal rejected · Coins refunded" });
      closeAction();
      refreshAll();
    } catch (e: unknown) {
      toast({ variant: "destructive", title: e instanceof Error ? e.message : "Failed to reject" });
    } finally { setProcessing(null); }
  };

  const handleSaveNote = async (id: number) => {
    setProcessing(id);
    const raw = noteInput[id] ?? "";
    const adminNote = raw.trim() === "" ? null : raw.trim();
    try {
      const res = await apiFetch(`/admin/withdrawals/${id}/note`, {
        method: "PUT", headers: h, body: JSON.stringify({ adminNote }),
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error ?? "Failed"); }
      toast({ title: "Note saved" });
      closeAction();
      loadList(search, filter);
    } catch (e: unknown) {
      toast({ variant: "destructive", title: e instanceof Error ? e.message : "Failed to save note" });
    } finally { setProcessing(null); }
  };

  const handleSaveMinWithdrawal = async () => {
    const v = parseFloat(minWithdrawal);
    if (isNaN(v) || v < 0) { toast({ variant: "destructive", title: "Invalid amount" }); return; }
    setMinWdSaving(true);
    try {
      const res = await apiFetch("/admin/settings", {
        method: "PUT", headers: h, body: JSON.stringify({ min_withdrawal_usdt: minWithdrawal }),
      });
      if (!res.ok) throw new Error();
      toast({ title: "Minimum withdrawal updated" });
    } catch {
      toast({ variant: "destructive", title: "Failed to save setting" });
    } finally { setMinWdSaving(false); }
  };

  const FILTERS = ["all", "pending", "approved", "rejected"];

  return (
    <div className="space-y-4">

      {/* ── Stats Bar ── */}
      {statsLoading ? (
        <div className="grid grid-cols-2 gap-3">
          {[...Array(4)].map((_, i) => <div key={i} className="bg-card border border-card-border rounded-xl p-3 h-16 animate-pulse" />)}
        </div>
      ) : stats && (
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3 space-y-0.5">
            <p className="text-xs text-amber-400 font-medium">Pending</p>
            <p className="text-lg font-bold">{stats.pendingCount}</p>
            <p className="text-xs text-muted-foreground">${stats.pendingValue.toFixed(2)} USDT</p>
          </div>
          <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-3 space-y-0.5">
            <p className="text-xs text-emerald-400 font-medium">Approved (all-time)</p>
            <p className="text-lg font-bold text-emerald-400">${stats.approvedTotal.toFixed(2)}</p>
            <p className="text-xs text-muted-foreground">USDT</p>
          </div>
          <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3 space-y-0.5">
            <p className="text-xs text-red-400 font-medium">Rejected (all-time)</p>
            <p className="text-lg font-bold text-red-400">${stats.rejectedTotal.toFixed(2)}</p>
            <p className="text-xs text-muted-foreground">USDT refunded</p>
          </div>
          <div className="bg-card border border-card-border rounded-xl p-3 space-y-0.5">
            <p className="text-xs text-muted-foreground font-medium">Total volume</p>
            <p className="text-lg font-bold">${(stats.pendingValue + stats.approvedTotal + stats.rejectedTotal).toFixed(2)}</p>
            <p className="text-xs text-muted-foreground">USDT all-time requested</p>
          </div>
        </div>
      )}

      {/* ── Withdrawal Settings (collapsible) ── */}
      <div className="bg-card border border-card-border rounded-xl overflow-hidden">
        <button
          className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium hover:bg-muted/30 transition-colors"
          onClick={() => setSettingsOpen(o => !o)}
        >
          <span className="flex items-center gap-2"><Settings className="w-3.5 h-3.5 text-muted-foreground" /> Withdrawal Settings</span>
          <ChevronRight className={`w-4 h-4 text-muted-foreground transition-transform ${settingsOpen ? "rotate-90" : ""}`} />
        </button>
        {settingsOpen && (
          <div className="px-4 pb-4 space-y-3 border-t border-card-border">
            <p className="text-xs text-muted-foreground pt-3">Minimum withdrawal amount (USDT). Users below this threshold cannot request a withdrawal.</p>
            <div className="flex gap-2 items-center">
              {minWdLoading ? (
                <div className="flex-1 h-9 bg-muted/30 rounded-lg animate-pulse" />
              ) : (
                <Input
                  type="number" min="0" step="0.5"
                  value={minWithdrawal}
                  onChange={e => setMinWithdrawal(e.target.value)}
                  className="h-9 flex-1"
                  placeholder="e.g. 5"
                />
              )}
              <span className="text-sm text-muted-foreground shrink-0">USDT</span>
              <Button size="sm" onClick={handleSaveMinWithdrawal} disabled={minWdSaving || minWdLoading} className="shrink-0">
                {minWdSaving ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* ── Filter + Search + Refresh ── */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          {FILTERS.map(f => (
            <Button key={f} size="sm" variant={filter === f ? "default" : "outline"} className="capitalize text-xs h-7" onClick={() => setFilter(f)}>{f}</Button>
          ))}
          <Button variant="outline" size="sm" className="ml-auto h-7 w-7 p-0" onClick={refreshAll}>
            <RefreshCw className="w-3.5 h-3.5" />
          </Button>
        </div>
        <Input
          placeholder="Search by username or wallet address…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="h-9"
        />
      </div>

      {/* ── List ── */}
      {loading ? (
        <p className="text-muted-foreground text-sm text-center py-8">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-muted-foreground text-sm text-center py-8">
          {search ? "No matching withdrawals" : "No withdrawals"}
        </p>
      ) : (
        <div className="space-y-2">
          {items.map(w => {
            const isActing = actionId === w.id;
            const isProcessing = processing === w.id;
            return (
              <div key={w.id} className="bg-card border border-card-border rounded-xl p-4 space-y-3">
                <div className="flex items-start justify-between gap-2 flex-wrap">
                  <div className="space-y-0.5 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold">{w.username ?? `User #${w.userId}`}</span>
                      <StatusBadge status={w.status} />
                    </div>
                    <p className="text-xs text-muted-foreground">{w.email}</p>
                    <p className="text-xs text-muted-foreground font-mono truncate">
                      {w.walletAddress ?? "No wallet"}
                    </p>
                    {w.paymentTag && <p className="text-xs text-muted-foreground font-mono">Tag: {w.paymentTag}</p>}
                    {w.adminNote && !(isActing && actionType === "note") && (
                      <p className="text-xs text-blue-400 italic">Note: {w.adminNote}</p>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-lg font-bold">${w.amount.toFixed(2)} USDT</p>
                    <p className="text-xs text-muted-foreground">{fmt(w.createdAt)}</p>
                  </div>
                </div>

                {/* ── Pending: Approve (with note) or Reject ── */}
                {w.status === "pending" && (
                  isActing && actionType === "approve" ? (
                    <div className="space-y-2 bg-emerald-500/5 border border-emerald-500/20 rounded-xl p-3">
                      <p className="text-xs text-emerald-400 font-medium">Add approval note (optional)</p>
                      <Input
                        placeholder="e.g. Payment verified via TRC20"
                        value={noteInput[w.id] ?? ""}
                        onChange={e => setNoteInput(prev => ({ ...prev, [w.id]: e.target.value }))}
                        className="h-9"
                      />
                      <div className="flex gap-2">
                        <Button size="sm" className="gap-1 bg-emerald-500 hover:bg-emerald-600 text-white text-xs" onClick={() => handleApprove(w.id)} disabled={isProcessing}>
                          <Check className="w-3 h-3" /> {isProcessing ? "Approving…" : "Confirm Approve"}
                        </Button>
                        <Button size="sm" variant="outline" onClick={closeAction} disabled={isProcessing}>Cancel</Button>
                      </div>
                    </div>
                  ) : isActing && actionType === "reject" ? (
                    <div className="space-y-2 bg-red-500/5 border border-red-500/20 rounded-xl p-3">
                      <p className="text-xs text-red-400 font-medium">Rejection reason (optional) — coins will be refunded</p>
                      <Input
                        placeholder="e.g. Invalid wallet address"
                        value={noteInput[w.id] ?? ""}
                        onChange={e => setNoteInput(prev => ({ ...prev, [w.id]: e.target.value }))}
                        className="h-9"
                      />
                      <div className="flex gap-2">
                        <Button size="sm" className="gap-1 bg-red-500 hover:bg-red-600 text-white text-xs" onClick={() => handleReject(w.id)} disabled={isProcessing}>
                          <X className="w-3 h-3" /> {isProcessing ? "Rejecting…" : "Confirm Reject"}
                        </Button>
                        <Button size="sm" variant="outline" onClick={closeAction} disabled={isProcessing}>Cancel</Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <Button size="sm" className="gap-1 bg-emerald-500 hover:bg-emerald-600 text-white text-xs h-7" onClick={() => openAction(w.id, "approve")}>
                        <Check className="w-3 h-3" /> Approve
                      </Button>
                      <Button size="sm" variant="outline" className="gap-1 text-red-400 border-red-500/30 text-xs h-7" onClick={() => openAction(w.id, "reject")}>
                        <X className="w-3 h-3" /> Reject
                      </Button>
                    </div>
                  )
                )}

                {/* ── Processed: Edit note ── */}
                {w.status !== "pending" && (
                  isActing && actionType === "note" ? (
                    <div className="space-y-2 bg-muted/30 rounded-xl p-3">
                      <Input
                        placeholder="Admin note…"
                        value={noteInput[w.id] ?? ""}
                        onChange={e => setNoteInput(prev => ({ ...prev, [w.id]: e.target.value }))}
                        className="h-9"
                      />
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" className="text-xs gap-1" onClick={() => handleSaveNote(w.id)} disabled={isProcessing}>
                          <Save className="w-3 h-3" /> {isProcessing ? "Saving…" : "Save note"}
                        </Button>
                        <Button size="sm" variant="ghost" className="text-xs" onClick={closeAction} disabled={isProcessing}>Cancel</Button>
                      </div>
                    </div>
                  ) : (
                    <Button
                      size="sm" variant="ghost"
                      className="text-xs text-muted-foreground h-6 px-2 gap-1 hover:text-foreground"
                      onClick={() => openAction(w.id, "note", w.adminNote ?? "")}
                    >
                      <Pencil className="w-3 h-3" /> {w.adminNote ? "Edit note" : "Add note"}
                    </Button>
                  )
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Transactions Tab ────────────────────────────────────────────────────────

function TransactionsTab({ secret }: { secret: string }) {
  const { toast } = useToast();
  const [items, setItems] = useState<TxRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState("all");
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (typeFilter !== "all") params.set("type", typeFilter);
      if (search.trim()) params.set("search", search.trim());
      const res = await apiFetch(`/admin/transactions?${params}`, { headers: { "x-admin-secret": secret, "Content-Type": "application/json" } });
      const data = await res.json();
      setItems(Array.isArray(data) ? data : []);
    } catch {
      toast({ variant: "destructive", title: "Failed to load transactions" });
    } finally {
      setLoading(false);
    }
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
  const headers = { "x-admin-secret": secret, "Content-Type": "application/json" };

  // Sessions state
  const [sessions, setSessions] = useState<MiningSession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);

  // Config state
  const [config, setConfig] = useState<MiningConfig | null>(null);
  const [configLoading, setConfigLoading] = useState(true);
  const [editRate, setEditRate] = useState("");
  const [editDuration, setEditDuration] = useState("");
  const [savingConfig, setSavingConfig] = useState(false);

  // Start mining for user
  const [startUserId, setStartUserId] = useState("");
  const [starting, setStarting] = useState(false);

  // User rate override
  const [overrideUserId, setOverrideUserId] = useState("");
  const [overrideRate, setOverrideRate] = useState("");
  const [savingOverride, setSavingOverride] = useState(false);

  const loadSessions = useCallback(async () => {
    setSessionsLoading(true);
    const res = await apiFetch("/admin/mining-sessions", { headers });
    const data = await res.json();
    setSessions(Array.isArray(data) ? data : []);
    setSessionsLoading(false);
  }, [secret]);

  const loadConfig = useCallback(async () => {
    setConfigLoading(true);
    const res = await apiFetch("/admin/mining-config", { headers });
    if (res.ok) {
      const data: MiningConfig = await res.json();
      setConfig(data);
      setEditRate(data.baseCoinRate.toString());
      setEditDuration(data.sessionDurationHours.toString());
    }
    setConfigLoading(false);
  }, [secret]);

  useEffect(() => { loadSessions(); loadConfig(); }, [loadSessions, loadConfig]);

  const timeLeft = (endsAt: string) => {
    const ms = new Date(endsAt).getTime() - Date.now();
    if (ms <= 0) return "Complete";
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    return `${h}h ${m}m`;
  };

  const handleStop = async (id: number, username: string | null) => {
    if (!confirm(`Stop ${username ?? "this user"}'s session? Coins earned so far will be preserved.`)) return;
    const res = await apiFetch(`/admin/mining-sessions/${id}/stop`, { method: "POST", headers });
    if (res.ok) { toast({ title: "Session stopped" }); loadSessions(); }
    else toast({ variant: "destructive", title: "Failed to stop session" });
  };

  const handleReset = async (id: number, username: string | null) => {
    if (!confirm(`Reset ${username ?? "this user"}'s session? All pending coins will be forfeited.`)) return;
    const res = await apiFetch(`/admin/mining-sessions/${id}/reset`, { method: "POST", headers });
    if (res.ok) { toast({ title: "Session reset — coins forfeited" }); loadSessions(); }
    else toast({ variant: "destructive", title: "Failed to reset session" });
  };

  const handleSaveConfig = async () => {
    const rate = parseFloat(editRate);
    const duration = parseInt(editDuration);
    if (isNaN(rate) || rate <= 0) { toast({ variant: "destructive", title: "Invalid coin rate" }); return; }
    if (isNaN(duration) || duration <= 0) { toast({ variant: "destructive", title: "Invalid duration" }); return; }
    setSavingConfig(true);
    const res = await apiFetch("/admin/mining-config", { method: "PUT", headers, body: JSON.stringify({ baseCoinRate: rate, sessionDurationHours: duration }) });
    if (res.ok) { toast({ title: "Mining config saved" }); loadConfig(); }
    else toast({ variant: "destructive", title: "Failed to save config" });
    setSavingConfig(false);
  };

  const handleToggleMaintenance = async () => {
    if (!config) return;
    const newVal = !config.maintenanceMode;
    const res = await apiFetch("/admin/mining-config", { method: "PUT", headers, body: JSON.stringify({ maintenanceMode: newVal }) });
    if (res.ok) { toast({ title: newVal ? "Maintenance mode ON — mining disabled" : "Maintenance mode OFF — mining enabled" }); loadConfig(); }
    else toast({ variant: "destructive", title: "Failed to update maintenance mode" });
  };

  const handleStartMining = async () => {
    const userId = parseInt(startUserId);
    if (isNaN(userId) || userId <= 0) { toast({ variant: "destructive", title: "Enter a valid User ID" }); return; }
    setStarting(true);
    const res = await apiFetch("/admin/mining/start-for-user", { method: "POST", headers, body: JSON.stringify({ userId }) });
    if (res.ok) { toast({ title: `Mining started for user #${userId}` }); setStartUserId(""); loadSessions(); }
    else {
      const data = await res.json().catch(() => ({}));
      toast({ variant: "destructive", title: data.error ?? "Failed to start mining" });
    }
    setStarting(false);
  };

  const handleSaveOverride = async () => {
    const userId = parseInt(overrideUserId);
    const rate = parseFloat(overrideRate);
    if (isNaN(userId) || userId <= 0) { toast({ variant: "destructive", title: "Enter a valid User ID" }); return; }
    if (isNaN(rate) || rate <= 0) { toast({ variant: "destructive", title: "Enter a valid rate" }); return; }
    setSavingOverride(true);
    const res = await apiFetch(`/admin/users/${userId}/mining-rate`, { method: "PUT", headers, body: JSON.stringify({ rate }) });
    if (res.ok) { toast({ title: `Rate override set for user #${userId}` }); setOverrideUserId(""); setOverrideRate(""); loadConfig(); }
    else toast({ variant: "destructive", title: "Failed to set rate override" });
    setSavingOverride(false);
  };

  const handleRemoveOverride = async (userId: number) => {
    const res = await apiFetch(`/admin/users/${userId}/mining-rate`, { method: "PUT", headers, body: JSON.stringify({ rate: null }) });
    if (res.ok) { toast({ title: "Override removed" }); loadConfig(); }
    else toast({ variant: "destructive", title: "Failed to remove override" });
  };

  return (
    <div className="space-y-6 max-w-4xl">

      {/* Global Config */}
      <div className="bg-card border border-card-border rounded-2xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-bold flex items-center gap-2"><Zap className="w-4 h-4 text-primary" /> Global Mining Config</h3>
          {configLoading && <RefreshCw className="w-3.5 h-3.5 animate-spin text-muted-foreground" />}
        </div>

        {/* Maintenance mode */}
        <div className="flex items-center justify-between bg-muted/30 rounded-xl px-4 py-3">
          <div>
            <p className="font-medium text-sm">Mining System</p>
            <p className="text-xs text-muted-foreground">{config?.maintenanceMode ? "Disabled — users cannot start new sessions" : "Active — users can mine normally"}</p>
          </div>
          <button onClick={handleToggleMaintenance} className={`flex items-center gap-1.5 text-sm font-medium transition-colors ${config?.maintenanceMode ? "text-red-400" : "text-emerald-400"}`}>
            {config?.maintenanceMode
              ? <><ToggleLeft className="w-7 h-7" /> Disabled</>
              : <><ToggleRight className="w-7 h-7" /> Enabled</>}
          </button>
        </div>

        {config?.maintenanceMode && (
          <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-2 text-red-400 text-sm">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            Maintenance mode is ON — no new mining sessions can be started
          </div>
        )}

        {/* Rate and Duration */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Base Coins / Hour</label>
            <Input value={editRate} onChange={e => setEditRate(e.target.value)} placeholder="0.5" type="number" min="0.001" step="0.1" />
            <p className="text-xs text-muted-foreground">Per mining level (Lv1 × rate, Lv2 × 2×rate…)</p>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Session Duration (hours)</label>
            <Input value={editDuration} onChange={e => setEditDuration(e.target.value)} placeholder="12" type="number" min="1" step="1" />
            <p className="text-xs text-muted-foreground">How long a single mining session lasts</p>
          </div>
        </div>
        <Button size="sm" onClick={handleSaveConfig} disabled={savingConfig} className="gap-1.5">
          <Save className="w-3.5 h-3.5" /> {savingConfig ? "Saving…" : "Save Config"}
        </Button>
      </div>

      {/* Active Sessions */}
      <div className="bg-card border border-card-border rounded-2xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-bold flex items-center gap-2"><Activity className="w-4 h-4 text-primary" /> Active Sessions
            <Badge className="text-xs border bg-muted text-muted-foreground border-border">{sessions.length}</Badge>
          </h3>
          <Button variant="outline" size="sm" onClick={loadSessions}><RefreshCw className="w-3.5 h-3.5" /></Button>
        </div>

        {sessionsLoading ? (
          <p className="text-muted-foreground text-sm text-center py-6">Loading…</p>
        ) : sessions.length === 0 ? (
          <p className="text-muted-foreground text-sm text-center py-6">No active mining sessions</p>
        ) : (
          <div className="space-y-2">
            {sessions.map(s => (
              <div key={s.id} className="border border-border rounded-xl p-4">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold">{s.username ?? `User #${s.userId}`}</span>
                      <Badge className="text-xs border bg-muted text-muted-foreground border-border">Lv {s.miningLevel ?? 1}</Badge>
                      {s.boostMultiplier > 1 && <Badge className="text-xs border bg-purple-500/20 text-purple-400 border-purple-500/30"><Zap className="w-2.5 h-2.5 mr-0.5 inline" />{s.boostMultiplier}x boost</Badge>}
                      {s.hasRateOverride && <Badge className="text-xs border bg-orange-500/20 text-orange-400 border-orange-500/30">custom rate</Badge>}
                    </div>
                    <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
                      <span>Rate: <span className="text-foreground font-mono">{s.coinRate.toFixed(3)}</span> coins/hr</span>
                      <span>Hash: <span className="text-foreground font-mono">{s.hashRate}</span> H/s</span>
                      <span>⏱ <span className="text-foreground">{timeLeft(s.endsAt)}</span> left</span>
                    </div>
                    <p className="text-xs text-muted-foreground">Started {fmt(s.startedAt)} · Ends {fmt(s.endsAt)}</p>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <Button size="sm" variant="outline" className="text-yellow-400 border-yellow-500/30 text-xs h-7 gap-1" onClick={() => handleStop(s.id, s.username)}>
                      <X className="w-3 h-3" /> Stop
                    </Button>
                    <Button size="sm" variant="outline" className="text-red-400 border-red-500/30 text-xs h-7 gap-1" onClick={() => handleReset(s.id, s.username)}>
                      <RotateCcw className="w-3 h-3" /> Reset
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Start Mining for User */}
      <div className="bg-card border border-card-border rounded-2xl p-5 space-y-4">
        <h3 className="font-bold flex items-center gap-2"><Play className="w-4 h-4 text-primary" /> Start Mining for User</h3>
        <p className="text-xs text-muted-foreground">Admin can force-start a 12-hour (or configured duration) mining session for any user by their ID.</p>
        <div className="flex gap-3">
          <Input
            value={startUserId}
            onChange={e => setStartUserId(e.target.value)}
            placeholder="User ID (e.g. 42)"
            type="number"
            className="max-w-xs"
            onKeyDown={e => e.key === "Enter" && handleStartMining()}
          />
          <Button onClick={handleStartMining} disabled={starting || !startUserId} className="gap-1.5">
            <Play className="w-3.5 h-3.5" /> {starting ? "Starting…" : "Start Mining"}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">You can find a user's ID in the Users tab.</p>
      </div>

      {/* User Rate Overrides */}
      <div className="bg-card border border-card-border rounded-2xl p-5 space-y-4">
        <h3 className="font-bold flex items-center gap-2"><Zap className="w-4 h-4 text-orange-400" /> User-Specific Rate Overrides</h3>
        <p className="text-xs text-muted-foreground">Override the global mining rate for a specific user. Overrides apply on future sessions and override calculations.</p>
        <div className="flex gap-3 flex-wrap">
          <Input value={overrideUserId} onChange={e => setOverrideUserId(e.target.value)} placeholder="User ID" type="number" className="w-36" />
          <Input value={overrideRate} onChange={e => setOverrideRate(e.target.value)} placeholder="Rate (coins/hr)" type="number" min="0.001" step="0.1" className="w-48" />
          <Button size="sm" onClick={handleSaveOverride} disabled={savingOverride || !overrideUserId || !overrideRate} className="gap-1.5">
            <Save className="w-3.5 h-3.5" /> {savingOverride ? "Saving…" : "Set Override"}
          </Button>
        </div>

        {config && config.userOverrides.length > 0 && (
          <div className="space-y-2 mt-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Current Overrides</p>
            {config.userOverrides.map(o => (
              <div key={o.userId} className="flex items-center justify-between bg-muted/30 rounded-xl px-4 py-2.5 text-sm">
                <div>
                  <span className="font-medium">{o.username}</span>
                  <span className="text-muted-foreground text-xs ml-2">(ID: {o.userId})</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-mono text-orange-400">{o.rate} coins/hr</span>
                  <Button size="sm" variant="ghost" className="text-red-400 h-6 w-6 p-0" onClick={() => handleRemoveOverride(o.userId)}>
                    <X className="w-3 h-3" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Referrals Tab ───────────────────────────────────────────────────────────

function ReferralsTab({ secret }: { secret: string }) {
  const { toast } = useToast();
  const h = { "x-admin-secret": secret, "Content-Type": "application/json" };

  // Config section
  const [cfg, setCfg] = useState<ReferralConfig | null>(null);
  const [cfgLoading, setCfgLoading] = useState(true);
  const [cfgSaving, setCfgSaving] = useState(false);
  const [bonusCoinsInput, setBonusCoinsInput] = useState("");
  const [commissionPctInput, setCommissionPctInput] = useState("");

  // Suspicious section
  const [suspicious, setSuspicious] = useState<SuspiciousReferral[]>([]);
  const [suspLoading, setSuspLoading] = useState(true);

  // Stats section
  const [stats, setStats] = useState<ReferralStat[]>([]);
  const [statsLoading, setStatsLoading] = useState(true);

  // All relationships section
  const [items, setItems] = useState<Referral[]>([]);
  const [relLoading, setRelLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [deleting, setDeleting] = useState<number | null>(null);

  const loadRelationships = useCallback((q: string) => {
    setRelLoading(true);
    const url = q.trim() ? `/admin/referrals?search=${encodeURIComponent(q.trim())}` : "/admin/referrals";
    apiFetch(url, { headers: h }).then(r => r.json()).then((d: Referral[]) => {
      setItems(Array.isArray(d) ? d : []);
      setRelLoading(false);
    }).catch(() => setRelLoading(false));
  }, [secret]);

  const loadAnalytics = useCallback(() => {
    setSuspLoading(true); setStatsLoading(true);
    apiFetch("/admin/referral-suspicious", { headers: h }).then(r => r.json()).then((d: SuspiciousReferral[]) => {
      setSuspicious(Array.isArray(d) ? d : []);
      setSuspLoading(false);
    }).catch(() => setSuspLoading(false));
    apiFetch("/admin/referral-stats", { headers: h }).then(r => r.json()).then((d: ReferralStat[]) => {
      setStats(Array.isArray(d) ? d : []);
      setStatsLoading(false);
    }).catch(() => setStatsLoading(false));
  }, [secret]);

  const loadAll = useCallback(() => {
    setCfgLoading(true);
    apiFetch("/admin/referral-config", { headers: h }).then(r => r.json()).then((d: ReferralConfig) => {
      setCfg(d);
      setBonusCoinsInput(String(d.bonusCoins));
      setCommissionPctInput(String(d.commissionPct));
      setCfgLoading(false);
    }).catch(() => setCfgLoading(false));
    loadAnalytics();
  }, [secret, loadAnalytics]);

  useEffect(() => { loadAll(); }, [loadAll]);

  // Debounced search → hits backend with ?search= param
  useEffect(() => {
    const timer = setTimeout(() => loadRelationships(search), search ? 350 : 0);
    return () => clearTimeout(timer);
  }, [search, loadRelationships]);

  const handleToggleDisabled = async () => {
    if (!cfg) return;
    const newVal = !cfg.referralDisabled;
    try {
      const res = await apiFetch("/admin/referral-config", { method: "PUT", headers: h, body: JSON.stringify({ referralDisabled: newVal }) });
      if (!res.ok) throw new Error();
      setCfg({ ...cfg, referralDisabled: newVal });
      toast({ title: newVal ? "Referral program disabled" : "Referral program enabled" });
    } catch {
      toast({ title: "Failed to update referral program status", variant: "destructive" });
    }
  };

  const handleSaveCfg = async () => {
    if (!cfg) return;
    const bonusCoins = parseFloat(bonusCoinsInput);
    const commissionPct = parseFloat(commissionPctInput);
    if (isNaN(bonusCoins) || bonusCoins < 0) { toast({ title: "Invalid bonus coins value", variant: "destructive" }); return; }
    if (isNaN(commissionPct) || commissionPct < 0 || commissionPct > 100) { toast({ title: "Commission must be 0–100", variant: "destructive" }); return; }
    setCfgSaving(true);
    try {
      const res = await apiFetch("/admin/referral-config", { method: "PUT", headers: h, body: JSON.stringify({ bonusCoins, commissionPct }) });
      if (!res.ok) throw new Error();
      setCfg({ ...cfg, bonusCoins, commissionPct });
      toast({ title: "Referral settings saved" });
    } catch {
      toast({ title: "Failed to save referral settings", variant: "destructive" });
    } finally {
      setCfgSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    setDeleting(id);
    try {
      const res = await apiFetch(`/admin/referrals/${id}`, { method: "DELETE", headers: h });
      if (!res.ok) throw new Error();
      toast({ title: "Referral relationship removed" });
      loadRelationships(search);
      loadAnalytics();
    } catch {
      toast({ title: "Failed to remove referral relationship", variant: "destructive" });
    } finally {
      setDeleting(null);
    }
  };

  const liveBonusUsdt = (() => {
    const v = parseFloat(bonusCoinsInput);
    return isNaN(v) ? null : (v / 1000).toFixed(3);
  })();

  return (
    <div className="space-y-6">

      {/* ── Section 1: Program Settings ── */}
      <div className="bg-card border border-card-border rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <p className="font-semibold text-sm">Program Settings</p>
          {cfgLoading ? null : (
            <button
              onClick={handleToggleDisabled}
              className={`flex items-center gap-2 text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors ${cfg?.referralDisabled ? "bg-red-500/10 text-red-400 border-red-500/30 hover:bg-red-500/20" : "bg-emerald-500/10 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/20"}`}
            >
              {cfg?.referralDisabled ? <><ToggleLeft className="w-3.5 h-3.5" /> Program OFF</> : <><ToggleRight className="w-3.5 h-3.5" /> Program ON</>}
            </button>
          )}
        </div>
        {cfgLoading ? (
          <p className="text-muted-foreground text-sm text-center py-4">Loading…</p>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground flex items-center justify-between">
                <span>Referral Bonus (coins)</span>
                {liveBonusUsdt !== null && <span className="text-purple-400">${liveBonusUsdt} USDT</span>}
              </label>
              <Input
                type="number" min="0"
                value={bonusCoinsInput}
                onChange={e => setBonusCoinsInput(e.target.value)}
                className="h-9"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Commission Rate (%)</label>
              <Input
                type="number" min="0" max="100" step="0.1"
                value={commissionPctInput}
                onChange={e => setCommissionPctInput(e.target.value)}
                className="h-9"
              />
            </div>
            <div className="col-span-2">
              <Button size="sm" onClick={handleSaveCfg} disabled={cfgSaving} className="w-full">
                {cfgSaving ? "Saving…" : "Save Settings"}
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* ── Section 2: Suspicious Activity ── */}
      <div className="space-y-2">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-400" /> Suspicious Activity
        </p>
        {suspLoading ? (
          <p className="text-muted-foreground text-sm text-center py-4">Loading…</p>
        ) : suspicious.length === 0 ? (
          <div className="bg-card border border-card-border rounded-xl p-4 text-center text-sm text-muted-foreground">No suspicious activity detected</div>
        ) : (
          suspicious.map(s => (
            <div key={s.referralId} className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-4 space-y-1.5">
              <div className="flex items-center gap-2 text-sm">
                <span className="font-medium text-amber-400">{s.referrerUsername}</span>
                <span className="text-muted-foreground">→</span>
                <span className="font-medium">{s.referredUsername}</span>
                <Badge className="ml-auto text-xs border bg-amber-500/20 text-amber-400 border-amber-500/30">Flagged</Badge>
              </div>
              <p className="text-xs text-amber-300/80">{s.reason}</p>
              <p className="text-xs text-muted-foreground">{fmt(s.createdAt)}</p>
            </div>
          ))
        )}
      </div>

      {/* ── Section 3: Top Referrers ── */}
      <div className="space-y-2">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Earnings per Referrer</p>
        {statsLoading ? (
          <p className="text-muted-foreground text-sm text-center py-4">Loading…</p>
        ) : stats.length === 0 ? (
          <div className="bg-card border border-card-border rounded-xl p-4 text-center text-sm text-muted-foreground">No referral earnings yet</div>
        ) : (
          <div className="bg-card border border-card-border rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-card-border text-xs text-muted-foreground">
                  <th className="text-left px-4 py-2.5 font-medium">User</th>
                  <th className="text-right px-4 py-2.5 font-medium">Referrals</th>
                  <th className="text-right px-4 py-2.5 font-medium">Bonus</th>
                  <th className="text-right px-4 py-2.5 font-medium">Commission</th>
                  <th className="text-right px-4 py-2.5 font-medium">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-card-border">
                {stats.map((s, i) => (
                  <tr key={s.userId} className={i % 2 === 0 ? "bg-muted/10" : ""}>
                    <td className="px-4 py-2.5 font-medium truncate max-w-[120px]">{s.username}</td>
                    <td className="px-4 py-2.5 text-right text-muted-foreground">{s.referralCount}</td>
                    <td className="px-4 py-2.5 text-right text-purple-400">{fmtCoins(s.totalBonus)}</td>
                    <td className="px-4 py-2.5 text-right text-blue-400">{fmtCoins(s.totalCommission)}</td>
                    <td className="px-4 py-2.5 text-right font-semibold text-emerald-400">{fmtCoins(s.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Section 4: All Relationships ── */}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">All Relationships</p>
          <Button variant="ghost" size="sm" onClick={() => { loadAll(); loadRelationships(search); }} className="h-6 w-6 p-0">
            <RefreshCw className="w-3 h-3" />
          </Button>
        </div>
        <Input
          placeholder="Search by username…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="h-9"
        />
        {relLoading ? (
          <p className="text-muted-foreground text-sm text-center py-4">Loading…</p>
        ) : items.length === 0 ? (
          <div className="text-center text-sm text-muted-foreground py-6">
            {search ? "No matches found" : "No referral relationships"}
          </div>
        ) : (
          items.map(r => (
            <div key={r.id} className="bg-card border border-card-border rounded-xl p-4 flex items-center justify-between gap-3 flex-wrap">
              <div className="space-y-0.5 min-w-0">
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
              <Button
                variant="ghost" size="sm"
                className="text-red-400 hover:text-red-300 hover:bg-red-500/10 h-8 w-8 p-0 shrink-0"
                disabled={deleting === r.id}
                onClick={() => handleDelete(r.id)}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ─── Upgrades Tab ────────────────────────────────────────────────────────────

const EMPTY_PACKAGE: Omit<UpgradePackage, "id"> = {
  name: "", description: "", tier: 1, hashRateBoost: 0, dailyCapBoost: 0,
  coinCost: null, usdtCost: null, isAutoMining: false, sortOrder: 0, badge: null, icon: null,
};

function UpgradesTab({
  secret,
  activeSubTab,
  onSubTabChange,
  onPendingCountChange,
}: {
  secret: string;
  activeSubTab: UpgradeSubTab;
  onSubTabChange: (t: UpgradeSubTab) => void;
  onPendingCountChange?: (count: number) => void;
}) {
  const [packages, setPackages] = useState<UpgradePackage[]>([]);
  const [purchases, setPurchases] = useState<UpgradePurchase[]>([]);
  const [payments, setPayments] = useState<UpgradePayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingPkg, setEditingPkg] = useState<UpgradePackage | null>(null);
  const [newPkg, setNewPkg] = useState<Omit<UpgradePackage, "id"> | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [decisionModal, setDecisionModal] = useState<{ txnId: number; action: "approve" | "reject"; upgradeName: string } | null>(null);
  const [decisionNote, setDecisionNote] = useState("");
  const [processingId, setProcessingId] = useState<number | null>(null);
  const { toast } = useToast();

  const load = useCallback(() => {
    const headers = { "x-admin-secret": secret, "Content-Type": "application/json" };
    setLoading(true);
    Promise.all([
      apiFetch("/admin/upgrades", { headers }).then(r => r.json()).catch(() => []),
      apiFetch("/admin/upgrade-purchases", { headers }).then(r => r.json()).catch(() => []),
      apiFetch("/admin/upgrade-payments", { headers }).then(r => r.json()).catch(() => []),
    ]).then(([pkgs, purch, pays]) => {
      setPackages(Array.isArray(pkgs) ? pkgs : []);
      setPurchases(Array.isArray(purch) ? purch : []);
      setPayments(Array.isArray(pays) ? pays : []);
      const pendingCount = (Array.isArray(pays) ? pays as UpgradePayment[] : [])
        .filter(p => p.status === "pending" || p.status === "awaiting_verification").length;
      onPendingCountChange?.(pendingCount);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [secret, onPendingCountChange]);

  useEffect(() => { load(); }, [load]);

  const saveEdit = async () => {
    if (!editingPkg) return;
    const headers = { "x-admin-secret": secret, "Content-Type": "application/json" };
    const r = await apiFetch(`/admin/upgrades/${editingPkg.id}`, {
      method: "PUT", headers,
      body: JSON.stringify({
        name: editingPkg.name, description: editingPkg.description,
        tier: Number(editingPkg.tier), hashRateBoost: Number(editingPkg.hashRateBoost),
        dailyCapBoost: Number(editingPkg.dailyCapBoost),
        coinCost: editingPkg.coinCost ? Number(editingPkg.coinCost) : null,
        usdtCost: editingPkg.usdtCost ? Number(editingPkg.usdtCost) : null,
        isAutoMining: editingPkg.isAutoMining,
        sortOrder: Number(editingPkg.sortOrder),
        badge: editingPkg.badge || null,
        icon: editingPkg.icon || null,
      }),
    });
    if (r.ok) { toast({ title: "Package saved" }); setEditingPkg(null); load(); }
    else { const d = await r.json(); toast({ variant: "destructive", title: d.error ?? "Save failed" }); }
  };

  const saveNew = async () => {
    if (!newPkg) return;
    const headers = { "x-admin-secret": secret, "Content-Type": "application/json" };
    const r = await apiFetch("/admin/upgrades", {
      method: "POST", headers,
      body: JSON.stringify({
        name: newPkg.name, description: newPkg.description,
        tier: Number(newPkg.tier), hashRateBoost: Number(newPkg.hashRateBoost),
        dailyCapBoost: Number(newPkg.dailyCapBoost),
        coinCost: newPkg.coinCost ? Number(newPkg.coinCost) : null,
        usdtCost: newPkg.usdtCost ? Number(newPkg.usdtCost) : null,
        isAutoMining: newPkg.isAutoMining,
        sortOrder: Number(newPkg.sortOrder),
        badge: newPkg.badge || null,
        icon: newPkg.icon || null,
      }),
    });
    if (r.ok) { toast({ title: "Package created" }); setNewPkg(null); load(); }
    else { const d = await r.json(); toast({ variant: "destructive", title: d.error ?? "Create failed" }); }
  };

  const handleDecision = async () => {
    if (!decisionModal) return;
    setProcessingId(decisionModal.txnId);
    const headers = { "x-admin-secret": secret, "Content-Type": "application/json" };
    const endpoint = `/admin/upgrade-payments/${decisionModal.txnId}/${decisionModal.action}`;
    const r = await apiFetch(endpoint, { method: "POST", headers, body: JSON.stringify({ note: decisionNote || undefined }) });
    if (r.ok) {
      const action = decisionModal.action === "approve" ? "Upgrade approved" : "Payment rejected";
      toast({ title: action });
    } else {
      const d = await r.json().catch(() => ({}));
      toast({ variant: "destructive", title: d.error ?? "Action failed" });
    }
    setDecisionModal(null);
    setDecisionNote("");
    setProcessingId(null);
    load();
  };

  const confirmDelete = async () => {
    if (!deletingId) return;
    const headers = { "x-admin-secret": secret, "Content-Type": "application/json" };
    const r = await apiFetch(`/admin/upgrades/${deletingId}`, { method: "DELETE", headers });
    if (r.ok) { toast({ title: "Package deleted" }); setDeletingId(null); load(); }
    else {
      const d = await r.json().catch(() => ({}));
      toast({ variant: "destructive", title: "Cannot delete", description: d.error ?? "Delete failed" });
      setDeletingId(null);
    }
  };

  const PkgForm = ({ value, onChange }: { value: Partial<UpgradePackage>; onChange: (v: Partial<UpgradePackage>) => void }) => (
    <div className="grid grid-cols-2 gap-3 text-sm">
      <div className="col-span-2">
        <label className="text-xs text-muted-foreground mb-1 block">Name</label>
        <Input value={value.name ?? ""} onChange={e => onChange({ ...value, name: e.target.value })} placeholder="e.g. Speed Boost II" />
      </div>
      <div className="col-span-2">
        <label className="text-xs text-muted-foreground mb-1 block">Description</label>
        <Input value={value.description ?? ""} onChange={e => onChange({ ...value, description: e.target.value })} placeholder="Short description" />
      </div>
      <div>
        <label className="text-xs text-muted-foreground mb-1 block">Tier</label>
        <Input type="number" min={1} value={value.tier ?? 1} onChange={e => onChange({ ...value, tier: Number(e.target.value) })} />
      </div>
      <div>
        <label className="text-xs text-muted-foreground mb-1 block">Sort Order</label>
        <Input type="number" value={value.sortOrder ?? 0} onChange={e => onChange({ ...value, sortOrder: Number(e.target.value) })} />
      </div>
      <div>
        <label className="text-xs text-muted-foreground mb-1 block">Speed Boost %</label>
        <Input type="number" min={0} value={value.hashRateBoost ?? 0} onChange={e => onChange({ ...value, hashRateBoost: Number(e.target.value) })} />
      </div>
      <div>
        <label className="text-xs text-muted-foreground mb-1 block">Daily Cap</label>
        <Input type="number" min={0} value={value.dailyCapBoost ?? 0} onChange={e => onChange({ ...value, dailyCapBoost: Number(e.target.value) })} />
      </div>
      <div>
        <label className="text-xs text-muted-foreground mb-1 block">Coin Cost (blank = none)</label>
        <Input type="number" min={0} value={value.coinCost ?? ""} onChange={e => onChange({ ...value, coinCost: e.target.value ? Number(e.target.value) : null })} placeholder="0" />
      </div>
      <div>
        <label className="text-xs text-muted-foreground mb-1 block">USDT Cost (blank = none)</label>
        <Input type="number" min={0} step="0.01" value={value.usdtCost ?? ""} onChange={e => onChange({ ...value, usdtCost: e.target.value ? Number(e.target.value) : null })} placeholder="0.00" />
      </div>
      <div>
        <label className="text-xs text-muted-foreground mb-1 block">Icon (emoji)</label>
        <Input value={value.icon ?? ""} onChange={e => onChange({ ...value, icon: e.target.value })} placeholder="⚡" />
      </div>
      <div>
        <label className="text-xs text-muted-foreground mb-1 block">Badge (Popular/Best Value/Elite)</label>
        <Input value={value.badge ?? ""} onChange={e => onChange({ ...value, badge: e.target.value })} placeholder="Popular" />
      </div>
      <div className="col-span-2 flex items-center gap-2">
        <input type="checkbox" id="autoMining" checked={!!value.isAutoMining} onChange={e => onChange({ ...value, isAutoMining: e.target.checked })} className="w-4 h-4" />
        <label htmlFor="autoMining" className="text-xs text-muted-foreground">Auto-Mining enabled</label>
      </div>
    </div>
  );

  const UPGRADE_SUB_TABS: { id: UpgradeSubTab; label: string }[] = [
    { id: "manage", label: "Manage Upgrades" },
    { id: "history", label: "Upgrades History" },
    { id: "approve-reject", label: "Approve or Reject Upgrades" },
  ];

  const pendingPayments = payments.filter(p => p.status === "pending" || p.status === "awaiting_verification");

  if (loading) return <p className="text-muted-foreground text-sm text-center py-8">Loading…</p>;

  return (
    <div className="space-y-6">
      {/* Sub-tab navigation */}
      <div className="flex gap-1 bg-muted/40 p-1 rounded-xl w-fit flex-wrap">
        {UPGRADE_SUB_TABS.map(st => (
          <button
            key={st.id}
            onClick={() => onSubTabChange(st.id)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${activeSubTab === st.id ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
          >
            {st.label}
            {st.id === "approve-reject" && pendingPayments.length > 0 && (
              <span className="bg-red-500 text-white text-xs rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1 leading-none">
                {pendingPayments.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Manage Upgrades sub-tab */}
      {activeSubTab === "manage" && <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold">Manage Packages</h3>
          <Button size="sm" className="gap-1.5" onClick={() => setNewPkg({ ...EMPTY_PACKAGE })}>
            <Plus className="w-3.5 h-3.5" /> Add Package
          </Button>
        </div>

        {/* Add new package form */}
        {newPkg && (
          <div className="bg-card border border-primary/40 rounded-xl p-4 mb-3 space-y-3">
            <p className="text-xs font-semibold text-primary">New Package</p>
            <PkgForm value={newPkg} onChange={v => setNewPkg(v as Omit<UpgradePackage, "id">)} />
            <div className="flex gap-2 pt-1">
              <Button size="sm" onClick={saveNew} className="gap-1"><Save className="w-3.5 h-3.5" /> Save</Button>
              <Button size="sm" variant="ghost" onClick={() => setNewPkg(null)}>Cancel</Button>
            </div>
          </div>
        )}

        <div className="space-y-2">
          {packages.length === 0 && <p className="text-muted-foreground text-sm text-center py-6">No packages yet. Add one above.</p>}
          {packages.map(pkg => (
            <div key={pkg.id}>
              {editingPkg?.id === pkg.id ? (
                <div className="bg-card border border-primary/40 rounded-xl p-4 space-y-3">
                  <p className="text-xs font-semibold text-primary">Editing: {pkg.name}</p>
                  <PkgForm value={editingPkg} onChange={v => setEditingPkg(v as UpgradePackage)} />
                  <div className="flex gap-2 pt-1">
                    <Button size="sm" onClick={saveEdit} className="gap-1"><Save className="w-3.5 h-3.5" /> Save</Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditingPkg(null)}>Cancel</Button>
                  </div>
                </div>
              ) : (
                <div className="bg-card border border-card-border rounded-xl p-3 flex items-center gap-3">
                  <span className="text-xl">{pkg.icon ?? "⚡"}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm">{pkg.name}</span>
                      <Badge variant="secondary" className="text-xs">Tier {pkg.tier}</Badge>
                      {pkg.badge && <Badge className={`text-xs border-0 ${pkg.badge === "Popular" ? "bg-purple-500/20 text-purple-400" : pkg.badge === "Best Value" ? "bg-pink-500/20 text-pink-400" : "bg-emerald-500/20 text-emerald-400"}`}>{pkg.badge}</Badge>}
                      {pkg.isAutoMining && <Badge className="text-xs bg-blue-500/20 text-blue-400 border-0">Auto</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground truncate mt-0.5">{pkg.description}</p>
                    <div className="flex gap-3 text-xs text-muted-foreground mt-1">
                      {pkg.coinCost && <span className="text-primary font-medium">{pkg.coinCost.toLocaleString()} coins</span>}
                      {pkg.usdtCost && <span className="text-amber-500 font-medium">${pkg.usdtCost} USDT</span>}
                      <span>+{pkg.hashRateBoost}% speed</span>
                      <span>Cap: {pkg.dailyCapBoost}</span>
                    </div>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Button size="sm" variant="ghost" onClick={() => setEditingPkg({ ...pkg })} className="h-8 w-8 p-0">
                      <Pencil className="w-3.5 h-3.5" />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setDeletingId(pkg.id)} className="h-8 w-8 p-0 text-destructive hover:text-destructive">
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>}

      {/* Delete Confirm modal — always rendered so it stays visible when switching sub-tabs */}
      {deletingId && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-card border border-card-border rounded-2xl p-6 max-w-sm w-full space-y-4">
            <h3 className="font-semibold">Delete Package?</h3>
            <p className="text-sm text-muted-foreground">This will permanently remove the package. Users who already own it keep their upgrade.</p>
            <div className="flex gap-2">
              <Button variant="destructive" className="flex-1" onClick={confirmDelete}>Delete</Button>
              <Button variant="ghost" className="flex-1" onClick={() => setDeletingId(null)}>Cancel</Button>
            </div>
          </div>
        </div>
      )}

      {/* Approve / Reject Upgrades sub-tab */}
      {activeSubTab === "approve-reject" && <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold">USDT Upgrade Payments</h3>
          <Button size="sm" variant="ghost" onClick={load} className="gap-1.5 text-xs">Refresh</Button>
        </div>
        {payments.length === 0 && (
          <p className="text-muted-foreground text-sm text-center py-6">No USDT upgrade payment submissions yet</p>
        )}
        <div className="space-y-2">
          {payments.map(p => {
            const isPending = p.status === "pending" || p.status === "awaiting_verification";
            const isApproved = p.status === "completed";
            const isRejected = p.status === "rejected";
            return (
              <div
                key={p.transactionId}
                className={`bg-card rounded-xl p-4 border ${isApproved ? "border-emerald-500/30" : isRejected ? "border-destructive/30" : isPending ? "border-amber-500/30" : "border-card-border"}`}
              >
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm">{p.username}</span>
                      <span className="text-xs text-muted-foreground">{p.email}</span>
                      <Badge className={`text-xs border-0 ${isApproved ? "bg-emerald-500/20 text-emerald-400" : isRejected ? "bg-destructive/20 text-destructive" : "bg-amber-500/20 text-amber-400"}`}>
                        {p.status === "awaiting_verification" ? "Sent by user" : p.status}
                      </Badge>
                    </div>
                    <p className="text-sm font-medium">{p.upgradeName}</p>
                    <div className="flex gap-3 text-xs text-muted-foreground flex-wrap">
                      <span className="font-bold text-emerald-400">${p.amount.toFixed(2)} USDT</span>
                      <span>Tag: <code className="bg-muted px-1 rounded">{p.paymentTag}</code></span>
                      <span>{fmt(p.createdAt)}</span>
                    </div>
                    {p.adminNote && (
                      <p className="text-xs text-muted-foreground mt-1">Admin note: <em>{p.adminNote}</em></p>
                    )}
                  </div>
                  {isPending && (
                    <div className="flex gap-2 shrink-0">
                      <Button
                        size="sm"
                        className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1"
                        disabled={processingId === p.transactionId}
                        onClick={() => { setDecisionNote(""); setDecisionModal({ txnId: p.transactionId, action: "approve", upgradeName: p.upgradeName }); }}
                      >
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        disabled={processingId === p.transactionId}
                        onClick={() => { setDecisionNote(""); setDecisionModal({ txnId: p.transactionId, action: "reject", upgradeName: p.upgradeName }); }}
                      >
                        Reject
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>}

      {/* Decision Modal — always rendered so it stays visible regardless of sub-tab */}
      {decisionModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-card border border-card-border rounded-2xl p-6 max-w-sm w-full space-y-4">
            <h3 className="font-semibold">
              {decisionModal.action === "approve" ? "✅ Approve Payment" : "❌ Reject Payment"}
            </h3>
            <p className="text-sm text-muted-foreground">
              {decisionModal.action === "approve"
                ? `This will activate the "${decisionModal.upgradeName}" upgrade and notify the user.`
                : `This will reject the payment for "${decisionModal.upgradeName}" and notify the user.`}
            </p>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">
                {decisionModal.action === "approve" ? "Note for user (optional)" : "Reason for rejection (recommended)"}
              </label>
              <Input
                value={decisionNote}
                onChange={e => setDecisionNote(e.target.value)}
                placeholder={decisionModal.action === "approve" ? "e.g. Payment verified successfully" : "e.g. Payment not received"}
              />
            </div>
            <div className="flex gap-2">
              {decisionModal.action === "approve" ? (
                <Button className="flex-1 bg-emerald-600 hover:bg-emerald-700" onClick={handleDecision} disabled={!!processingId}>
                  Approve & Activate
                </Button>
              ) : (
                <Button variant="destructive" className="flex-1" onClick={handleDecision} disabled={!!processingId}>
                  Reject Payment
                </Button>
              )}
              <Button variant="ghost" className="flex-1" onClick={() => setDecisionModal(null)}>Cancel</Button>
            </div>
          </div>
        </div>
      )}

      {/* Upgrades History sub-tab */}
      {activeSubTab === "history" && <div>
        <h3 className="font-semibold mb-3">Coin Purchase History</h3>
        {purchases.length === 0 && <p className="text-muted-foreground text-sm text-center py-6">No coin upgrade purchases yet</p>}
        <div className="space-y-2">
          {purchases.map(u => (
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
        </div>
      </div>}
    </div>
  );
}

// ─── Settings Tab ────────────────────────────────────────────────────────────

function Toggle({ on, onChange, danger, disabled }: { on: boolean; onChange: (v: boolean) => void; danger?: boolean; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={() => { if (!disabled) onChange(!on); }}
      disabled={disabled}
      className={`relative w-10 h-6 rounded-full transition-colors flex-shrink-0 ${on ? (danger ? "bg-red-500" : "bg-purple-600") : "bg-muted"} ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
    >
      <span className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform ${on ? "translate-x-4" : ""}`} />
    </button>
  );
}

function SettingsTab({ secret }: { secret: string }) {
  const { toast } = useToast();
  const h = useMemo(() => ({ "x-admin-secret": secret, "Content-Type": "application/json" }), [secret]);

  const DEFAULTS: Settings = {
    min_withdrawal_usdt: "5",
    referral_bonus_coins: "250",
    referral_commission_pct: "7",
    maintenance_mode: "false",
    global_base_coins_per_hour: "0.5",
    session_duration_hours: "12",
    referral_disabled: "false",
    mining_disabled: "false",
    ludo_platform_fee_pct: "10",
    ludo_win_pct: "90",
    ludo_min_fee: "10",
    ludo_max_fee: "10000",
    ludo_solo_fee: "100",
    ludo_solo_enabled: "true",
    ludo_timeout_minutes: "5",
    whot_platform_fee_pct: "10",
    whot_win_pct: "90",
    whot_min_fee: "10",
    whot_max_fee: "10000",
    whot_solo_fee: "100",
    whot_solo_enabled: "true",
    whot_timeout_minutes: "5",
    withdrawal_ticker_enabled: "true",
    voice_chat_enabled: "true",
    auto_miner_interval_minutes: "15",
  };

  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [savedKeys, setSavedKeys] = useState<Record<string, boolean>>({});
  // Change-password state
  const [newPw, setNewPw] = useState("");
  const [savingPw, setSavingPw] = useState(false);
  // USDT wallet address state
  const [usdtAddress, setUsdtAddress] = useState("");
  const [usdtAddressSaving, setUsdtAddressSaving] = useState(false);
  // 2FA state
  const [twoFAEnabled, setTwoFAEnabled] = useState(false);
  const [twoFALoading, setTwoFALoading] = useState(true);
  const [showSetup2FA, setShowSetup2FA] = useState(false);
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState("");
  const [totpSetupSecret, setTotpSetupSecret] = useState("");
  const [totpConfirmCode, setTotpConfirmCode] = useState("");
  const [enabling2FA, setEnabling2FA] = useState(false);
  const [disableCode, setDisableCode] = useState("");
  const [disabling2FA, setDisabling2FA] = useState(false);
  // SMTP state
  const [smtp, setSmtp] = useState({ host: "", port: "587", user: "", pass: "", from: "" });
  const [savingSmtp, setSavingSmtp] = useState(false);

  useEffect(() => {
    apiFetch("/admin/settings", { headers: h })
      .then(r => { if (!r.ok) throw new Error(); return r.json(); })
      .then((data: Partial<Settings>) => { setSettings(prev => ({ ...prev, ...data })); setLoading(false); })
      .catch(() => { toast({ variant: "destructive", title: "Failed to load settings" }); setLoading(false); });
    apiFetch("/admin/config", { headers: h })
      .then(r => r.ok ? r.json() : {})
      .then((data: Record<string, string>) => {
        if (data.usdt_wallet_address) setUsdtAddress(data.usdt_wallet_address);
        setSmtp({
          host: data.smtp_host ?? "",
          port: data.smtp_port ?? "587",
          user: data.smtp_user ?? "",
          pass: data.smtp_pass ?? "",
          from: data.smtp_from ?? "",
        });
      })
      .catch(() => {});
    apiFetch("/admin/2fa/status")
      .then(r => r.ok ? r.json() : { enabled: false })
      .then((data: { enabled: boolean }) => { setTwoFAEnabled(data.enabled); setTwoFALoading(false); })
      .catch(() => setTwoFALoading(false));
  }, [h, toast]);

  const handleSaveUsdtAddress = async () => {
    setUsdtAddressSaving(true);
    try {
      const res = await apiFetch("/admin/config", { method: "POST", headers: h, body: JSON.stringify({ key: "usdt_wallet_address", value: usdtAddress }) });
      if (res.ok) toast({ title: "USDT address saved!" });
      else toast({ variant: "destructive", title: "Failed to save address" });
    } catch { toast({ variant: "destructive", title: "Connection error" }); }
    finally { setUsdtAddressSaving(false); }
  };

  const saveSetting = async (key: keyof Settings, value: string) => {
    setSaving(p => ({ ...p, [key]: true }));
    setSavedKeys(p => ({ ...p, [key]: false }));
    try {
      const res = await apiFetch("/admin/settings", { method: "PUT", headers: h, body: JSON.stringify({ [key]: value }) });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error ?? "Failed"); }
      setSettings(p => ({ ...p, [key]: value }));
      setSavedKeys(p => ({ ...p, [key]: true }));
      setTimeout(() => setSavedKeys(p => ({ ...p, [key]: false })), 2000);
    } catch (e: unknown) {
      toast({ variant: "destructive", title: e instanceof Error ? e.message : "Failed to save" });
    } finally {
      setSaving(p => ({ ...p, [key]: false }));
    }
  };

  const handleSavePw = async () => {
    if (!newPw.trim()) { toast({ variant: "destructive", title: "Password cannot be empty" }); return; }
    setSavingPw(true);
    try {
      const res = await apiFetch("/admin/change-password", { method: "POST", headers: h, body: JSON.stringify({ newPassword: newPw }) });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error ?? "Failed"); }
      toast({ title: "Password changed" });
      setNewPw("");
    } catch (e: unknown) {
      toast({ variant: "destructive", title: e instanceof Error ? e.message : "Failed" });
    } finally {
      setSavingPw(false); }
  };

  const handleSetup2FA = async () => {
    const res = await apiFetch("/admin/2fa/setup", { method: "POST", headers: h, body: JSON.stringify({ secret }) });
    if (!res.ok) { toast({ variant: "destructive", title: "Failed to generate 2FA" }); return; }
    const data = await res.json();
    setQrCodeDataUrl(data.qrCodeDataUrl);
    setTotpSetupSecret(data.secret);
    setShowSetup2FA(true);
    setTotpConfirmCode("");
  };

  const handleEnable2FA = async () => {
    if (!totpConfirmCode.trim()) { toast({ variant: "destructive", title: "Enter the 6-digit code" }); return; }
    setEnabling2FA(true);
    try {
      const res = await apiFetch("/admin/2fa/enable", { method: "POST", headers: h, body: JSON.stringify({ secret, totpSecret: totpSetupSecret, totpCode: totpConfirmCode }) });
      const data = await res.json();
      if (!res.ok) { toast({ variant: "destructive", title: data.error ?? "Failed to enable 2FA" }); return; }
      setTwoFAEnabled(true);
      setShowSetup2FA(false);
      setQrCodeDataUrl("");
      setTotpSetupSecret("");
      setTotpConfirmCode("");
      toast({ title: "2FA enabled!", description: "You'll need your authenticator app to log in next time." });
    } catch { toast({ variant: "destructive", title: "Connection error" }); }
    finally { setEnabling2FA(false); }
  };

  const handleDisable2FA = async () => {
    if (!disableCode.trim()) { toast({ variant: "destructive", title: "Enter your current 2FA code" }); return; }
    setDisabling2FA(true);
    try {
      const res = await apiFetch("/admin/2fa/disable", { method: "POST", headers: h, body: JSON.stringify({ secret, totpCode: disableCode }) });
      const data = await res.json();
      if (!res.ok) { toast({ variant: "destructive", title: data.error ?? "Failed to disable 2FA" }); return; }
      setTwoFAEnabled(false);
      setDisableCode("");
      toast({ title: "2FA disabled" });
    } catch { toast({ variant: "destructive", title: "Connection error" }); }
    finally { setDisabling2FA(false); }
  };

  const handleSaveSmtp = async () => {
    setSavingSmtp(true);
    try {
      const fields = [
        { key: "smtp_host", value: smtp.host },
        { key: "smtp_port", value: smtp.port },
        { key: "smtp_user", value: smtp.user },
        { key: "smtp_pass", value: smtp.pass },
        { key: "smtp_from", value: smtp.from },
      ];
      for (const f of fields) {
        await apiFetch("/admin/config", { method: "POST", headers: h, body: JSON.stringify(f) });
      }
      toast({ title: "SMTP settings saved!", description: "Verification emails will now be sent via your SMTP server." });
    } catch { toast({ variant: "destructive", title: "Connection error" }); }
    finally { setSavingSmtp(false); }
  };

  if (loading) return <p className="text-muted-foreground text-sm py-8 text-center">Loading settings…</p>;

  const isSaving = (key: keyof Settings) => saving[key] === true;
  const isSaved = (key: keyof Settings) => savedKeys[key] === true;
  const SaveBtn = ({ k }: { k: keyof Settings }) => (
    <Button size="sm" disabled={isSaving(k)} onClick={() => saveSetting(k, settings[k])}
      className={isSaved(k) ? "bg-green-600 hover:bg-green-600 text-white" : ""}>
      {isSaving(k) ? "Saving…" : isSaved(k) ? "Saved ✓" : "Save"}
    </Button>
  );

  return (
    <div className="max-w-lg space-y-5">

      {/* ── App Display ── */}
      <div className="bg-card border border-card-border rounded-2xl p-5 space-y-4">
        <h3 className="font-semibold text-sm text-purple-400">App Display</h3>

        {/* Withdrawal ticker toggle */}
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium">Withdrawal ticker</p>
            <p className="text-xs text-muted-foreground">
              {settings.withdrawal_ticker_enabled === "false"
                ? "Hidden — ticker is not shown to users"
                : "Visible — scrolling withdrawal banner shown at the bottom"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {isSaving("withdrawal_ticker_enabled") && <span className="text-xs text-muted-foreground">Saving…</span>}
            {isSaved("withdrawal_ticker_enabled") && <span className="text-xs text-green-400">Saved ✓</span>}
            <Toggle
              on={settings.withdrawal_ticker_enabled !== "false"}
              disabled={isSaving("withdrawal_ticker_enabled")}
              onChange={v => saveSetting("withdrawal_ticker_enabled", v ? "true" : "false")}
            />
          </div>
        </div>

        {/* Voice chat button toggle */}
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium">Voice chat in games</p>
            <p className="text-xs text-muted-foreground">
              {settings.voice_chat_enabled === "false"
                ? "Disabled — voice button hidden from all game screens"
                : "Enabled — players can start voice chat during live games"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {isSaving("voice_chat_enabled") && <span className="text-xs text-muted-foreground">Saving…</span>}
            {isSaved("voice_chat_enabled") && <span className="text-xs text-green-400">Saved ✓</span>}
            <Toggle
              on={settings.voice_chat_enabled !== "false"}
              disabled={isSaving("voice_chat_enabled")}
              onChange={v => saveSetting("voice_chat_enabled", v ? "true" : "false")}
            />
          </div>
        </div>
      </div>

      {/* ── USDT Wallet Address ── */}
      <div className="bg-card border border-card-border rounded-2xl p-5 space-y-4">
        <h3 className="font-semibold text-sm text-purple-400">USDT Wallet Address (TRC20)</h3>
        <p className="text-xs text-muted-foreground">This address is shown to users when they pay for upgrades via USDT.</p>
        <div className="flex gap-2">
          <Input
            placeholder="T… (TRC20 wallet address)"
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

      {/* ── Mining ── */}
      <div className="bg-card border border-card-border rounded-2xl p-5 space-y-4">
        <h3 className="font-semibold text-sm text-purple-400">Mining</h3>

        {/* Mining enabled/disabled toggle */}
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium">Mining system</p>
            <p className="text-xs text-muted-foreground">
              {settings.mining_disabled === "true" ? "Mining is OFF — users cannot start sessions" : "Mining is ON — users can start sessions normally"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {isSaving("mining_disabled") && <span className="text-xs text-muted-foreground">Saving…</span>}
            {isSaved("mining_disabled") && <span className="text-xs text-green-400">Saved ✓</span>}
            <Toggle
              on={settings.mining_disabled !== "true"}
              danger={false}
              disabled={isSaving("mining_disabled")}
              onChange={v => saveSetting("mining_disabled", v ? "false" : "true")}
            />
          </div>
        </div>

        {/* Global mining rate */}
        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground font-medium">Global base rate (coins / hour)</label>
          <div className="flex gap-2">
            <Input
              type="number" step="0.01" min="0"
              value={settings.global_base_coins_per_hour}
              onChange={e => setSettings(p => ({ ...p, global_base_coins_per_hour: e.target.value }))}
            />
            <SaveBtn k="global_base_coins_per_hour" />
          </div>
          <p className="text-xs text-muted-foreground">≈ ${(parseFloat(settings.global_base_coins_per_hour || "0") / 1000 * 12).toFixed(4)} USDT per 12-hour session</p>
        </div>

        {/* Session duration */}
        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground font-medium">Session duration (hours)</label>
          <div className="flex gap-2">
            <Input
              type="number" step="1" min="1"
              value={settings.session_duration_hours}
              onChange={e => setSettings(p => ({ ...p, session_duration_hours: e.target.value }))}
            />
            <SaveBtn k="session_duration_hours" />
          </div>
          <p className="text-xs text-muted-foreground">Only applies to new sessions — active sessions are unaffected</p>
        </div>

        {/* Auto-miner interval */}
        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground font-medium">Auto-miner check interval (minutes)</label>
          <div className="flex gap-2">
            <Input
              type="number" step="1" min="1" max="1440"
              value={settings.auto_miner_interval_minutes}
              onChange={e => setSettings(p => ({ ...p, auto_miner_interval_minutes: e.target.value }))}
            />
            <SaveBtn k="auto_miner_interval_minutes" />
          </div>
          <p className="text-xs text-muted-foreground">
            How often the server checks and auto-restarts sessions for Auto Miner Pro users (1–1440 min).
            Increase this if the server is under heavy load.
          </p>
        </div>
      </div>

      {/* ── Referrals ── */}
      <div className="bg-card border border-card-border rounded-2xl p-5 space-y-4">
        <h3 className="font-semibold text-sm text-purple-400">Referrals</h3>

        {/* Referral enabled/disabled toggle */}
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium">Referral system</p>
            <p className="text-xs text-muted-foreground">
              {settings.referral_disabled === "true" ? "Referrals are OFF — no bonuses or commissions paid" : "Referrals are ON — bonuses and commissions active"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {isSaving("referral_disabled") && <span className="text-xs text-muted-foreground">Saving…</span>}
            {isSaved("referral_disabled") && <span className="text-xs text-green-400">Saved ✓</span>}
            <Toggle
              on={settings.referral_disabled !== "true"}
              disabled={isSaving("referral_disabled")}
              onChange={v => saveSetting("referral_disabled", v ? "false" : "true")}
            />
          </div>
        </div>

        {/* Referral bonus coins */}
        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground font-medium">Bonus coins per referral</label>
          <div className="flex gap-2">
            <Input
              type="number" step="1" min="0"
              value={settings.referral_bonus_coins}
              onChange={e => setSettings(p => ({ ...p, referral_bonus_coins: e.target.value }))}
            />
            <SaveBtn k="referral_bonus_coins" />
          </div>
          <p className="text-xs text-muted-foreground">≈ ${(parseFloat(settings.referral_bonus_coins || "0") / 1000).toFixed(3)} USDT</p>
        </div>

        {/* Referral commission */}
        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground font-medium">Commission rate (%)</label>
          <div className="flex gap-2">
            <Input
              type="number" step="0.1" min="0" max="100"
              value={settings.referral_commission_pct}
              onChange={e => setSettings(p => ({ ...p, referral_commission_pct: e.target.value }))}
            />
            <SaveBtn k="referral_commission_pct" />
          </div>
          <p className="text-xs text-muted-foreground">Referrer earns this % of their referral's mining coins</p>
        </div>
      </div>

      {/* ── Ludo ── */}
      <div className="bg-card border border-card-border rounded-2xl p-5 space-y-4">
        <h3 className="font-semibold text-sm text-purple-400">Ludo Game</h3>

        {/* Solo mode toggle */}
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium">Solo vs Bot</p>
            <p className="text-xs text-muted-foreground">
              {settings.ludo_solo_enabled === "true" ? "Solo mode is ON — players can challenge the AI bot" : "Solo mode is OFF"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {isSaving("ludo_solo_enabled") && <span className="text-xs text-muted-foreground">Saving…</span>}
            {isSaved("ludo_solo_enabled") && <span className="text-xs text-green-400">Saved ✓</span>}
            <Toggle
              on={settings.ludo_solo_enabled === "true"}
              disabled={isSaving("ludo_solo_enabled")}
              onChange={v => saveSetting("ludo_solo_enabled", v ? "true" : "false")}
            />
          </div>
        </div>

        {/* Platform fee */}
        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground font-medium">Platform fee (%)</label>
          <div className="flex gap-2">
            <Input
              type="number" step="1" min="0" max="99"
              value={settings.ludo_platform_fee_pct}
              onChange={e => setSettings(p => ({ ...p, ludo_platform_fee_pct: e.target.value }))}
            />
            <SaveBtn k="ludo_platform_fee_pct" />
          </div>
          <p className="text-xs text-muted-foreground">Deducted from the pot — winner gets {100 - parseFloat(settings.ludo_platform_fee_pct || "10")}%</p>
        </div>

        {/* Win pct (derived display only) */}
        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground font-medium">Winner payout (%)</label>
          <div className="flex gap-2">
            <Input
              type="number" step="1" min="1" max="100"
              value={settings.ludo_win_pct}
              onChange={e => setSettings(p => ({ ...p, ludo_win_pct: e.target.value }))}
            />
            <SaveBtn k="ludo_win_pct" />
          </div>
          <p className="text-xs text-muted-foreground">Should equal 100 − platform fee</p>
        </div>

        {/* Min/Max entry fee */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground font-medium">Min entry fee (coins)</label>
            <div className="flex gap-2">
              <Input
                type="number" step="1" min="1"
                value={settings.ludo_min_fee}
                onChange={e => setSettings(p => ({ ...p, ludo_min_fee: e.target.value }))}
              />
              <SaveBtn k="ludo_min_fee" />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground font-medium">Max entry fee (coins)</label>
            <div className="flex gap-2">
              <Input
                type="number" step="100" min="1"
                value={settings.ludo_max_fee}
                onChange={e => setSettings(p => ({ ...p, ludo_max_fee: e.target.value }))}
              />
              <SaveBtn k="ludo_max_fee" />
            </div>
          </div>
        </div>

        {/* Solo entry fee */}
        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground font-medium">Default solo entry fee (coins)</label>
          <div className="flex gap-2">
            <Input
              type="number" step="10" min="1"
              value={settings.ludo_solo_fee}
              onChange={e => setSettings(p => ({ ...p, ludo_solo_fee: e.target.value }))}
            />
            <SaveBtn k="ludo_solo_fee" />
          </div>
          <p className="text-xs text-muted-foreground">Pre-filled amount when starting a solo game</p>
        </div>

        {/* Timeout */}
        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground font-medium">Inactivity timeout (minutes)</label>
          <div className="flex gap-2">
            <Input
              type="number" step="1" min="1"
              value={settings.ludo_timeout_minutes}
              onChange={e => setSettings(p => ({ ...p, ludo_timeout_minutes: e.target.value }))}
            />
            <SaveBtn k="ludo_timeout_minutes" />
          </div>
          <p className="text-xs text-muted-foreground">Games idle longer than this are auto-forfeited</p>
        </div>
      </div>

      {/* ── WHOT Settings ── */}
      <div className="bg-card border border-card-border rounded-2xl p-5 space-y-4">
        <h3 className="font-semibold text-sm text-pink-400">WHOT Card Game</h3>

        {/* Solo mode toggle */}
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium">Solo vs Bot</p>
            <p className="text-xs text-muted-foreground">
              {settings.whot_solo_enabled === "true" ? "Solo mode is ON — players can challenge the AI bot" : "Solo mode is OFF"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {isSaving("whot_solo_enabled") && <span className="text-xs text-muted-foreground">Saving…</span>}
            {isSaved("whot_solo_enabled") && <span className="text-xs text-green-400">Saved ✓</span>}
            <Toggle
              on={settings.whot_solo_enabled === "true"}
              disabled={isSaving("whot_solo_enabled")}
              onChange={v => saveSetting("whot_solo_enabled", v ? "true" : "false")}
            />
          </div>
        </div>

        {/* Platform fee */}
        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground font-medium">Platform fee (%)</label>
          <div className="flex gap-2">
            <Input
              type="number" step="1" min="0" max="99"
              value={settings.whot_platform_fee_pct}
              onChange={e => setSettings(p => ({ ...p, whot_platform_fee_pct: e.target.value }))}
            />
            <SaveBtn k="whot_platform_fee_pct" />
          </div>
          <p className="text-xs text-muted-foreground">Deducted from the pot — winner gets {100 - parseFloat(settings.whot_platform_fee_pct || "10")}%</p>
        </div>

        {/* Win pct */}
        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground font-medium">Winner payout (%)</label>
          <div className="flex gap-2">
            <Input
              type="number" step="1" min="1" max="100"
              value={settings.whot_win_pct}
              onChange={e => setSettings(p => ({ ...p, whot_win_pct: e.target.value }))}
            />
            <SaveBtn k="whot_win_pct" />
          </div>
          <p className="text-xs text-muted-foreground">Should equal 100 − platform fee</p>
        </div>

        {/* Min/Max entry fee */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground font-medium">Min entry fee (coins)</label>
            <div className="flex gap-2">
              <Input
                type="number" step="1" min="1"
                value={settings.whot_min_fee}
                onChange={e => setSettings(p => ({ ...p, whot_min_fee: e.target.value }))}
              />
              <SaveBtn k="whot_min_fee" />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground font-medium">Max entry fee (coins)</label>
            <div className="flex gap-2">
              <Input
                type="number" step="100" min="1"
                value={settings.whot_max_fee}
                onChange={e => setSettings(p => ({ ...p, whot_max_fee: e.target.value }))}
              />
              <SaveBtn k="whot_max_fee" />
            </div>
          </div>
        </div>

        {/* Solo entry fee */}
        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground font-medium">Default solo entry fee (coins)</label>
          <div className="flex gap-2">
            <Input
              type="number" step="10" min="1"
              value={settings.whot_solo_fee}
              onChange={e => setSettings(p => ({ ...p, whot_solo_fee: e.target.value }))}
            />
            <SaveBtn k="whot_solo_fee" />
          </div>
          <p className="text-xs text-muted-foreground">Pre-filled when starting a solo WHOT game</p>
        </div>

        {/* Timeout */}
        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground font-medium">Inactivity timeout (minutes)</label>
          <div className="flex gap-2">
            <Input
              type="number" step="1" min="1"
              value={settings.whot_timeout_minutes}
              onChange={e => setSettings(p => ({ ...p, whot_timeout_minutes: e.target.value }))}
            />
            <SaveBtn k="whot_timeout_minutes" />
          </div>
          <p className="text-xs text-muted-foreground">Games idle longer than this are auto-forfeited</p>
        </div>
      </div>

      {/* ── Economy ── */}
      <div className="bg-card border border-card-border rounded-2xl p-5 space-y-4">
        <h3 className="font-semibold text-sm text-purple-400">Economy</h3>
        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground font-medium">Minimum withdrawal (USDT)</label>
          <div className="flex gap-2">
            <Input
              type="number" step="0.5" min="0"
              value={settings.min_withdrawal_usdt}
              onChange={e => setSettings(p => ({ ...p, min_withdrawal_usdt: e.target.value }))}
            />
            <SaveBtn k="min_withdrawal_usdt" />
          </div>
          <p className="text-xs text-muted-foreground">≈ {Math.round(parseFloat(settings.min_withdrawal_usdt || "0") * 1000).toLocaleString()} coins</p>
        </div>
      </div>

      {/* ── System ── */}
      <div className="bg-card border border-card-border rounded-2xl p-5 space-y-4">
        <h3 className="font-semibold text-sm text-purple-400">System</h3>

        {/* Maintenance mode */}
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium">Maintenance mode</p>
            <p className="text-xs text-muted-foreground">
              {settings.maintenance_mode === "true" ? "Site is in maintenance — new sessions blocked" : "Site is live and operating normally"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {isSaving("maintenance_mode") && <span className="text-xs text-muted-foreground">Saving…</span>}
            {isSaved("maintenance_mode") && <span className="text-xs text-green-400">Saved ✓</span>}
            <Toggle
              on={settings.maintenance_mode === "true"}
              danger
              disabled={isSaving("maintenance_mode")}
              onChange={v => saveSetting("maintenance_mode", v ? "true" : "false")}
            />
          </div>
        </div>

        {/* Change password */}
        <div className="border-t border-card-border pt-4 space-y-1.5">
          <label className="text-xs text-muted-foreground font-medium">Change admin password</label>
          <div className="flex gap-2">
            <Input
              type="password"
              placeholder="New password (min 8 chars)"
              value={newPw}
              onChange={e => setNewPw(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") handleSavePw(); }}
            />
            <Button size="sm" disabled={savingPw} onClick={handleSavePw}>
              {savingPw ? "…" : "Save"}
            </Button>
          </div>
        </div>
      </div>

      {/* ── Two-Factor Authentication ── */}
      <div className="bg-card border border-card-border rounded-2xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-sm text-purple-400">Two-Factor Authentication (2FA)</h3>
          {!twoFALoading && (
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${twoFAEnabled ? "bg-emerald-500/15 text-emerald-400" : "bg-muted text-muted-foreground"}`}>
              {twoFAEnabled ? "Enabled" : "Disabled"}
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Add an extra layer of security. When enabled, you'll need a 6-digit code from your authenticator app (e.g. Google Authenticator) every time you log in.
        </p>
        {twoFALoading ? (
          <div className="h-8 bg-muted rounded animate-pulse" />
        ) : !twoFAEnabled ? (
          showSetup2FA ? (
            <div className="space-y-4">
              <div className="space-y-2">
                <p className="text-xs font-medium">Scan this QR code with your authenticator app:</p>
                {qrCodeDataUrl && <img src={qrCodeDataUrl} alt="2FA QR Code" className="w-48 h-48 rounded-xl border border-card-border bg-white p-2" />}
                <p className="text-xs text-muted-foreground">Or enter the key manually: <code className="font-mono text-primary text-xs bg-primary/10 px-1 rounded">{totpSetupSecret}</code></p>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground font-medium">Enter the 6-digit code from your app to confirm:</label>
                <div className="flex gap-2">
                  <Input type="text" inputMode="numeric" maxLength={6} placeholder="000000"
                    value={totpConfirmCode} onChange={e => setTotpConfirmCode(e.target.value.replace(/\D/g,"").slice(0,6))}
                    onKeyDown={e => { if (e.key === "Enter") handleEnable2FA(); }}
                    className="font-mono tracking-widest text-center" />
                  <Button size="sm" onClick={handleEnable2FA} disabled={enabling2FA || totpConfirmCode.length < 6}>
                    {enabling2FA ? "Verifying…" : "Activate"}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => { setShowSetup2FA(false); setQrCodeDataUrl(""); setTotpSetupSecret(""); }}>Cancel</Button>
                </div>
              </div>
            </div>
          ) : (
            <Button size="sm" variant="outline" onClick={handleSetup2FA} className="gap-1.5">
              <KeyRound className="w-3.5 h-3.5" /> Set Up 2FA
            </Button>
          )
        ) : (
          <div className="space-y-3">
            <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-3">
              <p className="text-xs text-emerald-400 font-medium">2FA is active. Your admin panel is protected.</p>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground font-medium">Enter your current 2FA code to disable:</label>
              <div className="flex gap-2">
                <Input type="text" inputMode="numeric" maxLength={6} placeholder="000000"
                  value={disableCode} onChange={e => setDisableCode(e.target.value.replace(/\D/g,"").slice(0,6))}
                  className="font-mono tracking-widest text-center" />
                <Button size="sm" variant="destructive" onClick={handleDisable2FA} disabled={disabling2FA || disableCode.length < 6}>
                  {disabling2FA ? "…" : "Disable 2FA"}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Email / SMTP ── */}
      <div className="bg-card border border-card-border rounded-2xl p-5 space-y-4">
        <h3 className="font-semibold text-sm text-purple-400">Email / SMTP</h3>
        <p className="text-xs text-muted-foreground">Configure SMTP to send real email verification messages. Leave blank to skip sending (verification links log to console in dev mode).</p>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">SMTP Host</label>
            <Input placeholder="smtp.gmail.com" value={smtp.host} onChange={e => setSmtp(p => ({ ...p, host: e.target.value }))} />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Port</label>
            <Input placeholder="587" value={smtp.port} onChange={e => setSmtp(p => ({ ...p, port: e.target.value }))} />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Username</label>
            <Input placeholder="you@gmail.com" value={smtp.user} onChange={e => setSmtp(p => ({ ...p, user: e.target.value }))} />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Password / App key</label>
            <Input type="password" placeholder="••••••••" value={smtp.pass} onChange={e => setSmtp(p => ({ ...p, pass: e.target.value }))} />
          </div>
          <div className="col-span-2 space-y-1">
            <label className="text-xs text-muted-foreground">From address (optional)</label>
            <Input placeholder="noreply@minenova.app" value={smtp.from} onChange={e => setSmtp(p => ({ ...p, from: e.target.value }))} />
          </div>
        </div>
        <Button size="sm" disabled={savingSmtp} onClick={handleSaveSmtp} className="gap-1.5">
          <Save className="w-3.5 h-3.5" />
          {savingSmtp ? "Saving…" : "Save SMTP"}
        </Button>
      </div>
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
    try {
      const res = await apiFetch("/admin/share-messages", { headers: { "x-admin-secret": secret, "Content-Type": "application/json" } });
      const data = await res.json();
      setMessages(Array.isArray(data) ? data : []);
    } catch {
      toast({ variant: "destructive", title: "Failed to load messages" });
    } finally {
      setLoading(false);
    }
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

// ─── Ads Tab ─────────────────────────────────────────────────────────────────

const AD_TYPES = [
  { value: "video", label: "Video" },
  { value: "image", label: "Image" },
  { value: "script", label: "Script / Embed" },
  { value: "external_link", label: "External Link (iframe)" },
] as const;

type AdType = "video" | "image" | "script" | "external_link";

const BLANK_AD = {
  title: "",
  type: "video" as AdType,
  urlOrCode: "",
  providerScript: "",
  durationSeconds: 15,
  placement: "boost_2x",
  isActive: true,
};

function AdsTab({ secret }: { secret: string }) {
  const { toast } = useToast();
  const [ads, setAds] = useState<AdminAd[]>([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState({ ...BLANK_AD });
  const [saving, setSaving] = useState(false);
  const headers = { "x-admin-secret": secret, "Content-Type": "application/json" };

  const fetchAds = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch("/admin/ads", { headers: { "x-admin-secret": secret } });
      const data = await res.json();
      setAds(Array.isArray(data) ? data : []);
    } finally {
      setLoading(false);
    }
  }, [secret]);

  useEffect(() => { fetchAds(); }, [fetchAds]);

  const openCreate = () => { setForm({ ...BLANK_AD }); setEditingId(null); setShowForm(true); };
  const openEdit = (ad: AdminAd) => {
    setForm({ title: ad.title, type: ad.type, urlOrCode: ad.urlOrCode ?? "", providerScript: ad.providerScript ?? "", durationSeconds: ad.durationSeconds, placement: ad.placement, isActive: ad.isActive });
    setEditingId(ad.id);
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.title.trim()) { toast({ variant: "destructive", title: "Title is required" }); return; }
    setSaving(true);
    try {
      const body = JSON.stringify({ ...form, durationSeconds: Number(form.durationSeconds) });
      const res = editingId !== null
        ? await apiFetch(`/admin/ads/${editingId}`, { method: "PUT", headers, body })
        : await apiFetch("/admin/ads", { method: "POST", headers, body });
      if (res.ok) {
        toast({ title: editingId !== null ? "Ad updated!" : "Ad created!" });
        setShowForm(false);
        fetchAds();
      } else {
        const err = await res.json();
        toast({ variant: "destructive", title: "Error", description: err.error ?? "Failed to save" });
      }
    } finally { setSaving(false); }
  };

  const handleToggle = async (ad: AdminAd) => {
    const res = await apiFetch(`/admin/ads/${ad.id}`, { method: "PUT", headers, body: JSON.stringify({ isActive: !ad.isActive }) });
    if (res.ok) fetchAds();
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Delete this ad?")) return;
    const res = await apiFetch(`/admin/ads/${id}`, { method: "DELETE", headers });
    if (res.ok) { toast({ title: "Deleted" }); fetchAds(); }
  };

  const urlLabel = form.type === "script" ? "Ad unit code" : "URL";
  const urlPlaceholder = form.type === "script" ? "<ins class='adsbygoogle'>…</ins>" : "https://example.com/ad.mp4";

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-foreground">Ad Management</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Manage ads shown to users before boost activation</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={fetchAds} disabled={loading}><RefreshCw className="w-3.5 h-3.5" /></Button>
          <Button size="sm" className="gap-1.5" onClick={openCreate}><Plus className="w-3.5 h-3.5" /> Add Ad</Button>
        </div>
      </div>

      {/* Info banner */}
      <div className="bg-primary/10 border border-primary/20 rounded-xl p-3 text-xs text-primary flex items-start gap-2">
        <MonitorPlay className="w-3.5 h-3.5 mt-0.5 shrink-0" />
        <span>Ads are shown to users in a countdown modal before a boost is applied. Assign each ad to a specific boost tier using the Placement dropdown. If no active ad is found for a tier, a built-in MineNova promo is shown as a fallback so boosts always require the countdown.</span>
      </div>

      {/* Create / Edit form */}
      {showForm && (
        <div className="bg-card border border-card-border rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-foreground text-sm">{editingId !== null ? "Edit Ad" : "New Ad"}</h3>
            <Button variant="ghost" size="sm" className="w-7 h-7 p-0" onClick={() => setShowForm(false)}><X className="w-3.5 h-3.5" /></Button>
          </div>
          <div className="grid gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Title</label>
              <Input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="Ad title" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Type</label>
                <select
                  value={form.type}
                  onChange={e => setForm(f => ({ ...f, type: e.target.value as AdType }))}
                  className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  {AD_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 flex items-center gap-1"><Clock className="w-3 h-3" /> Duration (seconds)</label>
                <Input
                  type="number"
                  min={1}
                  value={form.durationSeconds}
                  onChange={e => setForm(f => ({ ...f, durationSeconds: parseInt(e.target.value) || 15 }))}
                />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 flex items-center gap-1"><Link className="w-3 h-3" /> {urlLabel}</label>
              {form.type === "script" ? (
                <textarea
                  value={form.urlOrCode}
                  onChange={e => setForm(f => ({ ...f, urlOrCode: e.target.value }))}
                  placeholder={urlPlaceholder}
                  className="w-full text-sm bg-background border border-border rounded-md p-3 resize-none min-h-[100px] font-mono text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                />
              ) : (
                <Input
                  value={form.urlOrCode}
                  onChange={e => setForm(f => ({ ...f, urlOrCode: e.target.value }))}
                  placeholder={urlPlaceholder}
                />
              )}
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Provider script (optional)</label>
              <textarea
                value={form.providerScript}
                onChange={e => setForm(f => ({ ...f, providerScript: e.target.value }))}
                placeholder={`<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-xxxxxxxxxxxxxxxx" crossorigin="anonymous"></script>`}
                className="w-full text-sm bg-background border border-border rounded-md p-3 resize-none min-h-[92px] font-mono text-xs focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Placement (Boost Tier)</label>
              <select
                value={form.placement}
                onChange={e => setForm(f => ({ ...f, placement: e.target.value }))}
                className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="boost_2x">2x Boost (⚡ 2x Speed)</option>
                <option value="boost_3x">3x Boost (🔥 3x Speed)</option>
                <option value="boost_5x">5x Boost (🚀 5x Speed)</option>
              </select>
            </div>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                <input type="checkbox" checked={form.isActive} onChange={e => setForm(f => ({ ...f, isActive: e.target.checked }))} className="w-3.5 h-3.5" />
                Active
              </label>
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <Button className="flex-1 gap-1" onClick={handleSave} disabled={saving}><Save className="w-3.5 h-3.5" /> {saving ? "Saving…" : "Save Ad"}</Button>
            <Button variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
          </div>
        </div>
      )}

      {/* Ads list */}
      {loading ? (
        <div className="text-center py-10 text-muted-foreground text-sm">Loading…</div>
      ) : ads.length === 0 ? (
        <div className="text-center py-10 bg-card border border-card-border rounded-2xl">
          <Film className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground text-sm">No ads yet. Click "Add Ad" to create one.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {ads.map(ad => (
            <div key={ad.id} className="bg-card border border-card-border rounded-xl p-4 flex items-start gap-3">
              <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                {ad.type === "video" && <Play className="w-4 h-4 text-primary" />}
                {ad.type === "image" && <Film className="w-4 h-4 text-primary" />}
                {ad.type === "external_link" && <Link className="w-4 h-4 text-primary" />}
                {ad.type === "script" && <Zap className="w-4 h-4 text-primary" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground truncate">{ad.title}</p>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1">
                      <span className="text-xs text-muted-foreground capitalize">{AD_TYPES.find(t => t.value === ad.type)?.label ?? ad.type}</span>
                      <span className="text-xs text-muted-foreground flex items-center gap-0.5"><Clock className="w-2.5 h-2.5" /> {ad.durationSeconds}s</span>
                      <span className="text-xs text-muted-foreground">
                        {ad.placement === "boost_2x" ? "⚡ 2x Boost" : ad.placement === "boost_3x" ? "🔥 3x Boost" : ad.placement === "boost_5x" ? "🚀 5x Boost" : ad.placement || "—"}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1 truncate max-w-[260px]">{ad.urlOrCode}</p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => handleToggle(ad)}
                      className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${ad.isActive ? "bg-emerald-500/20 text-emerald-500 border-emerald-500/30" : "bg-muted text-muted-foreground border-border"}`}
                    >
                      {ad.isActive ? <><Check className="w-2.5 h-2.5 inline mr-0.5" />Active</> : "Inactive"}
                    </button>
                    <Button size="sm" variant="ghost" className="w-7 h-7 p-0" onClick={() => openEdit(ad)}><Pencil className="w-3 h-3" /></Button>
                    <Button size="sm" variant="ghost" className="w-7 h-7 p-0 text-destructive hover:text-destructive" onClick={() => handleDelete(ad.id)}><Trash2 className="w-3 h-3" /></Button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Scripts Tab ─────────────────────────────────────────────────────────────

function ScriptsTab({ secret }: { secret: string }) {
  const { toast } = useToast();
  const [scripts, setScripts] = useState("");
  const [headTags, setHeadTags] = useState("");
  const [adsTxt, setAdsTxt] = useState("");
  const [loading, setLoading] = useState(true);
  const [savingBody, setSavingBody] = useState(false);
  const [savingHead, setSavingHead] = useState(false);
  const [savingAds, setSavingAds] = useState(false);
  const headers = { "x-admin-secret": secret, "Content-Type": "application/json" };

  useEffect(() => {
    apiFetch("/admin/config", { headers: { "x-admin-secret": secret } })
      .then(r => r.json())
      .then((cfg: Record<string, string>) => {
        setScripts(cfg["body_scripts"] ?? "");
        setHeadTags(cfg["head_meta_tags"] ?? "");
        setAdsTxt(cfg["ads_txt"] ?? "");
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [secret]);

  const saveKey = async (key: string, value: string, setFn: (v: boolean) => void, successMsg: string) => {
    setFn(true);
    try {
      const res = await apiFetch("/admin/config", {
        method: "POST",
        headers,
        body: JSON.stringify({ key, value }),
      });
      if (res.ok) toast({ title: successMsg });
      else toast({ variant: "destructive", title: "Failed to save" });
    } catch {
      toast({ variant: "destructive", title: "Connection error" });
    } finally {
      setFn(false);
    }
  };

  const textareaClass = "w-full rounded-xl border border-card-border bg-card text-sm text-foreground font-mono p-4 resize-y focus:outline-none focus:ring-2 focus:ring-primary/40 placeholder:text-muted-foreground";

  return (
    <div className="space-y-8 max-w-3xl">

      {/* ── Head Verification Tags ── */}
      <div className="space-y-4">
        <div>
          <h2 className="text-lg font-bold">Head Verification Tags</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Paste ad network verification meta tags here (e.g. Google AdSense publisher verification, Media.net, Ezoic). These are injected directly into the HTML <code className="text-xs bg-muted px-1 rounded">&lt;head&gt;</code> at the server level — visible to bots and crawlers without JavaScript.
          </p>
        </div>

        <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-4 flex gap-3">
          <Check className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-emerald-500">Bot-visible injection</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Unlike body scripts, these tags are embedded in the raw HTML response before it reaches any browser or bot. Ad network crawlers will find them immediately.
            </p>
          </div>
        </div>

        {loading ? (
          <div className="h-28 bg-muted rounded-xl animate-pulse" />
        ) : (
          <div className="space-y-3">
            <label className="text-sm font-medium text-foreground">Meta / Link Tags</label>
            <textarea
              value={headTags}
              onChange={e => setHeadTags(e.target.value)}
              placeholder={`<meta name="google-adsense-account" content="ca-pub-XXXXXXXXXXXXXXXX" />\n<meta name="ezoic-site-verification" content="XXXXXXXX" />`}
              rows={6}
              className={textareaClass}
              spellCheck={false}
            />
            <p className="text-xs text-muted-foreground">
              Paste exactly what the ad network gives you. Supports &lt;meta&gt;, &lt;link&gt;, and other head tags. Leave blank to disable.
            </p>
          </div>
        )}

        <div className="flex items-center gap-3">
          <button
            onClick={() => saveKey("head_meta_tags", headTags, setSavingHead, "Head tags saved — visible to crawlers immediately.")}
            disabled={savingHead || loading}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold text-white transition-all disabled:opacity-50"
            style={{ background: "linear-gradient(135deg, #7c3aed, #ec4899)" }}
          >
            <Save className="w-4 h-4" />
            {savingHead ? "Saving…" : "Save Head Tags"}
          </button>
          {!loading && headTags && (
            <button onClick={() => setHeadTags("")} className="text-sm text-muted-foreground hover:text-foreground transition-colors px-3 py-2">Clear</button>
          )}
        </div>
      </div>

      <div className="border-t border-border" />

      {/* ── ads.txt ── */}
      <div className="space-y-4">
        <div>
          <h2 className="text-lg font-bold">ads.txt</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Many ad networks (Google AdSense, Magnite, etc.) verify your domain by checking <code className="text-xs bg-muted px-1 rounded">yourdomain.com/ads.txt</code>. Paste the content they provide and it will be served automatically — no file upload needed.
          </p>
        </div>

        {loading ? (
          <div className="h-28 bg-muted rounded-xl animate-pulse" />
        ) : (
          <div className="space-y-3">
            <label className="text-sm font-medium text-foreground">ads.txt content</label>
            <textarea
              value={adsTxt}
              onChange={e => setAdsTxt(e.target.value)}
              placeholder={`google.com, pub-XXXXXXXXXXXXXXXX, DIRECT, f08c47fec0942fa0\n# Add one line per authorized seller`}
              rows={8}
              className={textareaClass}
              spellCheck={false}
            />
            <p className="text-xs text-muted-foreground">
              Served at <code className="text-xs bg-muted px-1 rounded">yourdomain.com/ads.txt</code> as plain text. Leave blank to return 404 (disabled).
            </p>
          </div>
        )}

        <div className="flex items-center gap-3">
          <button
            onClick={() => saveKey("ads_txt", adsTxt, setSavingAds, "ads.txt saved — available at /ads.txt immediately.")}
            disabled={savingAds || loading}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold text-white transition-all disabled:opacity-50"
            style={{ background: "linear-gradient(135deg, #7c3aed, #ec4899)" }}
          >
            <Save className="w-4 h-4" />
            {savingAds ? "Saving…" : "Save ads.txt"}
          </button>
          {!loading && adsTxt && (
            <button onClick={() => setAdsTxt("")} className="text-sm text-muted-foreground hover:text-foreground transition-colors px-3 py-2">Clear</button>
          )}
        </div>
      </div>

      <div className="border-t border-border" />

      {/* ── Body Scripts ── */}
      <div className="space-y-4">
        <div>
          <h2 className="text-lg font-bold">Body Scripts</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Paste ad platform scripts (e.g. Adsterra, Monetag, pop-under scripts) here. They are injected server-side directly into the HTML response on every page load.
          </p>
        </div>

        <div className="bg-green-500/10 border border-green-500/30 rounded-xl p-4 flex gap-3">
          <Check className="w-4 h-4 text-green-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-green-500">Server-side injection</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Body scripts are injected directly into the HTML response before it reaches the browser — before the closing body tag. They load before any client-side JavaScript runs, making them visible to crawlers and improving load order for analytics and ad scripts.
            </p>
          </div>
        </div>

        {loading ? (
          <div className="h-48 bg-muted rounded-xl animate-pulse" />
        ) : (
          <div className="space-y-3">
            <label className="text-sm font-medium text-foreground">Script HTML</label>
            <textarea
              value={scripts}
              onChange={e => setScripts(e.target.value)}
              placeholder={`<!-- Paste your ad platform script tags here -->\n<script async src="https://example-ad-network.com/script.js"></script>`}
              rows={14}
              className={textareaClass}
              spellCheck={false}
            />
            <p className="text-xs text-muted-foreground">
              Supports any HTML including &lt;script&gt; tags, &lt;noscript&gt; blocks, and inline code. Leave blank to disable.
            </p>
          </div>
        )}

        <div className="flex items-center gap-3">
          <button
            onClick={() => saveKey("body_scripts", scripts, setSavingBody, "Body scripts saved — active on next page load.")}
            disabled={savingBody || loading}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold text-white transition-all disabled:opacity-50"
            style={{ background: "linear-gradient(135deg, #7c3aed, #ec4899)" }}
          >
            <Save className="w-4 h-4" />
            {savingBody ? "Saving…" : "Save Body Scripts"}
          </button>
          {!loading && scripts && (
            <button onClick={() => setScripts("")} className="text-sm text-muted-foreground hover:text-foreground transition-colors px-3 py-2">Clear</button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function Admin() {
  const { toast } = useToast();
  const { theme, toggleTheme } = useTheme();
  const [secret, setSecret] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<Tab>("dashboard");
  const [upgradeSubTab, setUpgradeSubTab] = useState<UpgradeSubTab>("manage");
  const [pendingPaymentsCount, setPendingPaymentsCount] = useState(0);
  const [pendingWithdrawalsCount, setPendingWithdrawalsCount] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [needs2FA, setNeeds2FA] = useState(false);
  const [totpLoginCode, setTotpLoginCode] = useState("");

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
      const statusRes = await apiFetch("/admin/2fa/status");
      const { enabled } = await statusRes.json();
      if (enabled) {
        setNeeds2FA(true);
        setTotpLoginCode("");
      } else {
        setAuthed(true);
      }
    } catch {
      toast({ variant: "destructive", title: "Connection error" });
    } finally {
      setLoading(false);
    }
  };

  const handleTotpLogin = async () => {
    if (totpLoginCode.length < 6) return;
    setLoading(true);
    try {
      const res = await apiFetch("/admin/2fa/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret, totpCode: totpLoginCode }),
      });
      if (res.ok) {
        setAuthed(true);
      } else {
        const data = await res.json();
        toast({ variant: "destructive", title: data.error ?? "Invalid code" });
        setTotpLoginCode("");
      }
    } catch {
      toast({ variant: "destructive", title: "Connection error" });
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    setAuthed(false); setSecret(""); setNeeds2FA(false); setTotpLoginCode(""); setShowChangePassword(false);
    setPendingPaymentsCount(0); setPendingWithdrawalsCount(0); setUpgradeSubTab("manage");
  };

  useEffect(() => {
    if (!authed) return;
    const fetchPending = () => {
      Promise.all([
        apiFetch("/admin/upgrade-payments", { headers: { "x-admin-secret": secret } })
          .then(r => r.json())
          .then(data => {
            if (Array.isArray(data)) {
              const count = (data as UpgradePayment[]).filter(p => p.status === "pending" || p.status === "awaiting_verification").length;
              setPendingPaymentsCount(count);
            }
          })
          .catch(() => {}),
        apiFetch("/admin/withdrawal-stats", { headers: { "x-admin-secret": secret } })
          .then(r => r.json())
          .then((data: WithdrawalStats) => {
            setPendingWithdrawalsCount(data.pendingCount ?? 0);
          })
          .catch(() => {}),
      ]);
    };
    fetchPending();
    const id = setInterval(fetchPending, 60_000);
    return () => clearInterval(id);
  }, [authed, secret]);

  function urlBase64ToUint8Array(base64String: string) {
    const padding = "=".repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
    const rawData = window.atob(base64);
    const output = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) output[i] = rawData.charCodeAt(i);
    return output;
  }

  const handleBellClick = async () => {
    if (pendingWithdrawalsCount >= pendingPaymentsCount && pendingWithdrawalsCount > 0) {
      setTab("withdrawals");
    } else {
      setTab("upgrades");
      setUpgradeSubTab("approve-reject");
    }
    if (!("Notification" in window) || !("serviceWorker" in navigator)) return;
    if (Notification.permission === "denied") return;
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") return;
      const keyRes = await apiFetch("/admin/notifications/vapid-public-key", { headers: { "x-admin-secret": secret } });
      if (!keyRes.ok) return;
      const { publicKey } = await keyRes.json() as { publicKey: string };
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) });
      const p256dh = btoa(String.fromCharCode(...new Uint8Array(sub.getKey("p256dh")!)));
      const auth = btoa(String.fromCharCode(...new Uint8Array(sub.getKey("auth")!)));
      await apiFetch("/admin/notifications/subscribe", {
        method: "POST",
        headers: { "x-admin-secret": secret, "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: sub.endpoint, keys: { p256dh, auth } }),
      });
    } catch { /* silent — push notifications are a best-effort feature */ }
  };

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
        <Button variant="ghost" size="sm" className="absolute top-4 right-4 w-9 h-9 p-0" onClick={toggleTheme}>
          {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </Button>
        <div className="w-full max-w-sm space-y-4">
          {!needs2FA ? (
            <>
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
            </>
          ) : (
            <>
              <div className="text-center">
                <h1 className="text-2xl font-black font-serif text-foreground">Two-Factor Auth</h1>
                <p className="text-muted-foreground text-sm mt-1">Enter the 6-digit code from your authenticator app</p>
              </div>
              <div className="bg-card border border-card-border rounded-2xl p-6 space-y-4">
                <Input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="000000"
                  value={totpLoginCode}
                  onChange={e => setTotpLoginCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  onKeyDown={e => e.key === "Enter" && handleTotpLogin()}
                  className="font-mono tracking-widest text-center text-xl"
                  autoFocus
                />
                <Button className="w-full" onClick={handleTotpLogin} disabled={loading || totpLoginCode.length < 6}>
                  {loading ? "Verifying…" : "Verify"}
                </Button>
                <button onClick={() => { setNeeds2FA(false); setTotpLoginCode(""); }} className="w-full text-xs text-muted-foreground hover:text-foreground text-center mt-1">
                  ← Back to password
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  const TABS: { id: Tab; label: string; icon: LucideIcon }[] = [
    { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
    { id: "users", label: "Users", icon: Users },
    { id: "withdrawals", label: "Withdrawals", icon: Wallet },
    { id: "transactions", label: "Transactions", icon: BarChart3 },
    { id: "mining", label: "Mining Control", icon: Cpu },
    { id: "referrals", label: "Referrals", icon: Share2 },
    { id: "upgrades", label: "Upgrades", icon: Package },
    { id: "settings", label: "Settings", icon: Settings },
    { id: "share", label: "Share Links", icon: ArrowDownCircle },
    { id: "ads", label: "Ads", icon: MonitorPlay },
    { id: "scripts", label: "Scripts", icon: Code },
  ];

  const currentTab = TABS.find(t => t.id === tab);

  return (
    <div className="min-h-screen bg-background flex">
      {/* Left Sidebar */}
      <aside className={`shrink-0 border-r border-border bg-background flex flex-col h-screen sticky top-0 z-20 transition-all duration-200 ${sidebarOpen ? "w-52" : "w-14"}`}>
        {/* Logo / Toggle */}
        <div className="flex items-center justify-between px-3 py-4 border-b border-border">
          {sidebarOpen && <span className="text-sm font-black font-serif truncate">Admin Panel</span>}
          <Button variant="ghost" size="sm" className="w-8 h-8 p-0 shrink-0 ml-auto" onClick={() => setSidebarOpen(v => !v)}>
            {sidebarOpen ? <ChevronLeft className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
          </Button>
        </div>

        {/* Nav items */}
        <nav className="flex-1 overflow-y-auto p-2 space-y-0.5">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              title={!sidebarOpen ? t.label : undefined}
              className={`w-full flex items-center gap-3 px-2.5 py-2.5 rounded-lg text-sm font-medium transition-colors ${tab === t.id ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"} ${!sidebarOpen ? "justify-center" : ""}`}
            >
              <t.icon className="w-4 h-4 shrink-0" />
              {sidebarOpen && <span className="truncate">{t.label}</span>}
            </button>
          ))}
        </nav>

        {/* Footer actions */}
        <div className={`p-2 border-t border-border space-y-0.5 ${!sidebarOpen ? "flex flex-col items-center" : ""}`}>
          <button
            onClick={toggleTheme}
            title={theme === "dark" ? "Light mode" : "Dark mode"}
            className={`flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors w-full ${!sidebarOpen ? "justify-center" : ""}`}
          >
            {theme === "dark" ? <Sun className="w-4 h-4 shrink-0" /> : <Moon className="w-4 h-4 shrink-0" />}
            {sidebarOpen && <span>{theme === "dark" ? "Light Mode" : "Dark Mode"}</span>}
          </button>
          <button
            onClick={() => setShowChangePassword(v => !v)}
            title="Change password"
            className={`flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors w-full ${!sidebarOpen ? "justify-center" : ""}`}
          >
            <KeyRound className="w-4 h-4 shrink-0" />
            {sidebarOpen && <span>Change Password</span>}
          </button>
          <button
            onClick={handleLogout}
            title="Logout"
            className={`flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm text-red-400 hover:bg-red-500/10 transition-colors w-full ${!sidebarOpen ? "justify-center" : ""}`}
          >
            <LogOut className="w-4 h-4 shrink-0" />
            {sidebarOpen && <span>Logout</span>}
          </button>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Top bar */}
        <div className="sticky top-0 z-10 bg-background border-b border-border px-6 py-3 flex items-center gap-3">
          <div className="flex items-center gap-2 flex-1">
            {currentTab && <currentTab.icon className="w-4 h-4 text-primary" />}
            <h2 className="font-bold">{currentTab?.label}</h2>
          </div>
          {(() => {
            const totalPending = pendingPaymentsCount + pendingWithdrawalsCount;
            const parts: string[] = [];
            if (pendingWithdrawalsCount > 0) parts.push(`${pendingWithdrawalsCount} pending withdrawal${pendingWithdrawalsCount > 1 ? "s" : ""}`);
            if (pendingPaymentsCount > 0) parts.push(`${pendingPaymentsCount} upgrade payment${pendingPaymentsCount > 1 ? "s" : ""}`);
            const tooltip = parts.length > 0 ? parts.join(" · ") : "Notifications";
            return (
              <button
                onClick={handleBellClick}
                title={tooltip}
                className="relative w-9 h-9 flex items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              >
                <Bell className={`w-4 h-4 ${totalPending > 0 ? "text-amber-400" : ""}`} />
                {totalPending > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 bg-red-500 text-white text-[10px] font-bold rounded-full min-w-[16px] h-4 flex items-center justify-center px-0.5 leading-none">
                    {totalPending > 99 ? "99+" : totalPending}
                  </span>
                )}
              </button>
            );
          })()}
        </div>

        {/* Change password panel */}
        {showChangePassword && (
          <div className="px-6 py-3 border-b border-border bg-muted/30">
            <div className="flex gap-3 flex-wrap max-w-2xl">
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
            {newPassword && confirmPassword && newPassword !== confirmPassword && <p className="text-xs text-destructive mt-2">Passwords don't match</p>}
          </div>
        )}

        {/* Tab content */}
        <div className="flex-1 px-6 py-6 overflow-auto">
          {tab === "dashboard" && <DashboardTab secret={secret} />}
          {tab === "users" && <UsersTab secret={secret} />}
          {tab === "withdrawals" && <WithdrawalsTab secret={secret} />}
          {tab === "transactions" && <TransactionsTab secret={secret} />}
          {tab === "mining" && <MiningTab secret={secret} />}
          {tab === "referrals" && <ReferralsTab secret={secret} />}
          {tab === "upgrades" && (
            <UpgradesTab
              secret={secret}
              activeSubTab={upgradeSubTab}
              onSubTabChange={setUpgradeSubTab}
              onPendingCountChange={setPendingPaymentsCount}
            />
          )}
          {tab === "settings" && <SettingsTab secret={secret} />}
          {tab === "share" && <ShareMessagesTab secret={secret} />}
          {tab === "ads" && <AdsTab secret={secret} />}
          {tab === "scripts" && <ScriptsTab secret={secret} />}
        </div>
      </div>
    </div>
  );
}
