import { Link, useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import { useLogout } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
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
} from "lucide-react";
import WithdrawalTicker from "@/components/WithdrawalTicker";

const navItems = [
  { href: "/dashboard", label: "Mine", icon: Pickaxe },
  { href: "/tasks", label: "Tasks", icon: CheckSquare },
  { href: "/boost", label: "Boost", icon: Zap },
  { href: "/referrals", label: "Refer", icon: Users },
  { href: "/wallet", label: "Wallet", icon: Wallet },
  { href: "/profile", label: "Profile", icon: User },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { user } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const showUpgradeBtn = location !== "/upgrades";

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground max-w-md mx-auto relative">
      {/* Top Header */}
      <header className="flex items-center justify-between px-5 pt-5 pb-3 flex-shrink-0">
        <div>
          <div className="flex items-center gap-2">
            <Pickaxe className="w-5 h-5 text-primary" />
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
