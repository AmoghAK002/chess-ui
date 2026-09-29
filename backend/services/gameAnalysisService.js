const { Chess } = require("chess.js");

function reconstructGame(moves) {
    const chess = new Chess();

    const positions = [];

    for (const move of moves) {
        const beforeFen = chess.fen();

        const playerColor =
            beforeFen.split(" ")[1] === "w"
                ? "WHITE"
                : "BLACK";

        const playedMove = chess.move(move.san);

        if (!playedMove) {
            throw new Error(`Invalid chess move: ${move.san}`);
        }

        const afterFen = chess.fen();

        positions.push({
            moveIndex: move.moveIndex,
            san: move.san,
            playerColor,
            beforeFen,
            afterFen,
        });
    }

    return positions;
}

function analyzeGameFromMoves(moves) {
    return reconstructGame(moves);
}

module.exports = {
    reconstructGame,
    analyzeGameFromMoves,
};