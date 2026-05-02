import { useState, useEffect, useRef } from "react";
import type { GameState } from "@/lib/ludoApi";

const CELL = 46;

// 52 track positions [row, col] going clockwise from Red's entry
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

const RED_HOME_COL:  [number, number][] = [[7,1],[7,2],[7,3],[7,4],[7,5],[7,6]];
const BLUE_HOME_COL: [number, number][] = [[7,13],[7,12],[7,11],[7,10],[7,9],[7,8]];

// Home area piece spawn circles — 2×2 grid inside each corner
const RED_STARTS:    [number, number][] = [[1.4,1.4],[1.4,3.8],[3.8,1.4],[3.8,3.8]];
const BLUE_STARTS:   [number, number][] = [[1.4,10.4],[1.4,12.8],[3.8,10.4],[3.8,12.8]];
const GREEN_STARTS:  [number, number][] = [[10.4,1.4],[10.4,3.8],[12.8,1.4],[12.8,3.8]];
const YELLOW_STARTS: [number, number][] = [[10.4,10.4],[10.4,12.8],[12.8,10.4],[12.8,12.8]];

const PIECE_OFFSETS: [number, number][] = [[-4,-4],[4,-4],[-4,4],[4,4]];

function getPieceXY(
  playerIndex: 0 | 1,
  progress: number,
  pieceSubIdx: number,
): { x: number; y: number } {
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
  const entryPoint = playerIndex === 0 ? 0 : 26;
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
}

export default function LudoBoard({
  gameState,
  myPlayerIndex,
  validMoves,
  onPieceClick,
}: LudoBoardProps) {
  const W = 15 * CELL;
  const R = CELL * 0.35;
  const isMyTurn = gameState.currentTurn === myPlayerIndex;

  const [capturedKeys, setCapturedKeys] = useState<Set<string>>(new Set());
  const prevPlayersRef = useRef(gameState.players);

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

  return (
    <svg
      viewBox={`0 0 ${W} ${W}`}
      className="w-full h-auto select-none"
      style={{ maxHeight: "calc(100vw - 24px)", maxWidth: "calc(100vw - 24px)" }}
    >
      <defs>
        <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="2" stdDeviation="2" floodOpacity="0.25" />
        </filter>
        <filter id="glow" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="0" stdDeviation="3" floodColor="#fbbf24" floodOpacity="0.8" />
        </filter>
      </defs>

      {/* ── Board background ─────────────────────────────────── */}
      <rect width={W} height={W} fill="#e8e0d0" rx="4" />

      {/* ── Red home area (top-left) ────────────────────────── */}
      <rect x={0} y={0} width={6*CELL} height={6*CELL} fill="#dc2626" />
      <rect x={CELL*0.3} y={CELL*0.3} width={5.4*CELL} height={5.4*CELL} rx="8" fill="#ef4444" />
      <rect x={CELL*0.7} y={CELL*0.7} width={4.6*CELL} height={4.6*CELL} rx="6" fill="#fecaca" />

      {/* ── Blue home area (top-right) ──────────────────────── */}
      <rect x={9*CELL} y={0} width={6*CELL} height={6*CELL} fill="#1d4ed8" />
      <rect x={9.3*CELL} y={CELL*0.3} width={5.4*CELL} height={5.4*CELL} rx="8" fill="#3b82f6" />
      <rect x={9.7*CELL} y={CELL*0.7} width={4.6*CELL} height={4.6*CELL} rx="6" fill="#bfdbfe" />

      {/* ── Green home area (bottom-left, decorative) ──────── */}
      <rect x={0} y={9*CELL} width={6*CELL} height={6*CELL} fill="#15803d" />
      <rect x={CELL*0.3} y={9.3*CELL} width={5.4*CELL} height={5.4*CELL} rx="8" fill="#16a34a" />
      <rect x={CELL*0.7} y={9.7*CELL} width={4.6*CELL} height={4.6*CELL} rx="6" fill="#bbf7d0" />

      {/* ── Yellow home area (bottom-right, decorative) ─────── */}
      <rect x={9*CELL} y={9*CELL} width={6*CELL} height={6*CELL} fill="#b45309" />
      <rect x={9.3*CELL} y={9.3*CELL} width={5.4*CELL} height={5.4*CELL} rx="8" fill="#d97706" />
      <rect x={9.7*CELL} y={9.7*CELL} width={4.6*CELL} height={4.6*CELL} rx="6" fill="#fef08a" />

      {/* ── Track cells ─────────────────────────────────────── */}
      {TRACK_CELLS.map(([row, col], i) => {
        const isSafe = SAFE_SET.has(i);
        const isRedEntry = i === 0;
        const isBlueEntry = i === 26;
        let fill = "#ffffff";
        if (isRedEntry) fill = "#fca5a5";
        else if (isBlueEntry) fill = "#93c5fd";
        else if (isSafe) fill = "#fef3c7";
        return (
          <rect
            key={i}
            x={col * CELL} y={row * CELL}
            width={CELL} height={CELL}
            fill={fill}
            stroke="#94a3b8"
            strokeWidth={0.7}
          />
        );
      })}

      {/* ── Safe square stars ───────────────────────────────── */}
      {TRACK_CELLS.map(([row, col], i) => {
        if (!SAFE_SET.has(i) || i === 0 || i === 26) return null;
        const cx = (col + 0.5) * CELL;
        const cy = (row + 0.5) * CELL;
        return (
          <text
            key={`star-${i}`}
            x={cx} y={cy + 1}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize={CELL * 0.42}
            style={{ userSelect: "none", pointerEvents: "none" }}
          >
            ⭐
          </text>
        );
      })}

      {/* ── Red home column (row 7, cols 1-6) ─────────────── */}
      {RED_HOME_COL.map(([row, col], i) => (
        <rect
          key={`rhc-${i}`}
          x={col * CELL} y={row * CELL}
          width={CELL} height={CELL}
          fill={i === 5 ? "#dc2626" : "#fca5a5"}
          stroke="#94a3b8"
          strokeWidth={0.7}
        />
      ))}

      {/* ── Blue home column (row 7, cols 13-8) ───────────── */}
      {BLUE_HOME_COL.map(([row, col], i) => (
        <rect
          key={`bhc-${i}`}
          x={col * CELL} y={row * CELL}
          width={CELL} height={CELL}
          fill={i === 5 ? "#1d4ed8" : "#93c5fd"}
          stroke="#94a3b8"
          strokeWidth={0.7}
        />
      ))}

      {/* ── Left edge track cells (col 0: positions 50,51) ── */}
      {([7, 6] as const).map((row, i) => (
        <rect
          key={`c0-${i}`}
          x={0} y={row * CELL}
          width={CELL} height={CELL}
          fill="white"
          stroke="#94a3b8"
          strokeWidth={0.7}
        />
      ))}

      {/* ── Center: 4-triangle design ───────────────────────── */}
      <rect x={6*CELL} y={6*CELL} width={3*CELL} height={3*CELL} fill="#f1f5f9" stroke="#94a3b8" strokeWidth={0.5} />
      <polygon points={`${6*CELL},${6*CELL} ${9*CELL},${6*CELL} ${7.5*CELL},${7.5*CELL}`} fill="#fca5a5" />
      <polygon points={`${9*CELL},${9*CELL} ${6*CELL},${9*CELL} ${7.5*CELL},${7.5*CELL}`} fill="#93c5fd" />
      <polygon points={`${6*CELL},${9*CELL} ${6*CELL},${6*CELL} ${7.5*CELL},${7.5*CELL}`} fill="#bbf7d0" />
      <polygon points={`${9*CELL},${6*CELL} ${9*CELL},${9*CELL} ${7.5*CELL},${7.5*CELL}`} fill="#fde68a" />
      <circle cx={7.5*CELL} cy={7.5*CELL} r={CELL*0.42} fill="white" stroke="#94a3b8" strokeWidth={1} />

      {/* ── Piece spawn circles in all 4 home areas ─────────── */}
      {RED_STARTS.map(([r, c], i) => (
        <circle
          key={`rs-${i}`}
          cx={c * CELL} cy={r * CELL}
          r={CELL * 0.36}
          fill="#fecaca"
          stroke="#ef4444"
          strokeWidth={2}
        />
      ))}
      {BLUE_STARTS.map(([r, c], i) => (
        <circle
          key={`bs-${i}`}
          cx={c * CELL} cy={r * CELL}
          r={CELL * 0.36}
          fill="#bfdbfe"
          stroke="#3b82f6"
          strokeWidth={2}
        />
      ))}
      {GREEN_STARTS.map(([r, c], i) => (
        <circle
          key={`gs-${i}`}
          cx={c * CELL} cy={r * CELL}
          r={CELL * 0.36}
          fill="#bbf7d0"
          stroke="#16a34a"
          strokeWidth={2}
        />
      ))}
      {YELLOW_STARTS.map(([r, c], i) => (
        <circle
          key={`ys-${i}`}
          cx={c * CELL} cy={r * CELL}
          r={CELL * 0.36}
          fill="#fef08a"
          stroke="#d97706"
          strokeWidth={2}
        />
      ))}

      {/* ── Pieces ──────────────────────────────────────────── */}
      {gameState.players.map((player, pi) => {
        const isMe = pi === myPlayerIndex;
        const isRed = player.color === "red";
        const pieceColor = isRed ? "#dc2626" : "#1d4ed8";
        const pieceStroke = isRed ? "#7f1d1d" : "#1e3a8a";
        const pieceFill = isRed ? "#ef4444" : "#3b82f6";

        return player.pieces.map((piece, idx) => {
          const { x, y } = getPieceXY(pi as 0 | 1, piece.progress, idx);
          const isValid = isMe && isMyTurn && gameState.diceRolled && validMoves.includes(idx);
          const isFinished = piece.progress === 57;
          const justCaptured = capturedKeys.has(`${pi}-${idx}`);

          return (
            <g
              key={`p${pi}-${idx}`}
              onClick={isValid ? () => onPieceClick(idx) : undefined}
              style={{ cursor: isValid ? "pointer" : "default" }}
            >
              {justCaptured && (
                <circle cx={x} cy={y} r={R + 4} fill="rgba(251,191,36,0.6)">
                  <animate attributeName="r" values={`${R};${R + 18};${R + 4}`} dur="0.6s" fill="freeze" />
                  <animate attributeName="fill-opacity" values="0.8;0.4;0" dur="0.6s" fill="freeze" />
                </circle>
              )}
              {isValid && (
                <circle cx={x} cy={y} r={R + 7} fill="rgba(251,191,36,0.4)" filter="url(#glow)">
                  <animate attributeName="r" values={`${R + 5};${R + 11};${R + 5}`} dur="1s" repeatCount="indefinite" />
                  <animate attributeName="fill-opacity" values="0.5;0.15;0.5" dur="1s" repeatCount="indefinite" />
                </circle>
              )}
              {/* Outer ring for depth */}
              <circle
                cx={x} cy={y} r={R + 2}
                fill={pieceColor}
                filter="url(#shadow)"
              />
              {/* Main piece */}
              <circle
                cx={x} cy={y} r={R}
                fill={isFinished ? "#f59e0b" : pieceFill}
                stroke={isFinished ? "#92400e" : pieceStroke}
                strokeWidth={isValid ? 2.5 : 1.5}
              >
                {justCaptured && (
                  <animateTransform
                    attributeName="transform"
                    type="scale"
                    from="1.8 1.8"
                    to="1 1"
                    dur="0.5s"
                    additive="sum"
                    fill="freeze"
                  />
                )}
              </circle>
              {/* Inner shine */}
              <circle
                cx={x - R * 0.25} cy={y - R * 0.3}
                r={R * 0.3}
                fill="rgba(255,255,255,0.45)"
                style={{ pointerEvents: "none" }}
              />
              <text
                x={x} y={y + 1}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize={R * 0.82}
                fontWeight="800"
                fill="white"
                style={{ userSelect: "none", pointerEvents: "none", textShadow: "0 1px 2px rgba(0,0,0,0.4)" }}
              >
                {idx + 1}
              </text>
              {isValid && (
                <rect
                  x={x - CELL / 2} y={y - CELL / 2}
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
