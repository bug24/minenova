import { type WhotCard as WhotCardType, type WhotCardSuit } from "@/lib/whotApi";

// All suits rendered in authentic dark maroon ink
const INK = "#7a1212";
const CARD_BG = "#faf7f0";

const SIZE_DIMS: Record<string, { w: number; h: number }> = {
  sm: { w: 40, h: 57 },
  md: { w: 56, h: 80 },
  lg: { w: 68, h: 97 },
};

// ── Compute 5-pointed star polygon points ────────────────────────────────────
function starPoints(cx: number, cy: number, outerR: number, innerR: number): string {
  return Array.from({ length: 10 }, (_, i) => {
    const angle = (i * Math.PI) / 5 - Math.PI / 2;
    const r = i % 2 === 0 ? outerR : innerR;
    return `${(cx + r * Math.cos(angle)).toFixed(2)},${(cy + r * Math.sin(angle)).toFixed(2)}`;
  }).join(" ");
}

// ── Cross / plus path helper ─────────────────────────────────────────────────
function crossPath(cx: number, cy: number, aw: number, ar: number): string {
  const f = (n: number) => n.toFixed(1);
  return [
    `M${f(cx - aw)},${f(cy - ar)}`,
    `h${aw * 2}`, `v${ar - aw}`, `h${ar - aw}`,
    `v${aw * 2}`, `h${-(ar - aw)}`, `v${ar - aw}`,
    `h${-aw * 2}`, `v${-(ar - aw)}`, `h${-(ar - aw)}`,
    `v${-aw * 2}`, `h${ar - aw}`, "z",
  ].join(" ");
}

// ── Large center suit shape (viewBox 0 0 70 100) ─────────────────────────────
function CenterShape({ suit }: { suit: WhotCardSuit }) {
  switch (suit) {
    case "Triangle":
      // Equilateral triangle pointing up, center ~(35, 52)
      return <polygon points="35,21 65,75 5,75" fill={INK} />;

    case "Circle":
      return <circle cx="35" cy="52" r="26" fill={INK} />;

    case "Cross":
      // Thick plus sign, arm width 11, reach 27 from center (35,52)
      return <path fill={INK} d={crossPath(35, 52, 11, 27)} />;

    case "Square":
      return <rect x="8" y="26" width="54" height="54" fill={INK} />;

    case "Star":
      return <polygon points={starPoints(35, 51, 28, 11)} fill={INK} />;

    case "WHOT":
      return (
        <g>
          <text x="35" y="44" textAnchor="middle" fontSize="15"
            fontWeight="900" fontFamily="Georgia, serif" fill={INK} letterSpacing="1.5">
            WHOT
          </text>
          <text x="35" y="60" textAnchor="middle" fontSize="12"
            fontStyle="italic" fontFamily="Georgia, serif" fill={INK}>
            Whot
          </text>
        </g>
      );
    default:
      return null;
  }
}

// ── Small corner suit shape, centered at (x, y) ──────────────────────────────
function CornerShape({ suit, x, y }: { suit: WhotCardSuit; x: number; y: number }) {
  const r = 4.5;
  switch (suit) {
    case "Triangle":
      return (
        <polygon
          points={`${x},${y - r} ${x + r * 0.866},${y + r * 0.5} ${x - r * 0.866},${y + r * 0.5}`}
          fill={INK}
        />
      );
    case "Circle":
      return <circle cx={x} cy={y} r={r} fill={INK} />;
    case "Cross":
      return <path fill={INK} d={crossPath(x, y, 1.9, 4.6)} />;
    case "Square":
      return <rect x={x - r} y={y - r} width={r * 2} height={r * 2} fill={INK} />;
    case "Star":
      return <polygon points={starPoints(x, y, r, r * 0.42)} fill={INK} />;
    case "WHOT":
      return (
        <text x={x} y={y + 3.5} textAnchor="middle" fontSize="7"
          fontWeight="900" fontFamily="Georgia, serif" fill={INK}>
          w
        </text>
      );
    default:
      return null;
  }
}

// ── Card component ───────────────────────────────────────────────────────────
interface WhotCardProps {
  card: WhotCardType;
  selectable?: boolean;
  selected?: boolean;
  onClick?: () => void;
  size?: "sm" | "md" | "lg";
  faceDown?: boolean;
  dimmed?: boolean;
}

export default function WhotCard({
  card,
  selectable = false,
  selected = false,
  onClick,
  size = "md",
  faceDown = false,
  dimmed = false,
}: WhotCardProps) {
  const { w, h } = SIZE_DIMS[size];

  // ── Face-down / card back ────────────────────────────────────────────────
  if (faceDown || (card.suit === "WHOT" && card.value === 0)) {
    return (
      <div
        className="rounded-md flex-shrink-0 select-none overflow-hidden"
        style={{ width: w, height: h }}
      >
        <svg viewBox="0 0 70 100" width={w} height={h} style={{ display: "block" }}>
          <defs>
            <pattern id="backStripe" x="0" y="0" width="8" height="8" patternUnits="userSpaceOnUse">
              <line x1="0" y1="8" x2="8" y2="0" stroke="rgba(255,255,255,0.09)" strokeWidth="1.5" />
            </pattern>
            <linearGradient id="backGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#1e1b4b" />
              <stop offset="50%" stopColor="#312e81" />
              <stop offset="100%" stopColor="#1e1b4b" />
            </linearGradient>
          </defs>
          <rect width="70" height="100" rx="4" fill="url(#backGrad)" />
          <rect width="70" height="100" rx="4" fill="url(#backStripe)" />
          {/* Inner border */}
          <rect x="4" y="4" width="62" height="92" rx="2" fill="none"
            stroke="rgba(255,255,255,0.15)" strokeWidth="1" />
          {/* W monogram */}
          <text x="35" y="57" textAnchor="middle" dominantBaseline="middle"
            fontSize="22" fontWeight="900" fontFamily="Georgia, serif"
            fill="rgba(255,255,255,0.18)">W</text>
        </svg>
      </div>
    );
  }

  // ── Card face ────────────────────────────────────────────────────────────
  const isWhot = card.suit === "WHOT";
  const valueLabel = isWhot ? "20" : String(card.value);
  const suit = card.suit;

  return (
    <div
      onClick={selectable && !dimmed ? onClick : undefined}
      className={[
        "rounded-md flex-shrink-0 select-none overflow-hidden transition-all duration-150",
        selectable && !dimmed ? "cursor-pointer active:scale-95" : "cursor-default",
        selected ? "ring-2 ring-amber-400 -translate-y-3 scale-105 shadow-xl" : "",
        dimmed ? "opacity-25 saturate-50" : "",
        selectable && !selected && !dimmed ? "hover:-translate-y-1 hover:shadow-md" : "",
      ].join(" ")}
      style={{ width: w, height: h }}
    >
      <svg viewBox="0 0 70 100" width={w} height={h} style={{ display: "block" }}>
        {/* ── Card body ─────────────────────────────────────────────── */}
        {/* Border/shadow rim */}
        <rect x="0.5" y="0.5" width="69" height="99" rx="4.5" ry="4.5"
          fill="#d4c9b0" />
        {/* Card face */}
        <rect x="1.5" y="1.5" width="67" height="97" rx="3.5" ry="3.5"
          fill={CARD_BG} />
        {/* Inner border line (authentic WHOT card detail) */}
        <rect x="3.5" y="3.5" width="63" height="93" rx="2" ry="2"
          fill="none" stroke={INK} strokeWidth="0.7" opacity="0.55" />

        {/* ── Top-left corner ──────────────────────────────────────── */}
        <text x="7.5" y="17" fontSize="13" fontWeight="900"
          fontFamily="Arial Black, Arial, sans-serif" fill={INK}>
          {valueLabel}
        </text>
        {/* Small suit indicator below the number */}
        <CornerShape suit={suit} x={9.5} y={26} />

        {/* ── Center suit shape ─────────────────────────────────────── */}
        <CenterShape suit={suit} />

        {/* ── Bottom-right corner (rotated 180°) ───────────────────── */}
        <g transform="translate(70,100) rotate(180)">
          <text x="7.5" y="17" fontSize="13" fontWeight="900"
            fontFamily="Arial Black, Arial, sans-serif" fill={INK}>
            {valueLabel}
          </text>
          <CornerShape suit={suit} x={9.5} y={26} />
        </g>
      </svg>
    </div>
  );
}
