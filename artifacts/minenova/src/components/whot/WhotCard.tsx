import { type WhotCard as WhotCardType, SUIT_SYMBOLS, SUIT_COLORS } from "@/lib/whotApi";

interface WhotCardProps {
  card: WhotCardType;
  selectable?: boolean;
  selected?: boolean;
  onClick?: () => void;
  size?: "sm" | "md" | "lg";
  faceDown?: boolean;
  dimmed?: boolean;
}

const SIZE_CLASSES = {
  sm: "w-10 h-14 text-xs",
  md: "w-14 h-20 text-sm",
  lg: "w-16 h-24 text-base",
};

export default function WhotCard({
  card,
  selectable = false,
  selected = false,
  onClick,
  size = "md",
  faceDown = false,
  dimmed = false,
}: WhotCardProps) {
  const sizeClass = SIZE_CLASSES[size];
  const color = SUIT_COLORS[card.suit] ?? "#888";
  const symbol = SUIT_SYMBOLS[card.suit] ?? "?";

  if (faceDown || (card.suit === "WHOT" && card.value === 0)) {
    return (
      <div
        className={`${sizeClass} rounded-lg border-2 border-white/10 flex items-center justify-center cursor-default select-none flex-shrink-0`}
        style={{ background: "linear-gradient(135deg, #1e1b4b, #312e81)" }}
      >
        <span className="text-white/30 font-bold text-lg">W</span>
      </div>
    );
  }

  const isWhot = card.suit === "WHOT";
  const isAction = [1, 2, 5, 8, 14].includes(card.value);

  return (
    <div
      onClick={selectable && !dimmed ? onClick : undefined}
      className={[
        sizeClass,
        "rounded-lg border-2 flex flex-col items-center justify-between p-1 select-none flex-shrink-0 transition-all",
        selectable && !dimmed ? "cursor-pointer active:scale-95" : "cursor-default",
        selected ? "ring-2 ring-amber-400 -translate-y-2 scale-105" : "",
        dimmed ? "opacity-30" : "",
        selectable && !selected && !dimmed ? "hover:brightness-110" : "",
      ].join(" ")}
      style={{
        background: isWhot
          ? "linear-gradient(135deg, #7c3aed, #ec4899)"
          : `linear-gradient(145deg, ${color}22, ${color}44)`,
        borderColor: isWhot ? "#ec4899" : color,
      }}
    >
      {/* Top left value+symbol */}
      <div className="self-start leading-none" style={{ color: isWhot ? "#fff" : color }}>
        <div className="font-black leading-none" style={{ fontSize: size === "sm" ? "10px" : "11px" }}>
          {isWhot ? "W" : card.value}
        </div>
        <div style={{ fontSize: size === "sm" ? "8px" : "9px" }}>{isWhot ? "HOT" : symbol}</div>
      </div>

      {/* Center */}
      <div
        className="font-black leading-none"
        style={{
          color: isWhot ? "#fff" : color,
          fontSize: size === "sm" ? "18px" : size === "md" ? "22px" : "26px",
        }}
      >
        {isWhot ? "W" : symbol}
      </div>

      {/* Bottom right (rotated) */}
      <div className="self-end rotate-180 leading-none" style={{ color: isWhot ? "#fff" : color }}>
        <div className="font-black leading-none" style={{ fontSize: size === "sm" ? "10px" : "11px" }}>
          {isWhot ? "W" : card.value}
        </div>
        <div style={{ fontSize: size === "sm" ? "8px" : "9px" }}>{isWhot ? "HOT" : symbol}</div>
      </div>

      {/* Action badge */}
      {isAction && size !== "sm" && (
        <div
          className="absolute -top-1.5 -right-1 text-[8px] font-bold text-white rounded px-0.5"
          style={{ background: color, lineHeight: "1.3" }}
        >
          {card.value === 1 && "+1"}
          {card.value === 2 && "+2"}
          {card.value === 5 && "+3"}
          {card.value === 8 && "SKP"}
          {card.value === 14 && "MKT"}
        </div>
      )}
    </div>
  );
}
