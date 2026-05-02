import type { GameState } from "@/lib/ludoApi";

const CELL = 46;

// 52 track positions [row, col] going clockwise from Red's entry
const TRACK_CELLS: [number, number][] = [
  [6,1],[6,2],[6,3],[6,4],[6,5],            // 0-4
  [5,6],[4,6],[3,6],[2,6],[1,6],[0,6],      // 5-10
  [0,7],[0,8],                               // 11-12
  [1,8],[2,8],[3,8],[4,8],[5,8],            // 13-17
  [6,9],[6,10],[6,11],[6,12],[6,13],[6,14], // 18-23
  [7,14],[8,14],                             // 24-25
  [8,13],[8,12],[8,11],[8,10],[8,9],        // 26-30
  [9,8],[10,8],[11,8],[12,8],[13,8],[14,8], // 31-36
  [14,7],[14,6],                             // 37-38
  [13,6],[12,6],[11,6],[10,6],[9,6],        // 39-43
  [8,5],[8,4],[8,3],[8,2],[8,1],[8,0],      // 44-49
  [7,0],[6,0],                               // 50-51
];

const SAFE_SET = new Set([0, 8, 13, 21, 26, 34, 39, 47]);

// Home columns: progress 52-57
const RED_HOME_COL:  [number, number][] = [[7,1],[7,2],[7,3],[7,4],[7,5],[7,6]];
const BLUE_HOME_COL: [number, number][] = [[7,13],[7,12],[7,11],[7,10],[7,9],[7,8]];

// Starting positions in home areas (pieces at progress -1)
const RED_STARTS:  [number, number][] = [[1,1],[1,4],[4,1],[4,4]];
const BLUE_STARTS: [number, number][] = [[1,10],[1,13],[4,10],[4,13]];

// Small offsets so pieces on the same track cell don't perfectly overlap
const PIECE_OFFSETS: [number, number][] = [[-4,-4],[4,-4],[-4,4],[4,4]];

function getPieceXY(
  playerIndex: 0 | 1,
  progress: number,
  pieceSubIdx: number,
): { x: number; y: number } {
  if (progress === -1) {
    const [r, c] = playerIndex === 0 ? RED_STARTS[pieceSubIdx] : BLUE_STARTS[pieceSubIdx];
    return { x: (c + 0.5) * CELL, y: (r + 0.5) * CELL };
  }
  if (progress >= 52) {
    const homeCol = playerIndex === 0 ? RED_HOME_COL : BLUE_HOME_COL;
    const idx = Math.min(progress - 52, homeCol.length - 1);
    const [r, c] = homeCol[idx];
    // offset so multiple finished pieces don't perfectly stack
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
  const R = CELL * 0.36; // piece radius
  const isMyTurn = gameState.currentTurn === myPlayerIndex;

  return (
    <svg
      viewBox={`0 0 ${W} ${W}`}
      className="w-full h-auto select-none"
      style={{ maxHeight: "calc(100vw - 32px)", maxWidth: "calc(100vw - 32px)" }}
    >
      {/* ── Background ─────────────────────────────────────── */}
      <rect width={W} height={W} fill="#f1f5f9" />

      {/* ── Home areas ──────────────────────────────────────── */}
      {/* Red (top-left) */}
      <rect x={0} y={0} width={6*CELL} height={6*CELL} fill="#fee2e2" />
      <rect x={CELL*0.4} y={CELL*0.4} width={5.2*CELL} height={5.2*CELL} rx="10" fill="#fecaca" />
      {/* inner white circle area for pieces */}
      <circle cx={3*CELL} cy={3*CELL} r={2.1*CELL} fill="#fff5f5" />

      {/* Blue (top-right) */}
      <rect x={9*CELL} y={0} width={6*CELL} height={6*CELL} fill="#dbeafe" />
      <rect x={9.4*CELL} y={CELL*0.4} width={5.2*CELL} height={5.2*CELL} rx="10" fill="#bfdbfe" />
      <circle cx={12*CELL} cy={3*CELL} r={2.1*CELL} fill="#eff6ff" />

      {/* Unused corners (bottom-left & bottom-right) — grey */}
      <rect x={0} y={9*CELL} width={6*CELL} height={6*CELL} fill="#e2e8f0" />
      <rect x={9*CELL} y={9*CELL} width={6*CELL} height={6*CELL} fill="#e2e8f0" />

      {/* ── Center home ──────────────────────────────────────── */}
      <rect x={6*CELL} y={6*CELL} width={3*CELL} height={3*CELL} fill="#f8fafc" />
      {/* Two triangles meeting at center — red and blue */}
      <polygon
        points={`${6*CELL},${6*CELL} ${9*CELL},${6*CELL} ${7.5*CELL},${7.5*CELL}`}
        fill="#fca5a5"
      />
      <polygon
        points={`${9*CELL},${9*CELL} ${6*CELL},${9*CELL} ${7.5*CELL},${7.5*CELL}`}
        fill="#93c5fd"
      />
      <polygon
        points={`${6*CELL},${9*CELL} ${6*CELL},${6*CELL} ${7.5*CELL},${7.5*CELL}`}
        fill="#e2e8f0"
      />
      <polygon
        points={`${9*CELL},${6*CELL} ${9*CELL},${9*CELL} ${7.5*CELL},${7.5*CELL}`}
        fill="#e2e8f0"
      />
      <circle cx={7.5*CELL} cy={7.5*CELL} r={CELL*0.4} fill="white" />

      {/* ── Track cells ─────────────────────────────────────── */}
      {TRACK_CELLS.map(([row, col], i) => {
        const isSafe = SAFE_SET.has(i);
        const isRedEntry = i === 0;
        const isBlueEntry = i === 26;
        let fill = "white";
        if (isRedEntry) fill = "#fca5a5";
        else if (isBlueEntry) fill = "#93c5fd";
        else if (isSafe) fill = "#fef9c3";
        return (
          <rect
            key={i}
            x={col * CELL} y={row * CELL}
            width={CELL} height={CELL}
            fill={fill}
            stroke="#cbd5e1"
            strokeWidth={0.8}
          />
        );
      })}

      {/* ── Red home column (row 7, cols 1-6) ─────────────── */}
      {RED_HOME_COL.map(([row, col], i) => (
        <rect
          key={`rhc-${i}`}
          x={col * CELL} y={row * CELL}
          width={CELL} height={CELL}
          fill={i === 5 ? "#ef4444" : "#fca5a5"}
          stroke="#cbd5e1"
          strokeWidth={0.8}
        />
      ))}

      {/* ── Blue home column (row 7, cols 13-8) ───────────── */}
      {BLUE_HOME_COL.map(([row, col], i) => (
        <rect
          key={`bhc-${i}`}
          x={col * CELL} y={row * CELL}
          width={CELL} height={CELL}
          fill={i === 5 ? "#3b82f6" : "#93c5fd"}
          stroke="#cbd5e1"
          strokeWidth={0.8}
        />
      ))}

      {/* col 0 track cells (50, 51) — need border */}
      {[[7,0],[6,0]].map(([row, col], i) => (
        <rect
          key={`c0-${i}`}
          x={col * CELL} y={row * CELL}
          width={CELL} height={CELL}
          fill="white"
          stroke="#cbd5e1"
          strokeWidth={0.8}
        />
      ))}

      {/* ── Starting piece circles in home areas ──────────── */}
      {RED_STARTS.map(([r, c], i) => (
        <circle
          key={`rs-${i}`}
          cx={(c + 0.5) * CELL} cy={(r + 0.5) * CELL}
          r={CELL * 0.38}
          fill="#fecaca"
          stroke="#f87171"
          strokeWidth={1.5}
        />
      ))}
      {BLUE_STARTS.map(([r, c], i) => (
        <circle
          key={`bs-${i}`}
          cx={(c + 0.5) * CELL} cy={(r + 0.5) * CELL}
          r={CELL * 0.38}
          fill="#bfdbfe"
          stroke="#60a5fa"
          strokeWidth={1.5}
        />
      ))}

      {/* ── Pieces ────────────────────────────────────────── */}
      {gameState.players.map((player, pi) => {
        const isMe = pi === myPlayerIndex;
        const color = player.color === "red" ? "#ef4444" : "#3b82f6";
        const strokeColor = player.color === "red" ? "#b91c1c" : "#1d4ed8";

        return player.pieces.map((piece, idx) => {
          const { x, y } = getPieceXY(pi as 0 | 1, piece.progress, idx);
          const isValid = isMe && isMyTurn && gameState.diceRolled && validMoves.includes(idx);
          const isFinished = piece.progress === 57;

          return (
            <g
              key={`p${pi}-${idx}`}
              onClick={isValid ? () => onPieceClick(idx) : undefined}
              style={{ cursor: isValid ? "pointer" : "default" }}
            >
              {/* Glow ring for valid moves */}
              {isValid && (
                <circle cx={x} cy={y} r={R + 6} fill="rgba(251,191,36,0.35)">
                  <animate
                    attributeName="r"
                    values={`${R + 4};${R + 10};${R + 4}`}
                    dur="1s"
                    repeatCount="indefinite"
                  />
                  <animate
                    attributeName="fill-opacity"
                    values="0.5;0.2;0.5"
                    dur="1s"
                    repeatCount="indefinite"
                  />
                </circle>
              )}
              {/* Piece circle */}
              <circle
                cx={x} cy={y} r={R}
                fill={isFinished ? "gold" : color}
                stroke={isFinished ? "#b45309" : strokeColor}
                strokeWidth={isValid ? 2.5 : 1.5}
              />
              {/* Piece number */}
              <text
                x={x} y={y + 1}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize={R * 0.85}
                fontWeight="700"
                fill="white"
                style={{ userSelect: "none", pointerEvents: "none" }}
              >
                {idx + 1}
              </text>
              {/* Touch target */}
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
