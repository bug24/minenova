import { useState, useEffect } from "react";
import {
  useGetMiningStatus,
  useBoostMining,
  getGetMiningStatusQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Zap, Timer, CheckCircle2 } from "lucide-react";
import AdModal, { type AdData } from "@/components/AdModal";

type BoostTier = {
  id: "single" | "double" | "triple";
  emoji: string;
  label: string;
  multiplier: string;
  adCount: number;
  duration: string;
  gradient: string;
  borderColor: string;
  glowColor: string;
  placement: string;
};

const boostTiers: BoostTier[] = [
  {
    id: "single",
    emoji: "⚡",
    label: "2x Speed",
    multiplier: "2x",
    adCount: 1,
    duration: "30 min",
    gradient: "linear-gradient(135deg, #2563eb 0%, #1d4ed8 50%, #1e40af 100%)",
    borderColor: "rgba(59, 130, 246, 0.4)",
    glowColor: "rgba(59, 130, 246, 0.15)",
    placement: "boost_2x",
  },
  {
    id: "double",
    emoji: "🔥",
    label: "3x Speed",
    multiplier: "3x",
    adCount: 2,
    duration: "60 min",
    gradient: "linear-gradient(135deg, #9333ea 0%, #7c3aed 50%, #ec4899 100%)",
    borderColor: "rgba(147, 51, 234, 0.4)",
    glowColor: "rgba(147, 51, 234, 0.15)",
    placement: "boost_3x",
  },
  {
    id: "triple",
    emoji: "🚀",
    label: "5x Speed",
    multiplier: "5x",
    adCount: 3,
    duration: "120 min",
    gradient: "linear-gradient(135deg, #f97316 0%, #ea580c 50%, #dc2626 100%)",
    borderColor: "rgba(249, 115, 22, 0.4)",
    glowColor: "rgba(249, 115, 22, 0.15)",
    placement: "boost_5x",
  },
];

function formatTimeRemaining(endsAt: string): string {
  const ms = new Date(endsAt).getTime() - Date.now();
  if (ms <= 0) return "0m";
  const totalSecs = Math.ceil(ms / 1000);
  const h = Math.floor(totalSecs / 3600);
  const m = Math.floor((totalSecs % 3600) / 60);
  const s = totalSecs % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function createFallbackAd(tier: BoostTier, index: number): AdData {
  const promoHtml = `
    <div style="
      display:flex;flex-direction:column;align-items:center;justify-content:center;
      height:100%;padding:32px 24px;text-align:center;
      background:linear-gradient(160deg,#0f0c1a 0%,#1a1040 100%);
    ">
      <div style="font-size:52px;margin-bottom:16px;">⛏️</div>
      <h2 style="color:#a855f7;font-size:22px;font-weight:900;margin:0 0 8px;letter-spacing:-0.5px;">MineNova</h2>
      <p style="color:#c4b5fd;font-size:14px;margin:0 0 20px;font-weight:500;">Earn Smarter. Grow Faster.</p>
      <div style="background:rgba(168,85,247,0.15);border:1px solid rgba(168,85,247,0.3);border-radius:12px;padding:14px 20px;max-width:280px;">
        <p style="color:#f3f0ff;font-size:13px;margin:0;line-height:1.6;">
          💎 Invite friends and earn <strong style="color:#a855f7;">25% commission</strong> on every coin they mine!
        </p>
      </div>
      <p style="color:#6b7280;font-size:11px;margin-top:24px;">Ad ${index + 1} — Please wait for the timer</p>
    </div>
  `;
  return {
    id: -(index + 1),
    title: "MineNova Promo",
    type: "script",
    urlOrCode: promoHtml,
    providerScript: null,
    durationSeconds: 15,
    placement: tier.placement,
    isActive: true,
  };
}

export default function Boost() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: status } = useGetMiningStatus();
  const boostMining = useBoostMining();

  const [activatingTier, setActivatingTier] = useState<string | null>(null);
  const [adQueue, setAdQueue] = useState<AdData[]>([]);
  const [adIndex, setAdIndex] = useState(0);
  const [pendingTier, setPendingTier] = useState<BoostTier | null>(null);
  const [timeRemaining, setTimeRemaining] = useState<string>("");

  const isActive = status?.isActive ?? false;
  const boostEndsAt = status?.boostEndsAt ?? null;
  const hasActiveBoost = isActive && (status?.boostMultiplier ?? 1) > 1 && boostEndsAt != null && new Date(boostEndsAt) > new Date();
  const tiersUsedToday: string[] = (status?.boostTiersUsed ?? "").split(",").filter(Boolean);
  const boostsUsed = status?.boostsUsedToday ?? 0;
  const boostsRemaining = Math.max(0, 3 - boostsUsed);

  useEffect(() => {
    if (!hasActiveBoost || !boostEndsAt) { setTimeRemaining(""); return; }
    setTimeRemaining(formatTimeRemaining(boostEndsAt));
    const interval = setInterval(() => {
      const remaining = new Date(boostEndsAt).getTime() - Date.now();
      if (remaining <= 0) {
        setTimeRemaining("");
        clearInterval(interval);
        queryClient.invalidateQueries({ queryKey: getGetMiningStatusQueryKey() });
      } else {
        setTimeRemaining(formatTimeRemaining(boostEndsAt));
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [hasActiveBoost, boostEndsAt, queryClient]);

  const applyBoost = (tier: BoostTier) => {
    boostMining.mutate({ data: { boostType: tier.id } }, {
      onSuccess: () => {
        toast({
          title: `${tier.multiplier} Boost activated!`,
          description: `Mining at ${tier.multiplier} speed for ${tier.duration}.`,
        });
        queryClient.invalidateQueries({ queryKey: getGetMiningStatusQueryKey() });
        setActivatingTier(null);
        setPendingTier(null);
        setAdQueue([]);
        setAdIndex(0);
      },
      onError: (err: unknown) => {
        const msg = (err as { data?: { error?: string } })?.data?.error ?? "Could not apply boost";
        toast({ variant: "destructive", title: "Error", description: msg });
        setActivatingTier(null);
        setPendingTier(null);
        setAdQueue([]);
        setAdIndex(0);
      },
    });
  };

  const handleAdComplete = () => {
    const nextIndex = adIndex + 1;
    if (nextIndex < adQueue.length) {
      setAdIndex(nextIndex);
    } else {
      setAdQueue([]);
      setAdIndex(0);
      if (pendingTier) applyBoost(pendingTier);
    }
  };

  const startBoostFlow = async (tier: BoostTier) => {
    if (!isActive) {
      toast({ variant: "destructive", title: "No active session", description: "Start mining first to use a boost." });
      return;
    }
    if (hasActiveBoost) {
      toast({ variant: "destructive", title: "Boost already active", description: `Wait for the current ${status?.boostMultiplier}x boost to expire.` });
      return;
    }
    if (tiersUsedToday.includes(tier.id)) {
      toast({ variant: "destructive", title: "Already used today", description: `You've used the ${tier.multiplier} boost today. It resets at midnight.` });
      return;
    }
    if (activatingTier !== null) {
      toast({ variant: "destructive", title: "Ad in progress", description: "Please wait for the current ad to finish." });
      return;
    }

    setActivatingTier(tier.id);
    setPendingTier(tier);

    try {
      const ads: AdData[] = [];
      for (let i = 0; i < tier.adCount; i++) {
        let ad: AdData | null = null;

        try {
          const res = await fetch(`/api/ads/random?placement=${tier.placement}`);
          const data = await res.json();
          if (!data.noAd && data.id) {
            ad = data as AdData;
          } else if (tier.placement !== "boost_2x") {
            const fallback = await fetch(`/api/ads/random?placement=boost_2x`);
            const fallbackData = await fallback.json();
            if (!fallbackData.noAd && fallbackData.id) {
              ad = fallbackData as AdData;
            }
          }
        } catch {
        }

        ads.push(ad ?? createFallbackAd(tier, i));
      }

      setAdQueue(ads);
      setAdIndex(0);
    } catch {
      // Catastrophic failure — reset state unconditionally so the button
      // is never permanently stuck in "Setting up…". The inner try-catch
      // already handles individual fetch errors with createFallbackAd, so
      // this outer catch only fires if something truly unexpected occurs.
      setActivatingTier(null);
      setPendingTier(null);
      setAdQueue([]);
      setAdIndex(0);
      toast({
        variant: "destructive",
        title: "Could not load ad",
        description: "Something went wrong preparing the boost. Please try again.",
      });
    }
  };

  const showingAd = adQueue.length > 0 && adIndex < adQueue.length;

  return (
    <div className="px-4 pt-2 pb-6 space-y-5">
      {showingAd && pendingTier && (
        <AdModal
          ad={adQueue[adIndex]}
          totalAds={adQueue.length}
          currentAd={adIndex + 1}
          gradient={pendingTier.gradient}
          onComplete={handleAdComplete}
        />
      )}

      {/* Header */}
      <div className="text-center py-4">
        <div className="w-14 h-14 rounded-2xl mx-auto mb-3 flex items-center justify-center"
          style={{ background: "linear-gradient(135deg, #7c3aed, #ec4899)" }}>
          <Zap className="w-7 h-7 text-white" />
        </div>
        <h1 className="text-2xl font-black font-serif text-foreground">Mining Boosts</h1>
        <p className="text-sm text-muted-foreground mt-1">Watch short ads to multiply your mining speed</p>
      </div>

      {/* Status bar */}
      <div className="flex items-center justify-between bg-card border border-card-border rounded-2xl px-4 py-3">
        <div className="text-sm text-muted-foreground">Boosts remaining today</div>
        <div className="flex items-center gap-1.5">
          {boostTiers.map((tier, i) => (
            <div
              key={i}
              className={`w-2.5 h-2.5 rounded-full transition-all ${tiersUsedToday.includes(tier.id) ? "bg-muted" : "bg-primary"}`}
            />
          ))}
          <span className="text-sm font-bold text-foreground ml-1">{boostsRemaining}/3</span>
        </div>
      </div>

      {/* Active boost banner */}
      {hasActiveBoost && (
        <div className="flex items-center justify-between gap-2 bg-primary/10 border border-primary/30 rounded-2xl px-4 py-3">
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-primary" />
            <span className="text-sm font-bold text-primary">{status?.boostMultiplier}x BOOST ACTIVE</span>
          </div>
          {timeRemaining && (
            <div className="flex items-center gap-1 text-xs text-primary/80 font-medium">
              <Timer className="w-3.5 h-3.5" />
              {timeRemaining} left
            </div>
          )}
        </div>
      )}

      {hasActiveBoost && (
        <div className="text-center py-2 text-sm text-amber-500 bg-amber-500/10 rounded-2xl border border-amber-500/20">
          Another boost cannot be activated while one is already running
        </div>
      )}

      {!isActive && (
        <div className="text-center py-2 text-sm text-muted-foreground bg-muted/50 rounded-2xl border border-border">
          Start a mining session to use boosts
        </div>
      )}

      {/* Boost Cards */}
      <div className="space-y-3">
        {boostTiers.map(tier => {
          const isActivating = activatingTier === tier.id;
          const usedToday = tiersUsedToday.includes(tier.id);
          const disabled = !isActive || usedToday || hasActiveBoost || (activatingTier !== null && !isActivating);

          return (
            <div
              key={tier.id}
              className="rounded-2xl overflow-hidden border transition-all"
              style={{
                borderColor: usedToday ? "rgba(255,255,255,0.08)" : tier.borderColor,
                background: usedToday ? "rgba(255,255,255,0.03)" : tier.glowColor,
                opacity: (disabled && !isActivating && !usedToday) ? 0.5 : 1,
              }}
            >
              <div className="p-4">
                <div className="flex items-center gap-4 mb-3">
                  <div
                    className="w-14 h-14 rounded-2xl flex items-center justify-center text-2xl flex-shrink-0"
                    style={{ background: usedToday ? "rgba(255,255,255,0.05)" : tier.gradient }}
                  >
                    {usedToday ? "✓" : tier.emoji}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-lg font-black font-serif text-foreground">{tier.label}</span>
                      <span
                        className="text-xs font-bold px-2 py-0.5 rounded-full text-white"
                        style={{ background: usedToday ? "rgba(255,255,255,0.1)" : tier.gradient }}
                      >
                        {tier.multiplier}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span>📺 {tier.adCount} ad{tier.adCount > 1 ? "s" : ""}</span>
                      <span>⏱ {tier.duration}</span>
                    </div>
                  </div>
                </div>

                <button
                  onClick={() => !isActivating && !usedToday && startBoostFlow(tier)}
                  disabled={disabled}
                  className="w-full py-3 rounded-xl text-sm font-bold text-white transition-all active:scale-95 disabled:cursor-not-allowed"
                  style={
                    usedToday
                      ? { background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.4)" }
                      : !disabled
                      ? { background: tier.gradient }
                      : { background: "rgba(255,255,255,0.08)" }
                  }
                  data-testid={`button-boost-${tier.multiplier.replace("x", "")}`}
                >
                  {isActivating ? (
                    "Setting up..."
                  ) : usedToday ? (
                    <span className="flex items-center justify-center gap-1.5">
                      <CheckCircle2 className="w-4 h-4" />
                      Used today — resets at midnight
                    </span>
                  ) : hasActiveBoost ? (
                    "Boost already active"
                  ) : (
                    `Watch ${tier.adCount} Ad${tier.adCount > 1 ? "s" : ""} → Activate ${tier.multiplier}`
                  )}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-center text-xs text-muted-foreground px-4">
        Each boost tier can be used once per day · Resets at midnight · Only one boost active at a time
      </p>
    </div>
  );
}
