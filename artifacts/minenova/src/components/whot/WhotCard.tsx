import { type WhotCard as WhotCardType, type WhotCardSuit } from "@/lib/whotApi";

// ── Ink colour per suit ───────────────────────────────────────────────────────
const SUIT_INK: Record<WhotCardSuit, string> = {
  Circle:   "#9b1c1c",
  Triangle: "#5b21b6",
  Cross:    "#0369a1",
  Square:   "#92400e",
  Star:     "#166534",
  WHOT:     "#78350f",
};

// ── Subtle face tint per suit (cream base + hint of suit colour) ─────────────
const SUIT_BG: Record<WhotCardSuit, [string, string]> = {
  Circle:   ["#fff8f8", "#fdecea"],
  Triangle: ["#faf8ff", "#f0ebff"],
  Cross:    ["#f6fbff", "#e8f4fd"],
  Square:   ["#fffdf5", "#fef3c7"],
  Star:     ["#f5fff8", "#dcfce7"],
  WHOT:     ["#fffbeb", "#fef3c7"],
};

// ── Border accent per suit ────────────────────────────────────────────────────
const SUIT_BORDER: Record<WhotCardSuit, string> = {
  Circle:   "#fca5a5",
  Triangle: "#c4b5fd",
  Cross:    "#93c5fd",
  Square:   "#fcd34d",
  Star:     "#86efac",
  WHOT:     "#fcd34d",
};

const SIZE_DIMS: Record<string, { w: number; h: number }> = {
  sm: { w: 40, h: 57 },
  md: { w: 56, h: 80 },
  lg: { w: 68, h: 97 },
};

// ── Action badge label for special card values ────────────────────────────────
function getActionBadge(suit: WhotCardSuit, value: number): { label: string; color: string } | null {
  if (suit === "WHOT") return null;
  switch (value) {
    case 1:  return { label: "HOLD", color: "#7c3aed" };
    case 2:  return { label: "+2",   color: "#dc2626" };
    case 5:  return { label: "+3",   color: "#ea580c" };
    case 8:  return { label: "SKIP", color: "#0284c7" };
    case 14: return { label: "MARKET", color: "#16a34a" };
    default: return null;
  }
}

// ── Star polygon helper ───────────────────────────────────────────────────────
function starPoints(cx: number, cy: number, or_: number, ir: number): string {
  return Array.from({ length: 10 }, (_, i) => {
    const a = (i * Math.PI) / 5 - Math.PI / 2;
    const r = i % 2 === 0 ? or_ : ir;
    return `${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`;
  }).join(" ");
}

// ── Cross path helper ─────────────────────────────────────────────────────────
function crossPath(cx: number, cy: number, aw: number, ar: number): string {
  const f = (n: number) => n.toFixed(1);
  return [
    `M${f(cx - aw)},${f(cy - ar)}`, `h${aw * 2}`, `v${ar - aw}`, `h${ar - aw}`,
    `v${aw * 2}`, `h${-(ar - aw)}`, `v${ar - aw}`, `h${-aw * 2}`,
    `v${-(ar - aw)}`, `h${-(ar - aw)}`, `v${-aw * 2}`, `h${ar - aw}`, "z",
  ].join(" ");
}

// ── Large center suit shape (viewBox 0 0 70 100) ─────────────────────────────
function CenterShape({ suit, ink }: { suit: WhotCardSuit; ink: string }) {
  switch (suit) {
    case "Triangle":
      return <polygon points="35,18 66,74 4,74" fill={ink} />;
    case "Circle":
      return <circle cx="35" cy="52" r="27" fill={ink} />;
    case "Cross":
      return <path fill={ink} d={crossPath(35, 52, 11, 27)} />;
    case "Square":
      return <rect x="7" y="25" width="56" height="56" rx="2" fill={ink} />;
    case "Star":
      return <polygon points={starPoints(35, 51, 29, 12)} fill={ink} />;
    case "WHOT":
      return (
        <g>
          <defs>
            <linearGradient id="whotTextGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%"   stopColor="#d97706" />
              <stop offset="40%"  stopColor="#f59e0b" />
              <stop offset="70%"  stopColor="#dc2626" />
              <stop offset="100%" stopColor="#7c3aed" />
            </linearGradient>
          </defs>
          {/* Decorative sparkle dots */}
          <circle cx="12" cy="24" r="2.5" fill="#f59e0b" opacity="0.7" />
          <circle cx="58" cy="24" r="2"   fill="#ec4899" opacity="0.7" />
          <circle cx="12" cy="76" r="2"   fill="#0ea5e9" opacity="0.7" />
          <circle cx="58" cy="76" r="2.5" fill="#16a34a" opacity="0.7" />
          {/* Star sparkles */}
          <polygon points={starPoints(62, 38, 4, 1.6)} fill="#f59e0b" opacity="0.8" />
          <polygon points={starPoints(8,  62, 3, 1.2)} fill="#ec4899" opacity="0.8" />
          {/* Main WHOT text with gradient */}
          <text x="35" y="47" textAnchor="middle" fontSize="16"
            fontWeight="900" fontFamily="Georgia, serif" letterSpacing="2"
            fill="url(#whotTextGrad)">
            WHOT
          </text>
          <text x="35" y="62" textAnchor="middle" fontSize="11"
            fontStyle="italic" fontFamily="Georgia, serif"
            fill="#92400e" opacity="0.75">
            Call Suit
          </text>
          {/* Small mini suit icons representing all suits */}
          <circle cx="20" cy="74" r="3.5" fill="#9b1c1c" opacity="0.6" />
          <polygon points="27,70.5 30.6,77 23.4,77" fill="#5b21b6" opacity="0.6" />
          <path d={crossPath(35, 74, 2.2, 5.5)} fill="#0369a1" opacity="0.6" />
          <rect x="38.8" y="69.5" width="7" height="7" rx="0.8" fill="#92400e" opacity="0.6" />
          <polygon points={starPoints(51, 73.5, 4.5, 1.8)} fill="#166534" opacity="0.6" />
        </g>
      );
    default:
      return null;
  }
}

// ── Small corner suit shape ───────────────────────────────────────────────────
function CornerShape({ suit, x, y, ink }: { suit: WhotCardSuit; x: number; y: number; ink: string }) {
  const r = 4.5;
  switch (suit) {
    case "Triangle":
      return <polygon points={`${x},${y - r} ${x + r * 0.866},${y + r * 0.5} ${x - r * 0.866},${y + r * 0.5}`} fill={ink} />;
    case "Circle":
      return <circle cx={x} cy={y} r={r} fill={ink} />;
    case "Cross":
      return <path fill={ink} d={crossPath(x, y, 1.9, 4.6)} />;
    case "Square":
      return <rect x={x - r} y={y - r} width={r * 2} height={r * 2} fill={ink} />;
    case "Star":
      return <polygon points={starPoints(x, y, r, r * 0.42)} fill={ink} />;
    case "WHOT":
      return (
        <text x={x} y={y + 3.5} textAnchor="middle" fontSize="7"
          fontWeight="900" fontFamily="Georgia, serif" fill="#d97706">
          W
        </text>
      );
    default:
      return null;
  }
}

// ── Card component ────────────────────────────────────────────────────────────
interface WhotCardProps {
  card: WhotCardType;
  selectable?: boolean;
  selected?: boolean;
  onClick?: () => void;
  size?: "sm" | "md" | "lg";
  faceDown?: boolean;
  dimmed?: boolean;
  animate?: "land" | "draw";
}

export default function WhotCard({
  card,
  selectable = false,
  selected = false,
  onClick,
  size = "md",
  faceDown = false,
  dimmed = false,
  animate,
}: WhotCardProps) {
  const { w, h } = SIZE_DIMS[size];
  const animClass = animate === "land" ? "card-land" : animate === "draw" ? "card-draw" : "";

  // ── Face-down / card back ─────────────────────────────────────────────────
  if (faceDown || (card.suit === "WHOT" && card.value === 0)) {
    return (
      <div
        className={`rounded-md flex-shrink-0 select-none overflow-hidden ${animClass}`}
        style={{ width: w, height: h }}
      >
        <svg viewBox="0 0 70 100" width={w} height={h} style={{ display: "block" }}>
          <defs>
            <pattern id="backStripe" x="0" y="0" width="8" height="8" patternUnits="userSpaceOnUse">
              <line x1="0" y1="8" x2="8" y2="0" stroke="rgba(255,255,255,0.09)" strokeWidth="1.5" />
            </pattern>
            <linearGradient id="backGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%"   stopColor="#1e1b4b" />
              <stop offset="50%"  stopColor="#312e81" />
              <stop offset="100%" stopColor="#1e1b4b" />
            </linearGradient>
          </defs>
          <rect width="70" height="100" rx="4" fill="url(#backGrad)" />
          <rect width="70" height="100" rx="4" fill="url(#backStripe)" />
          <rect x="4" y="4" width="62" height="92" rx="2" fill="none"
            stroke="rgba(255,255,255,0.15)" strokeWidth="1" />
          <text x="35" y="57" textAnchor="middle" dominantBaseline="middle"
            fontSize="22" fontWeight="900" fontFamily="Georgia, serif"
            fill="rgba(255,255,255,0.18)">W</text>
        </svg>
      </div>
    );
  }

  // ── Card face ─────────────────────────────────────────────────────────────
  const isWhot = card.suit === "WHOT";
  const valueLabel = isWhot ? "20" : String(card.value);
  const suit = card.suit;
  const ink = SUIT_INK[suit];
  const [bgTop, bgBot] = SUIT_BG[suit];
  const borderAccent = SUIT_BORDER[suit];
  const badge = getActionBadge(suit, card.value);

  // WHOT card gets a special rainbow border shimmer
  const whotGlowStyle = isWhot ? {
    boxShadow: "0 0 0 1.5px #f59e0b, 0 2px 8px rgba(245,158,11,0.35)",
  } : {};

  return (
    <div
      onClick={selectable && !dimmed ? onClick : undefined}
      className={[
        `rounded-md flex-shrink-0 select-none overflow-hidden transition-all duration-150 ${animClass}`,
        selectable && !dimmed ? "cursor-pointer active:scale-95" : "cursor-default",
        selected ? "ring-2 ring-amber-400 -translate-y-3 scale-105 shadow-xl" : "",
        dimmed ? "opacity-25 saturate-50" : "",
        selectable && !selected && !dimmed ? "hover:-translate-y-1 hover:shadow-md" : "",
      ].join(" ")}
      style={{ width: w, height: h, ...whotGlowStyle }}
    >
      <svg viewBox="0 0 70 100" width={w} height={h} style={{ display: "block" }}>
        <defs>
          {/* Per-card face gradient */}
          <linearGradient id={`faceGrad-${suit}`} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%"   stopColor={bgTop} />
            <stop offset="100%" stopColor={bgBot} />
          </linearGradient>
          {/* WHOT rainbow background */}
          {isWhot && (
            <linearGradient id="whotBg" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%"   stopColor="#fffbeb" />
              <stop offset="30%"  stopColor="#fff7ed" />
              <stop offset="60%"  stopColor="#fef9ee" />
              <stop offset="100%" stopColor="#fffde7" />
            </linearGradient>
          )}
        </defs>

        {/* Shadow rim */}
        <rect x="0.5" y="0.5" width="69" height="99" rx="4.5"
          fill={isWhot ? "#d97706" : borderAccent} opacity={isWhot ? 0.9 : 0.55} />

        {/* Card face */}
        <rect x="1.5" y="1.5" width="67" height="97" rx="3.5"
          fill={isWhot ? "url(#whotBg)" : `url(#faceGrad-${suit})`} />

        {/* Inner border line */}
        <rect x="3.5" y="3.5" width="63" height="93" rx="2"
          fill="none" stroke={isWhot ? "#d97706" : ink} strokeWidth="0.8"
          opacity={isWhot ? 0.55 : 0.4} strokeDasharray={isWhot ? "3 2" : undefined} />

        {/* ── Top-left corner ─────────────────────────────── */}
        <text x="7.5" y="17" fontSize="13" fontWeight="900"
          fontFamily="Arial Black, Arial, sans-serif"
          fill={isWhot ? "#92400e" : ink}>
          {valueLabel}
        </text>
        <CornerShape suit={suit} x={9.5} y={26} ink={ink} />

        {/* ── Center suit shape ────────────────────────────── */}
        <CenterShape suit={suit} ink={ink} />

        {/* ── Action badge ─────────────────────────────────── */}
        {badge && (
          <g>
            <rect x="17" y="83" width="36" height="12" rx="6"
              fill={badge.color} opacity="0.92" />
            <text x="35" y="92.5" textAnchor="middle" fontSize="7.5"
              fontWeight="900" fontFamily="Arial Black, Arial, sans-serif"
              fill="white" letterSpacing="0.5">
              {badge.label}
            </text>
          </g>
        )}

        {/* ── Bottom-right corner (rotated 180°) ───────────── */}
        <g transform="translate(70,100) rotate(180)">
          <text x="7.5" y="17" fontSize="13" fontWeight="900"
            fontFamily="Arial Black, Arial, sans-serif"
            fill={isWhot ? "#92400e" : ink}>
            {valueLabel}
          </text>
          <CornerShape suit={suit} x={9.5} y={26} ink={ink} />
        </g>
      </svg>
    </div>
  );
}
