const path = require("path");
const { spawn } = require("child_process");
const { Chess } = require("chess.js");

function analyzeFenWithStockfish(fen, depth = 15, multiPV = 5) {
    return new Promise((resolve, reject) => {
        const stockfishPath = path.join(
            __dirname,
            "..",
            "stockfish-windows-x86-64-avx2.exe"
        );
        const stockfish = spawn(stockfishPath, [], { cwd: __dirname });

        let output = "";
        let isResolved = false;

        const timer = setTimeout(() => {
            if (!isResolved) {
                isResolved = true;
                stockfish.kill();
                reject(new Error("Stockfish analysis timed out"));
            }
        }, 12000);

        stockfish.stdout.on("data", (data) => {
            output += data.toString();

            if (output.includes("bestmove")) {
                if (isResolved) return;
                isResolved = true;
                clearTimeout(timer);
                stockfish.kill();

                const lines = output.split(/\r?\n/);
                const topMoves = [];

                for (const line of lines) {
                    if (!line.includes(`info depth ${depth}`)) {
                        continue;
                    }

                    // Stockfish sends its evaluation as plain text, for example:
                    // "score cp 44"  → normal evaluation of +44 centipawns (+0.44 pawns)
                    // "score cp -37" → normal evaluation of -37 centipawns (-0.37 pawns)
                    //
                    // The regex searches the Stockfish text for these patterns.
                    // (-?\d+) means:
                    //   - "-" is optional because the score can be positive or negative
                    //   - "\d" means a digit (0-9)
                    //   - "+" means one or more digits
                    //
                    // line.match(...) returns the matched text and the captured number.
                    // scoreMatch[1] / mateMatch[1] contains the actual score as a string.
                    // We later use Number(...) to convert that string into a JavaScript number.
                    //
                    // Stockfish can also report a forced mate instead of a centipawn score,
                    // so we check both "score cp" and "score mate".
                    const multipvMatch = line.match(/multipv (\d+)/);
                    const scoreMatch = line.match(/score cp (-?\d+)/);
                    const mateMatch = line.match(/score mate (-?\d+)/);
                    const pvIndex = line.lastIndexOf(" pv ");

                    if (!multipvMatch || pvIndex === -1) {
                        continue;
                    }

                    const pv = line.substring(pvIndex + 4).trim();
                    const moves = pv.split(/\s+/);

                    if (moves.length === 0) {
                        continue;
                    }

                    let san = moves[0];
                    try {
                        const chess = new Chess(fen);
                        const moveResult = chess.move({
                            from: moves[0].substring(0, 2),
                            to: moves[0].substring(2, 4),
                            promotion: moves[0].length > 4 ? moves[0][4] : undefined
                        });
                        if (moveResult) {
                            san = moveResult.san;
                        }
                    } catch (e) {
                        // Keep UCI as fallback
                    }

                    topMoves.push({
                        rank: Number(multipvMatch[1]),
                        move: moves[0],
                        san: san,
                        score: scoreMatch ? Number(scoreMatch[1]) : (mateMatch ? `mate ${mateMatch[1]}` : 0),
                        pv: pv
                    });
                }

                topMoves.sort((a, b) => a.rank - b.rank);
                resolve(topMoves);
            }
        });

        stockfish.stderr.on("data", (data) => {
            console.error("STOCKFISH ERROR:", data.toString());
        });

        stockfish.on("error", (error) => {
            if (!isResolved) {
                isResolved = true;
                clearTimeout(timer);
                reject(error);
            }
        });

        stockfish.stdin.write("uci\n");
        stockfish.stdin.write(`setoption name MultiPV value ${multiPV}\n`);
        stockfish.stdin.write("isready\n");
        stockfish.stdin.write(`position fen ${fen}\n`);
        stockfish.stdin.write(`go depth ${depth}\n`);
    });
}

module.exports = {
    analyzeFenWithStockfish
};