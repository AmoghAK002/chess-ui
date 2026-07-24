import { useState, useCallback } from "react";
import { Chess } from "chess.js";
import type { Square } from "chess.js";
import { Chessboard } from "react-chessboard";
import type { PieceDropHandlerArgs } from "react-chessboard";

function App() {
  const [game, setGame] = useState<Chess>(new Chess());

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

  const resetGame = () => {
    setGame(new Chess());
  };

  const getGameStatus = () => {
    if (game.isCheckmate()) return "Checkmate";
    if (game.isDraw()) return "Draw";
    if (game.isCheck()) return "Check";
    return "In Progress";
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-gray-900 flex items-center justify-center p-8">
      <div className="w-full max-w-6xl bg-white rounded-3xl shadow-2xl p-8">

        <h1 className="text-4xl font-bold text-center mb-2">
          ♟️ Chess UI
        </h1>

        <p className="text-center text-gray-500 mb-8">
          Built using React, TypeScript, chess.js & react-chessboard
        </p>

        <div className="flex flex-col lg:flex-row justify-center items-start gap-10">

          <div style={{ width: 550 }}>
            <Chessboard
              options={{
                id: "main-board",
                position: game.fen(),
                onPieceDrop,

                darkSquareStyle: {
                  backgroundColor: "#769656",
                },

                lightSquareStyle: {
                  backgroundColor: "#eeeed2",
                },
              }}
            />
          </div>

          <div className="w-full lg:w-80">

            <div className="bg-gray-100 rounded-xl p-6 shadow-lg">

              <h2 className="text-xl font-semibold mb-5">
                Game Information
              </h2>

              <div className="space-y-5">

                <div>
                  <p className="text-sm text-gray-500">
                    Current Turn
                  </p>

                  <p className="text-lg font-bold">
                    {game.turn() === "w" ? "♔ White" : "♚ Black"}
                  </p>
                </div>

                <div>
                  <p className="text-sm text-gray-500">
                    Game Status
                  </p>

                  <p
                    className={`text-lg font-bold ${
                      game.isCheckmate()
                        ? "text-red-600"
                        : game.isCheck()
                        ? "text-yellow-600"
                        : game.isDraw()
                        ? "text-gray-600"
                        : "text-green-600"
                    }`}
                  >
                    {getGameStatus()}
                  </p>
                </div>

                <div>
                  <p className="text-sm text-gray-500">
                    Current Position (FEN)
                  </p>

                  <p className="text-xs break-all bg-white rounded-md p-2 border">
                    {game.fen()}
                  </p>
                </div>

                <button
                  onClick={resetGame}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white py-3 rounded-xl transition font-semibold"
                >
                  Reset Game
                </button>

              </div>

            </div>

          </div>

        </div>

      </div>
    </div>
  );
}

export default App;