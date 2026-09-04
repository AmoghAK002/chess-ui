require("dotenv").config();

const path = require("path");
const express = require("express");
const cors = require("cors");
const { spawn } = require("child_process");
const { GoogleGenAI } = require("@google/genai");
const wav = require("wav");
const { Chess } = require("chess.js");

const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
});

const app = express();

app.use(cors());
app.use(express.json());

const PORT = 5000;

/**
 * Converts PCM buffer to WAV Base64 Data URI in memory
 */
function pcmToWavDataUri(pcmBuffer, sampleRate = 24000) {
    return new Promise((resolve, reject) => {
        const writer = new wav.Writer({
            channels: 1,
            sampleRate,
            bitDepth: 16,
        });

        const chunks = [];

        writer.on("data", (chunk) => {
            chunks.push(chunk);
        });

        writer.on("end", () => {
            const wavBuffer = Buffer.concat(chunks);
            resolve("data:audio/wav;base64," + wavBuffer.toString("base64"));
        });

        writer.on("error", reject);

        writer.write(pcmBuffer);
        writer.end();
    });
}

/**
 * Runs Stockfish engine on a FEN position to depth 15 with MultiPV
 */
function analyzeFenWithStockfish(fen, depth = 15, multiPV = 5) {
    return new Promise((resolve, reject) => {
        const stockfishPath = path.join(__dirname, "stockfish-windows-x86-64-avx2.exe");
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

/**
 * Generates TTS for a text segment using Gemini TTS directly via @google/genai
 */
async function generateTTSForText(text) {
    if (!text || !text.trim()) return null;

    try {
        const ttsResponse = await ai.models.generateContent({
            model: "gemini-2.5-flash-preview-tts",
            contents: text,
            config: {
                responseModalities: ["AUDIO"],
                speechConfig: {
                    voiceConfig: {
                        prebuiltVoiceConfig: {
                            voiceName: "Algenib",
                        },
                    },
                },
            },
        });

        const part = ttsResponse.candidates?.[0]?.content?.parts?.[0];
        if (part?.inlineData?.data) {
            const pcmBuffer = Buffer.from(part.inlineData.data, "base64");
            return await pcmToWavDataUri(pcmBuffer, 24000);
        }
    } catch (error) {
        console.error("TTS generation error:", error.message);
    }
    return null;
}

/**
 * Helper to safely extract JSON from Gemini text response
 */
function parseGeminiJson(rawText) {
    let cleanText = rawText.trim();
    if (cleanText.startsWith("```json")) {
        cleanText = cleanText.replace(/^```json\s*/, "").replace(/\s*```$/, "");
    } else if (cleanText.startsWith("```")) {
        cleanText = cleanText.replace(/^```\s*/, "").replace(/\s*```$/, "");
    }

    try {
        return JSON.parse(cleanText);
    } catch (e) {
        console.error("Failed to parse Gemini JSON:", e.message, "Raw text:", rawText);
        return {
            narrative: rawText,
            segments: [
                {
                    text: rawText,
                    move: null
                }
            ]
        };
    }
}

/**
 * POST /api/analyze
 * Analyzes a played move: Stockfish before/after position analysis, Gemini narration & segments, TTS.
 */
app.post("/api/analyze", async (req, res) => {
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
            error: "moveIndex, moveNumber, beforeFen, afterFen, playerMove, san and playerColor are required"
        });
    }

    console.log("\n========== MOVE CONTEXT ==========");
    console.log("Move Index:", moveIndex);
    console.log("Move Number:", moveNumber);
    console.log("Player Color:", playerColor);
    console.log("SAN:", san);
    console.log("UCI:", playerMove);
    console.log("Before FEN:", beforeFen);
    console.log("After FEN:", afterFen);
    console.log("==================================\n");

    try {
        const [topMovesBefore, topMovesAfter] = await Promise.all([
            analyzeFenWithStockfish(beforeFen, 15, 5).catch(err => {
                console.error("Stockfish BEFORE error:", err);
                return [];
            }),
            analyzeFenWithStockfish(afterFen, 15, 5).catch(err => {
                console.error("Stockfish AFTER error:", err);
                return [];
            })
        ]);

        console.log("\n========== STOCKFISH RESULTS ==========");

        console.log("\n--- BEFORE MOVE ---");
        console.table(topMovesBefore);

        console.log("\n--- AFTER MOVE ---");
        console.table(topMovesAfter);

        console.log("=======================================\n");

        const playerMoveResult = topMovesBefore.find(m => m.move === playerMove);
        const bestMoveBefore = topMovesBefore.length > 0 ? topMovesBefore[0] : null;
        const bestResponseAfter = topMovesAfter.length > 0 ? topMovesAfter[0] : null;

        let moveQuality = "playable_move";
        if (!playerMoveResult) {
            moveQuality = "not_in_top_5";
        } else if (playerMoveResult.rank === 1) {
            moveQuality = "best_move";
        } else if (playerMoveResult.rank <= 3) {
            moveQuality = "strong_move";
        }

        const moveAnalysis = {
            player: playerColor,
            playedMove: playerMove,
            san: san,
            rank: playerMoveResult ? playerMoveResult.rank : null,
            bestMoveBefore: bestMoveBefore ? bestMoveBefore.san : null,
            bestMoveBeforeUci: bestMoveBefore ? bestMoveBefore.move : null,
            bestResponseAfter: bestResponseAfter ? bestResponseAfter.san : null,
            bestResponseAfterUci: bestResponseAfter ? bestResponseAfter.move : null,
            quality: moveQuality
        };

        console.log("\n========== PLAYER MOVE ANALYSIS ==========");
        console.log(JSON.stringify(moveAnalysis, null, 2));
        console.log("==========================================\n");

        const prompt = `
You are a friendly, expert human chess coach sitting next to the player in a live game.

The player just made a move:
- Player: ${playerColor}
- Move Number: ${moveNumber}
- Played Move (SAN): ${san}
- Played Move (UCI): ${playerMove}
- Position Before Move (FEN): ${beforeFen}
- Position After Move (FEN): ${afterFen}

Stockfish Analysis BEFORE move (choices available to ${playerColor}):
${JSON.stringify(topMovesBefore, null, 2)}

Stockfish Analysis AFTER move (opponent's best response choices):
${JSON.stringify(topMovesAfter, null, 2)}

Move Evaluation:
${JSON.stringify(moveAnalysis, null, 2)}

CRITICAL INSTRUCTIONS:
1. Act like a supportive, natural human coach. NEVER mention Stockfish, engine, FEN, centipawns, MultiPV, depth, PV, or rank numbers.
2. Use standard SAN notation in spoken text (e.g. Nc3, e4, e5, Nf3).
3. Always identify the player correctly as ${playerColor} (e.g. "${playerColor === 'WHITE' ? 'White' : 'Black'} played ${san}...").
4. Provide feedback on the move played (${san}).
5. If there was a stronger alternative (e.g. ${bestMoveBefore ? bestMoveBefore.san : ''}), explain why naturally.
6. If mentioning an opponent response (e.g. ${bestResponseAfter ? bestResponseAfter.san : ''}), mention it as what opponent might consider.
7. Keep response short (3-4 sentences total).

OUTPUT REQUIREMENTS:
You MUST respond with a valid JSON object only. No markdown around JSON if possible, or clean JSON codeblock.

JSON Format:
{
  "narrative": "Complete full text explanation...",
  "segments": [
    {
      "text": "First sentence identifying player and move feedback...",
      "move": null
    },
    {
      "text": "Second sentence discussing a specific move like e4...",
      "move": {
        "from": "e2",
        "to": "e4",
        "san": "e4",
        "type": "best_move"
      }
    },
    {
      "text": "Third sentence discussing opponent response like e5...",
      "move": {
        "from": "e7",
        "to": "e5",
        "san": "e5",
        "type": "response"
      }
    }
  ]
}

Note: For any move object inside segments, 'from' and 'to' MUST be valid board squares (e.g. "e2", "e4", "g1", "f3"). Only include a move object if that specific segment explicitly discusses that specific chess move. Otherwise set move to null.
`;

        const geminiResponse = await ai.models.generateContent({
            model: "gemini-3.5-flash",
            contents: prompt,
            config: {
                responseMimeType: "application/json"
            }
        });

        const parsedJson = parseGeminiJson(geminiResponse.text);

        console.log("\n========== GEMINI COACH RESPONSE ==========");
        console.log("Narrative:");
        console.log(parsedJson.narrative);

        console.log("\nSegments:");
        console.log(JSON.stringify(parsedJson.segments, null, 2));

        console.log("============================================\n");

        const segments = (parsedJson.segments || []).map((seg) => ({
            text: seg.text,
            move: seg.move || null
        }));

        segments.forEach((segment, index) => {
            console.log(`Segment ${index + 1}:`, "NO AUDIO (on-demand only)");

            console.log("Text:", segment.text);

            if (segment.move) {
                console.log(
                    "Move:",
                    `${segment.move.from} → ${segment.move.to}`,
                    `(${segment.move.san || "no SAN"})`
                );
            } else {
                console.log("Move: None");
            }
        });

        console.log("================================\n");

        res.json({
            beforeFen,
            afterFen,
            playerColor,
            playerMove,
            san,
            bestMoveBefore: bestMoveBefore ? bestMoveBefore.move : null,
            bestResponseAfter: bestResponseAfter ? bestResponseAfter.move : null,
            topMovesBefore,
            topMovesAfter,
            moveAnalysis,
            narrative: parsedJson.narrative || geminiResponse.text,
            segments: segments
        });

    } catch (error) {
        console.error("Analysis route error:", error);
        res.status(500).json({ error: "Failed to analyze move" });
    }
});

/**
 * POST /api/analyze-position
 * Analyzes any valid chess position provided as a FEN.
 */
app.post("/api/analyze-position", async (req, res) => {
    const { fen } = req.body;

    if (!fen) {
        return res.status(400).json({
            error: "FEN is required"
        });
    }

    // Validate the FEN using chess.js
    let chess;

    try {
        chess = new Chess(fen);
    } catch (error) {
        return res.status(400).json({
            error: "Invalid FEN"
        });
    }

    console.log("\n========== FEN POSITION ANALYSIS ==========");
    console.log("FEN:");
    console.log(fen);
    console.log("Side to move:", chess.turn() === "w" ? "WHITE" : "BLACK");
    console.log("===========================================\n");

    try {
        // Run Stockfish analysis
        const topMoves = await analyzeFenWithStockfish(fen, 15, 5);

        console.log("========== STOCKFISH POSITION RESULTS ==========");
        console.table(topMoves);
        console.log("================================================\n");

        const bestMove = topMoves.length > 0 ? topMoves[0] : null;

        const sideToMove = chess.turn() === "w" ? "White" : "Black";

        const prompt = `
You are a friendly, expert human chess coach.

Analyze this chess position for the player.

Current position:
- FEN: ${fen}
- Side to move: ${sideToMove}

Best candidate moves:
${JSON.stringify(topMoves, null, 2)}

INSTRUCTIONS:

1. Explain the position naturally like a human chess coach.
2. NEVER mention Stockfish, engine, FEN, centipawns, MultiPV, depth, PV, or rank numbers.
3. Explain:
   - What is happening in the position
   - Which side has the main ideas
   - What the player should focus on
   - The strongest candidate move and why
4. Use standard chess notation such as e4, Nf3, Qxd5.
5. Keep the explanation concise and useful.
6. Write approximately 3-5 sentences.

OUTPUT REQUIREMENTS:

Respond ONLY with valid JSON:

{
  "narrative": "Complete explanation of the position...",
  "segments": [
    {
      "text": "Explanation sentence...",
      "move": null
    },
    {
      "text": "Explanation involving a specific move...",
      "move": {
        "from": "e2",
        "to": "e4",
        "san": "e4",
        "type": "best_move"
      }
    }
  ]
}

IMPORTANT:
Only include a move object when that segment explicitly discusses that move.
Otherwise use:

"move": null
`;

        const geminiResponse = await ai.models.generateContent({
            model: "gemini-3.5-flash",
            contents: prompt,
            config: {
                responseMimeType: "application/json"
            }
        });

        const parsedJson = parseGeminiJson(geminiResponse.text);

        console.log("========== GEMINI POSITION COACH ==========");
        console.log("Narrative:");
        console.log(parsedJson.narrative);

        console.log("\nSegments:");
        console.log(JSON.stringify(parsedJson.segments, null, 2));
        console.log("============================================\n");

        // Build segments (no automatic audio generation)
        const segments = (parsedJson.segments || []).map((seg) => ({
            text: seg.text,
            move: seg.move || null,
        }));

        console.log("========== POSITION SEGMENTS ==========");

        segments.forEach((segment, index) => {
            console.log(`Segment ${index + 1}:`, "NO AUDIO (on-demand only)");
        });

        console.log("========================================\n");

        res.json({
            fen,
            sideToMove,
            topMoves,
            bestMove,
            narrative: parsedJson.narrative || geminiResponse.text,
            segments: segments,
        });

    } catch (error) {
        console.error("Position analysis error:", error);

        res.status(500).json({
            error: "Failed to analyze position"
        });
    }
});

/**
 * POST /api/chat
 * Handles user follow-up questions about the current position/move.
 */
app.post("/api/chat", async (req, res) => {
    const { question, currentFen, moveContext, chatHistory } = req.body;

    if (!question) {
        return res.status(400).json({ error: "question is required" });
    }

    console.log(`[CHAT] Question: "${question}"`);

    try {
        const fenToAnalyze =
            currentFen ||
            moveContext?.afterFen ||
            moveContext?.beforeFen ||
            "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
        
        console.log("\n========== CHAT POSITION ==========");
        console.log("Current FEN received:", currentFen);
        console.log("FEN being analyzed:", fenToAnalyze);
        console.log("===================================\n");
        
        let stockfishMoves = [];
        try {
            stockfishMoves = await analyzeFenWithStockfish(fenToAnalyze, 15, 5);
        } catch (sfErr) {
            console.error("Stockfish error for chat position:", sfErr);
        }

        const prompt = `
You are a friendly, expert human chess coach in an interactive chat session with a player.

Current Game Context:
- Move Context: ${JSON.stringify(moveContext, null, 2)}
- Current Position FEN: ${fenToAnalyze}
- Stockfish Analysis of current position: ${JSON.stringify(stockfishMoves, null, 2)}

Chat History:
${JSON.stringify(chatHistory || [], null, 2)}

User's Question:
"${question}"

INSTRUCTIONS:
1. Answer the player's question directly, accurately, and encouragingly.
2. Ground your explanation in real chess principles and the supplied position/analysis.
3. If the user asks "Why not Nc3?", "Why was e4 better?", "What happens if I play d4?", explain clearly using SAN notation.
4. NEVER mention engine, Stockfish, FEN, centipawns, MultiPV, or robotic terms.
5. Keep explanation concise (2-4 sentences).

OUTPUT REQUIREMENTS:
Respond ONLY with a valid JSON object:

{
  "narrative": "Full answer to question...",
  "segments": [
    {
      "text": "Sentence explaining...",
      "move": {
        "from": "e2",
        "to": "e4",
        "san": "e4",
        "type": "discussed_move"
      }
    }
  ]
}

If a segment discusses a specific move, provide its 'from' and 'to' squares (e.g. e2 -> e4). Otherwise set move to null.
`;

        const geminiResponse = await ai.models.generateContent({
            model: "gemini-3.5-flash",
            contents: prompt,
            config: {
                responseMimeType: "application/json"
            }
        });

        const parsedJson = parseGeminiJson(geminiResponse.text);

        const segments = (parsedJson.segments || []).map((seg) => ({
            text: seg.text,
            move: seg.move || null,
        }));

        res.json({
            narrative: parsedJson.narrative || geminiResponse.text,
            segments,
        });

    } catch (error) {
        console.error("Chat route error:", error);
        res.status(500).json({ error: "Failed to answer question" });
    }
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
        res.status(500).json({ error: error.message });
    }
});

// ==========================================
// ON-DEMAND TEXT TO SPEECH
// ==========================================

app.post("/api/tts", async (req, res) => {
    try {
        const { text } = req.body;

        // Validate text
        if (!text || !text.trim()) {
            return res.status(400).json({
                error: "Text is required for TTS",
            });
        }

        console.log("\n========== TTS REQUEST ==========");
        console.log("Text:", text);

        // Generate audio only when explicitly requested
        const audioDataUri = await generateTTSForText(text);

        if (!audioDataUri) {
            return res.status(500).json({
                error: "TTS generation failed",
            });
        }

        console.log("TTS generated successfully ✅");
        console.log("=================================\n");

        res.json({
            audioDataUri,
        });
    } catch (error) {
        console.error("TTS endpoint error:", error);

        res.status(500).json({
            error: "Failed to generate speech",
        });
    }
});

const server = app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});

// Keep Node event loop active continuously
setInterval(() => { }, 100000);