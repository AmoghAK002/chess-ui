import { useState, useCallback, useMemo } from "react";
import { Chess } from "chess.js";
import type { Square, PieceSymbol, Color } from "chess.js";
import { Chessboard } from "react-chessboard";
import type { PieceDropHandlerArgs, SquareHandlerArgs } from "react-chessboard";

type LastMove = {
  from: Square;
  to: Square;
};

const UNICODE_PIECES: Record<Color, Record<PieceSymbol, string>> = {
  w: { p: "♙", n: "♘", b: "♗", r: "♖", q: "♕", k: "♔" },
  b: { p: "♟", n: "♞", b: "♝", r: "♜", q: "♛", k: "♚" },
};

const LAST_MOVE_HIGHLIGHT = "rgba(255, 215, 0, 0.45)";

function App() {
  const [game, setGame] = useState<Chess>(new Chess());
  const [lastMove, setLastMove] = useState<LastMove | null>(null);

  const makeMove = useCallback(
    (from: string, to: string, promotion: string = "q"): boolean => {
      let moveSucceeded = false;

      setGame((currentGame) => {
        const gameCopy = new Chess(currentGame.fen());

        try {
          const result = gameCopy.move({
            from: from as Square,
            to: to as Square,
            promotion,
          });

          if (result) {
            moveSucceeded = true;
            setLastMove({ from: result.from, to: result.to });
            return gameCopy;
          }
        } catch {
          // Illegal move
        }

        return currentGame;
      });

      return moveSucceeded;
    },
    []
  );

  const onPieceDrop = useCallback(
    ({ sourceSquare, targetSquare }: PieceDropHandlerArgs): boolean => {
      if (!targetSquare) return false;
      return makeMove(sourceSquare, targetSquare, "q");
    },
    [makeMove]
  );

  const resetGame = useCallback(() => {
    setGame(new Chess());
    setLastMove(null);
  }, []);

  const getGameStatus = useCallback(() => {
    if (game.isCheckmate()) return "Checkmate";
    if (game.isDraw()) return "Draw";
    if (game.isCheck()) return "Check";
    return "In Progress";
  }, [game]);

  // Paired move history in standard notation, e.g. [{ number: 1, white: "e4", black: "e5" }, ...]
  const moveHistory = useMemo(() => {
    const sanMoves = game.history();
    const pairs: { number: number; white: string; black?: string }[] = [];

    for (let i = 0; i < sanMoves.length; i += 2) {
      pairs.push({
        number: i / 2 + 1,
        white: sanMoves[i],
        black: sanMoves[i + 1],
      });
    }

    return pairs;
  }, [game]);

  // Captured pieces derived from verbose move history.
  const { capturedByWhite, capturedByBlack } = useMemo(() => {
    const verboseHistory = game.history({ verbose: true });
    const byWhite: PieceSymbol[] = [];
    const byBlack: PieceSymbol[] = [];

    for (const move of verboseHistory) {
      if (!move.captured) continue;
      if (move.color === "w") {
        byWhite.push(move.captured);
      } else {
        byBlack.push(move.captured);
      }
    }

    return { capturedByWhite: byWhite, capturedByBlack: byBlack };
  }, [game]);

  const squareStyles = useMemo(() => {
    if (!lastMove) return {};

    return {
      [lastMove.from]: { backgroundColor: LAST_MOVE_HIGHLIGHT },
      [lastMove.to]: { backgroundColor: LAST_MOVE_HIGHLIGHT },
    };
  }, [lastMove]);

  const chessboardOptions = useMemo(
    () => ({
      id: "main-board",
      position: game.fen(),
      onPieceDrop,
      squareStyles,
      darkSquareStyle: { backgroundColor: "#769656" },
      lightSquareStyle: { backgroundColor: "#eeeed2" },
    }),
    [game, onPieceDrop, squareStyles]
  );

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
          {/* Board column - responsive: fills available width up to a sensible cap */}
          <div className="w-full sm:w-[85%] md:w-[75%] lg:w-[550px] mx-auto">
            <Chessboard options={chessboardOptions} />
          </div>

          {/* Right panel */}
          <div className="w-full lg:w-96 flex flex-col gap-4">
            {/* Game Info Card */}
            <div className="bg-gray-50 border border-gray-200 rounded-2xl p-5 shadow-sm">
              <h2 className="text-lg font-semibold mb-4 text-gray-800">
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
                  {game.fen()}
                </p>
              </div>

              <button
                onClick={resetGame}
                className="mt-5 w-full bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white py-2.5 rounded-xl transition font-semibold text-sm"
              >
                Reset Game
              </button>
            </div>

            {/* Captured Pieces Card */}
            <div className="bg-gray-50 border border-gray-200 rounded-2xl p-5 shadow-sm">
              <h2 className="text-lg font-semibold mb-4 text-gray-800">
                Captured Pieces
              </h2>

              <div className="space-y-3">
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
            </div>

            {/* Move History Card */}
            <div className="bg-gray-50 border border-gray-200 rounded-2xl p-5 shadow-sm flex-1 min-h-0">
              <h2 className="text-lg font-semibold mb-4 text-gray-800">
                Move History
              </h2>

              <div className="max-h-64 overflow-y-auto rounded-lg border border-gray-200 bg-white">
                {moveHistory.length > 0 ? (
                  <table className="w-full text-sm">
                    <tbody>
                      {moveHistory.map((pair) => (
                        <tr
                          key={pair.number}
                          className="border-b border-gray-100 last:border-b-0 even:bg-gray-50"
                        >
                          <td className="py-1.5 pl-3 pr-2 text-gray-400 font-mono w-8">
                            {pair.number}.
                          </td>
                          <td className="py-1.5 px-2 font-mono text-gray-800">
                            {pair.white}
                          </td>
                          <td className="py-1.5 px-2 font-mono text-gray-800">
                            {pair.black ?? ""}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p className="text-sm text-gray-300 p-3">No moves yet</p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;