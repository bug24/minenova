import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Pickaxe, Zap, Users, Wallet, Shield, TrendingUp } from "lucide-react";
import { useTheme } from "@/contexts/ThemeContext";
import { Sun, Moon } from "lucide-react";

export default function Landing() {
  const { theme, toggleTheme } = useTheme();

  return (
    <div className="min-h-screen bg-background text-foreground overflow-hidden">
      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-background/80 backdrop-blur-md border-b border-border px-4 md:px-8 h-16 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-primary flex items-center justify-center pulse-glow">
            <Pickaxe className="w-4 h-4 text-primary-foreground" />
          </div>
          <span className="text-xl font-bold font-serif">MineNova</span>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={toggleTheme} data-testid="button-theme-toggle">
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

      {/* Hero Section */}
      <section className="relative flex flex-col items-center justify-center min-h-screen text-center px-4 pt-16">
        {/* Background orbs */}
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-1/4 right-1/4 w-64 h-64 bg-accent/10 rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10 max-w-3xl mx-auto">
          <div className="inline-flex items-center gap-2 bg-primary/10 border border-primary/20 rounded-full px-4 py-1.5 text-sm text-primary font-medium mb-8">
            <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
            Live Mining Active — Join 10,000+ Miners
          </div>

          <div className="float-anim inline-block mb-8">
            <div className="w-24 h-24 rounded-3xl bg-gradient-to-br from-primary to-primary/50 flex items-center justify-center pulse-glow mx-auto">
              <Pickaxe className="w-12 h-12 text-white" />
            </div>
          </div>

          <h1 className="text-4xl md:text-6xl font-black font-serif mb-6 leading-tight">
            Start Mining{" "}
            <span className="text-primary">Free Crypto</span>{" "}
            Daily
          </h1>

          <p className="text-lg md:text-xl text-muted-foreground mb-10 max-w-xl mx-auto">
            Earn USDT every day through mining sessions, completing tasks, and referring friends.
            Withdraw directly to your crypto wallet.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link href="/register">
              <Button size="lg" className="w-full sm:w-auto px-10 text-base font-semibold h-12" data-testid="hero-signup">
                Sign Up — It's Free
              </Button>
            </Link>
            <Link href="/login">
              <Button variant="outline" size="lg" className="w-full sm:w-auto px-10 text-base h-12" data-testid="hero-login">
                Login
              </Button>
            </Link>
          </div>

          <p className="mt-6 text-sm text-muted-foreground">
            Use a referral code and get <span className="text-accent font-semibold">4 bonus coins</span> instantly
          </p>
        </div>
      </section>

      {/* Features */}
      <section className="py-20 px-4 md:px-8 max-w-5xl mx-auto">
        <h2 className="text-3xl font-bold font-serif text-center mb-12">How It Works</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {[
            {
              icon: Pickaxe,
              title: "Mine Daily",
              desc: "Start a 12-hour mining session once per day. Come back to claim your rewards.",
              color: "text-primary",
              bg: "bg-primary/10",
            },
            {
              icon: Zap,
              title: "Boost Your Speed",
              desc: "Watch short videos to activate 2x and 5x speed boosts for your mining sessions.",
              color: "text-accent",
              bg: "bg-accent/10",
            },
            {
              icon: Wallet,
              title: "Withdraw USDT",
              desc: "Convert your mined coins to USDT and withdraw directly to your crypto wallet.",
              color: "text-emerald-500",
              bg: "bg-emerald-500/10",
            },
          ].map(({ icon: Icon, title, desc, color, bg }) => (
            <div key={title} className="bg-card border border-card-border rounded-2xl p-6">
              <div className={`w-12 h-12 ${bg} rounded-xl flex items-center justify-center mb-4`}>
                <Icon className={`w-6 h-6 ${color}`} />
              </div>
              <h3 className="font-semibold text-lg mb-2">{title}</h3>
              <p className="text-muted-foreground text-sm">{desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Stats */}
      <section className="py-16 px-4 bg-card border-y border-border">
        <div className="max-w-4xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
          {[
            { label: "Active Miners", value: "10,000+" },
            { label: "USDT Paid Out", value: "$50,000+" },
            { label: "Tasks Available", value: "7 Daily" },
            { label: "Referral Levels", value: "2 Tiers" },
          ].map(({ label, value }) => (
            <div key={label}>
              <div className="text-3xl font-black text-primary font-serif">{value}</div>
              <div className="text-sm text-muted-foreground mt-1">{label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* More features */}
      <section className="py-20 px-4 md:px-8 max-w-5xl mx-auto">
        <h2 className="text-3xl font-bold font-serif text-center mb-12">Everything You Need</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {[
            { icon: Users, title: "Referral System", desc: "Earn 10% from Level 1 referrals and 5% from Level 2. Build your mining network and watch passive income grow.", color: "text-purple-500", bg: "bg-purple-500/10" },
            { icon: TrendingUp, title: "Upgrade Your Rig", desc: "Spend coins or USDT to unlock advanced mining rigs with higher hash rates, daily caps, and auto-mining.", color: "text-orange-500", bg: "bg-orange-500/10" },
            { icon: Shield, title: "Secure Withdrawals", desc: "Withdraw your earnings to any USDT wallet. Minimum $5. Your funds are always safe.", color: "text-emerald-500", bg: "bg-emerald-500/10" },
            { icon: Zap, title: "Daily Tasks", desc: "Complete daily tasks for bonus coins. Share on social media, watch videos, and more.", color: "text-primary", bg: "bg-primary/10" },
          ].map(({ icon: Icon, title, desc, color, bg }) => (
            <div key={title} className="bg-card border border-card-border rounded-2xl p-6 flex gap-4">
              <div className={`w-12 h-12 ${bg} rounded-xl flex items-center justify-center flex-shrink-0`}>
                <Icon className={`w-6 h-6 ${color}`} />
              </div>
              <div>
                <h3 className="font-semibold text-lg mb-1">{title}</h3>
                <p className="text-muted-foreground text-sm">{desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 px-4 text-center">
        <div className="max-w-2xl mx-auto">
          <h2 className="text-4xl font-black font-serif mb-4">Ready to Start Mining?</h2>
          <p className="text-muted-foreground mb-8">Join thousands of miners earning daily crypto rewards.</p>
          <Link href="/register">
            <Button size="lg" className="px-12 h-14 text-lg font-bold pulse-glow" data-testid="cta-signup">
              Sign Up Free
            </Button>
          </Link>
        </div>
      </section>

      <footer className="border-t border-border py-8 px-4 text-center text-sm text-muted-foreground">
        <div className="flex items-center justify-center gap-2 mb-2">
          <Pickaxe className="w-4 h-4 text-primary" />
          <span className="font-semibold font-serif">MineNova</span>
        </div>
        <p>Mine smarter, not harder. Earn daily crypto rewards.</p>
      </footer>
    </div>
  );
}
