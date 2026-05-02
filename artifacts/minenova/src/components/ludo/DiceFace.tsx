import { useEffect, useState } from "react";

const DOT_POSITIONS: Record<number, [number, number][]> = {
  1: [[50, 50]],
  2: [[25, 25], [75, 75]],
  3: [[25, 25], [50, 50], [75, 75]],
  4: [[25, 25], [75, 25], [25, 75], [75, 75]],
  5: [[25, 25], [75, 25], [50, 50], [25, 75], [75, 75]],
  6: [[25, 20], [75, 20], [25, 50], [75, 50], [25, 80], [75, 80]],
};

interface DiceFaceProps {
  value: number | null;
  rolling: boolean;
  size?: number;
}

export default function DiceFace({ value, rolling, size = 64 }: DiceFaceProps) {
  const [displayValue, setDisplayValue] = useState<number>(value ?? 1);
  const [animFrame, setAnimFrame] = useState(0);

  useEffect(() => {
    if (!rolling) {
      if (value !== null) setDisplayValue(value);
      return;
    }
    let frame = 0;
    const iv = setInterval(() => {
      setDisplayValue(Math.ceil(Math.random() * 6));
      setAnimFrame(f => f + 1);
      frame++;
      if (frame > 8) clearInterval(iv);
    }, 80);
    return () => clearInterval(iv);
  }, [rolling, value]);

  const dots = DOT_POSITIONS[displayValue] ?? DOT_POSITIONS[1];

  return (
    <div
      className="relative select-none"
      style={{
        width: size,
        height: size,
        transform: rolling ? `rotate(${animFrame * 45}deg)` : "rotate(0deg)",
        transition: rolling ? "transform 0.08s linear" : "transform 0.3s ease",
      }}
    >
      <svg viewBox="0 0 100 100" width={size} height={size}>
        <rect
          x="2" y="2" width="96" height="96"
          rx="18" ry="18"
          fill="white"
          stroke="#e2e8f0"
          strokeWidth="3"
        />
        {dots.map(([cx, cy], i) => (
          <circle key={i} cx={cx} cy={cy} r="9" fill="#1e293b" />
        ))}
      </svg>
    </div>
  );
}
