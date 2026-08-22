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

            console.log("TOP MOVES:", topMoves);

            const prompt = `
You are an AI chess coach.

Stockfish has already analyzed the position BEFORE the player's move.
Your job is to explain whether the player's move was a good choice.

IMPORTANT RULES:
- Stockfish is the authority for the chess analysis.
- Do NOT calculate your own chess moves.
- Do NOT invent moves.
- Do NOT suggest moves that are not present in the supplied Stockfish data.
- The playerColor tells you whether WHITE or BLACK made the move.
- The playerMove is the move the player actually made.
- topMoves are Stockfish's best candidate moves for the player BEFORE they made their move.
- Compare the player's actual move with these Stockfish recommendations.
- If the player's move is the #1 Stockfish move, clearly say it was the engine's top choice.
- If the player's move appears lower in the top 5, explain that Stockfish preferred the higher-ranked move.
- If the player's move is not in the top 5, say that Stockfish preferred other moves.
- Do not call a move a blunder unless the supplied engine data clearly supports that conclusion.
- Do not mention centipawn scores, nodes, MultiPV, or engine depth.
- Keep the response short: 3-5 sentences.
- Convert coordinate notation into normal chess notation where possible.
- Explicitly identify the player as WHITE or BLACK.

PLAYER:
${playerColor}

PLAYER'S MOVE:
${playerMove}

POSITION BEFORE THE MOVE:
${beforeFen}

POSITION AFTER THE MOVE:
${afterFen}

STOCKFISH TOP 5 MOVES BEFORE THE PLAYER'S MOVE:
${JSON.stringify(topMoves, null, 2)}

Write the coaching message in this style:

"[WHITE/BLACK] played [move].
[Explain whether the move was the engine's top choice, another strong choice, or whether Stockfish preferred other moves.]
[Briefly explain the strongest alternative using the supplied PV.]
Coaching tip: [one short useful tip]."

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