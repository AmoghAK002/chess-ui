require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { spawn } = require("child_process");
const { GoogleGenAI } = require("@google/genai");

const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
});

const app = express();

app.use(cors());
app.use(express.json());

const PORT = 5000;

app.post("/api/analyze", (req, res) => {
    const {
        beforeFen,
        afterFen,
        playerMove,
        playerColor
    } = req.body;

    if (!beforeFen || !afterFen || !playerMove || !playerColor) {
        return res.status(400).json({
            error: "beforeFen, afterFen, playerMove and playerColor are required"
        });
    }

    console.log("Received before FEN:", beforeFen);
    console.log("Player:", playerColor);
    console.log("Player move:", playerMove);
    console.log("After FEN:", afterFen);

    const stockfish = spawn(
        "./stockfish-windows-x86-64-avx2.exe",
        [],
        {
            cwd: __dirname
        }
    );

    let output = "";

    stockfish.stdout.on("data", async (data) => {
        const text = data.toString();

        console.log("STOCKFISH:", text);

        output += text;
        if (output.includes("bestmove")) {
            console.log("Analysis complete");

            const lines = output.split(/\r?\n/);

            const topMoves = [];

            for (const line of lines) {

                // We only want the final depth 15 lines
                if (!line.includes("info depth 15")) {
                    continue;
                }

                const multipvMatch = line.match(/multipv (\d+)/);
                const scoreMatch = line.match(/score cp (-?\d+)/);

                // Find the LAST " pv " in the line
                const pvIndex = line.lastIndexOf(" pv ");

                if (!multipvMatch || !scoreMatch || pvIndex === -1) {
                    continue;
                }

                // Everything after the final " pv " is the actual chess PV
                const pv = line
                    .substring(pvIndex + 4)
                    .trim();

                const moves = pv.split(/\s+/);

                if (moves.length === 0) {
                    continue;
                }

                topMoves.push({
                    rank: Number(multipvMatch[1]),
                    move: moves[0],
                    score: Number(scoreMatch[1]),
                    pv: pv
                });
            }

            topMoves.sort((a, b) => a.rank - b.rank);

            console.log("TOP MOVES:", topMoves);

            // Find where the player's move appears in Stockfish's Top 5
            const playerMoveResult = topMoves.find(
                move => move.move === playerMove
            );

            const bestMove = topMoves.length > 0
                ? topMoves[0].move
                : null;

            let moveQuality;

            if (!playerMoveResult) {
                moveQuality = "not_in_top_5";
            } else if (playerMoveResult.rank === 1) {
                moveQuality = "best_move";
            } else if (playerMoveResult.rank <= 3) {
                moveQuality = "strong_move";
            } else {
                moveQuality = "playable_move";
            }

            const moveAnalysis = {
                player: playerColor,
                playedMove: playerMove,
                rank: playerMoveResult ? playerMoveResult.rank : null,
                bestMove: bestMove,
                quality: moveQuality
            };

            console.log("PLAYER MOVE ANALYSIS:", moveAnalysis);

            console.log("TOP MOVES:", topMoves);

            const prompt = `
You are a friendly human chess coach.

Your job is to explain the player's move naturally, like a coach
sitting beside them during a real chess game.

The chess engine has already analyzed the position.
You must NOT expose engine terminology to the player.

PLAYER:
${playerColor}

PLAYER'S ACTUAL MOVE:
${playerMove}

MOVE ANALYSIS:
${JSON.stringify(moveAnalysis, null, 2)}

BEST STOCKFISH MOVE:
${bestMove}

IMPORTANT RULES:

1. Always explicitly say whether WHITE or BLACK made the move.

2. Explain the ACTUAL MOVE the player made.
Do not describe the opponent's next move as if it were the player's move.

3. Use the supplied moveAnalysis to judge the move.

4. If quality is "best_move":
   - Tell the player that they made an excellent choice.
   - Explain the chess idea behind the move.

5. If quality is "strong_move":
   - Tell the player it is a strong/playable choice.
   - If the best move is different, briefly explain what the best move
     was trying to achieve.

6. If quality is "playable_move":
   - Explain that the move is still reasonable.
   - Mention that there were stronger alternatives.

7. If quality is "not_in_top_5":
   - DO NOT automatically call the move bad, a mistake, or a blunder.
   - Say that there were stronger alternatives.
   - Explain the difference in a constructive way.
   - Only describe the move as a serious mistake if the supplied
     analysis clearly supports that conclusion.

8. NEVER mention:
   - Stockfish
   - engine
   - FEN
   - centipawns
   - evaluation scores
   - MultiPV
   - PV
   - depth
   - nodes
   - ranks
   - "top 5"

9. Do not invent tactical ideas or moves that are not supported by
the supplied analysis.

10. Speak naturally and conversationally.
Do not sound like a computer-generated engine report.

11. Keep the response to 3-5 sentences.

12. Use normal chess notation:
    b1c3 → Nc3
    d2d4 → d4
    e2e4 → e4

13. Always refer to the player as WHITE or BLACK when introducing
their move.

Your response should feel like helpful coaching, not criticism.

Example style:

"WHITE played Nc3. That's a natural developing move and it helps
bring a piece into the game, but there was a stronger way to claim
the center with e4. Your move is still playable, so there's no need
to worry — just remember to look for opportunities to establish
central control early. Coaching tip: In the opening, prioritize
developing your pieces while fighting for the center."

Return ONLY the coaching message.
`;

            try {
                const geminiResponse = await ai.models.generateContent({
                    model: "gemini-3.5-flash",
                    contents: prompt,
                });

                res.json({
                    beforeFen: beforeFen,
                    afterFen: afterFen,
                    playerColor: playerColor,
                    playerMove: playerMove,
                    topMoves: topMoves,
                    narrative: geminiResponse.text,
                });

            } catch (error) {
                console.error("Gemini error:", error);

                res.status(500).json({
                    beforeFen: beforeFen,
                    afterFen: afterFen,
                    playerColor: playerColor,
                    playerMove: playerMove,
                    topMoves: topMoves,
                    error: "Gemini narration failed"
                });
            }

            stockfish.kill();
        }
    });

    stockfish.stderr.on("data", (data) => {
        console.error("STOCKFISH ERROR:", data.toString());
    });

    stockfish.on("error", (error) => {
        console.error("Failed to start Stockfish:", error);

        if (!res.headersSent) {
            res.status(500).json({
                error: "Failed to start Stockfish"
            });
        }
    });

    // Start UCI communication
    stockfish.stdin.write("uci\n");

    // Ask for 5 variations
    stockfish.stdin.write("setoption name MultiPV value 5\n");

    // Wait until Stockfish is ready
    stockfish.stdin.write("isready\n");

    // Send the FEN received from the frontend
    stockfish.stdin.write(`position fen ${beforeFen}\n`);

    // Analyze to depth 15
    stockfish.stdin.write("go depth 15\n");
});

app.get("/api/test-gemini", async (req, res) => {
    try {
        const response = await ai.models.generateContent({
            model: "gemini-3.5-flash",
            contents: "Say hello in one short sentence.",
        });

        res.json({
            response: response.text,
        });
    } catch (error) {
        console.error("Gemini error:", error);

        res.status(500).json({
            error: error.message,
        });
    }
});
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});