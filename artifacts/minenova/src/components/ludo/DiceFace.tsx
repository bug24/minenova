import { motion } from "framer-motion";
import { useEffect, useState } from "react";

const DOT_POSITIONS: Record<number, [number, number][]> = {
  1: [[50, 50]],
  2: [[30, 30], [70, 70]],
  3: [[30, 30], [50, 50], [70, 70]],
  4: [[30, 30], [70, 30], [30, 70], [70, 70]],
  5: [[30, 30], [70, 30], [50, 50], [30, 70], [70, 70]],
  6: [[30, 22], [70, 22], [30, 50], [70, 50], [30, 78], [70, 78]],
};

interface DiceFaceProps {
  value: number | null;
  rolling: boolean;
  size?: number;
}

export default function DiceFace({ value, rolling, size = 64 }: DiceFaceProps) {
  const [displayValue, setDisplayValue] = useState<number>(value ?? 1);
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    if (!rolling) {
      if (value !== null) {
        setDisplayValue(value);
        setSettled(true);
        const t = setTimeout(() => setSettled(false), 600);
        return () => clearTimeout(t);
      }
      return;
    }
    setSettled(false);
    let i = 0;
    const iv = setInterval(() => {
      setDisplayValue(Math.ceil(Math.random() * 6));
      i++;
      if (i > 14) clearInterval(iv);
    }, 55);
    return () => clearInterval(iv);
  }, [rolling, value]);

  const dots = DOT_POSITIONS[displayValue] ?? DOT_POSITIONS[1];

  return (
    <div style={{ perspective: "500px", width: size, height: size, position: "relative" }}>
      {/* Shadow */}
      <div
        style={{
          position: "absolute",
          bottom: -6,
          left: "20%",
          width: "60%",
          height: 10,
          borderRadius: "50%",
          background: "rgba(0,0,0,0.22)",
          filter: "blur(5px)",
          transformOrigin: "center",
        }}
      />
      <motion.div
        className="select-none"
        style={{ width: size, height: size, transformStyle: "preserve-3d" }}
        animate={
          rolling
            ? {
                rotateX: [0, 35, -35, 28, -22, 18, -10, 5, 0],
                rotateY: [0, -45, 45, -35, 30, -18, 12, -5, 0],
                rotateZ: [0, 10, -10, 7, -5, 2, 0],
                scale:   [1, 1.12, 0.90, 1.10, 0.95, 1.05, 1],
              }
            : settled
            ? { scale: [1.18, 0.88, 1.06, 0.97, 1], rotateX: 0, rotateY: 0, rotateZ: 0 }
            : { scale: 1, rotateX: 0, rotateY: 0, rotateZ: 0 }
        }
        transition={
          rolling
            ? { duration: 0.42, repeat: Infinity, ease: "linear" }
            : settled
            ? { duration: 0.45, ease: "easeOut", times: [0, 0.3, 0.55, 0.75, 1] }
            : { duration: 0.3 }
        }
      >
        <svg viewBox="0 0 100 100" width={size} height={size} style={{ display: "block" }}>
          <defs>
            <linearGradient id="diceBodyGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#ffffff" />
              <stop offset="100%" stopColor="#dde4ef" />
            </linearGradient>
            <filter id="diceInnerShadow">
              <feDropShadow dx="1" dy="2" stdDeviation="3" floodColor="#0f172a" floodOpacity="0.25" />
            </filter>
          </defs>

          {/* Body with inner shadow */}
          <rect x="3" y="3" width="94" height="94" rx="19" ry="19"
            fill="url(#diceBodyGrad)"
            filter="url(#diceInnerShadow)"
          />

          {/* Top-left bevel highlight */}
          <rect x="3" y="3" width="94" height="94" rx="19" ry="19"
            fill="none"
            stroke="rgba(255,255,255,0.9)"
            strokeWidth="3.5"
            strokeDasharray="55 300"
            strokeDashoffset="-5"
          />

          {/* Bottom-right edge shadow */}
          <rect x="3" y="3" width="94" height="94" rx="19" ry="19"
            fill="none"
            stroke="rgba(0,0,0,0.08)"
            strokeWidth="4"
            strokeDasharray="55 300"
            strokeDashoffset="-160"
          />

          {/* Dots */}
          {dots.map(([cx, cy], i) => (
            <g key={i}>
              {/* Dot shadow */}
              <circle cx={cx + 0.8} cy={cy + 1.2} r="8.5" fill="rgba(0,0,0,0.18)" />
              {/* Dot body */}
              <circle cx={cx} cy={cy} r="8.5" fill="#1e293b" />
              {/* Dot highlight */}
              <circle cx={cx - 2.5} cy={cy - 2.5} r="2.8" fill="rgba(255,255,255,0.22)" />
            </g>
          ))}
        </svg>
      </motion.div>
    </div>
  );
}
