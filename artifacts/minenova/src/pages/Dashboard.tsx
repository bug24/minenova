import { useState, useEffect, useCallback } from "react";
import {
  useGetMiningStatus,
  useStartMining,
  useClaimMining,
  useGetDashboardSummary,
  getGetMiningStatusQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { Pickaxe, Zap, TrendingUp, Bell, BellOff } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";

function getAuthHeader(): Record<string, string> {
  const token = localStorage.getItem("minenova_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function subscribeToNotifications(): Promise<boolean> {
  if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) return false;
  if (Notification.permission === "denied") return false;

  let permission = Notification.permission;
  if (permission === "default") {
    permission = await Notification.requestPermission();
  }
  if (permission !== "granted") return false;

  const registration = await navigator.serviceWorker.ready;

  const keyRes = await fetch("/api/notifications/vapid-public-key", {
    headers: { ...getAuthHeader() },
  });
  if (!keyRes.ok) return false;
  const { publicKey } = await keyRes.json() as { publicKey: string };

  const existing = await registration.pushManager.getSubscription();
  if (existing) await existing.unsubscribe();

  const keyBytes = Uint8Array.from(
    atob(publicKey.replace(/-/g, "+").replace(/_/g, "/")),
    (c) => c.charCodeAt(0),
  );

  const sub = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: keyBytes,
  });

  const subJson = sub.toJSON();
  await fetch("/api/notifications/subscribe", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...getAuthHeader(),
    },
    body: JSON.stringify(subJson),
  });

  return true;
}

function formatCountdown(ms: number): string {
  if (ms <= 0) return "00:00:00";
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export default function Dashboard() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [countdown, setCountdown] = useState("--:--:--");
  const [displayCoins, setDisplayCoins] = useState(0);
  const [notifPermission, setNotifPermission] = useState<NotificationPermission | "unsupported">(
    () => {
      if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
      return Notification.permission;
    }
  );
  const [notifLoading, setNotifLoading] = useState(false);

  const handleEnableNotifications = async () => {
    setNotifLoading(true);
    try {
      const ok = await subscribeToNotifications();
      if (ok) {
        setNotifPermission("granted");
        toast({ title: "Notifications enabled!", description: "We'll notify you when mining completes." });
      } else {
        setNotifPermission(Notification.permission as NotificationPermission);
        toast({ variant: "destructive", title: "Could not enable notifications", description: "Check your browser notification settings." });
      }
    } catch {
      toast({ variant: "destructive", title: "Error", description: "Could not enable notifications." });
    } finally {
      setNotifLoading(false);
    }
  };

  const { data: status, isLoading } = useGetMiningStatus();
  const { data: summary } = useGetDashboardSummary();
  const startMining = useStartMining();
  const claimMining = useClaimMining();

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: getGetMiningStatusQueryKey() });
  }, [queryClient]);

  useEffect(() => {
    if (!status?.isActive || !status?.sessionEndsAt) return;
    const tick = () => {
      const endsAt = new Date(status.sessionEndsAt!).getTime();
      const remaining = endsAt - Date.now();
      setCountdown(formatCountdown(remaining));
      if (remaining <= 0) invalidate();
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
    const totalCoins = (totalMs / 3600000) * 0.5 * (user?.miningLevel ?? 1) * (status.boostMultiplier ?? 1);

    const tick = () => {
      const elapsed = Math.min(Date.now() - startedAt, totalMs);
      setDisplayCoins(totalCoins * (elapsed / totalMs));
    };
    tick();
    const interval = setInterval(tick, 2000);
    return () => clearInterval(interval);
  }, [status?.isActive, status?.sessionStartedAt, status?.sessionEndsAt, user?.miningLevel, status?.boostMultiplier]);

  const handleStartMining = () => {
    startMining.mutate(undefined, {
      onSuccess: () => {
        toast({ title: "Mining started!", description: "Your 12-hour session is running." });
        invalidate();
        subscribeToNotifications()
          .then((ok) => {
            if (ok) setNotifPermission("granted");
          })
          .catch(() => {});
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
        const msg = (err as { data?: { error?: string } })?.data?.error ?? "Nothing to claim";
        toast({ variant: "destructive", title: "Error", description: msg });
      },
    });
  };

  const orbClickable = !status?.isActive || status?.canClaim;

  return (
    <div className="px-4 pt-2 pb-4 space-y-5">
      {/* Stats Cards */}
      <div className="grid grid-cols-3 gap-2.5">
        {[
          {
            icon: "💰",
            label: "Balance",
            value: displayCoins.toFixed(2),
            unit: "NVC",
          },
          {
            icon: "📈",
            label: "Total Earned",
            value: (user?.totalEarned ?? 0).toFixed(2),
            unit: "NVC",
          },
          {
            icon: "⏱",
            label: "Session",
            value: status?.isActive ? countdown.split(":").slice(0, 2).join(":") : "--:--",
            unit: status?.isActive ? "remaining" : "NVC",
          },
        ].map(({ icon, label, value, unit }) => (
          <div
            key={label}
            className="bg-card border border-card-border rounded-2xl p-3 text-center"
          >
            <div className="text-base mb-1">{icon}</div>
            <div className="text-[10px] text-muted-foreground mb-1 font-medium uppercase tracking-wide">{label}</div>
            <div className="text-base font-black text-foreground leading-tight">{value}</div>
            <div className="text-[10px] text-muted-foreground">{unit}</div>
          </div>
        ))}
      </div>
      {/* Mining Orb */}
      <div className="flex flex-col items-center py-4">
        {/* Orb Container */}
        <div className="relative flex items-center justify-center mb-6">

          {/* Outermost faded ghost ring - theme-compatible */}
          <div
            className="absolute w-[300px] h-[300px] rounded-full spin-reverse-slow"
            style={{
              border: "1px solid",
              borderColor: "color-mix(in srgb, var(--color-primary) 12%, transparent)",
              boxShadow: "0 0 30px color-mix(in srgb, var(--color-primary) 5%, transparent)",
            }}
          />

          {/* Gradient orbit ring */}
          <div
            className="absolute w-[230px] h-[230px] rounded-full spin-slow"
            style={{
              background: "conic-gradient(from 0deg, transparent 0%, rgba(168,85,247,0.45) 30%, rgba(139,92,246,0.2) 55%, transparent 70%)",
              WebkitMask: "radial-gradient(transparent 109px, black 110px, black 112px, transparent 113px)",
              mask: "radial-gradient(transparent 109px, black 110px, black 112px, transparent 113px)",
            }}
          />

          {/* Orbit dots - gentle independent spin */}
          <div className="absolute w-[230px] h-[230px] flex items-center justify-center spin-very-slow">
            <div
              className="absolute w-2 h-2 rounded-full"
              style={{
                background: "radial-gradient(circle, rgba(168,85,247,0.9), rgba(139,92,246,0.5))",
                transform: "translateX(115px)",
                boxShadow: "0 0 6px rgba(168,85,247,0.6)",
              }}
            />
            <div
              className="absolute w-1.5 h-1.5 rounded-full"
              style={{
                background: "rgba(139,92,246,0.6)",
                transform: "rotate(130deg) translateX(115px)",
              }}
            />
            <div
              className="absolute w-1 h-1 rounded-full"
              style={{
                background: "rgba(168,85,247,0.5)",
                transform: "rotate(250deg) translateX(115px)",
              }}
            />
          </div>

          {/* The Orb */}
          <button
            onClick={orbClickable ? (status?.canClaim ? handleClaim : handleStartMining) : undefined}
            disabled={startMining.isPending || claimMining.isPending}
            className={`relative w-44 h-44 rounded-full flex flex-col items-center justify-center cursor-pointer transition-transform active:scale-95 select-none ${
              !status?.isActive ? "opacity-90 hover:scale-105" : ""
            }`}
            style={{
              background: status?.isActive
                ? "radial-gradient(circle at 35% 35%, #c084fc, #a855f7 30%, #7c3aed 60%, #3b0764)"
                : "radial-gradient(circle at 35% 35%, #7e22ce, #5b21b6 45%, #2e1065)",
              boxShadow: status?.isActive
                ? "0 0 40px rgba(168,85,247,0.35), 0 0 80px rgba(124,58,237,0.15)"
                : "0 0 20px rgba(91,33,182,0.2)",
            }}
            data-testid="button-orb-mine"
          >
            {/* Inner glow ring */}
            {status?.isActive && (
              <div
                className="absolute inset-0 rounded-full orb-glow"
                style={{
                  border: "1px solid rgba(196,132,252,0.3)",
                  borderRadius: "50%",
                }}
              />
            )}

            {/* Shine highlight */}
            <div
              className="absolute top-6 left-8 w-10 h-10 rounded-full opacity-25"
              style={{
                background: "radial-gradient(circle, rgba(255,255,255,0.9) 0%, transparent 70%)",
              }}
            />

            <Pickaxe className="w-10 h-10 text-white/90 mb-2 relative z-10" />
            <span className="text-xs font-bold text-white/80 tracking-[0.2em] uppercase relative z-10">
              {status?.canClaim ? "CLAIM" : status?.isActive ? "MINING" : "START"}
            </span>
          </button>
        </div>

        {/* Status Text */}
        <div className="text-center">
          {status?.isActive && !status?.canClaim && (
            <>
              <p className="text-sm text-muted-foreground">Tap orb to stop mining</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Speed: {status.boostMultiplier ?? 1}x · Level {user?.miningLevel ?? 1}
              </p>
            </>
          )}
          {status?.canClaim && (
            <>
              <p className="text-sm font-semibold text-primary">Mining complete! Tap to claim</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {displayCoins.toFixed(4)} coins ready
              </p>
            </>
          )}
          {!status?.isActive && !status?.canClaim && (
            <>
              <p className="text-sm text-muted-foreground">Tap the orb to start mining</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                12-hour session · Level {user?.miningLevel ?? 1}
              </p>
            </>
          )}
        </div>

        {/* Boost active indicator */}
        {status?.isActive && (status?.boostMultiplier ?? 1) > 1 && (
          <div className="mt-3 flex items-center gap-1.5 bg-primary/20 border border-primary/30 rounded-full px-3 py-1">
            <Zap className="w-3 h-3 text-primary" />
            <span className="text-xs font-bold text-primary">{status.boostMultiplier}x BOOST ACTIVE</span>
          </div>
        )}
      </div>
      {/* Action Buttons */}
      <div className="grid grid-cols-2 gap-3">
        {/* Boost Speed */}
        <Link href="/boost">
          <button
            className="w-full flex items-center gap-3 p-4 rounded-2xl text-left transition-opacity"
            style={{
              background: "linear-gradient(135deg, #7c3aed 0%, #6d28d9 50%, #5b21b6 100%)",
            }}
            data-testid="button-boost-speed"
          >
            <div className="w-8 h-8 rounded-xl bg-white/20 flex items-center justify-center flex-shrink-0">
              <Zap className="w-4 h-4 text-white" />
            </div>
            <div>
              <p className="text-sm font-bold text-white">Boost Speed</p>
              <p className="text-xs text-white/70">Watch ads for 5x</p>
            </div>
          </button>
        </Link>

        {/* Upgrade */}
        <Link href="/upgrades">
          <button
            className="w-full flex items-center gap-3 p-4 rounded-2xl text-left transition-opacity"
            style={{
              background: "linear-gradient(135deg, #0f2744 0%, #0d1f35 50%, #0a1828 100%)",
              border: "1px solid rgba(99, 179, 237, 0.2)",
            }}
            data-testid="button-upgrade-link"
          >
            <div className="w-8 h-8 rounded-xl bg-cyan-500/20 flex items-center justify-center flex-shrink-0">
              <TrendingUp className="w-4 h-4 text-cyan-400" />
            </div>
            <div>
              <p className="text-sm font-bold text-white">Upgrade</p>
              <p className="text-xs text-white/70">Increase earnings</p>
            </div>
          </button>
        </Link>
      </div>

      {/* Notification opt-in */}
      {notifPermission !== "unsupported" && notifPermission !== "granted" && (
        <button
          onClick={handleEnableNotifications}
          disabled={notifLoading || notifPermission === "denied"}
          className="w-full flex items-center gap-3 p-4 rounded-2xl text-left transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
          style={{
            background: "rgba(168,85,247,0.08)",
            border: "1px solid rgba(168,85,247,0.25)",
          }}
          data-testid="button-enable-notifications"
        >
          <div className="w-8 h-8 rounded-xl bg-purple-500/20 flex items-center justify-center flex-shrink-0">
            {notifPermission === "denied" ? (
              <BellOff className="w-4 h-4 text-muted-foreground" />
            ) : (
              <Bell className="w-4 h-4 text-primary" />
            )}
          </div>
          <div>
            <p className="text-sm font-bold text-foreground">
              {notifPermission === "denied" ? "Notifications blocked" : notifLoading ? "Enabling…" : "Enable notifications"}
            </p>
            <p className="text-xs text-muted-foreground">
              {notifPermission === "denied"
                ? "Allow in browser settings"
                : "Get alerted when mining ends"}
            </p>
          </div>
        </button>
      )}
    </div>
  );
}
