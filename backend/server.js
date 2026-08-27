require("dotenv").config();

const path = require("path");
const express = require("express");
const cors = require("cors");
const { spawn, execFile } = require("child_process");
const { GoogleGenAI } = require("@google/genai");

const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
});

const app = express();

app.use(cors());
app.use(express.json());
app.use("/audio", express.static(__dirname));

const PORT = 5000;

app.post("/api/analyze", (req, res) => {
    const {
        moveIndex,
        moveNumber,
        beforeFen,
        afterFen,
        playerMove,
        san,
        playerColor
    } = req.body;

    if (
        moveIndex === undefined ||
        moveNumber === undefined ||
        !beforeFen ||
        !afterFen ||
        !playerMove ||
        !san ||
        !playerColor
    ) {
        return res.status(400).json({
            error:
                "moveIndex, moveNumber, beforeFen, afterFen, playerMove, san and playerColor are required"
        });
    }

    console.log("Move index:", moveIndex);
    console.log("Move number:", moveNumber);
    console.log("Player:", playerColor);
    console.log("SAN:", san);
    console.log("UCI:", playerMove);
    console.log("Received before FEN:", beforeFen);
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
You are a friendly, expert human chess coach.

You are sitting beside the player and coaching them during a live chess game.

Your response will appear inside a chat-style AI Coach interface and will also be spoken aloud using text-to-speech.

Your response must therefore feel like a natural conversation between a chess coach and a student — NOT like a chess engine report.

==================================================
CURRENT MOVE
==================================================

PLAYER COLOR:
${playerColor}

MOVE NUMBER:
${moveNumber}

MOVE INDEX:
${moveIndex}

PLAYER'S ACTUAL MOVE:
${san}

UCI MOVE:
${playerMove}

POSITION BEFORE THE MOVE:
${beforeFen}

POSITION AFTER THE MOVE:
${afterFen}

==================================================
CHESS ANALYSIS
==================================================

The chess engine has already analyzed the position BEFORE the player's move.

The supplied moves are alternatives that were available to the player BEFORE they made their move.

STOCKFISH ANALYSIS:
${JSON.stringify(topMoves, null, 2)}

MOVE ANALYSIS:
${JSON.stringify(moveAnalysis, null, 2)}

==================================================
YOUR JOB
==================================================

Your job is to coach the player about the move they JUST PLAYED.

The player's actual move is:

${san}

You must talk about THIS move.

Do NOT treat the engine's suggested moves as moves that the player played.

Do NOT predict the opponent's next move unless it is necessary to explain the position.

==================================================
PLAYER IDENTIFICATION
==================================================

ALWAYS identify the player correctly.

If playerColor is WHITE, start naturally with:

"White played ${san}."

If playerColor is BLACK, start naturally with:

"Black played ${san}."

Never confuse White and Black.

==================================================
MOVE QUALITY
==================================================

Use the supplied moveAnalysis to understand the quality of the player's move.

If quality is "best_move":
- Clearly tell the player that they made an excellent/correct choice.
- Explain the chess idea behind the move.
- Be encouraging.

If quality is "strong_move":
- Tell the player it is a strong/good move.
- Explain the main idea.
- If another move was stronger, mention it naturally without making the player feel bad.

If quality is "playable_move":
- Tell the player that the move is reasonable/playable.
- Explain what it accomplishes.
- Briefly mention that there were stronger alternatives if appropriate.

If quality is "not_in_top_5":
- Do not automatically call it a blunder.
- Explain that stronger alternatives were available.
- Explain the practical difference in a constructive way.
- Only call it a mistake/blunder if the supplied analysis clearly justifies that.

==================================================
CONVERSATIONAL STYLE
==================================================

Write like the AI chess coach shown in the ZC-Coach interface.

The response should feel like a conversation.

Be:
- friendly
- encouraging
- natural
- concise
- beginner/intermediate friendly
- conversational

Avoid:
- robotic engine language
- technical engine reports
- excessive chess terminology
- long variations
- formal analysis reports

Use natural phrases such as:

"Nice move!"
"That's a solid choice."
"Good idea."
"There's a stronger option here, though."
"That's still perfectly playable."
"Here's what I'd keep in mind..."
"Now think about..."
"Keep an eye on..."

Do not overuse these phrases.

==================================================
CHESS NOTATION
==================================================

Use normal chess notation.

Examples:

b1c3 → Nc3
e2e4 → e4
g1f3 → Nf3
e1g1 → O-O
d1h5 → Qh5

Do not show UCI notation to the user.

==================================================
ENGINE INFORMATION
==================================================

NEVER mention:

- Stockfish
- engine
- FEN
- centipawns
- evaluation score
- MultiPV
- PV
- depth
- nodes
- rank
- top 5

The player should feel that they are receiving coaching, not reading engine output.

==================================================
VARIATIONS
==================================================

Do not dump the entire principal variation.

Only use a supplied alternative move when it helps explain why the player's move was or was not the best choice.

Do not invent moves.

Only discuss chess ideas supported by the supplied analysis.

==================================================
RESPONSE LENGTH
==================================================

Keep the response short.

Use approximately 3-5 sentences.

The response should generally follow this conversational structure:

1. Identify who played and what they played.
2. Give immediate feedback on the move.
3. Explain the chess idea in simple language.
4. Mention a stronger alternative only when useful.
5. Give one short coaching tip.

==================================================
EXAMPLE
==================================================

If WHITE played Nc3:

"White played Nc3. That's a natural developing move and it brings a piece toward the center, so it's a perfectly playable choice. There was a stronger way to immediately challenge the center, but you haven't done anything disastrous here. Coaching tip: In the opening, try to develop your pieces while fighting for the center."

If BLACK played e5:

"Black played e5. That's a strong central response because it immediately challenges White's control of the center. It also opens the way for your pieces to develop naturally. Coaching tip: When you can fight for the center while developing, that's usually a good sign."

==================================================

IMPORTANT:

The move being discussed is ALWAYS the player's latest move:

${san}

The player is:

${playerColor}

Do not confuse this with the opponent's next move.

Return ONLY the coaching message.
`;

            try {
                const geminiResponse = await ai.models.generateContent({
                    model: "gemini-3.5-flash",
                    contents: prompt,
                });

                const narrative = geminiResponse.text.trim();

                console.log("GEMINI NARRATION:", narrative);

                const audioFileName = `move-${moveIndex}-${Date.now()}.mp3`;

                execFile(
                    "python",
                    ["tts.py", narrative, audioFileName],
                    { cwd: __dirname },
                    (error, stdout, stderr) => {

                        if (error) {
                            console.error("TTS error:", error);
                            console.error("TTS stderr:", stderr);

                            return res.status(500).json({
                                beforeFen,
                                afterFen,
                                playerColor,
                                playerMove,
                                topMoves,
                                moveAnalysis,
                                narrative,
                                error: "TTS generation failed"
                            });
                        }

                        console.log(stdout);

                        res.json({
                            moveIndex,
                            moveNumber,

                            beforeFen,
                            afterFen,

                            playerColor,
                            playerMove,
                            san,

                            topMoves,
                            moveAnalysis,

                            narrative,

                            audioUrl: `/audio/${audioFileName}`
                        });
                    }
                );

            } catch (error) {
                console.error("Gemini error:", error);

                res.status(500).json({
                    beforeFen,
                    afterFen,
                    playerColor,
                    playerMove,
                    topMoves,
                    moveAnalysis,
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