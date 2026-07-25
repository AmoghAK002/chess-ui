import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import type { CSSProperties } from "react";
import { Chess } from "chess.js";
import type { Square, PieceSymbol, Color, Move } from "chess.js";
import { Chessboard } from "react-chessboard";
import type { PieceDropHandlerArgs } from "react-chessboard";

type LastMove = {
  from: Square;
  to: Square;
};

type GameOverInfo = {
  title: string;
  subtitle: string;
};

type MovePair = {
  number: number;
  white: string;
  whiteIndex: number;
  black?: string;
  blackIndex?: number;
};

const UNICODE_PIECES: Record<Color, Record<PieceSymbol, string>> = {
  w: { p: "♙", n: "♘", b: "♗", r: "♖", q: "♕", k: "♔" },
  b: { p: "♟", n: "♞", b: "♝", r: "♜", q: "♛", k: "♚" },
};

const LAST_MOVE_COLOR = "rgba(255, 215, 0, 0.35)";
const SELECTED_SQUARE_COLOR = "rgba(255, 215, 0, 0.55)";
const LEGAL_MOVE_DOT =
  "radial-gradient(circle, rgba(0, 0, 0, 0.18) 22%, transparent 24%)";
const LEGAL_CAPTURE_RING =
  "radial-gradient(circle, transparent 60%, rgba(0, 0, 0, 0.18) 62%, rgba(0, 0, 0, 0.18) 72%, transparent 74%)";

function App() {
  // The single source of truth for game state. Never reconstructed from FEN
  // mid-game, so chess.js's internal move history stays intact.
  const gameRef = useRef(new Chess());

  // Lightweight state purely to trigger re-renders when gameRef mutates.
  const [fen, setFen] = useState<string>(gameRef.current.fen());

  const [lastMove, setLastMove] = useState<LastMove | null>(null);
  const [selectedSquare, setSelectedSquare] = useState<Square | null>(null);
  const [legalTargets, setLegalTargets] = useState<Square[]>([]);
  const [showGameOverModal, setShowGameOverModal] = useState(false);

  const clearSelection = useCallback(() => {
    setSelectedSquare(null);
    setLegalTargets([]);
  }, []);

  const makeMove = useCallback(
    (from: string, to: string, promotion: string = "q"): boolean => {
      try {
        const result = gameRef.current.move({
          from: from as Square,
          to: to as Square,
          promotion,
        });

        if (result) {
          setLastMove({ from: result.from, to: result.to });
          setFen(gameRef.current.fen());
          return true;
        }
      } catch {
        // Illegal move — ignore, board will snap back.
      }

      return false;
    },
    []
  );

  // Rebuilds the game up to (but not including) the given global half-move
  // index by replaying moves from scratch. This is used both for a plain
  // "undo last move" action and for jumping back to any specific move in
  // the history panel — both are just special cases of "keep the first N
  // half-moves".
  const rewindToIndex = useCallback(
    (index: number) => {
      const verboseHistory = gameRef.current.history({ verbose: true });
      const movesToKeep = verboseHistory.slice(0, Math.max(index, 0));

      const rebuilt = new Chess();
      for (const move of movesToKeep) {
        rebuilt.move({
          from: move.from,
          to: move.to,
          promotion: move.promotion,
        });
      }

      gameRef.current = rebuilt;
      setFen(rebuilt.fen());

      const last = movesToKeep[movesToKeep.length - 1] as Move | undefined;
      setLastMove(last ? { from: last.from, to: last.to } : null);

      clearSelection();
      setShowGameOverModal(false);
    },
    [clearSelection]
  );

  // Undoes a specific half-move (identified by its global index in the
  // history) and everything played after it.
  const undoMoveAtIndex = useCallback(
    (index: number) => {
      rewindToIndex(index);
    },
    [rewindToIndex]
  );

  // Quick "undo last move" action.
  const undoLastMove = useCallback(() => {
    const totalMoves = gameRef.current.history().length;
    if (totalMoves === 0) return;
    rewindToIndex(totalMoves - 1);
  }, [rewindToIndex]);

  const onPieceDrop = useCallback(
    ({ sourceSquare, targetSquare }: PieceDropHandlerArgs): boolean => {
      clearSelection();
      if (!targetSquare) return false;
      return makeMove(sourceSquare, targetSquare, "q");
    },
    [makeMove, clearSelection]
  );

  const onSquareClick = useCallback(
    ({ square }: { square: string; piece?: unknown }) => {
      const clickedSquare = square as Square;
      const game = gameRef.current;

      // A destination square was tapped while a piece is already selected.
      if (selectedSquare && legalTargets.includes(clickedSquare)) {
        const moved = makeMove(selectedSquare, clickedSquare, "q");
        clearSelection();
        if (moved) return;
      }

      // Tapping the currently selected square again deselects it.
      if (selectedSquare === clickedSquare) {
        clearSelection();
        return;
      }

      const pieceOnSquare = game.get(clickedSquare);

      if (pieceOnSquare && pieceOnSquare.color === game.turn()) {
        const moves = game.moves({ square: clickedSquare, verbose: true });
        setSelectedSquare(clickedSquare);
        setLegalTargets(moves.map((m) => m.to as Square));
        return;
      }

      clearSelection();
    },
    [selectedSquare, legalTargets, makeMove, clearSelection]
  );

  const resetGame = useCallback(() => {
    gameRef.current = new Chess();
    setFen(gameRef.current.fen());
    setLastMove(null);
    clearSelection();
    setShowGameOverModal(false);
  }, [clearSelection]);

  const getGameStatus = useCallback(() => {
    const game = gameRef.current;
    if (game.isCheckmate()) return "Checkmate";
    if (game.isDraw()) return "Draw";
    if (game.isCheck()) return "Check";
    return "In Progress";
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fen]);

  const isGameOver = gameRef.current.isGameOver();

  const gameOverInfo: GameOverInfo | null = useMemo(() => {
    const game = gameRef.current;
    if (!isGameOver) return null;

    if (game.isCheckmate()) {
      const winner = game.turn() === "w" ? "Black" : "White";
      return { title: "🏆 Checkmate!", subtitle: `${winner} Wins` };
    }

    if (game.isStalemate()) {
      return { title: "🤝 Draw", subtitle: "Stalemate" };
    }

    if (game.isThreefoldRepetition()) {
      return { title: "🤝 Draw", subtitle: "Threefold Repetition" };
    }

    if (game.isInsufficientMaterial()) {
      return { title: "🤝 Draw", subtitle: "Insufficient Material" };
    }

    if (game.isDraw()) {
      return { title: "🤝 Draw", subtitle: "50-Move Rule" };
    }

    return { title: "Game Over", subtitle: "" };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fen, isGameOver]);

  useEffect(() => {
    if (isGameOver) {
      setShowGameOverModal(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGameOver]);

  // Single pass over the verbose history: builds move pairs (for display +
  // per-move undo indices) and captured-piece lists together, so we don't
  // walk the history array three separate times per render.
  const { moveHistory, capturedByWhite, capturedByBlack } = useMemo(() => {
    const verboseHistory = gameRef.current.history({ verbose: true });
    const pairs: MovePair[] = [];
    const byWhite: PieceSymbol[] = [];
    const byBlack: PieceSymbol[] = [];

    verboseHistory.forEach((move, index) => {
      if (move.captured) {
        if (move.color === "w") {
          byWhite.push(move.captured);
        } else {
          byBlack.push(move.captured);
        }
      }

      if (index % 2 === 0) {
        pairs.push({
          number: pairs.length + 1,
          white: move.san,
          whiteIndex: index,
        });
      } else {
        pairs[pairs.length - 1].black = move.san;
        pairs[pairs.length - 1].blackIndex = index;
      }
    });

    return { moveHistory: pairs, capturedByWhite: byWhite, capturedByBlack: byBlack };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fen]);

  const squareStyles = useMemo(() => {
    const styles: Record<string, CSSProperties> = {};
    const game = gameRef.current;

    if (lastMove) {
      styles[lastMove.from] = { backgroundColor: LAST_MOVE_COLOR };
      styles[lastMove.to] = { backgroundColor: LAST_MOVE_COLOR };
    }

    if (selectedSquare) {
      styles[selectedSquare] = {
        ...styles[selectedSquare],
        backgroundColor: SELECTED_SQUARE_COLOR,
      };
    }

    for (const target of legalTargets) {
      const isCapture = Boolean(game.get(target));
      styles[target] = {
        ...styles[target],
        backgroundImage: isCapture ? LEGAL_CAPTURE_RING : LEGAL_MOVE_DOT,
        backgroundRepeat: "no-repeat",
        backgroundPosition: "center",
        cursor: "pointer",
      };
    }

    return styles;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fen, lastMove, selectedSquare, legalTargets]);

  const chessboardOptions = useMemo(
    () => ({
      id: "main-board",
      position: fen,
      onPieceDrop,
      onSquareClick,
      squareStyles,
      darkSquareStyle: { backgroundColor: "#769656" },
      lightSquareStyle: { backgroundColor: "#eeeed2" },
    }),
    [fen, onPieceDrop, onSquareClick, squareStyles]
  );

  const game = gameRef.current;
  const totalMoves = moveHistory.length > 0
    ? (moveHistory[moveHistory.length - 1].blackIndex ?? moveHistory[moveHistory.length - 1].whiteIndex) + 1
    : 0;

  const statusColorClass = game.isCheckmate()
    ? "text-red-600"
    : game.isCheck()
    ? "text-yellow-600"
    : game.isDraw()
    ? "text-gray-600"
    : "text-green-600";

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-gray-900 flex items-center justify-center p-4 sm:p-8">
      <div className="w-full max-w-6xl bg-white rounded-3xl shadow-2xl p-4 sm:p-8">
        <h1 className="text-3xl sm:text-4xl font-bold text-center mb-2">
          ♟️ Chess UI
        </h1>

        <p className="text-center text-gray-500 mb-6 sm:mb-8 text-sm sm:text-base">
          Built using React, TypeScript, chess.js &amp; react-chessboard
        </p>

        <div className="flex flex-col lg:flex-row justify-center items-start gap-6 lg:gap-10">
          {/* Board column - fully responsive, no fixed pixel width */}
          <div className="w-full max-w-[95vw] sm:max-w-[450px] lg:max-w-[560px] mx-auto">
            <Chessboard options={chessboardOptions} />
          </div>

          {/* Right panel */}
          <div className="w-full lg:w-96 flex flex-col gap-4">
            {/* Game Information Card */}
            <section className="bg-gray-50 border border-gray-200 rounded-2xl p-5 shadow-sm">
              <h2 className="text-lg font-semibold mb-4 text-gray-800 tracking-tight">
                Game Information
              </h2>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs uppercase tracking-wide text-gray-400 mb-1">
                    Current Turn
                  </p>
                  <p className="text-base font-bold text-gray-800">
                    {game.turn() === "w" ? "♔ White" : "♚ Black"}
                  </p>
                </div>

                <div>
                  <p className="text-xs uppercase tracking-wide text-gray-400 mb-1">
                    Game Status
                  </p>
                  <p className={`text-base font-bold ${statusColorClass}`}>
                    {getGameStatus()}
                  </p>
                </div>
              </div>

              <div className="mt-4">
                <p className="text-xs uppercase tracking-wide text-gray-400 mb-1">
                  Current Position (FEN)
                </p>
                <p className="text-xs break-all bg-white rounded-lg p-2 border border-gray-200 font-mono text-gray-600">
                  {fen}
                </p>
              </div>

              <div className="mt-4 space-y-3">
                <div>
                  <p className="text-xs uppercase tracking-wide text-gray-400 mb-1">
                    Captured by White
                  </p>
                  <div className="min-h-[1.75rem] text-2xl leading-none flex flex-wrap gap-1">
                    {capturedByWhite.length > 0 ? (
                      capturedByWhite.map((piece, idx) => (
                        <span key={`w-cap-${idx}`}>
                          {UNICODE_PIECES.b[piece]}
                        </span>
                      ))
                    ) : (
                      <span className="text-sm text-gray-300">None yet</span>
                    )}
                  </div>
                </div>

                <div>
                  <p className="text-xs uppercase tracking-wide text-gray-400 mb-1">
                    Captured by Black
                  </p>
                  <div className="min-h-[1.75rem] text-2xl leading-none flex flex-wrap gap-1">
                    {capturedByBlack.length > 0 ? (
                      capturedByBlack.map((piece, idx) => (
                        <span key={`b-cap-${idx}`}>
                          {UNICODE_PIECES.w[piece]}
                        </span>
                      ))
                    ) : (
                      <span className="text-sm text-gray-300">None yet</span>
                    )}
                  </div>
                </div>
              </div>

              <div className="mt-5 flex gap-3">
                <button
                  onClick={undoLastMove}
                  disabled={totalMoves === 0}
                  className="flex-1 bg-gray-100 hover:bg-gray-200 active:bg-gray-300 disabled:opacity-40 disabled:cursor-not-allowed text-gray-700 py-2.5 rounded-xl transition font-semibold text-sm"
                >
                  ↺ Undo Move
                </button>
                <button
                  onClick={resetGame}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white py-2.5 rounded-xl transition font-semibold text-sm"
                >
                  Reset Game
                </button>
              </div>
            </section>

            {/* Move History Card */}
            <section className="bg-gray-50 border border-gray-200 rounded-2xl p-5 shadow-sm flex-1 min-h-0">
              <h2 className="text-lg font-semibold mb-4 text-gray-800 tracking-tight">
                Move History
              </h2>

              <div className="max-h-72 overflow-y-auto rounded-lg border border-gray-200 bg-white">
                {moveHistory.length > 0 ? (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-200 text-xs uppercase tracking-wide text-gray-400">
                        <th className="py-2 pl-3 pr-2 text-left font-medium w-10">
                          #
                        </th>
                        <th className="py-2 px-2 text-left font-medium">
                          White
                        </th>
                        <th className="py-2 px-2 text-left font-medium">
                          Black
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {moveHistory.map((pair) => (
                        <tr
                          key={pair.number}
                          className="border-b border-gray-100 last:border-b-0 even:bg-gray-50 group"
                        >
                          <td className="py-1.5 pl-3 pr-2 text-gray-400 font-mono">
                            {pair.number}.
                          </td>
                          <td className="py-1.5 px-2 font-mono text-gray-800">
                            <div className="flex items-center gap-1.5">
                              <span>{pair.white}</span>
                              <button
                                onClick={() => undoMoveAtIndex(pair.whiteIndex)}
                                title={`Undo ${pair.white}`}
                                aria-label={`Undo move ${pair.white}`}
                                className="opacity-0 group-hover:opacity-100 focus:opacity-100 text-xs text-gray-400 hover:text-red-500 transition"
                              >
                                ↺
                              </button>
                            </div>
                          </td>
                          <td className="py-1.5 px-2 font-mono text-gray-800">
                            {pair.black !== undefined && pair.blackIndex !== undefined && (
                              <div className="flex items-center gap-1.5">
                                <span>{pair.black}</span>
                                <button
                                  onClick={() => undoMoveAtIndex(pair.blackIndex as number)}
                                  title={`Undo ${pair.black}`}
                                  aria-label={`Undo move ${pair.black}`}
                                  className="opacity-0 group-hover:opacity-100 focus:opacity-100 text-xs text-gray-400 hover:text-red-500 transition"
                                >
                                  ↺
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p className="text-sm text-gray-300 p-3">No moves yet</p>
                )}
              </div>
            </section>
          </div>
        </div>
      </div>

      {showGameOverModal && gameOverInfo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm bg-white rounded-2xl shadow-2xl p-8 text-center">
            <p className="text-3xl font-bold mb-2">{gameOverInfo.title}</p>
            <p className="text-lg text-gray-600 mb-6">
              {gameOverInfo.subtitle}
            </p>

            <div className="flex flex-col sm:flex-row gap-3">
              <button
                onClick={resetGame}
                className="flex-1 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white py-2.5 rounded-xl transition font-semibold text-sm"
              >
                Play Again
              </button>
              <button
                onClick={() => setShowGameOverModal(false)}
                className="flex-1 bg-gray-100 hover:bg-gray-200 active:bg-gray-300 text-gray-700 py-2.5 rounded-xl transition font-semibold text-sm"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;