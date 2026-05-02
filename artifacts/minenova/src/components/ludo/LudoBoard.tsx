import { useState, useEffect, useRef } from "react";
import type { GameState } from "@/lib/ludoApi";
import DiceFace from "./DiceFace";

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
  rolling: boolean;
  diceValue: number | null;
  diceValues: [number, number] | null;
  movesLeft: number;
  activeDieIndex: 0 | 1 | null;
  canRoll: boolean;
  onDiceRoll: () => void;
  playerNames: [string, string];
  isBot?: boolean;
}

function truncateName(name: string, max = 9): string {
  return name.length > max ? name.slice(0, max - 1) + "…" : name;
}

export default function LudoBoard({
  gameState,
  myPlayerIndex,
  validMoves,
  onPieceClick,
  animPiece,
  onAnimDone,
  rolling,
  diceValue,
  diceValues,
  movesLeft,
  activeDieIndex,
  canRoll,
  onDiceRoll,
  playerNames,
  isBot,
}: LudoBoardProps) {
  const W = 15 * CELL;
  const R = CELL * 0.36;
  const isMyTurn = gameState.currentTurn === myPlayerIndex;

  const [animStep, setAnimStep] = useState<number>(-1);
  const [capturedKeys, setCapturedKeys] = useState<Set<string>>(new Set());
  const prevPlayersRef = useRef(gameState.players);
  const onAnimDoneRef = useRef(onAnimDone);
  onAnimDoneRef.current = onAnimDone;

  useEffect(() => {
    if (!animPiece || animPiece.steps.length === 0) { setAnimStep(-1); return; }
    setAnimStep(0);
    let i = 0;
    const iv = setInterval(() => {
      i++;
      if (i >= animPiece.steps.length) { clearInterval(iv); setAnimStep(-1); onAnimDoneRef.current?.(); }
      else setAnimStep(i);
    }, 185);
    return () => clearInterval(iv);
  }, [animPiece]);

  useEffect(() => {
    const prev = prevPlayersRef.current;
    const newlyCaptured: string[] = [];
    gameState.players.forEach((player, pi) => {
      player.pieces.forEach((piece, idx) => {
        const prevProgress = prev[pi]?.pieces[idx]?.progress;
        if (piece.progress === -1 && prevProgress !== undefined && prevProgress > -1)
          newlyCaptured.push(`${pi}-${idx}`);
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

  const getEffectiveProgress = (pi: number, idx: number, base: number): number => {
    if (animPiece && animPiece.playerIndex === pi && animPiece.pieceIdx === idx && animStep >= 0 && animStep < animPiece.steps.length)
      return animPiece.steps[animStep];
    return base;
  };

  const C = CELL;
  const cx = 7.5 * C;
  const cy = 7.5 * C;

  const redName   = truncateName(playerNames[0]);
  const blueName  = truncateName(playerNames[1]);

  const myName0 = myPlayerIndex === 0;

  return (
    <div className="relative w-full select-none" style={{ maxWidth: "100%", lineHeight: 0 }}>
      <svg
        viewBox={`0 0 ${W} ${W}`}
        className="w-full h-auto"
        style={{ display: "block" }}
      >
        <defs>
          <filter id="pieceShadow" x="-40%" y="-40%" width="180%" height="180%">
            <feDropShadow dx="0" dy="2" stdDeviation="2" floodOpacity="0.5" />
          </filter>
          <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
            <feDropShadow dx="0" dy="0" stdDeviation="5" floodColor="#fbbf24" floodOpacity="1" />
          </filter>
          <filter id="boardShadow">
            <feDropShadow dx="0" dy="3" stdDeviation="4" floodOpacity="0.25" />
          </filter>

          <radialGradient id="redPieceGrad" cx="35%" cy="30%" r="70%">
            <stop offset="0%" stopColor="#fca5a5" />
            <stop offset="100%" stopColor="#991b1b" />
          </radialGradient>
          <radialGradient id="bluePieceGrad" cx="35%" cy="30%" r="70%">
            <stop offset="0%" stopColor="#bfdbfe" />
            <stop offset="100%" stopColor="#1e40af" />
          </radialGradient>
          <radialGradient id="goldPieceGrad" cx="35%" cy="30%" r="70%">
            <stop offset="0%" stopColor="#fef3c7" />
            <stop offset="100%" stopColor="#92400e" />
          </radialGradient>
        </defs>

        {/* ── Board outer frame */}
        <rect width={W} height={W} rx={10} fill="#1a1a2e" />
        <rect x={3} y={3} width={W-6} height={W-6} rx={8} fill="#f8f4ee" />

        {/* ══════════════════════════════════════════════════════
            HOME QUADRANTS
        ══════════════════════════════════════════════════════ */}

        {/* Red home — top-left */}
        <rect x={0} y={0} width={6*C} height={6*C} fill="#ef4444" />
        <rect x={0} y={0} width={6*C} height={6*C} fill="none" stroke="#b91c1c" strokeWidth={4} />
        <circle cx={2.6*C} cy={2.6*C} r={2.18*C} fill="#b91c1c" />
        <circle cx={2.6*C} cy={2.6*C} r={1.92*C} fill="#ef4444" />
        <circle cx={2.6*C} cy={2.6*C} r={1.65*C} fill="#dc2626" opacity={0.4} />

        {/* Blue home — top-right */}
        <rect x={9*C} y={0} width={6*C} height={6*C} fill="#3b82f6" />
        <rect x={9*C} y={0} width={6*C} height={6*C} fill="none" stroke="#1d4ed8" strokeWidth={4} />
        <circle cx={11.6*C} cy={2.6*C} r={2.18*C} fill="#1d4ed8" />
        <circle cx={11.6*C} cy={2.6*C} r={1.92*C} fill="#3b82f6" />
        <circle cx={11.6*C} cy={2.6*C} r={1.65*C} fill="#2563eb" opacity={0.4} />

        {/* Green home — bottom-left */}
        <rect x={0} y={9*C} width={6*C} height={6*C} fill="#22c55e" />
        <rect x={0} y={9*C} width={6*C} height={6*C} fill="none" stroke="#15803d" strokeWidth={4} />
        <circle cx={2.6*C} cy={11.6*C} r={2.18*C} fill="#15803d" />
        <circle cx={2.6*C} cy={11.6*C} r={1.92*C} fill="#22c55e" />
        <circle cx={2.6*C} cy={11.6*C} r={1.65*C} fill="#16a34a" opacity={0.4} />

        {/* Orange home — bottom-right */}
        <rect x={9*C} y={9*C} width={6*C} height={6*C} fill="#f97316" />
        <rect x={9*C} y={9*C} width={6*C} height={6*C} fill="none" stroke="#c2410c" strokeWidth={4} />
        <circle cx={11.6*C} cy={11.6*C} r={2.18*C} fill="#c2410c" />
        <circle cx={11.6*C} cy={11.6*C} r={1.92*C} fill="#f97316" />
        <circle cx={11.6*C} cy={11.6*C} r={1.65*C} fill="#ea580c" opacity={0.4} />

        {/* ══════════════════════════════════════════════════════
            TRACK CELLS
        ══════════════════════════════════════════════════════ */}
        {TRACK_CELLS.map(([row, col], i) => {
          const isSafe = SAFE_SET.has(i);
          const isRedEntry = i === 0;
          const isBlueEntry = i === 13;
          let fill = "#ffffff";
          if (isRedEntry) fill = "#ef4444";
          else if (isBlueEntry) fill = "#3b82f6";
          else if (isSafe) fill = "#fff9c2";
          return (
            <rect key={i}
              x={col*C+1} y={row*C+1} width={C-2} height={C-2}
              fill={fill} stroke="#d0d4dc" strokeWidth={0.8} rx={1}
            />
          );
        })}

        {/* Safe stars */}
        {TRACK_CELLS.map(([row, col], i) => {
          if (!SAFE_SET.has(i) || i === 0 || i === 13 || i === 26) return null;
          return (
            <text key={`star-${i}`}
              x={(col+0.5)*C} y={(row+0.5)*C+1}
              textAnchor="middle" dominantBaseline="middle"
              fontSize={C*0.42} style={{ userSelect:"none", pointerEvents:"none" }}
            >⭐</text>
          );
        })}

        {/* ══════════════════════════════════════════════════════
            HOME CORRIDORS — fully solid colors
        ══════════════════════════════════════════════════════ */}

        {/* Red corridor (row 7, cols 1→6) */}
        {RED_HOME_COL.map(([row, col], i) => (
          <rect key={`rhc-${i}`}
            x={col*C+1} y={row*C+1} width={C-2} height={C-2}
            fill={i === 5 ? "#dc2626" : "#ef4444"}
            stroke="#b91c1c" strokeWidth={0.6} rx={1}
          />
        ))}

        {/* Blue corridor (col 7, rows 1→6) */}
        {BLUE_HOME_COL.map(([row, col], i) => (
          <rect key={`bhc-${i}`}
            x={col*C+1} y={row*C+1} width={C-2} height={C-2}
            fill={i === 5 ? "#1d4ed8" : "#3b82f6"}
            stroke="#1d4ed8" strokeWidth={0.6} rx={1}
          />
        ))}

        {/* Green corridor (col 7, rows 13→8) */}
        {GREEN_HOME_COL.map(([row, col], i) => (
          <rect key={`ghc-${i}`}
            x={col*C+1} y={row*C+1} width={C-2} height={C-2}
            fill={i === 5 ? "#15803d" : "#22c55e"}
            stroke="#15803d" strokeWidth={0.6} rx={1}
          />
        ))}

        {/* Orange corridor (row 7, cols 13→8) */}
        {YELLOW_HOME_COL.map(([row, col], i) => (
          <rect key={`yhc-${i}`}
            x={col*C+1} y={row*C+1} width={C-2} height={C-2}
            fill={i === 5 ? "#c2410c" : "#f97316"}
            stroke="#c2410c" strokeWidth={0.6} rx={1}
          />
        ))}

        {/* Left edge track cells */}
        {([7, 6] as const).map((row, i) => (
          <rect key={`c0-${i}`}
            x={1} y={row*C+1} width={C-2} height={C-2}
            fill="#ffffff" stroke="#d0d4dc" strokeWidth={0.8} rx={1}
          />
        ))}

        {/* ══════════════════════════════════════════════════════
            CENTER — 4 bold triangles
        ══════════════════════════════════════════════════════ */}
        <rect x={6*C} y={6*C} width={3*C} height={3*C} fill="#f8f4ee" />
        {/* Top triangle → Blue */}
        <polygon points={`${6*C},${6*C} ${9*C},${6*C} ${cx},${cy}`} fill="#3b82f6" />
        {/* Bottom triangle → Green */}
        <polygon points={`${6*C},${9*C} ${9*C},${9*C} ${cx},${cy}`} fill="#22c55e" />
        {/* Left triangle → Red */}
        <polygon points={`${6*C},${6*C} ${6*C},${9*C} ${cx},${cy}`} fill="#ef4444" />
        {/* Right triangle → Orange */}
        <polygon points={`${9*C},${6*C} ${9*C},${9*C} ${cx},${cy}`} fill="#f97316" />
        {/* Center circle — where dice sits */}
        <circle cx={cx} cy={cy} r={C*0.72} fill="rgba(255,255,255,0.18)" />

        {/* ══════════════════════════════════════════════════════
            SPAWN CIRCLES IN HOME AREAS
        ══════════════════════════════════════════════════════ */}

        {/* Red spawns */}
        {RED_STARTS.map(([r, c], i) => (
          <g key={`rs-${i}`}>
            <circle cx={c*C} cy={r*C} r={C*0.44} fill="#b91c1c" />
            <circle cx={c*C} cy={r*C} r={C*0.38} fill="#fecaca" stroke="#ef4444" strokeWidth={1.5} />
            <text x={c*C} y={r*C+1.5} textAnchor="middle" dominantBaseline="middle"
              fontSize={C*0.28} fill="#ef4444" fontWeight="900"
              style={{ userSelect:"none", pointerEvents:"none" }}>♛</text>
          </g>
        ))}

        {/* Blue spawns */}
        {BLUE_STARTS.map(([r, c], i) => (
          <g key={`bs-${i}`}>
            <circle cx={c*C} cy={r*C} r={C*0.44} fill="#1d4ed8" />
            <circle cx={c*C} cy={r*C} r={C*0.38} fill="#bfdbfe" stroke="#3b82f6" strokeWidth={1.5} />
            <text x={c*C} y={r*C+1.5} textAnchor="middle" dominantBaseline="middle"
              fontSize={C*0.28} fill="#3b82f6" fontWeight="900"
              style={{ userSelect:"none", pointerEvents:"none" }}>♛</text>
          </g>
        ))}

        {/* Green spawns (decorative) */}
        {GREEN_STARTS.map(([r, c], i) => (
          <g key={`gs-${i}`}>
            <circle cx={c*C} cy={r*C} r={C*0.44} fill="#15803d" />
            <circle cx={c*C} cy={r*C} r={C*0.38} fill="#bbf7d0" stroke="#22c55e" strokeWidth={1.5} />
            <text x={c*C} y={r*C+1.5} textAnchor="middle" dominantBaseline="middle"
              fontSize={C*0.28} fill="#16a34a" fontWeight="900"
              style={{ userSelect:"none", pointerEvents:"none" }}>♛</text>
          </g>
        ))}

        {/* Orange spawns (decorative) */}
        {YELLOW_STARTS.map(([r, c], i) => (
          <g key={`ys-${i}`}>
            <circle cx={c*C} cy={r*C} r={C*0.44} fill="#c2410c" />
            <circle cx={c*C} cy={r*C} r={C*0.38} fill="#fed7aa" stroke="#f97316" strokeWidth={1.5} />
            <text x={c*C} y={r*C+1.5} textAnchor="middle" dominantBaseline="middle"
              fontSize={C*0.28} fill="#ea580c" fontWeight="900"
              style={{ userSelect:"none", pointerEvents:"none" }}>♛</text>
          </g>
        ))}

        {/* ══════════════════════════════════════════════════════
            PLAYER NAME LABELS
        ══════════════════════════════════════════════════════ */}

        {/* Red player label (top-left) */}
        <rect x={C*0.3} y={C*5.3} width={C*5.4} height={C*0.65} rx={C*0.3} fill="rgba(0,0,0,0.4)" />
        <text x={C*3} y={C*5.75}
          textAnchor="middle" dominantBaseline="middle"
          fontSize={C*0.38} fontWeight="800" fill="white"
          style={{ userSelect:"none", pointerEvents:"none",
            filter:"drop-shadow(0 1px 2px rgba(0,0,0,0.6))" }}
        >
          {myName0 ? `★ ${redName}` : redName}
          {isBot && !myName0 ? " 🤖" : ""}
        </text>

        {/* Blue player label (top-right) */}
        <rect x={C*9.3} y={C*5.3} width={C*5.4} height={C*0.65} rx={C*0.3} fill="rgba(0,0,0,0.4)" />
        <text x={C*12} y={C*5.75}
          textAnchor="middle" dominantBaseline="middle"
          fontSize={C*0.38} fontWeight="800" fill="white"
          style={{ userSelect:"none", pointerEvents:"none",
            filter:"drop-shadow(0 1px 2px rgba(0,0,0,0.6))" }}
        >
          {!myName0 ? `★ ${blueName}` : blueName}
          {isBot && myName0 ? " 🤖" : ""}
        </text>

        {/* Turn indicator glow ring in home areas */}
        {isMyTurn && (
          <rect
            x={myPlayerIndex === 0 ? 2 : 9*C+2}
            y={2}
            width={6*C-4}
            height={6*C-4}
            rx={6}
            fill="none"
            stroke="#fbbf24"
            strokeWidth={4}
            opacity={0.8}
          >
            <animate attributeName="opacity" values="0.8;0.3;0.8" dur="1.2s" repeatCount="indefinite" />
          </rect>
        )}
        {!isMyTurn && (
          <rect
            x={myPlayerIndex === 0 ? 9*C+2 : 2}
            y={2}
            width={6*C-4}
            height={6*C-4}
            rx={6}
            fill="none"
            stroke="#fbbf24"
            strokeWidth={4}
            opacity={0.5}
          >
            <animate attributeName="opacity" values="0.5;0.15;0.5" dur="1.6s" repeatCount="indefinite" />
          </rect>
        )}

        {/* ══════════════════════════════════════════════════════
            PIECES
        ══════════════════════════════════════════════════════ */}
        {gameState.players.map((player, pi) => {
          const isRed = player.color === "red";
          const pieceOuterColor = isRed ? "#7f1d1d" : "#1e3a8a";
          const pieceRimColor   = isRed ? "#ef4444" : "#3b82f6";
          const pieceGradId     = isRed ? "redPieceGrad" : "bluePieceGrad";

          return player.pieces.map((piece, idx) => {
            const effectiveProgress = getEffectiveProgress(pi, idx, piece.progress);
            const { x, y } = getPieceXY(pi as 0|1, effectiveProgress, idx);
            const isValid      = pi === myPlayerIndex && isMyTurn && gameState.diceRolled && validMoves.includes(idx);
            const isFinished   = piece.progress === 57;
            const justCaptured = capturedKeys.has(`${pi}-${idx}`);
            const isAnimating  = animPiece?.playerIndex === pi && animPiece?.pieceIdx === idx && animStep >= 0;

            return (
              <g key={`p${pi}-${idx}`}
                transform={`translate(${x},${y})`}
                style={{
                  transition: isAnimating ? "transform 0.16s ease-out" : "transform 0.22s ease-out",
                  cursor: isValid ? "pointer" : "default",
                }}
                onClick={isValid ? () => onPieceClick(idx) : undefined}
              >
                {justCaptured && (
                  <circle cx={0} cy={0} r={R+4} fill="rgba(251,191,36,0.6)">
                    <animate attributeName="r" values={`${R};${R+18};${R+4}`} dur="0.6s" fill="freeze" />
                    <animate attributeName="fill-opacity" values="0.8;0.4;0" dur="0.6s" fill="freeze" />
                  </circle>
                )}
                {isValid && (
                  <circle cx={0} cy={0} r={R+8} fill="rgba(251,191,36,0.35)" filter="url(#glow)">
                    <animate attributeName="r" values={`${R+5};${R+14};${R+5}`} dur="0.8s" repeatCount="indefinite" />
                    <animate attributeName="fill-opacity" values="0.5;0.1;0.5" dur="0.8s" repeatCount="indefinite" />
                  </circle>
                )}
                {isAnimating && (
                  <circle cx={0} cy={0} r={R+5} fill="rgba(255,255,255,0.25)">
                    <animate attributeName="r" values={`${R+3};${R+10};${R+3}`} dur="0.18s" repeatCount="indefinite" />
                  </circle>
                )}
                <circle cx={0} cy={0} r={R+3} fill={pieceOuterColor} filter="url(#pieceShadow)" />
                <circle cx={0} cy={0} r={R+1.5} fill={pieceRimColor} />
                <circle cx={0} cy={0} r={R}
                  fill={isFinished ? "url(#goldPieceGrad)" : `url(#${pieceGradId})`}
                  stroke={isFinished ? "#92400e" : pieceRimColor}
                  strokeWidth={isValid ? 2.5 : 1.2}
                >
                  {justCaptured && (
                    <animateTransform attributeName="transform" type="scale"
                      from="1.9 1.9" to="1 1" dur="0.5s" additive="sum" fill="freeze" />
                  )}
                </circle>
                <ellipse cx={-R*0.22} cy={-R*0.28} rx={R*0.32} ry={R*0.22}
                  fill="rgba(255,255,255,0.55)" style={{ pointerEvents:"none" }} />
                {isFinished ? (
                  <text x={0} y={1} textAnchor="middle" dominantBaseline="middle"
                    fontSize={R*0.88} fill="white" fontWeight="900"
                    style={{ userSelect:"none", pointerEvents:"none" }}>♛</text>
                ) : (
                  <text x={0} y={1} textAnchor="middle" dominantBaseline="middle"
                    fontSize={R*0.78} fontWeight="800" fill="white"
                    style={{ userSelect:"none", pointerEvents:"none",
                      filter:"drop-shadow(0 1px 1px rgba(0,0,0,0.5))" }}>{idx+1}</text>
                )}
                {isValid && (
                  <rect x={-C/2} y={-C/2} width={C} height={C}
                    fill="transparent" onClick={() => onPieceClick(idx)}
                    style={{ cursor:"pointer" }} />
                )}
              </g>
            );
          });
        })}
      </svg>

    </div>
  );
}
