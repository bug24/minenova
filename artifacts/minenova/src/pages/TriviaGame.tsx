import { useState, useEffect, useCallback, useRef } from "react";
import { useLocation, useParams } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { getGetWalletQueryKey } from "@workspace/api-client-react";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import {
  triviaApi, type TriviaQuestion, type TriviaGameResult,
} from "@/lib/triviaApi";
import {
  BookOpen, ArrowLeft, Check, X, Trophy, TrendingUp, TrendingDown,
  Minus, Clock, RefreshCw, Bot, Swords,
} from "lucide-react";

const QUESTION_TIME = 15;
const ANSWER_SHOW_TIME = 1500;
const TOTAL_QUESTIONS = 10;

interface GameState {
  id: number;
  mode: "bot" | "pvp";
  status: "active" | "completed";
  player1Id: number;
  player2Id: number | null;
  entryFee: number;
  questionIds: number[];
  player1Answers: (number | null)[];
  player2Answers: (number | null)[];
  player1Score: number;
  player2Score: number;
  winnerId: number | null;
}

type Phase = "loading" | "question" | "answer-reveal" | "result";

export default function TriviaGame() {
  const { id } = useParams<{ id: string }>();
  const gameId = Number(id);
  const { user } = useAuth();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();

  const [phase, setPhase] = useState<Phase>("loading");
  const [game, setGame] = useState<GameState | null>(null);
  const [questions, setQuestions] = useState<TriviaQuestion[]>([]);
  const [currentQ, setCurrentQ] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState<number | null>(null);
  const [timeLeft, setTimeLeft] = useState(QUESTION_TIME);
  const [myScore, setMyScore] = useState(0);
  const [answeredIndexes, setAnsweredIndexes] = useState<(number | null)[]>([]);
  const [revealCorrectIndex, setRevealCorrectIndex] = useState<number | null>(null);
  const [result, setResult] = useState<TriviaGameResult | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoSubmitRef = useRef(false);

  // Load game data on mount
  useEffect(() => {
    if (!gameId || Number.isNaN(gameId)) { navigate("/trivia"); return; }
    (async () => {
      try {
        // First check if already completed
        try {
          const existing = await triviaApi<TriviaGameResult>(`/trivia/game/${gameId}`);
          if (existing.status === "completed") {
            setResult(existing);
            setPhase("result");
            return;
          }
          // Active game — load questions
          const gameData = existing as unknown as GameState;
          setGame(gameData);
          const questionIds = gameData.questionIds;
          const isP1 = gameData.player1Id === user?.id;
          const myAnswers = isP1 ? gameData.player1Answers : gameData.player2Answers;
          const startFromQ = myAnswers.length;

          // Load question data
          const allQ = await triviaApi<TriviaQuestion[]>("/trivia/questions");
          const ordered = questionIds.map((qid: number) => allQ.find((q) => q.id === qid)).filter(Boolean) as TriviaQuestion[];
          setQuestions(ordered);

          const myAnswersSafe = Array.isArray(myAnswers) ? (myAnswers as (number | null)[]) : [];
          setAnsweredIndexes(myAnswersSafe);
          setMyScore(0);
          setCurrentQ(startFromQ);

          if (startFromQ >= TOTAL_QUESTIONS) {
            // Already answered all — poll for result
            pollForResult(gameId);
            setPhase("question");
          } else {
            setPhase("question");
          }
        } catch {
          navigate("/trivia");
        }
      } catch {
        navigate("/trivia");
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId, user?.id]);

  const pollForResult = useCallback((gid: number) => {
    const interval = setInterval(async () => {
      try {
        const r = await triviaApi<TriviaGameResult>(`/trivia/game/${gid}`);
        if (r.status === "completed") {
          clearInterval(interval);
          queryClient.invalidateQueries({ queryKey: getGetWalletQueryKey() });
          setResult(r);
          setPhase("result");
        }
      } catch { /* retry */ }
    }, 2000);
    return interval;
  }, [queryClient]);

  // SSE for PvP game completion — uses ?token= since EventSource cannot set headers
  useEffect(() => {
    if (!gameId || phase === "result" || phase === "loading") return;
    if (!game || game.mode !== "pvp") return;

    const token = localStorage.getItem("minenova_token");
    if (!token) return;

    const es = new EventSource(`/api/trivia/events/${gameId}?token=${encodeURIComponent(token)}`);
    es.onmessage = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data as string) as { event?: string };
        if (data.event === "game_over") {
          es.close();
          const id = pollForResult(gameId);
          setTimeout(() => clearInterval(id), 120_000);
        }
      } catch { /* ignore parse errors */ }
    };
    es.onerror = () => { es.close(); };
    return () => { es.close(); };
  }, [gameId, phase, game, pollForResult]);

  const submitAnswer = useCallback(async (answerIdx: number | null, qIdx: number) => {
    if (submitting) return;
    setSubmitting(true);
    try {
      const resp = await triviaApi<{ recorded: boolean; answeredCount: number; done: boolean; correctIndex: number | null }>(
        "/trivia/answer",
        {
          method: "POST",
          body: JSON.stringify({ gameId, questionIndex: qIdx, answerIndex: answerIdx }),
        },
      );

      // Reveal the correct answer for this question immediately
      if (resp.correctIndex !== null && resp.correctIndex !== undefined) {
        setRevealCorrectIndex(resp.correctIndex);
      }
      // Increment score only if the player's answer was correct
      if (answerIdx !== null && resp.correctIndex !== null && resp.correctIndex !== undefined && answerIdx === resp.correctIndex) {
        setMyScore(prev => prev + 1);
      }

      if (resp.done) {
        // Poll for result (waiting for opponent in PvP)
        const intervalId = pollForResult(gameId);
        setTimeout(() => clearInterval(intervalId), 120_000);
      }
    } catch (err) {
      toast({ variant: "destructive", title: (err as Error).message });
    } finally {
      setSubmitting(false);
    }
  }, [submitting, gameId, pollForResult, toast]);

  const advanceQuestion = useCallback(() => {
    const nextQ = currentQ + 1;
    setRevealCorrectIndex(null);
    if (nextQ >= TOTAL_QUESTIONS) {
      // All questions done — show waiting for opponent if PvP
      setPhase("question");
      setCurrentQ(nextQ);
    } else {
      setCurrentQ(nextQ);
      setSelectedAnswer(null);
      setTimeLeft(QUESTION_TIME);
      autoSubmitRef.current = false;
      setPhase("question");
    }
  }, [currentQ]);

  const handleAnswer = useCallback(async (answerIdx: number) => {
    if (phase !== "question" || selectedAnswer !== null || currentQ >= TOTAL_QUESTIONS) return;
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }

    setSelectedAnswer(answerIdx);
    const newAnswered = [...answeredIndexes, answerIdx];
    setAnsweredIndexes(newAnswered);
    setPhase("answer-reveal");

    void submitAnswer(answerIdx, currentQ);

    setTimeout(advanceQuestion, ANSWER_SHOW_TIME);
  }, [phase, selectedAnswer, currentQ, answeredIndexes, submitAnswer, advanceQuestion]);

  const handleTimeout = useCallback(() => {
    if (phase !== "question" || selectedAnswer !== null || currentQ >= TOTAL_QUESTIONS) return;
    if (autoSubmitRef.current) return;
    autoSubmitRef.current = true;

    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }

    setSelectedAnswer(-1);
    const newAnswered = [...answeredIndexes, null];
    setAnsweredIndexes(newAnswered);
    setPhase("answer-reveal");

    void submitAnswer(null, currentQ);
    setTimeout(advanceQuestion, ANSWER_SHOW_TIME);
  }, [phase, selectedAnswer, currentQ, answeredIndexes, submitAnswer, advanceQuestion]);

  // Countdown timer
  useEffect(() => {
    if (phase !== "question" || currentQ >= TOTAL_QUESTIONS) return;
    setTimeLeft(QUESTION_TIME);
    autoSubmitRef.current = false;

    timerRef.current = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          clearInterval(timerRef.current!);
          timerRef.current = null;
          handleTimeout();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentQ, phase]);

  // ─── Loading ───────────────────────────────────────────────────────────────
  // Allow "result" phase to bypass the loading guard — game/questions stay null
  // when a completed game is loaded directly (they are not needed for the result view).
  if (phase !== "result" && (phase === "loading" || !game || questions.length === 0)) {
    return (
      <div className="flex flex-col gap-4 px-4 pb-6 pt-2 max-w-lg mx-auto">
        <div className="flex items-center justify-center h-40">
          <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  // ─── All answered — waiting for opponent ─────────────────────────────────
  if (currentQ >= TOTAL_QUESTIONS && phase !== "result") {
    return (
      <div className="flex flex-col gap-4 px-4 pb-6 pt-2 max-w-lg mx-auto">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate("/trivia")} className="flex items-center gap-1 text-xs text-muted-foreground active:opacity-60">
            <ArrowLeft className="w-4 h-4" /> Trivia
          </button>
        </div>
        <div className="bg-card border border-border rounded-2xl p-6 text-center space-y-4">
          <div className="w-14 h-14 rounded-2xl bg-indigo-500/20 flex items-center justify-center mx-auto">
            <Clock className="w-7 h-7 text-indigo-400" />
          </div>
          <div>
            <h2 className="font-black text-lg">Answers submitted!</h2>
            <p className="text-sm text-muted-foreground mt-1">
              {game.mode === "pvp" ? "Waiting for opponent to finish…" : "Calculating results…"}
            </p>
          </div>
          <div className="flex justify-center">
            <div className="flex gap-1">
              {[0, 1, 2].map(i => (
                <div key={i} className="w-2 h-2 rounded-full bg-indigo-400 animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ─── Result ────────────────────────────────────────────────────────────────
  if (phase === "result" && result) {
    const isP1 = result.player1Id === user?.id;
    const myFinalScore = isP1 ? result.player1Score : result.player2Score;
    const oppFinalScore = isP1 ? result.player2Score : result.player1Score;
    const won = result.winnerId === user?.id;
    const tied = result.status === "completed" && result.winnerId === null;
    const myAnswers = isP1 ? result.player1Answers : result.player2Answers;
    const oppAnswers = isP1 ? result.player2Answers : result.player1Answers;

    return (
      <div className="flex flex-col gap-4 px-4 pb-6 pt-2 max-w-lg mx-auto">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate("/trivia")} className="flex items-center gap-1 text-xs text-muted-foreground active:opacity-60">
            <ArrowLeft className="w-4 h-4" /> Trivia
          </button>
        </div>

        {/* Result header */}
        <div className={`rounded-2xl p-5 text-center border ${won ? "bg-emerald-500/10 border-emerald-500/30" : tied ? "bg-yellow-500/10 border-yellow-500/30" : "bg-red-500/10 border-red-500/30"}`}>
          <div className={`w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-3 ${won ? "bg-emerald-500/20" : tied ? "bg-yellow-500/20" : "bg-red-500/20"}`}>
            {won ? <Trophy className="w-7 h-7 text-emerald-400" /> : tied ? <Minus className="w-7 h-7 text-yellow-400" /> : <X className="w-7 h-7 text-red-400" />}
          </div>
          <h2 className={`font-black text-xl ${won ? "text-emerald-400" : tied ? "text-yellow-400" : "text-red-400"}`}>
            {won ? "You Won!" : tied ? "It's a Tie!" : "You Lost"}
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            {result.profit > 0 ? `+${result.profit.toFixed(0)} coins` : result.profit < 0 ? `${result.profit.toFixed(0)} coins` : "Entry fee partially refunded"}
          </p>
        </div>

        {/* Score comparison */}
        <div className="bg-card border border-border rounded-2xl p-4">
          <p className="text-xs font-bold text-muted-foreground mb-3 uppercase tracking-wide">Score Comparison</p>
          <div className="grid grid-cols-2 gap-4 text-center">
            <div>
              <p className="text-xs text-muted-foreground mb-1">You</p>
              <p className="text-3xl font-black">{myFinalScore}</p>
              <p className="text-[10px] text-muted-foreground">/ 10 correct</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">{result.opponentUsername ?? (game.mode === "bot" ? "Bot" : "Opponent")}</p>
              <p className="text-3xl font-black">{oppFinalScore}</p>
              <p className="text-[10px] text-muted-foreground">/ 10 correct</p>
            </div>
          </div>
        </div>

        {/* Question breakdown */}
        {result.questions && (
          <div className="bg-card border border-border rounded-2xl p-4">
            <p className="text-xs font-bold text-muted-foreground mb-3 uppercase tracking-wide">Question Breakdown</p>
            <div className="space-y-3">
              {result.questions.map((q, i) => {
                const myA = (myAnswers as (number | null)[])[i];
                const oppA = (oppAnswers as (number | null)[])[i];
                const myCorrect = myA === q.correctIndex;
                const oppCorrect = oppA === q.correctIndex;
                return (
                  <div key={q.id} className="text-xs space-y-1">
                    <p className="font-medium leading-snug line-clamp-2">{i + 1}. {q.question}</p>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                      <span className={`flex items-center gap-1 ${myCorrect ? "text-emerald-400" : "text-red-400"}`}>
                        {myCorrect ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />}
                        You{myA !== null ? ` — ${(q.options as string[])[myA]}` : " — No answer"}
                      </span>
                      <span className={`flex items-center gap-1 ${oppCorrect ? "text-emerald-400" : "text-red-400"}`}>
                        {oppCorrect ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />}
                        {result.opponentUsername ?? "Bot"}{oppA !== null && oppA !== undefined ? ` — ${(q.options as string[])[oppA]}` : " — No answer"}
                      </span>
                    </div>
                    <p className="text-[10px] text-muted-foreground">
                      Correct: <span className="text-emerald-400 font-medium">{(q.options as string[])[q.correctIndex]}</span>
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <Button
          className="w-full font-bold"
          style={{ background: "linear-gradient(135deg, #6366f1, #3b82f6)" }}
          onClick={() => navigate("/trivia")}
        >
          Play Again
        </Button>
      </div>
    );
  }

  // ─── Question phase ────────────────────────────────────────────────────────
  const currentQuestion = questions[currentQ];
  if (!currentQuestion) return null;

  const timerPct = (timeLeft / QUESTION_TIME) * 100;
  const timerColor = timeLeft > 8 ? "bg-emerald-500" : timeLeft > 4 ? "bg-yellow-500" : "bg-red-500";

  return (
    <div className="flex flex-col gap-4 px-4 pb-6 pt-2 max-w-lg mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate("/trivia")} className="flex items-center gap-1 text-xs text-muted-foreground active:opacity-60">
          <ArrowLeft className="w-4 h-4" /> Quit
        </button>
        <div className="flex-1" />
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {game.mode === "bot" ? <Bot className="w-3.5 h-3.5" /> : <Swords className="w-3.5 h-3.5" />}
          {game.mode === "bot" ? "vs Bot" : "vs Player"}
        </div>
      </div>

      {/* Progress */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs">
          <span className="font-bold">Question {Math.min(currentQ + 1, TOTAL_QUESTIONS)} / {TOTAL_QUESTIONS}</span>
          <span className="text-muted-foreground">Score: <span className="font-bold text-foreground">{myScore}</span></span>
        </div>
        <div className="h-1.5 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-indigo-500 transition-all duration-300"
            style={{ width: `${((currentQ) / TOTAL_QUESTIONS) * 100}%` }}
          />
        </div>
      </div>

      {/* Timer */}
      <div className="flex items-center gap-2">
        <Clock className={`w-4 h-4 shrink-0 ${timeLeft <= 4 ? "text-red-400" : "text-muted-foreground"}`} />
        <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
          <div
            className={`h-full ${timerColor} transition-all duration-1000 ease-linear`}
            style={{ width: `${timerPct}%` }}
          />
        </div>
        <span className={`text-xs font-bold w-5 text-right ${timeLeft <= 4 ? "text-red-400" : "text-muted-foreground"}`}>{timeLeft}</span>
      </div>

      {/* Question card */}
      <div className="bg-card border border-border rounded-2xl p-4">
        <p className="text-[10px] font-semibold text-indigo-400 uppercase tracking-wide mb-2">{currentQuestion.category}</p>
        <p className="text-sm font-semibold leading-snug">{currentQuestion.question}</p>
      </div>

      {/* Answer options */}
      <div className="grid grid-cols-1 gap-2">
        {(currentQuestion.options as string[]).map((option, i) => {
          let btnStyle = "bg-card border border-border text-foreground hover:border-indigo-500/50 hover:bg-indigo-500/5";
          if (phase === "answer-reveal") {
            if (revealCorrectIndex !== null) {
              if (i === revealCorrectIndex) {
                btnStyle = "bg-emerald-500/20 border border-emerald-500/60 text-emerald-400";
              } else if (i === selectedAnswer) {
                btnStyle = "bg-red-500/20 border border-red-500/60 text-red-400";
              }
            } else if (i === selectedAnswer) {
              btnStyle = "bg-indigo-500/20 border border-indigo-500/60 text-indigo-400";
            }
          } else if (i === selectedAnswer) {
            btnStyle = "bg-indigo-500/20 border border-indigo-500/60 text-indigo-400";
          }

          return (
            <button
              key={i}
              onClick={() => handleAnswer(i)}
              disabled={phase === "answer-reveal" || selectedAnswer !== null || submitting}
              className={`w-full text-left px-4 py-3 rounded-xl text-sm font-medium transition-all ${btnStyle} disabled:cursor-not-allowed`}
            >
              <span className="inline-flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-muted text-muted-foreground text-[10px] font-bold flex items-center justify-center shrink-0">
                  {String.fromCharCode(65 + i)}
                </span>
                {option}
              </span>
            </button>
          );
        })}
      </div>

      <p className="text-center text-[10px] text-muted-foreground">
        {phase === "answer-reveal" ? "Moving to next question…" : "Tap to select your answer"}
      </p>
    </div>
  );
}
