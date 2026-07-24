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
          // chess.js throws on illegal moves in some versions instead of
          // returning null — treat that the same as an illegal move.
        }

        // Illegal move: return the unchanged game so the board snaps back.
        return currentGame;
      });

      return moveSucceeded;
    },
    []
  );

  const onPieceDrop = useCallback(
    ({ sourceSquare, targetSquare }: PieceDropHandlerArgs): boolean => {
      // Dropped off the board entirely.
      if (!targetSquare) {
        return false;
      }

      return makeMove(sourceSquare, targetSquare, "q");
    },
    [makeMove]
  );

  const resetGame = () => {
  setGame(new Chess());
};

  return (
  <div className="min-h-screen bg-slate-900 flex items-center justify-center p-8">
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
              position: game.fen(),
              onPieceDrop,
              id: "main-board",
            }}
          />
        </div>

        <div className="w-full lg:w-80">

          <div className="bg-gray-100 rounded-xl p-5 shadow">

            <h2 className="text-xl font-semibold mb-4">
              Game Information
            </h2>

            <div className="space-y-3">

              <div>
                <p className="text-gray-500 text-sm">
                  Current Turn
                </p>

                <p className="text-lg font-bold">
                  {game.turn() === "w" ? "White" : "Black"}
                </p>
              </div>

              <div>
                <p className="text-gray-500 text-sm">
                  Current Position (FEN)
                </p>

                <p className="text-xs break-all">
                  {game.fen()}
                </p>
              </div>

            </div>
            <button
  onClick={resetGame}
  className="mt-6 w-full bg-blue-600 hover:bg-blue-700 text-white py-3 rounded-xl transition"
>
  Reset Game
</button>
          </div>

        </div>

      </div>

    </div>
  </div>
);
}

export default App;