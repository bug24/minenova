import { useState } from "react";
import { useGetReferrals, useGetLeaderboard } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Copy, Twitter, Facebook, MessageCircle, Users, Trophy, TrendingUp, Check, Gift, Zap } from "lucide-react";

export default function Referrals() {
  const { data: referrals, isLoading } = useGetReferrals();
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
        <p className="text-muted-foreground text-sm mt-0.5">Invite friends and earn from their mining activity</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4">
        {[
          { label: "Total Referrals", value: String(referrals?.totalReferrals ?? 0), color: "text-primary" },
          { label: "Earned from Refs", value: `${(referrals?.totalEarnedFromReferrals ?? 0).toFixed(2)} coins`, color: "text-accent" },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-card border border-card-border rounded-xl p-4 text-center">
            <div className={`text-2xl font-bold ${color}`}>{value}</div>
            <div className="text-xs text-muted-foreground mt-1">{label}</div>
          </div>
        ))}
      </div>

      {/* Earnings breakdown */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-card border border-card-border rounded-xl p-4 flex items-center gap-3">
          <div className="w-10 h-10 bg-primary/20 rounded-lg flex items-center justify-center flex-shrink-0">
            <Gift className="w-5 h-5 text-primary" />
          </div>
          <div>
            <p className="text-sm font-semibold">0.25 USDT</p>
            <p className="text-xs text-muted-foreground">One-time signup bonus</p>
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

        {/* Share Buttons */}
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

      {/* How it works */}
      <div className="bg-card border border-card-border rounded-xl p-5">
        <h3 className="font-semibold mb-4">How Referrals Work</h3>
        <div className="space-y-4">
          <div className="flex gap-3">
            <div className="w-7 h-7 bg-primary/20 rounded-full flex items-center justify-center text-xs font-bold text-primary flex-shrink-0 mt-0.5">1</div>
            <div>
              <p className="text-sm font-medium">Share your link</p>
              <p className="text-xs text-muted-foreground">Send your unique referral link to friends</p>
            </div>
          </div>
          <div className="flex gap-3">
            <div className="w-7 h-7 bg-primary/20 rounded-full flex items-center justify-center text-xs font-bold text-primary flex-shrink-0 mt-0.5">2</div>
            <div>
              <p className="text-sm font-medium">Friend signs up and starts mining</p>
              <p className="text-xs text-muted-foreground">You instantly receive a <span className="text-primary font-semibold">0.25 USDT (250 coins)</span> one-time bonus — paid the moment they activate their first mining session</p>
            </div>
          </div>
          <div className="flex gap-3">
            <div className="w-7 h-7 bg-accent/20 rounded-full flex items-center justify-center text-xs font-bold text-accent flex-shrink-0 mt-0.5">3</div>
            <div>
              <p className="text-sm font-medium">Earn 7% on every claim they make</p>
              <p className="text-xs text-muted-foreground">You earn <span className="text-accent font-semibold">7% commission</span> automatically added to your wallet every time a referral claims their mining reward. No multi-level, Level 1 only.</p>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs for referrals list and leaderboard */}
      <Tabs defaultValue="leaderboard">
        <TabsList className="w-full">
          <TabsTrigger value="leaderboard" className="flex-1 gap-2">
            <Trophy className="w-4 h-4" /> Leaderboard
          </TabsTrigger>
          <TabsTrigger value="my-referrals" className="flex-1 gap-2">
            <Users className="w-4 h-4" /> My Referrals
          </TabsTrigger>
        </TabsList>

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
                  <p className="text-xs text-muted-foreground">Level {entry.miningLevel} • {entry.referralCount} referrals</p>
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
