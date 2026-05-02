import { useState, useEffect, useRef } from "react";
import type { GameState } from "@/lib/ludoApi";

const CELL = 46;

const TRACK_CELLS: [number, number][] = [
  [6,1],[6,2],[6,3],[6,4],[6,5],
  [5,6],[4,6],[3,6],[2,6],[1,6],[0,6],
  [0,7],[0,8],
  [1,8],[2,8],[3,8],[4,8],[5,8],
  [6,9],[6,10],[6,11],[6,12],[6,13],[6,14],
  [7,14],[8,14],
  [8,13],[8,12],[8,11],[8,10],[8,9],
  [9,8],[10,8],[11,8],[12,8],[13,8],[14,8],
  [14,7],[14,6],
  [13,6],[12,6],[11,6],[10,6],[9,6],
  [8,5],[8,4],[8,3],[8,2],[8,1],[8,0],
  [7,0],[6,0],
];

const SAFE_SET = new Set([0, 8, 13, 21, 26, 34, 39, 47]);

// Home-run corridors — each leads from the player's side into the centre
// Red   : left horizontal  (row 7, cols 1→6)
// Blue  : top  vertical    (col 7, rows 1→6)  ← Blue home is top-right
// Green : bottom vertical  (col 7, rows 13→8) ← decorative
// Yellow: right horizontal (row 7, cols 13→8) ← decorative
const RED_HOME_COL:    [number, number][] = [[7,1],[7,2],[7,3],[7,4],[7,5],[7,6]];
const BLUE_HOME_COL:   [number, number][] = [[1,7],[2,7],[3,7],[4,7],[5,7],[6,7]];
const GREEN_HOME_COL:  [number, number][] = [[13,7],[12,7],[11,7],[10,7],[9,7],[8,7]];
const YELLOW_HOME_COL: [number, number][] = [[7,13],[7,12],[7,11],[7,10],[7,9],[7,8]];

const RED_STARTS:    [number, number][] = [[1.4,1.4],[1.4,3.8],[3.8,1.4],[3.8,3.8]];
const BLUE_STARTS:   [number, number][] = [[1.4,10.4],[1.4,12.8],[3.8,10.4],[3.8,12.8]];
const GREEN_STARTS:  [number, number][] = [[10.4,1.4],[10.4,3.8],[12.8,1.4],[12.8,3.8]];
const YELLOW_STARTS: [number, number][] = [[10.4,10.4],[10.4,12.8],[12.8,10.4],[12.8,12.8]];

const PIECE_OFFSETS: [number, number][] = [[-4,-4],[4,-4],[-4,4],[4,4]];

export interface AnimPiece {
  playerIndex: 0 | 1;
  pieceIdx: number;
  steps: number[];
}

function getPieceXY(playerIndex: 0 | 1, progress: number, pieceSubIdx: number): { x: number; y: number } {
  if (progress === -1) {
    const [r, c] = playerIndex === 0 ? RED_STARTS[pieceSubIdx] : BLUE_STARTS[pieceSubIdx];
    return { x: c * CELL, y: r * CELL };
  }
  if (progress >= 52) {
    const homeCol = playerIndex === 0 ? RED_HOME_COL : BLUE_HOME_COL;
    const idx = Math.min(progress - 52, homeCol.length - 1);
    const [r, c] = homeCol[idx];
    const [dx, dy] = PIECE_OFFSETS[pieceSubIdx % 4];
    return { x: (c + 0.5) * CELL + dx * 0.5, y: (r + 0.5) * CELL + dy * 0.5 };
  }
  const entryPoint = playerIndex === 0 ? 0 : 13;
  const absPos = (entryPoint + progress) % 52;
  const [r, c] = TRACK_CELLS[absPos];
  const [dx, dy] = PIECE_OFFSETS[pieceSubIdx % 4];
  return { x: (c + 0.5) * CELL + dx, y: (r + 0.5) * CELL + dy };
}

interface LudoBoardProps {
  gameState: GameState;
  myPlayerIndex: 0 | 1;
  validMoves: number[];
  onPieceClick: (pieceIndex: number) => void;
  animPiece?: AnimPiece | null;
  onAnimDone?: () => void;
}

export default function LudoBoard({
  gameState,
  myPlayerIndex,
  validMoves,
  onPieceClick,
  animPiece,
  onAnimDone,
}: LudoBoardProps) {
  const W = 15 * CELL;
  const R = CELL * 0.36;
  const isMyTurn = gameState.currentTurn === myPlayerIndex;

  const [animStep, setAnimStep] = useState<number>(-1);
  const [capturedKeys, setCapturedKeys] = useState<Set<string>>(new Set());
  const prevPlayersRef = useRef(gameState.players);
  const onAnimDoneRef = useRef(onAnimDone);
  onAnimDoneRef.current = onAnimDone;

  // Step through animation positions
  useEffect(() => {
    if (!animPiece || animPiece.steps.length === 0) {
      setAnimStep(-1);
      return;
    }
    setAnimStep(0);
    let i = 0;
    const iv = setInterval(() => {
      i++;
      if (i >= animPiece.steps.length) {
        clearInterval(iv);
        setAnimStep(-1);
        onAnimDoneRef.current?.();
      } else {
        setAnimStep(i);
      }
    }, 185);
    return () => clearInterval(iv);
  }, [animPiece]);

  // Capture flash detection
  useEffect(() => {
    const prev = prevPlayersRef.current;
    const newlyCaptured: string[] = [];
    gameState.players.forEach((player, pi) => {
      player.pieces.forEach((piece, idx) => {
        const prevProgress = prev[pi]?.pieces[idx]?.progress;
        if (piece.progress === -1 && prevProgress !== undefined && prevProgress > -1) {
          newlyCaptured.push(`${pi}-${idx}`);
        }
      });
    });
    prevPlayersRef.current = gameState.players;
    if (newlyCaptured.length > 0) {
      setCapturedKeys(new Set(newlyCaptured));
      const t = setTimeout(() => setCapturedKeys(new Set()), 700);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [gameState.players]);

  // Override position during step animation
  const getEffectiveProgress = (pi: number, idx: number, base: number): number => {
    if (
      animPiece &&
      animPiece.playerIndex === pi &&
      animPiece.pieceIdx === idx &&
      animStep >= 0 &&
      animStep < animPiece.steps.length
    ) {
      return animPiece.steps[animStep];
    }
    return base;
  };

  return (
    <svg
      viewBox={`0 0 ${W} ${W}`}
      className="w-full h-auto select-none"
      style={{ maxHeight: "calc(100vw - 24px)", maxWidth: "calc(100vw - 24px)" }}
    >
      <defs>
        {/* Drop shadow for pieces */}
        <filter id="pieceShadow" x="-40%" y="-40%" width="180%" height="180%">
          <feDropShadow dx="0" dy="2.5" stdDeviation="2.5" floodOpacity="0.35" />
        </filter>
        {/* Gold glow for valid moves */}
        <filter id="glow" x="-40%" y="-40%" width="180%" height="180%">
          <feDropShadow dx="0" dy="0" stdDeviation="4" floodColor="#fbbf24" floodOpacity="0.9" />
        </filter>
        {/* Subtle board cell shadow */}
        <filter id="cellShadow">
          <feDropShadow dx="0" dy="1" stdDeviation="1" floodOpacity="0.1" />
        </filter>

        {/* Home area radial gradients — 3D bowl look */}
        <radialGradient id="redHomeGrad" cx="40%" cy="35%" r="65%">
          <stop offset="0%" stopColor="#fca5a5" />
          <stop offset="60%" stopColor="#ef4444" />
          <stop offset="100%" stopColor="#b91c1c" />
        </radialGradient>
        <radialGradient id="blueHomeGrad" cx="60%" cy="35%" r="65%">
          <stop offset="0%" stopColor="#bfdbfe" />
          <stop offset="60%" stopColor="#3b82f6" />
          <stop offset="100%" stopColor="#1d4ed8" />
        </radialGradient>
        <radialGradient id="greenHomeGrad" cx="40%" cy="65%" r="65%">
          <stop offset="0%" stopColor="#bbf7d0" />
          <stop offset="60%" stopColor="#16a34a" />
          <stop offset="100%" stopColor="#15803d" />
        </radialGradient>
        <radialGradient id="yellowHomeGrad" cx="60%" cy="65%" r="65%">
          <stop offset="0%" stopColor="#fef08a" />
          <stop offset="60%" stopColor="#d97706" />
          <stop offset="100%" stopColor="#92400e" />
        </radialGradient>

        {/* Piece gradients */}
        <radialGradient id="redPieceGrad" cx="35%" cy="30%" r="70%">
          <stop offset="0%" stopColor="#fca5a5" />
          <stop offset="100%" stopColor="#b91c1c" />
        </radialGradient>
        <radialGradient id="bluePieceGrad" cx="35%" cy="30%" r="70%">
          <stop offset="0%" stopColor="#bfdbfe" />
          <stop offset="100%" stopColor="#1d4ed8" />
        </radialGradient>
        <radialGradient id="goldPieceGrad" cx="35%" cy="30%" r="70%">
          <stop offset="0%" stopColor="#fef3c7" />
          <stop offset="100%" stopColor="#92400e" />
        </radialGradient>
      </defs>

      {/* ── Board background ─────────────────────────────────── */}
      <rect width={W} height={W} fill="#c8bca8" rx="6" />
      <rect x={1} y={1} width={W - 2} height={W - 2} fill="#e8dfc8" rx="5" />

      {/* ── Red home area (top-left) ─────────────────────────── */}
      <rect x={0} y={0} width={6*CELL} height={6*CELL} fill="#991b1b" />
      <rect x={CELL*0.25} y={CELL*0.25} width={5.5*CELL} height={5.5*CELL} rx="10" fill="#dc2626" />
      <rect x={CELL*0.65} y={CELL*0.65} width={4.7*CELL} height={4.7*CELL} rx="8" fill="url(#redHomeGrad)" />

      {/* ── Blue home area (top-right) ──────────────────────── */}
      <rect x={9*CELL} y={0} width={6*CELL} height={6*CELL} fill="#1e3a8a" />
      <rect x={9.25*CELL} y={CELL*0.25} width={5.5*CELL} height={5.5*CELL} rx="10" fill="#1d4ed8" />
      <rect x={9.65*CELL} y={CELL*0.65} width={4.7*CELL} height={4.7*CELL} rx="8" fill="url(#blueHomeGrad)" />

      {/* ── Green home area (bottom-left) ──────────────────── */}
      <rect x={0} y={9*CELL} width={6*CELL} height={6*CELL} fill="#14532d" />
      <rect x={CELL*0.25} y={9.25*CELL} width={5.5*CELL} height={5.5*CELL} rx="10" fill="#15803d" />
      <rect x={CELL*0.65} y={9.65*CELL} width={4.7*CELL} height={4.7*CELL} rx="8" fill="url(#greenHomeGrad)" />

      {/* ── Yellow home area (bottom-right) ─────────────────── */}
      <rect x={9*CELL} y={9*CELL} width={6*CELL} height={6*CELL} fill="#78350f" />
      <rect x={9.25*CELL} y={9.25*CELL} width={5.5*CELL} height={5.5*CELL} rx="10" fill="#b45309" />
      <rect x={9.65*CELL} y={9.65*CELL} width={4.7*CELL} height={4.7*CELL} rx="8" fill="url(#yellowHomeGrad)" />

      {/* ── Track cells ─────────────────────────────────────── */}
      {TRACK_CELLS.map(([row, col], i) => {
        const isSafe = SAFE_SET.has(i);
        const isRedEntry = i === 0;
        const isBlueEntry = i === 13;
        let fill = "#f5efe0";
        if (isRedEntry) fill = "#fca5a5";
        else if (isBlueEntry) fill = "#93c5fd";
        else if (isSafe) fill = "#fef3c7";
        return (
          <rect
            key={i}
            x={col * CELL + 0.5} y={row * CELL + 0.5}
            width={CELL - 1} height={CELL - 1}
            fill={fill}
            stroke="#b8a898"
            strokeWidth={0.8}
            rx={1}
          />
        );
      })}

      {/* ── Safe square stars ───────────────────────────────── */}
      {TRACK_CELLS.map(([row, col], i) => {
        if (!SAFE_SET.has(i) || i === 0 || i === 26) return null;
        const cx = (col + 0.5) * CELL;
        const cy = (row + 0.5) * CELL;
        return (
          <text key={`star-${i}`} x={cx} y={cy + 1}
            textAnchor="middle" dominantBaseline="middle"
            fontSize={CELL * 0.44}
            style={{ userSelect: "none", pointerEvents: "none" }}
          >⭐</text>
        );
      })}

      {/* ── Red home column — left horizontal (row 7, cols 1→6) ─────── */}
      {RED_HOME_COL.map(([row, col], i) => (
        <rect key={`rhc-${i}`}
          x={col * CELL + 0.5} y={row * CELL + 0.5}
          width={CELL - 1} height={CELL - 1}
          fill={i === 5 ? "#dc2626" : i >= 3 ? "#fca5a5" : "#fecaca"}
          stroke="#b8a898" strokeWidth={0.8} rx={1}
        />
      ))}

      {/* ── Blue home column — top vertical (col 7, rows 1→6) ────────── */}
      {BLUE_HOME_COL.map(([row, col], i) => (
        <rect key={`bhc-${i}`}
          x={col * CELL + 0.5} y={row * CELL + 0.5}
          width={CELL - 1} height={CELL - 1}
          fill={i === 5 ? "#1d4ed8" : i >= 3 ? "#93c5fd" : "#bfdbfe"}
          stroke="#b8a898" strokeWidth={0.8} rx={1}
        />
      ))}

      {/* ── Green home column — bottom vertical (col 7, rows 13→8) ───── */}
      {GREEN_HOME_COL.map(([row, col], i) => (
        <rect key={`ghc-${i}`}
          x={col * CELL + 0.5} y={row * CELL + 0.5}
          width={CELL - 1} height={CELL - 1}
          fill={i === 5 ? "#15803d" : i >= 3 ? "#86efac" : "#bbf7d0"}
          stroke="#b8a898" strokeWidth={0.8} rx={1}
        />
      ))}

      {/* ── Yellow home column — right horizontal (row 7, cols 13→8) ─── */}
      {YELLOW_HOME_COL.map(([row, col], i) => (
        <rect key={`yhc-${i}`}
          x={col * CELL + 0.5} y={row * CELL + 0.5}
          width={CELL - 1} height={CELL - 1}
          fill={i === 5 ? "#b45309" : i >= 3 ? "#fcd34d" : "#fef08a"}
          stroke="#b8a898" strokeWidth={0.8} rx={1}
        />
      ))}

      {/* ── Left edge track cells (col 0) ────────────────── */}
      {([7, 6] as const).map((row, i) => (
        <rect key={`c0-${i}`}
          x={0.5} y={row * CELL + 0.5}
          width={CELL - 1} height={CELL - 1}
          fill="#f5efe0" stroke="#b8a898" strokeWidth={0.8} rx={1}
        />
      ))}

      {/* ── Centre: 4-triangle design (colour matches each side's home corridor) ── */}
      {/* Left  → Red corridor;  Top  → Blue corridor                              */}
      {/* Right → Yellow corridor; Bottom → Green corridor                          */}
      <rect x={6*CELL} y={6*CELL} width={3*CELL} height={3*CELL} fill="#f5efe0" stroke="#b8a898" strokeWidth={0.5} />
      <polygon points={`${6*CELL},${6*CELL} ${9*CELL},${6*CELL} ${7.5*CELL},${7.5*CELL}`} fill="#93c5fd" opacity="0.9" />
      <polygon points={`${9*CELL},${9*CELL} ${6*CELL},${9*CELL} ${7.5*CELL},${7.5*CELL}`} fill="#bbf7d0" opacity="0.9" />
      <polygon points={`${6*CELL},${9*CELL} ${6*CELL},${6*CELL} ${7.5*CELL},${7.5*CELL}`} fill="#fca5a5" opacity="0.9" />
      <polygon points={`${9*CELL},${6*CELL} ${9*CELL},${9*CELL} ${7.5*CELL},${7.5*CELL}`} fill="#fde68a" opacity="0.9" />
      {/* Centre circle */}
      <circle cx={7.5*CELL} cy={7.5*CELL} r={CELL*0.46} fill="white" stroke="#b8a898" strokeWidth={1.2} />
      <circle cx={7.5*CELL} cy={7.5*CELL} r={CELL*0.3} fill="#f1f5f9" stroke="#94a3b8" strokeWidth={0.8} />

      {/* ── Piece spawn circles ──────────────────────────────── */}
      {RED_STARTS.map(([r, c], i) => (
        <g key={`rs-${i}`}>
          <circle cx={c * CELL} cy={r * CELL} r={CELL * 0.38} fill="#b91c1c" />
          <circle cx={c * CELL} cy={r * CELL} r={CELL * 0.34} fill="#fecaca" stroke="#ef4444" strokeWidth={1.5} />
        </g>
      ))}
      {BLUE_STARTS.map(([r, c], i) => (
        <g key={`bs-${i}`}>
          <circle cx={c * CELL} cy={r * CELL} r={CELL * 0.38} fill="#1e3a8a" />
          <circle cx={c * CELL} cy={r * CELL} r={CELL * 0.34} fill="#bfdbfe" stroke="#3b82f6" strokeWidth={1.5} />
        </g>
      ))}
      {GREEN_STARTS.map(([r, c], i) => (
        <g key={`gs-${i}`}>
          <circle cx={c * CELL} cy={r * CELL} r={CELL * 0.38} fill="#14532d" />
          <circle cx={c * CELL} cy={r * CELL} r={CELL * 0.34} fill="#bbf7d0" stroke="#16a34a" strokeWidth={1.5} />
        </g>
      ))}
      {YELLOW_STARTS.map(([r, c], i) => (
        <g key={`ys-${i}`}>
          <circle cx={c * CELL} cy={r * CELL} r={CELL * 0.38} fill="#78350f" />
          <circle cx={c * CELL} cy={r * CELL} r={CELL * 0.34} fill="#fef08a" stroke="#d97706" strokeWidth={1.5} />
        </g>
      ))}

      {/* ── Pieces ──────────────────────────────────────────── */}
      {gameState.players.map((player, pi) => {
        const isRed = player.color === "red";
        const pieceOuterColor = isRed ? "#7f1d1d" : "#1e3a8a";
        const pieceRimColor   = isRed ? "#dc2626" : "#1d4ed8";
        const pieceGradId     = isRed ? "redPieceGrad" : "bluePieceGrad";

        return player.pieces.map((piece, idx) => {
          const effectiveProgress = getEffectiveProgress(pi, idx, piece.progress);
          const { x, y } = getPieceXY(pi as 0 | 1, effectiveProgress, idx);
          const isValid    = pi === myPlayerIndex && isMyTurn && gameState.diceRolled && validMoves.includes(idx);
          const isFinished = piece.progress === 57;
          const justCaptured = capturedKeys.has(`${pi}-${idx}`);
          const isAnimating  = animPiece?.playerIndex === pi && animPiece?.pieceIdx === idx && animStep >= 0;

          return (
            <g
              key={`p${pi}-${idx}`}
              transform={`translate(${x}, ${y})`}
              style={{
                transition: isAnimating ? "transform 0.16s ease-out" : "transform 0.22s ease-out",
                cursor: isValid ? "pointer" : "default",
              }}
              onClick={isValid ? () => onPieceClick(idx) : undefined}
            >
              {/* Capture burst */}
              {justCaptured && (
                <circle cx={0} cy={0} r={R + 4} fill="rgba(251,191,36,0.6)">
                  <animate attributeName="r" values={`${R};${R + 18};${R + 4}`} dur="0.6s" fill="freeze" />
                  <animate attributeName="fill-opacity" values="0.8;0.4;0" dur="0.6s" fill="freeze" />
                </circle>
              )}

              {/* Pulsing glow ring for valid move */}
              {isValid && (
                <circle cx={0} cy={0} r={R + 8} fill="rgba(251,191,36,0.35)" filter="url(#glow)">
                  <animate attributeName="r" values={`${R + 5};${R + 13};${R + 5}`} dur="0.9s" repeatCount="indefinite" />
                  <animate attributeName="fill-opacity" values="0.5;0.12;0.5" dur="0.9s" repeatCount="indefinite" />
                </circle>
              )}

              {/* Step-animation trail glow */}
              {isAnimating && (
                <circle cx={0} cy={0} r={R + 5} fill="rgba(255,255,255,0.25)">
                  <animate attributeName="r" values={`${R + 3};${R + 10};${R + 3}`} dur="0.18s" repeatCount="indefinite" />
                </circle>
              )}

              {/* Outer shadow ring */}
              <circle cx={0} cy={0} r={R + 3} fill={pieceOuterColor} filter="url(#pieceShadow)" />

              {/* Rim */}
              <circle cx={0} cy={0} r={R + 1.5} fill={pieceRimColor} />

              {/* Main piece face */}
              <circle
                cx={0} cy={0} r={R}
                fill={isFinished ? "url(#goldPieceGrad)" : `url(#${pieceGradId})`}
                stroke={isFinished ? "#92400e" : pieceRimColor}
                strokeWidth={isValid ? 2.5 : 1.2}
              >
                {justCaptured && (
                  <animateTransform
                    attributeName="transform" type="scale"
                    from="1.9 1.9" to="1 1"
                    dur="0.5s" additive="sum" fill="freeze"
                  />
                )}
              </circle>

              {/* Inner shine */}
              <ellipse
                cx={-R * 0.22} cy={-R * 0.28}
                rx={R * 0.32} ry={R * 0.22}
                fill="rgba(255,255,255,0.5)"
                style={{ pointerEvents: "none" }}
              />

              {/* Crown (finished) or number label */}
              {isFinished ? (
                <text x={0} y={1}
                  textAnchor="middle" dominantBaseline="middle"
                  fontSize={R * 0.88} fill="white"
                  fontWeight="900"
                  style={{ userSelect: "none", pointerEvents: "none" }}
                >♛</text>
              ) : (
                <text x={0} y={1}
                  textAnchor="middle" dominantBaseline="middle"
                  fontSize={R * 0.78} fontWeight="800"
                  fill="white"
                  style={{ userSelect: "none", pointerEvents: "none",
                    filter: "drop-shadow(0 1px 1px rgba(0,0,0,0.5))" }}
                >{idx + 1}</text>
              )}

              {/* Invisible tap target for valid moves */}
              {isValid && (
                <rect
                  x={-CELL / 2} y={-CELL / 2}
                  width={CELL} height={CELL}
                  fill="transparent"
                  onClick={() => onPieceClick(idx)}
                  style={{ cursor: "pointer" }}
                />
              )}
            </g>
          );
        });
      })}
    </svg>
  );
}
