import { useState, useEffect } from "react";
import { useGetReferrals, useGetReferralEarnings, useGetReferralStats, useGetLeaderboard } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Copy, Twitter, Facebook, MessageCircle, Users, Trophy, TrendingUp, Check, Gift, Zap, Lock, Unlock, Layers } from "lucide-react";

function useCountdown(targetDate: string): string {
  const [remaining, setRemaining] = useState("");

  useEffect(() => {
    function calc() {
      const diff = new Date(targetDate).getTime() - Date.now();
      if (diff <= 0) { setRemaining("Unlocking soon…"); return; }
      const d = Math.floor(diff / 86400000);
      const h = Math.floor((diff % 86400000) / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      if (d > 0) setRemaining(`${d}d ${h}h remaining`);
      else if (h > 0) setRemaining(`${h}h ${m}m remaining`);
      else setRemaining(`${m}m remaining`);
    }
    calc();
    const t = setInterval(calc, 60_000);
    return () => clearInterval(t);
  }, [targetDate]);

  return remaining;
}

function EarningRow({ earning }: { earning: { id: number; referredUsername: string; tier: number; rewardCoins: number; rewardLockedUsdt: number; status: string; unlockDate: string; createdAt: string } }) {
  const countdown = useCountdown(earning.unlockDate);
  const isLocked = earning.status === "locked";

  return (
    <div className="bg-card border border-card-border rounded-xl p-4 flex items-start gap-3">
      <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5 ${isLocked ? "bg-amber-500/15" : "bg-emerald-500/15"}`}>
        {isLocked ? <Lock className="w-4 h-4 text-amber-500" /> : <Unlock className="w-4 h-4 text-emerald-500" />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-semibold">{earning.referredUsername}</p>
          <Badge className="text-[10px] px-1.5 border-0 bg-primary/15 text-primary">Tier {earning.tier}</Badge>
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">
          +{earning.rewardCoins.toFixed(0)} coins · {earning.rewardLockedUsdt.toFixed(3)} USDT {isLocked ? "locked" : "unlocked"}
        </p>
        {isLocked && (
          <p className="text-xs text-amber-500 mt-0.5">{countdown}</p>
        )}
        {!isLocked && (
          <p className="text-xs text-emerald-500 mt-0.5">Available to withdraw</p>
        )}
      </div>
      <div className="text-right flex-shrink-0">
        <p className="text-xs text-muted-foreground">{new Date(earning.createdAt).toLocaleDateString()}</p>
      </div>
    </div>
  );
}

export default function Referrals() {
  const { data: referrals, isLoading } = useGetReferrals();
  const { data: earnings } = useGetReferralEarnings();
  const { data: stats } = useGetReferralStats();
  const { data: leaderboard } = useGetLeaderboard();
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    if (referrals?.referralLink) {
      navigator.clipboard.writeText(referrals.referralLink);
      setCopied(true);
      toast({ title: "Copied!", description: "Referral link copied to clipboard" });
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const shareText = `Join me on MineNova! Earn free crypto daily just by mining. Use my code: ${referrals?.referralCode}`;
  const encodedText = encodeURIComponent(shareText);
  const encodedUrl = encodeURIComponent(referrals?.referralLink ?? "");

  const shareLinks = [
    {
      name: "Twitter",
      icon: Twitter,
      color: "text-sky-400",
      bg: "bg-sky-400/10 hover:bg-sky-400/20",
      url: `https://twitter.com/intent/tweet?text=${encodedText}&url=${encodedUrl}`,
    },
    {
      name: "Facebook",
      icon: Facebook,
      color: "text-blue-500",
      bg: "bg-blue-500/10 hover:bg-blue-500/20",
      url: `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`,
    },
    {
      name: "WhatsApp",
      icon: MessageCircle,
      color: "text-emerald-500",
      bg: "bg-emerald-500/10 hover:bg-emerald-500/20",
      url: `https://api.whatsapp.com/send?text=${encodedText}%20${encodedUrl}`,
    },
  ];

  return (
    <div className="p-4 md:p-8 max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold font-serif">Referrals</h1>
        <p className="text-muted-foreground text-sm mt-0.5">Invite friends, earn from their mining and upgrades</p>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Referrals", value: String(stats?.level1Count ?? referrals?.totalReferrals ?? 0), color: "text-primary" },
          { label: "Coins Earned", value: `${(earnings?.totalCoinsEarned ?? referrals?.totalEarnedFromReferrals ?? 0).toFixed(0)}`, color: "text-accent" },
          { label: "Locked USDT", value: `$${(earnings?.totalLockedUsdt ?? 0).toFixed(3)}`, color: "text-amber-500" },
          { label: "Unlocked USDT", value: `$${(earnings?.totalUnlockedUsdt ?? 0).toFixed(3)}`, color: "text-emerald-500" },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-card border border-card-border rounded-xl p-4 text-center">
            <div className={`text-xl font-bold ${color}`}>{value}</div>
            <div className="text-xs text-muted-foreground mt-1">{label}</div>
          </div>
        ))}
      </div>

      {/* Reward structure */}
      <div className="bg-card border border-card-border rounded-xl p-5">
        <h3 className="font-semibold mb-4 flex items-center gap-2"><Layers className="w-4 h-4 text-primary" /> Upgrade Reward Structure</h3>
        <div className="space-y-2">
          {[
            { tier: "Level 1", rate: "10%", desc: "Direct referral buys an upgrade", color: "text-primary" },
            { tier: "Level 2", rate: "3%", desc: "Your referral's referral buys an upgrade", color: "text-accent" },
            { tier: "Level 3", rate: "1%", desc: "Three levels deep", color: "text-muted-foreground" },
          ].map(({ tier, rate, desc, color }) => (
            <div key={tier} className="flex items-center gap-3 py-2 border-b border-card-border last:border-0">
              <div className={`text-sm font-bold w-16 flex-shrink-0 ${color}`}>{tier}</div>
              <div className={`text-sm font-bold w-10 flex-shrink-0 ${color}`}>{rate}</div>
              <div className="text-xs text-muted-foreground">{desc}</div>
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground mt-3">
          Each reward splits as <span className="font-semibold text-accent">70% coins</span> (instant) + <span className="font-semibold text-amber-500">30% locked USDT</span> (unlocks after 7 days). Daily cap: $50 per referrer.
        </p>
      </div>

      {/* Referral Link */}
      <div className="bg-card border border-card-border rounded-xl p-5">
        <h3 className="font-semibold mb-3 flex items-center gap-2">
          <Users className="w-4 h-4 text-primary" />
          Your Referral Link
        </h3>
        <div className="flex gap-2 mb-4">
          <div className="flex-1 bg-muted rounded-lg px-3 py-2.5 text-sm font-mono truncate text-muted-foreground">
            {referrals?.referralLink ?? "Loading..."}
          </div>
          <Button
            variant="outline"
            size="sm"
            className="gap-2 flex-shrink-0"
            onClick={handleCopy}
            data-testid="button-copy-referral"
          >
            {copied ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>

        <div className="flex items-center gap-2 mb-1">
          <span className="text-sm text-muted-foreground">Your code:</span>
          <code className="bg-muted px-2 py-0.5 rounded text-sm font-bold font-mono text-primary">
            {referrals?.referralCode ?? "..."}
          </code>
        </div>

        <div className="flex gap-2 mt-4">
          {shareLinks.map(({ name, icon: Icon, color, bg, url }) => (
            <a key={name} href={url} target="_blank" rel="noopener noreferrer" className="flex-1">
              <Button
                variant="ghost"
                className={`w-full gap-2 ${bg} border border-transparent`}
                data-testid={`button-share-${name.toLowerCase()}`}
              >
                <Icon className={`w-4 h-4 ${color}`} />
                <span className="hidden sm:inline">{name}</span>
              </Button>
            </a>
          ))}
        </div>
      </div>

      {/* Earnings breakdown (quick cards) */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-card border border-card-border rounded-xl p-4 flex items-center gap-3">
          <div className="w-10 h-10 bg-primary/20 rounded-lg flex items-center justify-center flex-shrink-0">
            <Gift className="w-5 h-5 text-primary" />
          </div>
          <div>
            <p className="text-sm font-semibold">0.25 USDT</p>
            <p className="text-xs text-muted-foreground">Sign-up bonus/referral</p>
          </div>
        </div>
        <div className="bg-card border border-card-border rounded-xl p-4 flex items-center gap-3">
          <div className="w-10 h-10 bg-accent/20 rounded-lg flex items-center justify-center flex-shrink-0">
            <Zap className="w-5 h-5 text-accent" />
          </div>
          <div>
            <p className="text-sm font-semibold">7% Commission</p>
            <p className="text-xs text-muted-foreground">Per mining claim</p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="upgrade-earnings">
        <TabsList className="w-full">
          <TabsTrigger value="upgrade-earnings" className="flex-1 gap-2">
            <Lock className="w-4 h-4" /> Upgrade Rewards
          </TabsTrigger>
          <TabsTrigger value="leaderboard" className="flex-1 gap-2">
            <Trophy className="w-4 h-4" /> Leaderboard
          </TabsTrigger>
          <TabsTrigger value="my-referrals" className="flex-1 gap-2">
            <Users className="w-4 h-4" /> My Referrals
          </TabsTrigger>
        </TabsList>

        <TabsContent value="upgrade-earnings" className="mt-4">
          {earnings && earnings.earnings.length > 0 ? (
            <div className="space-y-2">
              {/* Summary bar */}
              <div className="grid grid-cols-2 gap-2 mb-3">
                <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3 text-center">
                  <p className="text-sm font-bold text-amber-500">${earnings.totalLockedUsdt.toFixed(3)}</p>
                  <p className="text-xs text-muted-foreground">Locked (unlocks in 7 days)</p>
                </div>
                <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-3 text-center">
                  <p className="text-sm font-bold text-emerald-500">${earnings.totalUnlockedUsdt.toFixed(3)}</p>
                  <p className="text-xs text-muted-foreground">Unlocked USDT</p>
                </div>
              </div>
              {earnings.earnings.map(e => <EarningRow key={e.id} earning={e} />)}
            </div>
          ) : (
            <div className="text-center py-10">
              <Lock className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
              <p className="font-medium">No upgrade rewards yet</p>
              <p className="text-sm text-muted-foreground mt-1">Earn rewards when your referrals purchase upgrades</p>
            </div>
          )}
        </TabsContent>

        <TabsContent value="leaderboard" className="mt-4">
          <div className="space-y-2">
            {leaderboard?.slice(0, 20).map((entry) => (
              <div key={entry.rank} className="bg-card border border-card-border rounded-xl p-3 flex items-center gap-3">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold flex-shrink-0 ${
                  entry.rank === 1 ? "bg-yellow-500/20 text-yellow-500" :
                  entry.rank === 2 ? "bg-slate-400/20 text-slate-400" :
                  entry.rank === 3 ? "bg-orange-600/20 text-orange-600" : "bg-muted text-muted-foreground"
                }`}>
                  {entry.rank <= 3 ? <Trophy className="w-4 h-4" /> : `#${entry.rank}`}
                </div>
                <div className="flex-1">
                  <p className="text-sm font-semibold">{entry.username}</p>
                  <p className="text-xs text-muted-foreground">Level {entry.miningLevel} · {entry.referralCount} referrals</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold text-primary">{entry.totalEarned.toFixed(2)}</p>
                  <p className="text-xs text-muted-foreground">coins</p>
                </div>
              </div>
            ))}
            {(!leaderboard || leaderboard.length === 0) && (
              <div className="text-center py-8 text-muted-foreground text-sm">No leaderboard data yet</div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="my-referrals" className="mt-4">
          {/* Multi-level counts */}
          {stats && (stats.level1Count > 0 || stats.level2Count > 0 || stats.level3Count > 0) && (
            <div className="grid grid-cols-3 gap-2 mb-4">
              {[
                { label: "Level 1", count: stats.level1Count, color: "text-primary" },
                { label: "Level 2", count: stats.level2Count, color: "text-accent" },
                { label: "Level 3", count: stats.level3Count, color: "text-muted-foreground" },
              ].map(({ label, count, color }) => (
                <div key={label} className="bg-card border border-card-border rounded-lg p-2 text-center">
                  <p className={`text-lg font-bold ${color}`}>{count}</p>
                  <p className="text-[10px] text-muted-foreground">{label}</p>
                </div>
              ))}
            </div>
          )}

          {isLoading ? (
            <div className="space-y-2">
              {[...Array(3)].map((_, i) => <div key={i} className="h-16 bg-muted rounded-xl animate-pulse" />)}
            </div>
          ) : referrals?.referrals && referrals.referrals.length > 0 ? (
            <div className="space-y-2">
              {referrals.referrals.map(ref => (
                <div key={ref.id} className="bg-card border border-card-border rounded-xl p-3 flex items-center gap-3">
                  <div className="w-8 h-8 bg-primary/20 rounded-lg flex items-center justify-center text-sm font-bold text-primary flex-shrink-0">
                    {ref.username[0]?.toUpperCase()}
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-semibold">{ref.username}</p>
                    <p className="text-xs text-muted-foreground">
                      Joined {new Date(ref.joinedAt).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="text-right flex flex-col items-end gap-1">
                    <p className="text-sm font-bold text-accent">{ref.earnedFromUser.toFixed(2)} coins</p>
                    {(ref as any).bonusPaid ? (
                      <Badge className="bg-emerald-500/15 text-emerald-500 border-0 text-[10px] px-1.5">Bonus paid</Badge>
                    ) : (
                      <Badge className="bg-amber-500/15 text-amber-500 border-0 text-[10px] px-1.5">Mining pending</Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-10">
              <TrendingUp className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
              <p className="font-medium">No referrals yet</p>
              <p className="text-sm text-muted-foreground mt-1">Share your link to start earning referral bonuses</p>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
