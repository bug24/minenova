import { Link } from "wouter";
import { Dices, Layers, Bomb, ChevronRight, Trophy } from "lucide-react";

const games = [
  {
    href: "/ludo",
    name: "Ludo",
    tagline: "Classic Board Game",
    description: "Roll the dice, race your pieces home and outrun your opponent in this classic 2-player skill game.",
    icon: Dices,
    gradient: "from-violet-600 to-indigo-700",
    badge: "2 Players",
    testId: "game-card-ludo",
  },
  {
    href: "/whot",
    name: "WHOT",
    tagline: "Nigerian Card Game",
    description: "Play the iconic West African card game. Match suits, use action cards and empty your hand first to win.",
    icon: Layers,
    gradient: "from-amber-500 to-red-600",
    badge: "2 Players",
    testId: "game-card-whot",
  },
  {
    href: "/mines",
    name: "Mines",
    tagline: "Crypto-Style Risk Game",
    description: "Pick tiles to uncover gems and grow your multiplier. Cash out before you hit a mine or lose it all.",
    icon: Bomb,
    gradient: "from-emerald-500 to-teal-600",
    badge: "Solo",
    testId: "game-card-mines",
  },
] as const;

export default function Games() {
  return (
    <div className="px-4 py-4 space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-xl font-black flex items-center gap-2">
          <Trophy className="w-6 h-6 text-primary" />
          Games
        </h1>
        <p className="text-xs text-muted-foreground">Pick a game and earn coins</p>
      </div>

      {/* Game cards */}
      <div className="space-y-4">
        {games.map(({ href, name, tagline, description, icon: Icon, gradient, badge, testId }) => (
          <Link key={href} href={href}>
            <div
              data-testid={testId}
              className="group relative overflow-hidden rounded-2xl cursor-pointer active:scale-[0.98] transition-transform select-none"
            >
              {/* Gradient background */}
              <div className={`bg-gradient-to-br ${gradient} p-3.5`}>
                {/* Top row */}
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2.5">
                    <div className="w-9 h-9 rounded-lg bg-white/20 flex items-center justify-center backdrop-blur-sm shrink-0">
                      <Icon className="w-5 h-5 text-white" />
                    </div>
                    <div>
                      <h2 className="text-base font-black text-white leading-tight">{name}</h2>
                      <p className="text-[11px] font-semibold text-white/70">{tagline}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="text-[10px] font-bold text-white/80 bg-white/15 px-2 py-0.5 rounded-full">
                      {badge}
                    </span>
                    <ChevronRight className="w-4 h-4 text-white/70 group-hover:translate-x-0.5 transition-transform" />
                  </div>
                </div>

                {/* Description */}
                <p className="text-xs text-white/60 leading-relaxed">{description}</p>

                {/* Decorative circles */}
                <div className="absolute -bottom-6 -right-6 w-24 h-24 rounded-full bg-white/5" />
                <div className="absolute -bottom-10 -right-10 w-36 h-36 rounded-full bg-white/5" />
              </div>
            </div>
          </Link>
        ))}
      </div>

      {/* Footer hint */}
      <p className="text-center text-xs text-muted-foreground pt-2">
        More games coming soon
      </p>
    </div>
  );
}
