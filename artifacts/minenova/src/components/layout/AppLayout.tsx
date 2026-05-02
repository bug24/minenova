import { Link, useLocation } from "wouter";
import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import { useLogout } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  Pickaxe,
  CheckSquare,
  Zap,
  Users,
  Wallet,
  ShoppingBag,
  User,
  Sun,
  Moon,
  MailWarning,
  X,
  Dices,
} from "lucide-react";
import WithdrawalTicker from "@/components/WithdrawalTicker";

const navItems = [
  { href: "/dashboard", label: "Mine", icon: Pickaxe },
  { href: "/tasks", label: "Tasks", icon: CheckSquare },
  { href: "/boost", label: "Boost", icon: Zap },
  { href: "/referrals", label: "Refer", icon: Users },
  { href: "/wallet", label: "Wallet", icon: Wallet },
  { href: "/ludo", label: "Ludo", icon: Dices },
  { href: "/profile", label: "Profile", icon: User },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { user } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { toast } = useToast();
  const showUpgradeBtn = location !== "/upgrades";
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [resending, setResending] = useState(false);

  const showVerifyBanner = user && !user.emailVerified && !bannerDismissed;

  const handleResend = async () => {
    setResending(true);
    try {
      const token = localStorage.getItem("minenova_token");
      const res = await fetch("/api/auth/resend-verification", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (res.ok) {
        toast({ title: "Verification email sent!", description: "Check your inbox and click the link to verify your email." });
        if (data.verificationUrl) {
          console.info("[dev] Verification URL:", data.verificationUrl);
        }
      } else {
        toast({ variant: "destructive", title: data.error || "Could not send email" });
      }
    } catch {
      toast({ variant: "destructive", title: "Connection error" });
    } finally {
      setResending(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground max-w-md mx-auto relative overflow-x-hidden">
      {/* Top Header */}
      <header className="flex items-center justify-between px-5 pt-5 pb-3 flex-shrink-0">
        <div>
          <div className="flex items-center gap-2">
            <img src="/logo.png" alt="MineNova" className="w-8 h-8 object-contain rounded-lg" />
            <span className="text-xl font-black font-serif text-foreground">MineNova</span>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">Earn Smarter. Grow Faster.</p>
        </div>
        <div className="flex items-center gap-2">
          {showUpgradeBtn && (
            <Link href="/upgrades">
              <button
                className="flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-bold text-white transition-all active:scale-95"
                style={{ background: "linear-gradient(135deg, #7c3aed, #ec4899)" }}
                data-testid="button-upgrade-header"
              >
                <ShoppingBag className="w-3.5 h-3.5" />
                Upgrade
              </button>
            </Link>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="w-8 h-8 rounded-full p-0"
            onClick={toggleTheme}
            data-testid="button-toggle-theme"
          >
            {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </Button>
        </div>
      </header>

      {/* Email Verification Banner */}
      {showVerifyBanner && (
        <div className="mx-4 mb-1 bg-amber-500/10 border border-amber-500/30 rounded-xl px-4 py-3 flex items-start gap-3" data-testid="email-verify-banner">
          <MailWarning className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-amber-500 leading-snug">Verify your email to unlock withdrawals</p>
            <p className="text-xs text-muted-foreground mt-0.5 leading-snug">
              Check your inbox for a verification link.{" "}
              <button
                onClick={handleResend}
                disabled={resending}
                className="underline text-primary disabled:opacity-50"
              >
                {resending ? "Sending…" : "Resend"}
              </button>
            </p>
          </div>
          <button onClick={() => setBannerDismissed(true)} className="text-muted-foreground hover:text-foreground shrink-0">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Main Scrollable Content */}
      <main className="flex-1 overflow-y-auto pb-24">
        {children}
      </main>

      {/* Bottom Navigation */}
      <nav className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-md bg-card border-t border-card-border dark:border-white/10 z-50">
        <div className="flex items-center justify-around px-2 py-2">
          {navItems.map(({ href, label, icon: Icon }) => {
            const isActive = location === href;
            return (
              <Link key={href} href={href}>
                <div
                  className={`flex flex-col items-center gap-1 px-3 py-1.5 rounded-xl cursor-pointer transition-all ${
                    isActive
                      ? "text-primary"
                      : "text-foreground/50 dark:text-white/55 hover:text-foreground dark:hover:text-white/80"
                  } ${isActive ? "" : "ring-1 ring-foreground/10 dark:ring-white/10"}`}
                  data-testid={`nav-${label.toLowerCase()}`}
                >
                  <div className={`relative ${isActive ? "after:absolute after:-bottom-1 after:left-1/2 after:-translate-x-1/2 after:w-1 after:h-1 after:rounded-full after:bg-primary" : ""}`}>
                    <Icon className={`w-5 h-5 ${isActive ? "text-primary" : ""}`} />
                  </div>
                  <span className={`text-[10px] font-medium ${isActive ? "text-primary" : ""}`}>
                    {label}
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      </nav>

      {/* Withdrawal Ticker */}
      <WithdrawalTicker />
    </div>
  );
}
