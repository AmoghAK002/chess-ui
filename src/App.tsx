import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import type { CSSProperties } from "react";
import { Chess } from "chess.js";
import type { Square, PieceSymbol, Color, Move } from "chess.js";
import { Chessboard } from "react-chessboard";
import type { PieceDropHandlerArgs } from "react-chessboard";

type PendingMove = {
  moveIndex: number;
  moveNumber: number;
  beforeFen: string;
  afterFen: string;
  playerMove: string;
  san: string;
  playerColor: "WHITE" | "BLACK";
};

type MoveHighlight = {
  from: Square;
  to: Square;
  san?: string;
  type?: string;
};

type Segment = {
  text: string;
  move?: MoveHighlight | null;
  audioDataUri?: string | null;
};

type ChatMessage = {
  id: string;
  role: "user" | "model";
  text: string;
  moveContext?: PendingMove;
  segments?: Segment[];
};

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
  // Single source of truth for game state
  const gameRef = useRef(new Chess());

  // State to trigger re-renders when gameRef mutates
  const [fen, setFen] = useState<string>(gameRef.current.fen());

  const [lastMove, setLastMove] = useState<LastMove | null>(null);
  const [selectedSquare, setSelectedSquare] = useState<Square | null>(null);
  const [legalTargets, setLegalTargets] = useState<Square[]>([]);
  const [showGameOverModal, setShowGameOverModal] = useState(false);

  // AI Chess Coach & Chat state
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [pendingMove, setPendingMove] = useState<PendingMove | null>(null);
  const [isExplaining, setIsExplaining] = useState(false);
  const [userQuestion, setUserQuestion] = useState("");
  const [coachHighlight, setCoachHighlight] = useState<MoveHighlight | null>(null);

  // Audio queue & race condition management
  const requestIdRef = useRef<number>(0);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const chatBottomRef = useRef<HTMLDivElement | null>(null);

  // Scroll chat to bottom on new message
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages, isExplaining]);

  // Stops any playing audio and clears coach move highlights
  const stopAudioAndHighlight = useCallback(() => {
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current = null;
    }
    setCoachHighlight(null);
  }, []);

  // Sequentially plays segment audio and highlights moves during corresponding spoken segments
  const playSegments = useCallback(
    async (segments: Segment[], currentRequestId: number) => {
      stopAudioAndHighlight();

      for (let i = 0; i < segments.length; i++) {
        if (requestIdRef.current !== currentRequestId) {
          setCoachHighlight(null);
          return;
        }

        const seg = segments[i];

        if (seg.move && seg.move.from && seg.move.to) {
          setCoachHighlight(seg.move);
        } else {
          setCoachHighlight(null);
        }

        if (seg.audioDataUri) {
          await new Promise<void>((resolve) => {
            const audio = new Audio(seg.audioDataUri!);
            currentAudioRef.current = audio;

            const cleanup = () => {
              audio.onended = null;
              audio.onerror = null;
              if (currentAudioRef.current === audio) {
                currentAudioRef.current = null;
              }
            };

            audio.onended = () => {
              cleanup();
              resolve();
            };

            audio.onerror = (err) => {
              console.error("Segment audio error:", err);
              cleanup();
              resolve();
            };

            audio.play().catch((err) => {
              console.error("Audio playback error:", err);
              cleanup();
              resolve();
            });
          });
        } else {
          const delay = Math.max(1500, (seg.text?.length || 20) * 60);
          await new Promise((r) => setTimeout(r, delay));
        }
      }

      if (requestIdRef.current === currentRequestId) {
        setCoachHighlight(null);
      }
    },
    [stopAudioAndHighlight],
  );

  const clearSelection = useCallback(() => {
    setSelectedSquare(null);
    setLegalTargets([]);
  }, []);

  const makeMove = useCallback(
    (from: string, to: string, promotion: string = "q"): boolean => {
      try {
        const beforeFen = gameRef.current.fen();
        const playerColor = gameRef.current.turn() === "w" ? "WHITE" : "BLACK";

        const result = gameRef.current.move({
          from: from as Square,
          to: to as Square,
          promotion,
        });

        if (result) {
          const afterFen = gameRef.current.fen();

          const moveIndex = gameRef.current.history().length - 1;
          const moveNumber = Math.floor(moveIndex / 2) + 1;
          const san = result.san;
          const uci = result.from + result.to;

          const newMoveContext: PendingMove = {
            moveIndex,
            moveNumber,
            beforeFen,
            afterFen,
            playerMove: uci,
            san,
            playerColor,
          };

          // Cancel any active audio/highlights when a new move is made
          requestIdRef.current++;
          stopAudioAndHighlight();

          setPendingMove(newMoveContext);
          setLastMove({
            from: result.from,
            to: result.to,
          });
          setFen(afterFen);

          return true;
        }
      } catch {
        // Illegal move
      }

      return false;
    },
    [stopAudioAndHighlight],
  );

  const explainMove = useCallback(async () => {
    if (!pendingMove) return;

    requestIdRef.current++;
    const currentRequestId = requestIdRef.current;
    stopAudioAndHighlight();

    setIsExplaining(true);

    try {
      const response = await fetch("http://localhost:5000/api/analyze", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(pendingMove),
      });

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      const data = await response.json();

      if (requestIdRef.current !== currentRequestId) return;

      const coachMsg: ChatMessage = {
        id: `msg-${Date.now()}`,
        role: "model",
        text: data.narrative || "Here is your move analysis.",
        moveContext: pendingMove,
        segments: data.segments || [],
      };

      setChatMessages((prev) => [...prev, coachMsg]);

      if (data.segments && data.segments.length > 0) {
        playSegments(data.segments, currentRequestId);
      }
    } catch (error) {
      console.error("Explain move error:", error);
      setChatMessages((prev) => [
        ...prev,
        {
          id: `msg-err-${Date.now()}`,
          role: "model",
          text: "Sorry, I couldn't analyze this move.",
        },
      ]);
    } finally {
      setIsExplaining(false);
    }
  }, [pendingMove, playSegments, stopAudioAndHighlight]);

  const handleAskQuestion = useCallback(
    async (questionText?: string) => {
      const q = (questionText || userQuestion).trim();
      if (!q || isExplaining) return;

      setUserQuestion("");

      requestIdRef.current++;
      const currentRequestId = requestIdRef.current;
      stopAudioAndHighlight();

      const userMsg: ChatMessage = {
        id: `msg-user-${Date.now()}`,
        role: "user",
        text: q,
      };

      setChatMessages((prev) => [...prev, userMsg]);
      setIsExplaining(true);

      try {
        const historyPayload = chatMessages.map((m) => ({
          role: m.role,
          text: m.text,
        }));

        const response = await fetch("http://localhost:5000/api/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            question: q,
            moveContext: pendingMove,
            chatHistory: historyPayload,
          }),
        });

        if (!response.ok) {
          throw new Error(`API error: ${response.status}`);
        }

        const data = await response.json();

        if (requestIdRef.current !== currentRequestId) return;

        const coachMsg: ChatMessage = {
          id: `msg-coach-${Date.now()}`,
          role: "model",
          text: data.narrative,
          segments: data.segments || [],
        };

        setChatMessages((prev) => [...prev, coachMsg]);

        if (data.segments && data.segments.length > 0) {
          playSegments(data.segments, currentRequestId);
        }
      } catch (err) {
        console.error("Chat question error:", err);
        setChatMessages((prev) => [
          ...prev,
          {
            id: `msg-err-${Date.now()}`,
            role: "model",
            text: "Sorry, I ran into an error answering your question.",
          },
        ]);
      } finally {
        setIsExplaining(false);
      }
    },
    [userQuestion, isExplaining, chatMessages, pendingMove, playSegments, stopAudioAndHighlight],
  );

  const rewindToIndex = useCallback(
    (index: number) => {
      requestIdRef.current++;
      stopAudioAndHighlight();

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

      setPendingMove(null);
      clearSelection();
      setShowGameOverModal(false);
    },
    [clearSelection, stopAudioAndHighlight],
  );

  const undoMoveAtIndex = useCallback(
    (index: number) => {
      rewindToIndex(index);
    },
    [rewindToIndex],
  );

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
    [makeMove, clearSelection],
  );

  const onSquareClick = useCallback(
    ({ square }: { square: string; piece?: unknown }) => {
      const clickedSquare = square as Square;
      const game = gameRef.current;

      if (selectedSquare && legalTargets.includes(clickedSquare)) {
        const moved = makeMove(selectedSquare, clickedSquare, "q");
        clearSelection();
        if (moved) return;
      }

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
    [selectedSquare, legalTargets, makeMove, clearSelection],
  );

  const resetGame = useCallback(() => {
    requestIdRef.current++;
    stopAudioAndHighlight();

    gameRef.current = new Chess();
    setFen(gameRef.current.fen());
    setLastMove(null);
    setPendingMove(null);
    setChatMessages([]);
    clearSelection();
    setShowGameOverModal(false);
  }, [clearSelection, stopAudioAndHighlight]);

  const getGameStatus = useCallback(() => {
    const game = gameRef.current;
    if (game.isCheckmate()) return "Checkmate";
    if (game.isDraw()) return "Draw";
    if (game.isCheck()) return "Check";
    return "In Progress";
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
  }, [fen, isGameOver]);

  useEffect(() => {
    if (isGameOver) {
      setShowGameOverModal(true);
    }
  }, [isGameOver]);

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

    return {
      moveHistory: pairs,
      capturedByWhite: byWhite,
      capturedByBlack: byBlack,
    };
  }, [fen]);

  // Combine square styles: lastMove (yellow) + selected + legal + coachHighlight (blue)
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

    // Coach explanation highlighting layer
    if (coachHighlight && coachHighlight.from && coachHighlight.to) {
      const coachSquareStyle: CSSProperties = {
        backgroundColor: "rgba(59, 130, 246, 0.45)",
        boxShadow: "inset 0 0 0 3px #2563eb",
        borderRadius: "4px",
      };

      styles[coachHighlight.from] = {
        ...styles[coachHighlight.from],
        ...coachSquareStyle,
      };
      styles[coachHighlight.to] = {
        ...styles[coachHighlight.to],
        ...coachSquareStyle,
      };
    }

    return styles;
  }, [fen, lastMove, selectedSquare, legalTargets, coachHighlight]);

  // Coach explanation arrows layer
  const customArrows = useMemo(() => {
    if (coachHighlight && coachHighlight.from && coachHighlight.to) {
      return [
        {
          startSquare: coachHighlight.from,
          endSquare: coachHighlight.to,
          color: "rgb(37, 99, 235)",
        },
      ];
    }
    return [];
  }, [coachHighlight]);

  const chessboardOptions = useMemo(
    () => ({
      id: "main-board",
      position: fen,
      onPieceDrop,
      onSquareClick,
      squareStyles,
      arrows: customArrows,
      darkSquareStyle: { backgroundColor: "#769656" },
      lightSquareStyle: { backgroundColor: "#eeeed2" },
    }),
    [fen, onPieceDrop, onSquareClick, squareStyles, customArrows],
  );

  const game = gameRef.current;
  const totalMoves =
    moveHistory.length > 0
      ? (moveHistory[moveHistory.length - 1].blackIndex ??
          moveHistory[moveHistory.length - 1].whiteIndex) + 1
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
      <div className="w-full max-w-7xl bg-white rounded-3xl shadow-2xl p-4 sm:p-8">
        <h1 className="text-3xl sm:text-4xl font-bold text-center mb-2">
          ♟️ AI Chess Coach
        </h1>

        <p className="text-center text-gray-500 mb-6 sm:mb-8 text-sm sm:text-base">
          Interactive Coaching with Stockfish Analysis, Gemini Voice &amp; Board Highlighting
        </p>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8 items-start">
          {/* Left Column: Chess Board */}
          <div className="lg:col-span-6 flex flex-col items-center">
            <div className="w-full max-w-[480px] lg:max-w-[540px]">
              <Chessboard options={chessboardOptions} />
            </div>

            {/* Quick Game Action Controls */}
            <div className="w-full max-w-[480px] lg:max-w-[540px] mt-4 flex gap-3">
              <button
                onClick={undoLastMove}
                disabled={totalMoves === 0}
                className="flex-1 bg-gray-100 hover:bg-gray-200 active:bg-gray-300 disabled:opacity-40 disabled:cursor-not-allowed text-gray-700 py-2.5 rounded-xl transition font-semibold text-sm flex items-center justify-center gap-1.5"
              >
                ↺ Undo Move
              </button>
              <button
                onClick={resetGame}
                className="flex-1 bg-slate-800 hover:bg-slate-900 active:bg-black text-white py-2.5 rounded-xl transition font-semibold text-sm"
              >
                Reset Game
              </button>
            </div>
          </div>

          {/* Right Column: AI Coach Chat & Game Status */}
          <div className="lg:col-span-6 flex flex-col gap-6 h-full">
            {/* AI Coach Chat Card */}
            <section className="bg-slate-900 text-white border border-slate-700 rounded-2xl p-5 shadow-lg flex flex-col h-[460px]">
              <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center font-bold text-sm">
                    🤖
                  </div>
                  <div>
                    <h2 className="text-base font-semibold">AI Chess Coach</h2>
                    <p className="text-xs text-slate-400">
                      {coachHighlight ? "🔊 Speaking & Highlighting..." : "Ready to explain"}
                    </p>
                  </div>
                </div>

                {pendingMove && (
                  <button
                    onClick={explainMove}
                    disabled={isExplaining}
                    className="bg-blue-600 hover:bg-blue-500 active:bg-blue-700 disabled:opacity-50 text-white text-xs px-3.5 py-1.5 rounded-lg font-semibold transition flex items-center gap-1.5 shadow"
                  >
                    {isExplaining ? "Analyzing..." : `🧠 Explain ${pendingMove.san}`}
                  </button>
                )}
              </div>

              {/* Chat Message Scroll Area */}
              <div className="flex-1 overflow-y-auto my-3 pr-2 space-y-3 font-sans">
                {chatMessages.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-center text-slate-400 p-4">
                    <p className="text-sm font-medium mb-1">Make a move to start coaching</p>
                    <p className="text-xs text-slate-500 max-w-xs">
                      Click &quot;Explain Move&quot; after making your move, or ask questions anytime!
                    </p>
                  </div>
                ) : (
                  chatMessages.map((msg) => (
                    <div
                      key={msg.id}
                      className={`flex flex-col ${
                        msg.role === "user" ? "items-end" : "items-start"
                      }`}
                    >
                      <div
                        className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                          msg.role === "user"
                            ? "bg-blue-600 text-white rounded-br-none"
                            : "bg-slate-800 text-slate-100 border border-slate-700 rounded-bl-none shadow-sm"
                        }`}
                      >
                        {msg.text}
                      </div>

                      {msg.moveContext && (
                        <span className="text-[11px] text-slate-400 mt-1 px-1">
                          Move #{msg.moveContext.moveNumber} • {msg.moveContext.playerColor} played {msg.moveContext.san}
                        </span>
                      )}
                    </div>
                  ))
                )}

                {isExplaining && (
                  <div className="flex items-center gap-2 text-xs text-blue-400 py-1">
                    <div className="w-2 h-2 rounded-full bg-blue-400 animate-ping" />
                    Coach is thinking...
                  </div>
                )}
                <div ref={chatBottomRef} />
              </div>

              {/* Quick Suggestion Chips */}
              <div className="flex flex-wrap gap-1.5 mb-2 pt-2 border-t border-slate-800">
                {[
                  pendingMove ? `Why not ${pendingMove.san}?` : "Why not Nc3?",
                  "Why was e4 better?",
                  "What happens if I play d4?",
                  "What should I play here?",
                ].map((chip, idx) => (
                  <button
                    key={idx}
                    onClick={() => handleAskQuestion(chip)}
                    disabled={isExplaining}
                    className="text-[11px] bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white px-2.5 py-1 rounded-md border border-slate-700 transition"
                  >
                    {chip}
                  </button>
                ))}
              </div>

              {/* Chat Question Input */}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleAskQuestion();
                }}
                className="flex gap-2"
              >
                <input
                  type="text"
                  value={userQuestion}
                  onChange={(e) => setUserQuestion(e.target.value)}
                  placeholder="Ask your coach anything (e.g. Why not Nc3?)..."
                  disabled={isExplaining}
                  className="flex-1 bg-slate-800 border border-slate-700 text-white placeholder-slate-400 text-xs sm:text-sm rounded-xl px-3.5 py-2.5 focus:outline-none focus:border-blue-500 transition"
                />
                <button
                  type="submit"
                  disabled={!userQuestion.trim() || isExplaining}
                  className="bg-blue-600 hover:bg-blue-500 active:bg-blue-700 disabled:opacity-40 text-white text-xs px-4 py-2.5 rounded-xl font-semibold transition"
                >
                  Send
                </button>
              </form>
            </section>

            {/* Game Info & History Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Status & Captured */}
              <section className="bg-gray-50 border border-gray-200 rounded-2xl p-4 shadow-sm text-xs">
                <h3 className="font-semibold text-gray-800 mb-2 text-sm">Game Status</h3>
                <div className="flex justify-between items-center mb-3">
                  <span className="text-gray-500">Turn:</span>
                  <span className="font-bold text-gray-800">
                    {game.turn() === "w" ? "♔ White" : "♚ Black"}
                  </span>
                </div>
                <div className="flex justify-between items-center mb-3">
                  <span className="text-gray-500">Status:</span>
                  <span className={`font-bold ${statusColorClass}`}>{getGameStatus()}</span>
                </div>

                <div className="border-t border-gray-200 pt-2 space-y-2">
                  <div>
                    <span className="text-gray-400 block mb-0.5">Captured by White:</span>
                    <div className="min-h-[1.25rem] text-lg flex flex-wrap gap-0.5">
                      {capturedByWhite.length > 0 ? (
                        capturedByWhite.map((p, i) => (
                          <span key={`w-${i}`}>{UNICODE_PIECES.b[p]}</span>
                        ))
                      ) : (
                        <span className="text-gray-300 italic">None</span>
                      )}
                    </div>
                  </div>
                  <div>
                    <span className="text-gray-400 block mb-0.5">Captured by Black:</span>
                    <div className="min-h-[1.25rem] text-lg flex flex-wrap gap-0.5">
                      {capturedByBlack.length > 0 ? (
                        capturedByBlack.map((p, i) => (
                          <span key={`b-${i}`}>{UNICODE_PIECES.w[p]}</span>
                        ))
                      ) : (
                        <span className="text-gray-300 italic">None</span>
                      )}
                    </div>
                  </div>
                </div>
              </section>

              {/* Move History */}
              <section className="bg-gray-50 border border-gray-200 rounded-2xl p-4 shadow-sm text-xs">
                <h3 className="font-semibold text-gray-800 mb-2 text-sm">Move History</h3>
                <div className="max-h-36 overflow-y-auto rounded-lg border border-gray-200 bg-white">
                  {moveHistory.length > 0 ? (
                    <table className="w-full text-left font-mono">
                      <thead>
                        <tr className="border-b text-[10px] text-gray-400 uppercase">
                          <th className="py-1 px-2">#</th>
                          <th className="py-1 px-1">White</th>
                          <th className="py-1 px-1">Black</th>
                        </tr>
                      </thead>
                      <tbody>
                        {moveHistory.map((pair) => (
                          <tr key={pair.number} className="border-b last:border-b-0 even:bg-gray-50">
                            <td className="py-1 px-2 text-gray-400">{pair.number}.</td>
                            <td className="py-1 px-1 text-gray-800">
                              <span
                                className="cursor-pointer hover:text-blue-600"
                                onClick={() => undoMoveAtIndex(pair.whiteIndex)}
                              >
                                {pair.white}
                              </span>
                            </td>
                            <td className="py-1 px-1 text-gray-800">
                              {pair.black !== undefined && (
                                <span
                                  className="cursor-pointer hover:text-blue-600"
                                  onClick={() => undoMoveAtIndex(pair.blackIndex as number)}
                                >
                                  {pair.black}
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <p className="text-gray-300 p-2 italic">No moves yet</p>
                  )}
                </div>
              </section>
            </div>
          </div>
        </div>
      </div>

      {showGameOverModal && gameOverInfo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm bg-white rounded-2xl shadow-2xl p-8 text-center">
            <p className="text-3xl font-bold mb-2">{gameOverInfo.title}</p>
            <p className="text-lg text-gray-600 mb-6">{gameOverInfo.subtitle}</p>

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
