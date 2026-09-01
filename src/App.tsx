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
  const [coachHighlight, setCoachHighlight] = useState<MoveHighlight | null>(
    null,
  );

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

          console.log("MOVE CONTEXT:", newMoveContext);

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

      console.log("Stockfish analysis:", data);

      console.log("Gemini narration received:", data.narrative);
      console.log("Gemini segments received:", data.segments);

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

        console.log("CHAT RESPONSE:", data);
        console.log("Gemini chat narration received:", data.narrative);
        console.log("Gemini chat segments received:", data.segments);

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
    [
      userQuestion,
      isExplaining,
      chatMessages,
      pendingMove,
      playSegments,
      stopAudioAndHighlight,
    ],
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
    <div className="min-h-screen bg-[#0b1120] text-white">
      {/* Top Navigation */}
      <header className="border-b border-white/10 bg-[#0b1120]/95 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1500px] items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/15 text-xl ring-1 ring-blue-400/20">
              ♟
            </div>

            <div>
              <h1 className="text-base font-bold tracking-tight sm:text-lg">
                AI Chess Coach
              </h1>
              <p className="hidden text-xs text-slate-500 sm:block">
                Analyze. Understand. Improve.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-400/5 px-3 py-1.5">
            <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
            <span className="text-[11px] font-medium text-emerald-300">
              Coach Online
            </span>
          </div>
        </div>
      </header>

      {/* Main Application */}
      <main className="mx-auto max-w-[1500px] px-3 py-4 sm:px-6 sm:py-6 lg:px-8 lg:py-8">
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(560px,1.15fr)_minmax(420px,0.85fr)]">
          {/* ================= BOARD AREA ================= */}
          <section className="min-w-0">
            <div className="overflow-hidden rounded-3xl border border-white/10 bg-[#111827] shadow-2xl shadow-black/20">
              {/* Board Header */}
              <div className="flex items-center justify-between border-b border-white/10 px-4 py-3 sm:px-5">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                    Current Position
                  </p>

                  <div className="mt-1 flex items-center gap-2">
                    <span
                      className={`h-2 w-2 rounded-full ${
                        game.turn() === "w"
                          ? "bg-white shadow-[0_0_8px_rgba(255,255,255,0.7)]"
                          : "bg-slate-500"
                      }`}
                    />

                    <span className="text-sm font-semibold text-slate-200">
                      {game.turn() === "w" ? "White" : "Black"} to move
                    </span>
                  </div>
                </div>

                <div
                  className={`rounded-full px-3 py-1 text-[11px] font-semibold ${
                    game.isCheckmate()
                      ? "bg-red-500/10 text-red-400 ring-1 ring-red-500/20"
                      : game.isCheck()
                        ? "bg-amber-500/10 text-amber-400 ring-1 ring-amber-500/20"
                        : game.isDraw()
                          ? "bg-slate-500/10 text-slate-400 ring-1 ring-slate-500/20"
                          : "bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/20"
                  }`}
                >
                  {getGameStatus()}
                </div>
              </div>

              {/* Chess Board */}
              <div className="flex justify-center bg-[#0f172a] p-3 sm:p-5 lg:p-7">
                <div className="w-full max-w-[680px] overflow-hidden rounded-xl shadow-2xl ring-1 ring-black/40">
                  <Chessboard options={chessboardOptions} />
                </div>
              </div>

              {/* Board Controls */}
              <div className="border-t border-white/10 bg-[#111827] p-3 sm:p-4">
                <div className="flex gap-2">
                  <button
                    onClick={undoLastMove}
                    disabled={totalMoves === 0}
                    className="group flex flex-1 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-semibold text-slate-300 transition hover:bg-white/[0.08] hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
                  >
                    <span className="text-base transition group-hover:-translate-x-0.5">
                      ↶
                    </span>
                    Undo
                  </button>

                  <button
                    onClick={resetGame}
                    className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-blue-600/20 transition hover:bg-blue-500 active:scale-[0.98]"
                  >
                    <span>↻</span>
                    New Game
                  </button>
                </div>
              </div>
            </div>

            {/* Move History */}
            <div className="mt-5 overflow-hidden rounded-2xl border border-white/10 bg-[#111827]">
              <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
                <div>
                  <h2 className="text-sm font-semibold text-white">
                    Move History
                  </h2>
                  <p className="mt-0.5 text-[10px] text-slate-500">
                    Click a move to return to that position
                  </p>
                </div>

                <span className="rounded-lg bg-white/[0.04] px-2.5 py-1 text-[10px] font-medium text-slate-500">
                  {totalMoves} {totalMoves === 1 ? "move" : "moves"}
                </span>
              </div>

              <div className="max-h-48 overflow-y-auto">
                {moveHistory.length > 0 ? (
                  <table className="w-full text-left">
                    <thead className="sticky top-0 bg-[#111827]">
                      <tr className="border-b border-white/10 text-[9px] uppercase tracking-wider text-slate-600">
                        <th className="w-12 px-4 py-2.5">#</th>
                        <th className="px-2 py-2.5">White</th>
                        <th className="px-2 py-2.5">Black</th>
                      </tr>
                    </thead>

                    <tbody>
                      {moveHistory.map((pair) => (
                        <tr
                          key={pair.number}
                          className="border-b border-white/[0.05] last:border-0 hover:bg-white/[0.025]"
                        >
                          <td className="px-4 py-2.5 font-mono text-xs text-slate-600">
                            {pair.number}.
                          </td>

                          <td className="px-2 py-2.5">
                            <button
                              onClick={() => undoMoveAtIndex(pair.whiteIndex)}
                              className="rounded-md px-2 py-1 font-mono text-sm text-slate-300 transition hover:bg-blue-500/10 hover:text-blue-400"
                            >
                              {pair.white}
                            </button>
                          </td>

                          <td className="px-2 py-2.5">
                            {pair.black !== undefined && (
                              <button
                                onClick={() =>
                                  undoMoveAtIndex(pair.blackIndex as number)
                                }
                                className="rounded-md px-2 py-1 font-mono text-sm text-slate-300 transition hover:bg-blue-500/10 hover:text-blue-400"
                              >
                                {pair.black}
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div className="px-4 py-8 text-center">
                    <div className="mb-2 text-2xl opacity-30">♟</div>
                    <p className="text-xs text-slate-600">
                      Your moves will appear here
                    </p>
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* ================= COACH AREA ================= */}
          <section className="flex min-h-0 flex-col overflow-hidden rounded-3xl border border-white/10 bg-[#111827] shadow-2xl shadow-black/20 xl:h-[calc(100vh-145px)] xl:min-h-[720px]">
            {/* Coach Header */}
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-4 sm:px-5">
              <div className="flex items-center gap-3">
                <div className="relative">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 text-lg shadow-lg shadow-blue-600/20">
                    ♟
                  </div>

                  <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-[#111827] bg-emerald-400" />
                </div>

                <div>
                  <h2 className="text-sm font-bold text-white sm:text-base">
                    Your Chess Coach
                  </h2>

                  <p className="mt-0.5 text-[11px] text-slate-500">
                    {isExplaining
                      ? "Analyzing your position..."
                      : coachHighlight
                        ? "Explaining the position..."
                        : "Ask me anything about the position"}
                  </p>
                </div>
              </div>

              {pendingMove && (
                <button
                  onClick={explainMove}
                  disabled={isExplaining}
                  className="group flex items-center gap-2 rounded-xl bg-blue-600 px-3 py-2 text-[11px] font-bold text-white shadow-lg shadow-blue-600/20 transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50 sm:px-4 sm:text-xs"
                >
                  <span className="text-sm">✦</span>

                  <span>
                    {isExplaining
                      ? "Analyzing..."
                      : `Explain ${pendingMove.san}`}
                  </span>
                </button>
              )}
            </div>

            {/* Current Move Context */}
            {pendingMove && (
              <div className="border-b border-white/[0.06] bg-blue-500/[0.035] px-4 py-3 sm:px-5">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-blue-400/70">
                      Latest Move
                    </p>

                    <div className="mt-1 flex items-center gap-2">
                      <span className="text-sm font-bold text-white">
                        {pendingMove.playerColor}
                      </span>

                      <span className="text-slate-600">•</span>

                      <span className="font-mono text-sm font-bold text-blue-400">
                        {pendingMove.san}
                      </span>
                    </div>
                  </div>

                  <span className="rounded-lg border border-white/10 bg-white/[0.04] px-2 py-1 text-[9px] text-slate-500">
                    Move {pendingMove.moveNumber}
                  </span>
                </div>
              </div>
            )}

            {/* Chat */}
            <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-5">
              {chatMessages.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center px-5 text-center">
                  <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-3xl bg-blue-500/10 text-3xl ring-1 ring-blue-500/10">
                    ♟
                  </div>

                  <h3 className="text-base font-semibold text-slate-200">
                    Your personal chess coach
                  </h3>

                  <p className="mt-2 max-w-sm text-xs leading-5 text-slate-500">
                    Make a move and ask me why it works, what could be better,
                    or what might happen next.
                  </p>

                  <div className="mt-5 grid w-full max-w-sm grid-cols-1 gap-2 sm:grid-cols-2">
                    {[
                      "Why is this move good?",
                      "What should I play?",
                      "Why not another move?",
                      "What happens next?",
                    ].map((chip, idx) => (
                      <button
                        key={idx}
                        onClick={() => handleAskQuestion(chip)}
                        disabled={isExplaining}
                        className="rounded-xl border border-white/10 bg-white/[0.025] px-3 py-2.5 text-left text-[11px] text-slate-400 transition hover:border-blue-500/30 hover:bg-blue-500/[0.06] hover:text-blue-300 disabled:opacity-40"
                      >
                        {chip}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="space-y-5">
                  {chatMessages.map((msg) => (
                    <div
                      key={msg.id}
                      className={`flex ${
                        msg.role === "user" ? "justify-end" : "justify-start"
                      }`}
                    >
                      <div
                        className={`flex max-w-[90%] gap-2.5 ${
                          msg.role === "user" ? "flex-row-reverse" : "flex-row"
                        }`}
                      >
                        {/* Avatar */}
                        <div
                          className={`mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-xs ${
                            msg.role === "user"
                              ? "bg-blue-600 text-white"
                              : "bg-blue-500/10 text-blue-400 ring-1 ring-blue-500/10"
                          }`}
                        >
                          {msg.role === "user" ? "You" : "♟"}
                        </div>

                        <div
                          className={`${
                            msg.role === "user" ? "items-end" : "items-start"
                          } flex flex-col`}
                        >
                          <div
                            className={`rounded-2xl px-4 py-3 text-xs leading-5 sm:text-sm sm:leading-6 ${
                              msg.role === "user"
                                ? "rounded-tr-md bg-blue-600 text-white shadow-lg shadow-blue-600/10"
                                : "rounded-tl-md border border-white/[0.07] bg-[#182235] text-slate-200"
                            }`}
                          >
                            {msg.text}
                          </div>

                          {msg.moveContext && (
                            <div className="mt-1.5 px-1 text-[9px] text-slate-600">
                              Move {msg.moveContext.moveNumber} ·{" "}
                              {msg.moveContext.playerColor} ·{" "}
                              {msg.moveContext.san}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}

                  {isExplaining && (
                    <div className="flex items-center gap-2 px-1 text-xs text-slate-500">
                      <div className="flex items-center gap-1 rounded-xl border border-white/[0.06] bg-white/[0.025] px-3 py-2">
                        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-blue-400 [animation-delay:-0.3s]" />
                        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-blue-400 [animation-delay:-0.15s]" />
                        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-blue-400" />
                        <span className="ml-1.5">Coach is thinking</span>
                      </div>
                    </div>
                  )}

                  <div ref={chatBottomRef} />
                </div>
              )}
            </div>

            {/* Bottom Composer */}
            <div className="border-t border-white/10 bg-[#0f172a] p-3 sm:p-4">
              {/* Quick Questions */}
              <div className="mb-3 flex gap-1.5 overflow-x-auto pb-1">
                {[
                  pendingMove ? `Why not ${pendingMove.san}?` : "Why not Nc3?",
                  "What was better?",
                  "What happens next?",
                  "Why this move?",
                ].map((chip, idx) => (
                  <button
                    key={idx}
                    onClick={() => handleAskQuestion(chip)}
                    disabled={isExplaining}
                    className="shrink-0 rounded-full border border-white/10 bg-white/[0.035] px-3 py-1.5 text-[10px] font-medium text-slate-400 transition hover:border-blue-500/30 hover:bg-blue-500/10 hover:text-blue-300 disabled:opacity-40"
                  >
                    {chip}
                  </button>
                ))}
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleAskQuestion();
                }}
                className="flex items-center gap-2 rounded-2xl border border-white/10 bg-[#182235] p-1.5 transition focus-within:border-blue-500/40 focus-within:ring-2 focus-within:ring-blue-500/10"
              >
                <input
                  type="text"
                  value={userQuestion}
                  onChange={(e) => setUserQuestion(e.target.value)}
                  placeholder="Ask your coach anything..."
                  disabled={isExplaining}
                  className="min-w-0 flex-1 bg-transparent px-3 py-2.5 text-xs text-white outline-none placeholder:text-slate-600 sm:text-sm"
                />

                <button
                  type="submit"
                  disabled={!userQuestion.trim() || isExplaining}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-sm text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-30"
                  aria-label="Send message"
                >
                  ↑
                </button>
              </form>

              <p className="mt-2 text-center text-[9px] text-slate-700">
                AI coaching can make mistakes · Verify critical positions
              </p>
            </div>
          </section>
        </div>

        {/* ================= GAME INFO ================= */}
        <section className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
          {/* Game Status */}
          <div className="rounded-2xl border border-white/10 bg-[#111827] p-4 sm:p-5">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-white">
                  Game Status
                </h3>
                <p className="mt-0.5 text-[10px] text-slate-600">
                  Current position information
                </p>
              </div>

              <div className="rounded-lg bg-white/[0.04] px-2.5 py-1 text-[10px] text-slate-500">
                Live
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.025] p-3">
                <p className="text-[9px] uppercase tracking-wider text-slate-600">
                  Turn
                </p>
                <p className="mt-1 text-sm font-semibold text-slate-200">
                  {game.turn() === "w" ? "♔ White" : "♚ Black"}
                </p>
              </div>

              <div className="rounded-xl border border-white/[0.06] bg-white/[0.025] p-3">
                <p className="text-[9px] uppercase tracking-wider text-slate-600">
                  Status
                </p>
                <p className={`mt-1 text-sm font-semibold ${statusColorClass}`}>
                  {getGameStatus()}
                </p>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.025] p-3">
                <p className="mb-2 text-[9px] uppercase tracking-wider text-slate-600">
                  Captured by White
                </p>

                <div className="flex min-h-7 flex-wrap items-center gap-0.5 text-xl">
                  {capturedByWhite.length > 0 ? (
                    capturedByWhite.map((p, i) => (
                      <span key={`w-${i}`} className="drop-shadow">
                        {UNICODE_PIECES.b[p]}
                      </span>
                    ))
                  ) : (
                    <span className="text-[10px] italic text-slate-700">
                      None
                    </span>
                  )}
                </div>
              </div>

              <div className="rounded-xl border border-white/[0.06] bg-white/[0.025] p-3">
                <p className="mb-2 text-[9px] uppercase tracking-wider text-slate-600">
                  Captured by Black
                </p>

                <div className="flex min-h-7 flex-wrap items-center gap-0.5 text-xl">
                  {capturedByBlack.length > 0 ? (
                    capturedByBlack.map((p, i) => (
                      <span key={`b-${i}`} className="drop-shadow">
                        {UNICODE_PIECES.w[p]}
                      </span>
                    ))
                  ) : (
                    <span className="text-[10px] italic text-slate-700">
                      None
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Coaching Status */}
          <div className="rounded-2xl border border-white/10 bg-[#111827] p-4 sm:p-5">
            <div className="mb-4">
              <h3 className="text-sm font-semibold text-white">
                Coaching Session
              </h3>
              <p className="mt-0.5 text-[10px] text-slate-600">
                Your current AI coaching state
              </p>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between rounded-xl border border-white/[0.06] bg-white/[0.025] px-3 py-2.5">
                <span className="text-xs text-slate-500">Latest move</span>

                <span className="font-mono text-xs font-semibold text-slate-300">
                  {pendingMove?.san || "—"}
                </span>
              </div>

              <div className="flex items-center justify-between rounded-xl border border-white/[0.06] bg-white/[0.025] px-3 py-2.5">
                <span className="text-xs text-slate-500">Coach</span>

                <span className="text-xs font-semibold text-emerald-400">
                  {isExplaining
                    ? "Thinking..."
                    : coachHighlight
                      ? "Explaining"
                      : "Ready"}
                </span>
              </div>

              <div className="flex items-center justify-between rounded-xl border border-white/[0.06] bg-white/[0.025] px-3 py-2.5">
                <span className="text-xs text-slate-500">Board highlight</span>

                <span className="text-xs font-semibold text-blue-400">
                  {coachHighlight
                    ? `${coachHighlight.from} → ${coachHighlight.to}`
                    : "Inactive"}
                </span>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* ================= GAME OVER MODAL ================= */}
      {showGameOverModal && gameOverInfo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md overflow-hidden rounded-3xl border border-white/10 bg-[#111827] shadow-2xl">
            <div className="p-7 text-center sm:p-9">
              <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-500/10 text-3xl">
                {game.isCheckmate() ? "♛" : "🤝"}
              </div>

              <p className="text-2xl font-bold tracking-tight text-white">
                {gameOverInfo.title}
              </p>

              <p className="mt-2 text-sm text-slate-500">
                {gameOverInfo.subtitle}
              </p>

              <div className="mt-7 flex flex-col gap-2 sm:flex-row">
                <button
                  onClick={resetGame}
                  className="flex-1 rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-blue-600/20 transition hover:bg-blue-500"
                >
                  Play Again
                </button>

                <button
                  onClick={() => setShowGameOverModal(false)}
                  className="flex-1 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-semibold text-slate-300 transition hover:bg-white/[0.08] hover:text-white"
                >
                  Continue Reviewing
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
