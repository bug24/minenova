import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Pickaxe, Zap, Users, Wallet, Shield, TrendingUp, Sun, Moon } from "lucide-react";
import { useTheme } from "@/contexts/ThemeContext";

export default function Landing() {
  const { theme, toggleTheme } = useTheme();

  return (
    <div className="min-h-screen bg-background text-foreground overflow-hidden">
      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-background/80 backdrop-blur-md border-b border-border px-4 md:px-8 h-16 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <img src="/logo.png" alt="MineNova" className="w-8 h-8 object-contain rounded-lg" />
          <span className="text-xl font-black font-serif">MineNova</span>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={toggleTheme} className="w-8 h-8 p-0 rounded-full">
            {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </Button>
          <Link href="/login">
            <Button variant="outline" size="sm" data-testid="button-login">Login</Button>
          </Link>
          <Link href="/register">
            <Button size="sm" data-testid="button-signup">Sign Up</Button>
          </Link>
        </div>
      </header>

      {/* Hero */}
      <section className="relative flex flex-col items-center justify-center min-h-screen text-center px-4 pt-16">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 rounded-full blur-3xl pointer-events-none opacity-20"
          style={{ background: "radial-gradient(circle, #7c3aed, transparent 70%)" }} />
        <div className="absolute bottom-1/4 right-1/4 w-64 h-64 rounded-full blur-3xl pointer-events-none opacity-10"
          style={{ background: "radial-gradient(circle, #a855f7, transparent 70%)" }} />

        <div className="relative z-10 max-w-2xl mx-auto">
          <div className="inline-flex items-center gap-2 bg-primary/10 border border-primary/20 rounded-full px-4 py-1.5 text-sm text-primary font-medium mb-8">
            <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
            Live Mining — Join 10,000+ Miners
          </div>

          {/* Big orb hero */}
          <div className="relative inline-flex items-center justify-center mb-10">
            <div className="absolute w-48 h-48 rounded-full opacity-30 blur-2xl"
              style={{ background: "radial-gradient(circle, #7c3aed, transparent 70%)" }} />
            <div
              className="w-36 h-36 rounded-full flex items-center justify-center orb-glow relative z-10"
              style={{
                background: "radial-gradient(circle at 35% 35%, #a855f7, #7c3aed 40%, #4c1d95 75%, #1e0a3c)",
              }}
            >
              <div className="absolute top-5 left-7 w-8 h-8 rounded-full opacity-30"
                style={{ background: "radial-gradient(circle, rgba(255,255,255,0.8) 0%, transparent 70%)" }} />
              <Pickaxe className="w-16 h-16 text-white/90 relative z-10" />
            </div>
          </div>

          <h1 className="text-4xl md:text-5xl font-black font-serif mb-4 leading-tight">
            Mine <span className="text-primary">Free Crypto</span> Daily
          </h1>
          <p className="text-base md:text-lg text-muted-foreground mb-8 max-w-md mx-auto">
            Earn USDT every day through mining sessions, daily tasks, and referrals. Withdraw directly to your wallet.
          </p>

          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link href="/register">
              <Button size="lg" className="px-10 font-semibold h-12" data-testid="hero-signup">
                Sign Up Free
              </Button>
            </Link>
            <Link href="/login">
              <Button variant="outline" size="lg" className="px-10 h-12" data-testid="hero-login">
                Login
              </Button>
            </Link>
          </div>

          <p className="mt-5 text-sm text-muted-foreground">
            Use a referral code and get <span className="text-primary font-semibold">4 bonus coins</span> instantly
          </p>
        </div>
      </section>

      {/* Features */}
      <section className="py-16 px-4 md:px-8 max-w-4xl mx-auto">
        <h2 className="text-2xl font-bold font-serif text-center mb-8">How It Works</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            { icon: Pickaxe, title: "Mine Daily", desc: "Start a 12-hour session. Come back to claim rewards.", color: "text-primary", bg: "bg-primary/10" },
            { icon: Zap, title: "Boost Speed", desc: "Activate 2x or 5x speed boosts for faster mining.", color: "text-accent", bg: "bg-accent/10" },
            { icon: Wallet, title: "Withdraw USDT", desc: "Convert coins to USDT. Minimum $5 withdrawal.", color: "text-emerald-500", bg: "bg-emerald-500/10" },
          ].map(({ icon: Icon, title, desc, color, bg }) => (
            <div key={title} className="bg-card border border-card-border rounded-2xl p-5">
              <div className={`w-10 h-10 ${bg} rounded-xl flex items-center justify-center mb-3`}>
                <Icon className={`w-5 h-5 ${color}`} />
              </div>
              <h3 className="font-semibold mb-1">{title}</h3>
              <p className="text-muted-foreground text-sm">{desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Stats */}
      <section className="py-12 px-4 bg-card border-y border-border">
        <div className="max-w-3xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-6 text-center">
          {[
            { label: "Active Miners", value: "10,000+" },
            { label: "USDT Paid Out", value: "$50,000+" },
            { label: "Daily Tasks", value: "7" },
            { label: "Referral Tiers", value: "2" },
          ].map(({ label, value }) => (
            <div key={label}>
              <div className="text-2xl font-black text-primary font-serif">{value}</div>
              <div className="text-xs text-muted-foreground mt-1">{label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* More features */}
      <section className="py-16 px-4 md:px-8 max-w-4xl mx-auto">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[
            { icon: Users, title: "Referral System", desc: "Earn 10% from Level 1 and 5% from Level 2 referrals.", color: "text-purple-400", bg: "bg-purple-500/10" },
            { icon: TrendingUp, title: "Upgrade Your Rig", desc: "Unlock advanced mining rigs with higher hash rates.", color: "text-cyan-400", bg: "bg-cyan-500/10" },
            { icon: Shield, title: "Secure Withdrawals", desc: "Withdraw to any USDT wallet. Minimum $5.", color: "text-emerald-400", bg: "bg-emerald-500/10" },
            { icon: Zap, title: "Daily Tasks", desc: "Complete tasks for bonus coins every day.", color: "text-primary", bg: "bg-primary/10" },
          ].map(({ icon: Icon, title, desc, color, bg }) => (
            <div key={title} className="bg-card border border-card-border rounded-2xl p-5 flex gap-4">
              <div className={`w-10 h-10 ${bg} rounded-xl flex items-center justify-center flex-shrink-0`}>
                <Icon className={`w-5 h-5 ${color}`} />
              </div>
              <div>
                <h3 className="font-semibold mb-0.5">{title}</h3>
                <p className="text-muted-foreground text-sm">{desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="py-16 px-4 text-center">
        <div className="max-w-sm mx-auto">
          <h2 className="text-3xl font-black font-serif mb-3">Ready to Start?</h2>
          <p className="text-muted-foreground text-sm mb-6">Join thousands of miners earning daily crypto.</p>
          <Link href="/register">
            <Button size="lg" className="px-10 h-12 font-bold w-full orb-glow" data-testid="cta-signup">
              Sign Up Free
            </Button>
          </Link>
        </div>
      </section>

      <footer className="border-t border-border py-6 px-4 text-center text-xs text-muted-foreground">
        <div className="flex items-center justify-center gap-2 mb-1">
          <Pickaxe className="w-3.5 h-3.5 text-primary" />
          <span className="font-semibold font-serif">MineNova</span>
        </div>
        <p>Mine smarter, not harder.</p>
      </footer>
    </div>
  );
}
