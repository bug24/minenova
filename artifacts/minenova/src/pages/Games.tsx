import { Link } from "wouter";
import { ChevronRight, Trophy } from "lucide-react";

function LudoArt() {
  return (
    <svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
      {/* Board quadrants */}
      <rect x="2" y="2" width="50" height="50" rx="6" fill="#ef4444" fillOpacity="0.35" />
      <rect x="68" y="2" width="50" height="50" rx="6" fill="#3b82f6" fillOpacity="0.35" />
      <rect x="2" y="68" width="50" height="50" rx="6" fill="#22c55e" fillOpacity="0.35" />
      <rect x="68" y="68" width="50" height="50" rx="6" fill="#eab308" fillOpacity="0.35" />
      {/* Home circles */}
      <circle cx="27" cy="27" r="14" fill="white" fillOpacity="0.2" stroke="white" strokeOpacity="0.4" strokeWidth="1.5" />
      <circle cx="93" cy="27" r="14" fill="white" fillOpacity="0.2" stroke="white" strokeOpacity="0.4" strokeWidth="1.5" />
      <circle cx="27" cy="93" r="14" fill="white" fillOpacity="0.2" stroke="white" strokeOpacity="0.4" strokeWidth="1.5" />
      <circle cx="93" cy="93" r="14" fill="white" fillOpacity="0.2" stroke="white" strokeOpacity="0.4" strokeWidth="1.5" />
      {/* Center safe zone */}
      <rect x="40" y="40" width="40" height="40" rx="4" fill="white" fillOpacity="0.12" />
      {/* Star in center */}
      <polygon points="60,44 63,54 73,54 65,60 68,70 60,64 52,70 55,60 47,54 57,54" fill="white" fillOpacity="0.35" />
      {/* Pieces */}
      <circle cx="21" cy="21" r="5" fill="#ef4444" stroke="white" strokeWidth="1.5" />
      <circle cx="33" cy="21" r="5" fill="#ef4444" stroke="white" strokeWidth="1.5" />
      <circle cx="21" cy="33" r="5" fill="#ef4444" stroke="white" strokeWidth="1.5" />
      <circle cx="87" cy="21" r="5" fill="#3b82f6" stroke="white" strokeWidth="1.5" />
      <circle cx="27" cy="87" r="5" fill="#22c55e" stroke="white" strokeWidth="1.5" />
      <circle cx="87" cy="87" r="5" fill="#eab308" stroke="white" strokeWidth="1.5" />
      <circle cx="99" cy="87" r="5" fill="#eab308" stroke="white" strokeWidth="1.5" />
      {/* Path lines */}
      <line x1="52" y1="52" x2="68" y2="52" stroke="white" strokeOpacity="0.2" strokeWidth="1" />
      <line x1="68" y1="52" x2="68" y2="68" stroke="white" strokeOpacity="0.2" strokeWidth="1" />
      <line x1="52" y1="68" x2="68" y2="68" stroke="white" strokeOpacity="0.2" strokeWidth="1" />
      <line x1="52" y1="52" x2="52" y2="68" stroke="white" strokeOpacity="0.2" strokeWidth="1" />
    </svg>
  );
}

function WhotArt() {
  return (
    <svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
      {/* Back card */}
      <rect x="10" y="18" width="60" height="84" rx="8" fill="white" fillOpacity="0.1" stroke="white" strokeOpacity="0.25" strokeWidth="1.5" transform="rotate(-12 40 60)" />
      {/* Middle card */}
      <rect x="22" y="14" width="60" height="84" rx="8" fill="white" fillOpacity="0.15" stroke="white" strokeOpacity="0.35" strokeWidth="1.5" transform="rotate(-4 52 56)" />
      {/* Front card */}
      <rect x="30" y="12" width="60" height="84" rx="8" fill="white" fillOpacity="0.22" stroke="white" strokeOpacity="0.5" strokeWidth="1.5" />
      {/* WHOT text on front card */}
      <text x="60" y="46" textAnchor="middle" fill="white" fillOpacity="0.9" fontSize="13" fontWeight="800" fontFamily="sans-serif">WHOT</text>
      {/* Circle symbol */}
      <circle cx="60" cy="66" r="14" fill="none" stroke="white" strokeOpacity="0.7" strokeWidth="2.5" />
      <text x="60" y="71" textAnchor="middle" fill="white" fillOpacity="0.8" fontSize="11" fontWeight="700" fontFamily="sans-serif">20</text>
      {/* Corner pips */}
      <text x="37" y="30" fill="white" fillOpacity="0.7" fontSize="9" fontWeight="700" fontFamily="sans-serif">W</text>
      <text x="75" y="90" fill="white" fillOpacity="0.7" fontSize="9" fontWeight="700" fontFamily="sans-serif" transform="rotate(180 82 87)">W</text>
      {/* Suit dots */}
      <circle cx="37" cy="80" r="3" fill="white" fillOpacity="0.5" />
      <circle cx="83" cy="36" r="3" fill="white" fillOpacity="0.5" />
    </svg>
  );
}

function MinesArt() {
  const grid = [
    [null, "gem", null, null],
    ["gem", null, "mine", null],
    [null, null, "gem", null],
    [null, "gem", null, null],
  ];
  const cellSize = 22;
  const gap = 4;
  const cols = 4;
  const rows = 4;
  const totalW = cols * cellSize + (cols - 1) * gap;
  const totalH = rows * cellSize + (rows - 1) * gap;
  const offsetX = (120 - totalW) / 2;
  const offsetY = (120 - totalH) / 2;

  return (
    <svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
      {grid.map((row, ri) =>
        row.map((cell, ci) => {
          const x = offsetX + ci * (cellSize + gap);
          const y = offsetY + ri * (cellSize + gap);
          const cx = x + cellSize / 2;
          const cy = y + cellSize / 2;
          return (
            <g key={`${ri}-${ci}`}>
              <rect
                x={x} y={y} width={cellSize} height={cellSize} rx="5"
                fill={cell === "gem" ? "rgba(255,255,255,0.22)" : cell === "mine" ? "rgba(255,80,80,0.28)" : "rgba(255,255,255,0.10)"}
                stroke="white"
                strokeOpacity={cell ? 0.45 : 0.18}
                strokeWidth="1"
              />
              {cell === "gem" && (
                <>
                  <polygon
                    points={`${cx},${cy - 7} ${cx + 6},${cy} ${cx},${cy + 7} ${cx - 6},${cy}`}
                    fill="white" fillOpacity="0.8"
                  />
                  <polygon
                    points={`${cx},${cy - 7} ${cx + 6},${cy} ${cx},${cy + 1}`}
                    fill="white" fillOpacity="0.45"
                  />
                </>
              )}
              {cell === "mine" && (
                <>
                  <circle cx={cx} cy={cy} r="6" fill="#ff5050" fillOpacity="0.85" />
                  <line x1={cx - 8} y1={cy} x2={cx + 8} y2={cy} stroke="white" strokeOpacity="0.8" strokeWidth="1.5" />
                  <line x1={cx} y1={cy - 8} x2={cx} y2={cy + 8} stroke="white" strokeOpacity="0.8" strokeWidth="1.5" />
                  <line x1={cx - 6} y1={cy - 6} x2={cx + 6} y2={cy + 6} stroke="white" strokeOpacity="0.8" strokeWidth="1.5" />
                  <line x1={cx + 6} y1={cy - 6} x2={cx - 6} y2={cy + 6} stroke="white" strokeOpacity="0.8" strokeWidth="1.5" />
                  <circle cx={cx} cy={cy} r="3.5" fill="white" fillOpacity="0.9" />
                </>
              )}
            </g>
          );
        })
      )}
      {/* Multiplier banner */}
      <rect x="28" y="94" width="64" height="18" rx="9" fill="white" fillOpacity="0.18" />
      <text x="60" y="106" textAnchor="middle" fill="white" fillOpacity="0.9" fontSize="10" fontWeight="800" fontFamily="sans-serif">3.20×  CASHOUT</text>
    </svg>
  );
}

function TriviaArt() {
  return (
    <svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
      {/* Background hexagons */}
      <polygon points="60,8 88,24 88,56 60,72 32,56 32,24" fill="white" fillOpacity="0.08" stroke="white" strokeOpacity="0.2" strokeWidth="1.5" />
      <polygon points="60,18 80,30 80,54 60,66 40,54 40,30" fill="white" fillOpacity="0.08" stroke="white" strokeOpacity="0.25" strokeWidth="1" />
      {/* Big question mark */}
      <text x="60" y="60" textAnchor="middle" fill="white" fillOpacity="0.85" fontSize="36" fontWeight="900" fontFamily="serif">?</text>
      {/* Blockchain chain links */}
      <rect x="18" y="78" width="20" height="12" rx="6" fill="none" stroke="white" strokeOpacity="0.45" strokeWidth="2" />
      <rect x="34" y="78" width="20" height="12" rx="6" fill="none" stroke="white" strokeOpacity="0.45" strokeWidth="2" />
      <rect x="50" y="78" width="20" height="12" rx="6" fill="none" stroke="white" strokeOpacity="0.45" strokeWidth="2" />
      <rect x="66" y="78" width="20" height="12" rx="6" fill="none" stroke="white" strokeOpacity="0.45" strokeWidth="2" />
      <rect x="82" y="78" width="20" height="12" rx="6" fill="none" stroke="white" strokeOpacity="0.45" strokeWidth="2" />
      {/* Answer options */}
      <rect x="16" y="97" width="38" height="14" rx="7" fill="white" fillOpacity="0.15" />
      <rect x="66" y="97" width="38" height="14" rx="7" fill="white" fillOpacity="0.28" />
      <text x="35" y="108" textAnchor="middle" fill="white" fillOpacity="0.6" fontSize="8" fontWeight="600" fontFamily="sans-serif">A  BTC</text>
      <text x="85" y="108" textAnchor="middle" fill="white" fillOpacity="0.9" fontSize="8" fontWeight="700" fontFamily="sans-serif">✓  ETH</text>
      {/* Small sparkles */}
      <circle cx="20" cy="22" r="2.5" fill="white" fillOpacity="0.5" />
      <circle cx="100" cy="18" r="2" fill="white" fillOpacity="0.4" />
      <circle cx="104" cy="68" r="3" fill="white" fillOpacity="0.3" />
      <circle cx="14" cy="58" r="2" fill="white" fillOpacity="0.35" />
    </svg>
  );
}

const games = [
  {
    href: "/ludo",
    name: "Ludo",
    tagline: "Classic Board Game",
    description: "Roll the dice, race your pieces home and outrun your opponent in this classic 2-player skill game.",
    gradient: "from-violet-600 via-purple-600 to-indigo-700",
    glowColor: "rgba(139,92,246,0.45)",
    badge: "2 Players",
    testId: "game-card-ludo",
    Art: LudoArt,
  },
  {
    href: "/whot",
    name: "WHOT",
    tagline: "Nigerian Card Game",
    description: "Play the iconic West African card game. Match suits, use action cards and empty your hand first to win.",
    gradient: "from-amber-500 via-orange-500 to-red-600",
    glowColor: "rgba(245,158,11,0.4)",
    badge: "2 Players",
    testId: "game-card-whot",
    Art: WhotArt,
  },
  {
    href: "/mines",
    name: "Mines",
    tagline: "Crypto-Style Risk Game",
    description: "Pick tiles to uncover gems and grow your multiplier. Cash out before you hit a mine or lose it all.",
    gradient: "from-emerald-500 via-teal-500 to-cyan-600",
    glowColor: "rgba(16,185,129,0.4)",
    badge: "Solo",
    testId: "game-card-mines",
    Art: MinesArt,
  },
  {
    href: "/trivia",
    name: "Trivia",
    tagline: "Crypto Knowledge Quiz",
    description: "Answer 10 crypto questions, outscore your opponent and claim the pot. Test your blockchain knowledge.",
    gradient: "from-indigo-500 via-blue-500 to-sky-600",
    glowColor: "rgba(99,102,241,0.4)",
    badge: "vs Bot / PvP",
    testId: "game-card-trivia",
    Art: TriviaArt,
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
        {games.map(({ href, name, tagline, description, gradient, glowColor, badge, testId, Art }) => (
          <Link key={href} href={href}>
            <div
              data-testid={testId}
              className="group relative overflow-hidden rounded-2xl cursor-pointer active:scale-[0.98] transition-transform select-none"
              style={{ boxShadow: `0 8px 32px -4px ${glowColor}` }}
            >
              <div className={`bg-gradient-to-br ${gradient} relative`} style={{ minHeight: "110px" }}>
                {/* Subtle noise/grain overlay */}
                <div className="absolute inset-0 opacity-[0.06]"
                  style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")" }}
                />

                {/* Right-side game art (positioned absolutely) */}
                <div className="absolute right-0 top-0 bottom-0 w-[120px] opacity-70 pointer-events-none">
                  <Art />
                </div>

                {/* Left content, constrained so text doesn't overlap art */}
                <div className="relative z-10 p-4 pr-[120px]">
                  {/* Name + badge row */}
                  <div className="flex items-center gap-2 mb-1">
                    <h2 className="text-lg font-black text-white leading-tight">{name}</h2>
                    <span className="text-[10px] font-bold text-white/80 bg-white/20 px-2 py-0.5 rounded-full">
                      {badge}
                    </span>
                  </div>
                  <p className="text-[11px] font-semibold text-white/65 mb-2">{tagline}</p>
                  <p className="text-xs text-white/55 leading-relaxed">{description}</p>

                  {/* Play CTA */}
                  <div className="flex items-center gap-1 mt-3">
                    <span className="text-xs font-bold text-white/80">Play now</span>
                    <ChevronRight className="w-3.5 h-3.5 text-white/70 group-hover:translate-x-0.5 transition-transform" />
                  </div>
                </div>
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
