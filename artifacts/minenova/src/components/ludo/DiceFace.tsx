import { motion } from "framer-motion";
import { useEffect, useState } from "react";

const DOTS: Record<number, [number, number][]> = {
  1: [[50, 50]],
  2: [[28, 28], [72, 72]],
  3: [[28, 28], [50, 50], [72, 72]],
  4: [[28, 28], [72, 28], [28, 72], [72, 72]],
  5: [[28, 28], [72, 28], [50, 50], [28, 72], [72, 72]],
  6: [[28, 22], [72, 22], [28, 50], [72, 50], [28, 78], [72, 78]],
};

const FACE_BG: Record<number, string> = {
  1: "#ffffff",
  2: "#edf0ff",
  3: "#f4f6ff",
  4: "#dde2f4",
  5: "#e8ecff",
  6: "#d4d8ee",
};

const FR: Record<number, [number, number]> = {
  1: [0, 0],
  2: [0, -90],
  3: [90, 0],
  4: [-90, 0],
  5: [0, 90],
  6: [0, 180],
};

const BASE_RX = -20;
const BASE_RY = 25;

interface DiceFaceProps {
  value: number | null;
  rolling: boolean;
  size?: number;
  onRoll?: () => void;
  canRoll?: boolean;
}

function CubeFace({ face, s }: { face: number; s: number }) {
  const dots = DOTS[face] ?? [];
  return (
    <div
      style={{
        width: s,
        height: s,
        background: FACE_BG[face] ?? "#fff",
        borderRadius: s * 0.14,
        border: "1.5px solid rgba(180,190,220,0.7)",
        boxShadow: "inset 0 3px 8px rgba(255,255,255,0.85), inset 0 -2px 5px rgba(0,0,0,0.07)",
        overflow: "hidden",
        position: "relative",
      }}
    >
      <svg viewBox="0 0 100 100" width={s} height={s} style={{ position: "absolute", top: 0, left: 0 }}>
        <rect x={2} y={2} width={96} height={96} rx={12}
          fill="none" stroke="rgba(255,255,255,0.95)" strokeWidth={4}
          strokeDasharray="40 400" strokeDashoffset="-2" />
        <rect x={2} y={2} width={96} height={96} rx={12}
          fill="none" stroke="rgba(0,0,0,0.08)" strokeWidth={3}
          strokeDasharray="45 400" strokeDashoffset="-145" />
        {dots.map(([cx, cy], i) => (
          <g key={i}>
            <circle cx={cx + 1.2} cy={cy + 1.8} r={9} fill="rgba(0,0,0,0.22)" />
            <circle cx={cx} cy={cy} r={9} fill="#0f172a" />
            <circle cx={cx - 2.5} cy={cy - 2.5} r={2.8} fill="rgba(255,255,255,0.32)" />
          </g>
        ))}
      </svg>
    </div>
  );
}

export default function DiceFace({ value, rolling, size = 64, onRoll, canRoll }: DiceFaceProps) {
  const [shown, setShown] = useState<number>(value ?? 1);
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    if (rolling) {
      setSettled(false);
      let i = 0;
      const iv = setInterval(() => {
        setShown(Math.ceil(Math.random() * 6));
        if (++i > 14) clearInterval(iv);
      }, 50);
      return () => clearInterval(iv);
    } else {
      if (value != null) {
        setShown(value);
        setSettled(true);
        const t = setTimeout(() => setSettled(false), 700);
        return () => clearTimeout(t);
      }
      return undefined;
    }
  }, [rolling, value]);

  const half = size / 2;
  const [frx, fry] = FR[shown] ?? FR[1];
  const rx = BASE_RX + frx;
  const ry = BASE_RY + fry;

  return (
    <div
      onClick={canRoll && !rolling ? onRoll : undefined}
      style={{
        width: size + 12,
        height: size + 12,
        cursor: canRoll && !rolling ? "pointer" : "default",
        perspective: "520px",
        position: "relative",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div style={{
        position: "absolute",
        bottom: 0,
        left: "18%",
        width: "64%",
        height: 10,
        background: "rgba(0,0,0,0.4)",
        borderRadius: "50%",
        filter: "blur(6px)",
      }} />

      <motion.div
        style={{
          width: size,
          height: size,
          position: "relative",
          transformStyle: "preserve-3d",
        }}
        animate={
          rolling
            ? {
                rotateX: [BASE_RX, BASE_RX - 180, BASE_RX - 360, BASE_RX - 540, BASE_RX - 720],
                rotateY: [BASE_RY, BASE_RY + 150, BASE_RY + 300, BASE_RY + 450, BASE_RY + 600],
                rotateZ: [0, 12, -9, 6, -3, 0],
                scale: [1, 1.14, 0.88, 1.1, 0.94, 1],
              }
            : settled
            ? {
                rotateX: [rx + 45, rx - 10, rx + 4, rx - 1, rx],
                rotateY: [ry, ry],
                scale: [1.28, 0.80, 1.10, 0.96, 1],
              }
            : {
                rotateX: rx,
                rotateY: ry,
                scale: 1,
                rotateZ: 0,
              }
        }
        transition={
          rolling
            ? { duration: 0.52, repeat: Infinity, ease: "linear" }
            : settled
            ? { duration: 0.48, ease: "easeOut" }
            : { duration: 0.32, ease: "easeInOut" }
        }
      >
        {([
          [1, `translateZ(${half}px)`],
          [6, `rotateY(180deg) translateZ(${half}px)`],
          [2, `rotateY(90deg) translateZ(${half}px)`],
          [5, `rotateY(-90deg) translateZ(${half}px)`],
          [3, `rotateX(-90deg) translateZ(${half}px)`],
          [4, `rotateX(90deg) translateZ(${half}px)`],
        ] as [number, string][]).map(([face, tf]) => (
          <div
            key={face}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              transform: tf,
              backfaceVisibility: "hidden",
              WebkitBackfaceVisibility: "hidden",
            }}
          >
            <CubeFace face={face} s={size} />
          </div>
        ))}
      </motion.div>
    </div>
  );
}
