import { useState } from "react";
import {
  useGetMiningStatus,
  useBoostMining,
  getGetMiningStatusQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Zap } from "lucide-react";
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
  },
];

type AdState = "idle" | "watching" | "complete";

interface ActiveAdSession {
  tier: BoostTier;
  ad: AdData;
  currentAd: number;
}

export default function Boost() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: status } = useGetMiningStatus();
  const boostMining = useBoostMining();

  const [adState, setAdState] = useState<Record<string, AdState>>({});
  const [adProgress, setAdProgress] = useState<Record<string, number>>({});
  const [activatingTier, setActivatingTier] = useState<string | null>(null);
  const [adSession, setAdSession] = useState<ActiveAdSession | null>(null);

  const boostsUsed = status?.boostsUsedToday ?? 0;
  const boostsRemaining = Math.max(0, 3 - boostsUsed);
  const isActive = status?.isActive ?? false;

  const applyBoost = (tier: BoostTier) => {
    boostMining.mutate({ data: { boostType: tier.id } }, {
      onSuccess: () => {
        toast({
          title: `${tier.multiplier} Boost activated!`,
          description: `Mining at ${tier.multiplier} speed for ${tier.duration}.`,
        });
        queryClient.invalidateQueries({ queryKey: getGetMiningStatusQueryKey() });
        setTimeout(() => {
          setAdState(s => ({ ...s, [tier.id]: "idle" }));
          setAdProgress(s => ({ ...s, [tier.id]: 0 }));
          setActivatingTier(null);
        }, 2000);
      },
      onError: (err: unknown) => {
        const msg = (err as { data?: { error?: string } })?.data?.error ?? "Could not apply boost";
        toast({ variant: "destructive", title: "Error", description: msg });
        setAdState(s => ({ ...s, [tier.id]: "idle" }));
        setActivatingTier(null);
      },
    });
  };

  const runFakeAd = (tier: BoostTier) => {
    setActivatingTier(tier.id);
    setAdState(s => ({ ...s, [tier.id]: "watching" }));
    setAdProgress(s => ({ ...s, [tier.id]: 0 }));

    let elapsed = 0;
    const totalMs = tier.adCount * 1500;
    const interval = setInterval(() => {
      elapsed += 100;
      const pct = Math.min(100, (elapsed / totalMs) * 100);
      setAdProgress(s => ({ ...s, [tier.id]: pct }));
      if (elapsed >= totalMs) {
        clearInterval(interval);
        setAdState(s => ({ ...s, [tier.id]: "complete" }));
        applyBoost(tier);
      }
    }, 100);
  };

  const handleActivate = async (tier: BoostTier) => {
    if (!isActive) {
      toast({ variant: "destructive", title: "No active session", description: "Start mining first to use a boost." });
      return;
    }
    if (boostsRemaining <= 0) {
      toast({ variant: "destructive", title: "Limit reached", description: "You've used all 3 boosts for today." });
      return;
    }
    if (activatingTier !== null) {
      toast({ variant: "destructive", title: "Ad in progress", description: "Please wait for the current ad to finish." });
      return;
    }

    try {
      const res = await fetch("/api/ads/random?placement=boost");
      if (!res.ok) {
        runFakeAd(tier);
        return;
      }
      const data = await res.json();
      if (data?.noAd) {
        runFakeAd(tier);
        return;
      }
      setActivatingTier(tier.id);
      setAdState(s => ({ ...s, [tier.id]: "watching" }));
      setAdSession({ tier, ad: data as AdData, currentAd: 1 });
    } catch {
      runFakeAd(tier);
    }
  };

  const handleAdComplete = () => {
    if (!adSession) return;
    const { tier, ad, currentAd } = adSession;

    if (currentAd < tier.adCount) {
      setAdSession({ tier, ad, currentAd: currentAd + 1 });
    } else {
      setAdSession(null);
      setAdState(s => ({ ...s, [tier.id]: "complete" }));
      applyBoost(tier);
    }
  };

  const handleAdDismiss = () => {
    if (!adSession) return;
    const { tier } = adSession;
    setAdSession(null);
    setAdState(s => ({ ...s, [tier.id]: "idle" }));
    setActivatingTier(null);
  };

  return (
    <>
      {adSession && (
        <AdModal
          ad={adSession.ad}
          totalAds={adSession.tier.adCount}
          currentAd={adSession.currentAd}
          gradient={adSession.tier.gradient}
          autoActivate
          onComplete={handleAdComplete}
        />
      )}

      <div className="px-4 pt-2 pb-6 space-y-5">
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
            {[0, 1, 2].map(i => (
              <div
                key={i}
                className={`w-2.5 h-2.5 rounded-full transition-all ${i < boostsRemaining ? "bg-primary" : "bg-muted"}`}
              />
            ))}
            <span className="text-sm font-bold text-foreground ml-1">{boostsRemaining}/3</span>
          </div>
        </div>

        {/* Current boost badge */}
        {isActive && (status?.boostMultiplier ?? 1) > 1 && (
          <div className="flex items-center justify-center gap-2 bg-primary/10 border border-primary/30 rounded-2xl py-2.5">
            <Zap className="w-4 h-4 text-primary" />
            <span className="text-sm font-bold text-primary">{status?.boostMultiplier}x BOOST ACTIVE</span>
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
            const state = adState[tier.id] ?? "idle";
            const progress = adProgress[tier.id] ?? 0;
            const disabled = !isActive || boostsRemaining <= 0;

            return (
              <div
                key={tier.id}
                className="rounded-2xl overflow-hidden border transition-all"
                style={{
                  borderColor: tier.borderColor,
                  background: tier.glowColor,
                }}
              >
                <div className="p-4">
                  <div className="flex items-center gap-4 mb-3">
                    {/* Emoji icon with gradient bg */}
                    <div
                      className="w-14 h-14 rounded-2xl flex items-center justify-center text-2xl flex-shrink-0"
                      style={{ background: tier.gradient }}
                    >
                      {tier.emoji}
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-lg font-black font-serif text-foreground">{tier.label}</span>
                        <span
                          className="text-xs font-bold px-2 py-0.5 rounded-full text-white"
                          style={{ background: tier.gradient }}
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

                  {/* Fake ad progress bar (fallback only) */}
                  {state === "watching" && !adSession && (
                    <div className="mb-3">
                      <div className="flex items-center justify-between text-xs text-muted-foreground mb-1.5">
                        <span>Watching ad{tier.adCount > 1 ? "s" : ""}...</span>
                        <span>{Math.round(progress)}%</span>
                      </div>
                      <div className="h-2 bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-100"
                          style={{
                            width: `${progress}%`,
                            background: tier.gradient,
                          }}
                        />
                      </div>
                    </div>
                  )}

                  {state === "complete" && (
                    <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-green-500">
                      <span>✅</span> Boost activated!
                    </div>
                  )}

                  {/* Activate button */}
                  <button
                    onClick={() => state === "idle" && handleActivate(tier)}
                    disabled={disabled || state !== "idle"}
                    className="w-full py-3 rounded-xl text-sm font-bold text-white transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
                    style={state === "idle" && !disabled ? { background: tier.gradient } : { background: "rgba(255,255,255,0.08)" }}
                    data-testid={`button-boost-${tier.multiplier.replace("x", "")}`}
                  >
                    {state === "watching"
                      ? "Watching..."
                      : state === "complete"
                      ? "Activated!"
                      : `Watch ${tier.adCount} Ad${tier.adCount > 1 ? "s" : ""} → Activate ${tier.multiplier}`}
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Info note */}
        <p className="text-center text-xs text-muted-foreground px-4">
          Boosts reset daily at midnight · Max 3 boosts per day · Only one boost active at a time
        </p>
      </div>
    </>
  );
}
