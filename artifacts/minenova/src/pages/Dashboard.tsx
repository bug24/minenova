import { useState, useEffect, useCallback } from "react";
import { useGetMiningStatus, useStartMining, useClaimMining, useBoostMining, useGetDashboardSummary, getGetMiningStatusQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Pickaxe, Zap, TrendingUp, Users, Trophy, Activity, Play, Gift, Cpu, Clock } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

function formatCountdown(ms: number): string {
  if (ms <= 0) return "00:00:00";
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function HashRateDisplay({ rate }: { rate: number }) {
  const [display, setDisplay] = useState(rate);
  useEffect(() => {
    const interval = setInterval(() => {
      setDisplay(rate + (Math.random() - 0.5) * 2);
    }, 800);
    return () => clearInterval(interval);
  }, [rate]);
  return <span>{display.toFixed(1)} MH/s</span>;
}

export default function Dashboard() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [boostDialogOpen, setBoostDialogOpen] = useState(false);
  const [countdown, setCountdown] = useState("--:--:--");
  const [displayCoins, setDisplayCoins] = useState(0);

  const { data: status, isLoading } = useGetMiningStatus();
  const { data: summary } = useGetDashboardSummary();
  const startMining = useStartMining();
  const claimMining = useClaimMining();
  const boostMining = useBoostMining();

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: getGetMiningStatusQueryKey() });
  }, [queryClient]);

  useEffect(() => {
    if (!status?.isActive || !status?.sessionEndsAt) return;
    const tick = () => {
      const endsAt = new Date(status.sessionEndsAt!).getTime();
      const now = Date.now();
      const remaining = endsAt - now;
      setCountdown(formatCountdown(remaining));

      if (remaining <= 0) {
        setCountdown("00:00:00");
        invalidate();
      }
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [status?.isActive, status?.sessionEndsAt, invalidate]);

  useEffect(() => {
    if (!status?.isActive || !status?.sessionStartedAt || !status?.sessionEndsAt) {
      setDisplayCoins(status?.accumulatedCoins ?? 0);
      return;
    }
    const startedAt = new Date(status.sessionStartedAt).getTime();
    const endsAt = new Date(status.sessionEndsAt).getTime();
    const totalMs = endsAt - startedAt;
    const coinsPerMs = (status.accumulatedCoins / (Date.now() - startedAt)) || 0;

    const tick = () => {
      const elapsed = Date.now() - startedAt;
      const fraction = Math.min(elapsed / totalMs, 1);
      const approxTotal = (totalMs / (1000 * 60 * 60)) * 0.5 * (user?.miningLevel ?? 1) * (status.boostMultiplier ?? 1);
      setDisplayCoins(Math.min(approxTotal * fraction, approxTotal));
    };
    tick();
    const interval = setInterval(tick, 2000);
    return () => clearInterval(interval);
  }, [status?.isActive, status?.sessionStartedAt, status?.sessionEndsAt, user?.miningLevel, status?.boostMultiplier]);

  const handleStartMining = () => {
    startMining.mutate(undefined, {
      onSuccess: () => {
        toast({ title: "Mining started!", description: "Your session runs for 12 hours. Come back to claim!" });
        invalidate();
      },
      onError: (err: unknown) => {
        const msg = (err as { data?: { error?: string } })?.data?.error ?? "Could not start mining";
        toast({ variant: "destructive", title: "Error", description: msg });
      },
    });
  };

  const handleClaim = () => {
    claimMining.mutate(undefined, {
      onSuccess: (res) => {
        toast({ title: "Rewards claimed!", description: `You earned ${res.coinsEarned.toFixed(2)} coins!` });
        invalidate();
      },
      onError: (err: unknown) => {
        const msg = (err as { data?: { error?: string } })?.data?.error ?? "Nothing to claim yet";
        toast({ variant: "destructive", title: "Error", description: msg });
      },
    });
  };

  const handleBoost = (type: "single" | "triple") => {
    boostMining.mutate({ data: { boostType: type === "single" ? "single" : "triple" } }, {
      onSuccess: () => {
        toast({ title: "Mining boosted!", description: type === "single" ? "2x speed for 30 minutes!" : "5x speed for 30 minutes!" });
        setBoostDialogOpen(false);
        invalidate();
      },
      onError: (err: unknown) => {
        const msg = (err as { data?: { error?: string } })?.data?.error ?? "Could not apply boost";
        toast({ variant: "destructive", title: "Error", description: msg });
      },
    });
  };

  const sessionProgress = (() => {
    if (!status?.sessionStartedAt || !status?.sessionEndsAt) return 0;
    const start = new Date(status.sessionStartedAt).getTime();
    const end = new Date(status.sessionEndsAt).getTime();
    const now = Date.now();
    return Math.min(((now - start) / (end - start)) * 100, 100);
  })();

  if (isLoading) {
    return (
      <div className="p-6 md:p-8 max-w-5xl mx-auto">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-muted rounded w-48" />
          <div className="h-48 bg-muted rounded-2xl" />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[...Array(4)].map((_, i) => <div key={i} className="h-24 bg-muted rounded-xl" />)}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold font-serif">Dashboard</h1>
        <p className="text-muted-foreground text-sm mt-0.5">Welcome back, {user?.username}</p>
      </div>

      {/* Main Mining Card */}
      <div className="bg-card border border-card-border rounded-2xl overflow-hidden">
        <div className="p-6 md:p-8">
          <div className="flex flex-col md:flex-row items-center gap-8">
            {/* Mining Rig Visual */}
            <div className="flex-shrink-0">
              <div className={`w-32 h-32 rounded-3xl flex items-center justify-center relative ${status?.isActive ? "bg-primary/20 pulse-glow" : "bg-muted"}`}>
                <Cpu className={`w-16 h-16 ${status?.isActive ? "text-primary" : "text-muted-foreground"}`} />
                {status?.isActive && (
                  <div className="absolute inset-0 rounded-3xl overflow-hidden">
                    {[...Array(3)].map((_, i) => (
                      <div
                        key={i}
                        className="absolute inset-0 rounded-3xl border-2 border-primary/30"
                        style={{ animation: `ping ${1.5 + i * 0.5}s cubic-bezier(0, 0, 0.2, 1) infinite`, opacity: 0.4 }}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Status */}
            <div className="flex-1 text-center md:text-left">
              <div className="flex items-center gap-2 justify-center md:justify-start mb-2">
                <div className={`w-2.5 h-2.5 rounded-full ${status?.isActive ? "bg-emerald-500 animate-pulse" : status?.canClaim ? "bg-accent animate-pulse" : "bg-muted-foreground"}`} />
                <span className="text-sm font-medium text-muted-foreground">
                  {status?.isActive ? "Mining Active" : status?.canClaim ? "Ready to Claim" : "Idle"}
                </span>
              </div>

              <div className="text-5xl font-black font-serif text-primary mb-1">
                {displayCoins.toFixed(4)}
              </div>
              <p className="text-sm text-muted-foreground mb-4">coins accumulated</p>

              {status?.isActive && (
                <div className="mb-4">
                  <div className="flex justify-between text-xs text-muted-foreground mb-1">
                    <span>Session Progress</span>
                    <span>{sessionProgress.toFixed(0)}%</span>
                  </div>
                  <Progress value={sessionProgress} className="h-2" />
                  <div className="flex items-center justify-center md:justify-start gap-1.5 mt-2">
                    <Clock className="w-3.5 h-3.5 text-muted-foreground" />
                    <span className="text-sm font-mono font-medium">{countdown}</span>
                    <span className="text-xs text-muted-foreground">remaining</span>
                  </div>
                </div>
              )}

              <div className="flex flex-wrap gap-2 justify-center md:justify-start">
                {!status?.isActive && !status?.canClaim && (
                  <Button
                    onClick={handleStartMining}
                    disabled={startMining.isPending}
                    className="pulse-glow font-semibold gap-2"
                    data-testid="button-start-mining"
                  >
                    <Play className="w-4 h-4" />
                    {startMining.isPending ? "Starting..." : "Start Mining"}
                  </Button>
                )}
                {status?.canClaim && (
                  <Button
                    onClick={handleClaim}
                    disabled={claimMining.isPending}
                    className="bg-accent text-accent-foreground hover:bg-accent/90 font-semibold gap-2"
                    data-testid="button-claim-rewards"
                  >
                    <Gift className="w-4 h-4" />
                    {claimMining.isPending ? "Claiming..." : "Claim Rewards"}
                  </Button>
                )}
                {status?.isActive && !status?.canClaim && (
                  <Button
                    variant="outline"
                    onClick={() => setBoostDialogOpen(true)}
                    className="gap-2 font-semibold"
                    data-testid="button-boost-mining"
                  >
                    <Zap className="w-4 h-4 text-accent" />
                    Boost Mining
                  </Button>
                )}
              </div>
            </div>

            {/* Hash Rate */}
            {status?.isActive && (
              <div className="flex-shrink-0 text-center">
                <p className="text-xs text-muted-foreground mb-1">Hash Rate</p>
                <div className="text-2xl font-black text-primary font-mono">
                  <HashRateDisplay rate={status.hashRate} />
                </div>
                {(status.boostMultiplier ?? 1) > 1 && (
                  <div className="mt-1 bg-accent/20 text-accent text-xs font-bold px-2 py-0.5 rounded-full inline-block">
                    {status.boostMultiplier}x BOOST
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { icon: TrendingUp, label: "Total Earned", value: `${(user?.totalEarned ?? 0).toFixed(2)}`, unit: "coins", color: "text-primary" },
          { icon: Trophy, label: "My Rank", value: summary?.myRank ? `#${summary.myRank}` : "--", unit: "leaderboard", color: "text-accent" },
          { icon: Users, label: "Referrals", value: String(summary?.myReferralCount ?? 0), unit: "people", color: "text-purple-500" },
          { icon: Activity, label: "Mining Level", value: String(user?.miningLevel ?? 1), unit: "level", color: "text-emerald-500" },
        ].map(({ icon: Icon, label, value, unit, color }) => (
          <div key={label} className="bg-card border border-card-border rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <Icon className={`w-4 h-4 ${color}`} />
              <span className="text-xs text-muted-foreground font-medium">{label}</span>
            </div>
            <div className={`text-2xl font-black ${color} font-serif`}>{value}</div>
            <p className="text-xs text-muted-foreground mt-0.5">{unit}</p>
          </div>
        ))}
      </div>

      {/* Platform Stats */}
      {summary && (
        <div className="bg-card border border-card-border rounded-xl p-4">
          <h3 className="text-sm font-semibold text-muted-foreground mb-3">Platform Stats</h3>
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <div className="text-xl font-bold text-foreground">{summary.totalUsers.toLocaleString()}</div>
              <div className="text-xs text-muted-foreground">Total Miners</div>
            </div>
            <div>
              <div className="text-xl font-bold text-foreground">{summary.totalCoinsDistributed.toFixed(0)}</div>
              <div className="text-xs text-muted-foreground">Coins Distributed</div>
            </div>
            <div>
              <div className="text-xl font-bold text-foreground">{summary.activeSessions}</div>
              <div className="text-xs text-muted-foreground">Active Sessions</div>
            </div>
          </div>
        </div>
      )}

      {/* Boost Dialog */}
      <Dialog open={boostDialogOpen} onOpenChange={setBoostDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Zap className="w-5 h-5 text-accent" />
              Boost Mining Speed
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 pt-2">
            <p className="text-sm text-muted-foreground">Boosts used today: {status?.boostsUsedToday ?? 0}/3</p>
            <Button
              className="w-full h-14 flex-col gap-1 text-left items-start"
              variant="outline"
              onClick={() => handleBoost("single")}
              disabled={boostMining.isPending || (status?.boostsUsedToday ?? 0) >= 3}
              data-testid="button-boost-2x"
            >
              <span className="font-semibold flex items-center gap-2">
                <Zap className="w-4 h-4 text-primary" /> 2x Speed Boost
              </span>
              <span className="text-xs text-muted-foreground font-normal">Watch 1 ad — Active for 30 minutes</span>
            </Button>
            <Button
              className="w-full h-14 flex-col gap-1 text-left items-start"
              variant="outline"
              onClick={() => handleBoost("triple")}
              disabled={boostMining.isPending || (status?.boostsUsedToday ?? 0) >= 3}
              data-testid="button-boost-5x"
            >
              <span className="font-semibold flex items-center gap-2">
                <Zap className="w-4 h-4 text-accent" /> 5x Speed Boost
              </span>
              <span className="text-xs text-muted-foreground font-normal">Watch 3 ads — Active for 30 minutes</span>
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
