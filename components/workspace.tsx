"use client";
import { Button, Panel, TextInput, Textarea } from "./ui";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import dynamic from "next/dynamic";
import {
  Badge,
  Checkbox,
  Modal,
  NavLink,
  NumberInput,
  SegmentedControl,
  Select,
  Tabs,
} from "@mantine/core";
import { SplitPane } from "./split-pane";
import { TestCases, JudgeResults } from "./test-workbench";
import AssessmentMenu from "./assessment-menu";
import ReflectionWorkspace from "./reflection-workspace";
import AgentSettings from "./agent-settings";
import AgentDiagnostics from "./agent-diagnostics";
import CoachMemory from "./coach-memory";
import DataManagement from "./data-management";
import ProblemPrescription, {
  useProblemPrescription,
} from "./problem-prescription";
import PracticeLibrary from "./practice-library";
import ReviewFlagButton from "./review-flag";
import ResearchSources from "./research-sources";
import JavaHelpChat, { type RecordHelp } from "./java-help";
import { useEditorChat } from "./use-editor-chat";
import FocusedLearning, { type CoachRequest } from "./focused-learning";
import { acceptedSubmission } from "@/lib/assessment-completion";
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Code2,
  Compass,
  FlaskConical,
  History,
  Link2,
  MessageCircle,
  LoaderCircle,
  Pause,
  Play,
  RotateCcw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Target,
  Timer,
  TrendingUp,
  X,
  Zap,
} from "lucide-react";
import { api, bridge, mergeJob, Recorder } from "@/lib/browser";
import {
  CPP_MIN_BRIDGE_VERSION,
  initialBridgeState,
  isBridgeVersionAtLeast,
  popupWindowBounds,
  popupWindowFeatures,
  probeLeetCodeBridge,
  watchLeetCodeLogin,
  type BridgeConnection,
  type PopupHandle,
} from "@/lib/leetcode-bridge";
import { java } from "@/lib/java";
import { cpp } from "@/lib/cpp";
import {
  attemptLanguage,
  availableLanguages,
  languageConfig,
  normalizeLanguage,
  PREFERRED_LANGUAGE_KEY,
  starterForLanguage,
  type LanguageId,
} from "@/lib/languages";
import { useAgentSymbols } from "./use-agent-symbols";
import { splitTestCases, testParameters } from "@/lib/test-cases";
import { clockRemaining } from "@/lib/recording";
import { demoProblem } from "@/lib/demo";
import type {
  Attempt,
  AttemptSummary,
  Edit,
  JudgeJob,
  Problem,
} from "@/lib/types";
const ProblemDescription = dynamic(() => import("./problem-description"), {
  ssr: false,
});
const CodeEditor = dynamic(() => import("./code-editor"), { ssr: false });
type View =
  | "today"
  | "catalog"
  | "history"
  | "connections"
  | "settings"
  | "diagnostics"
  | "memory"
  | "data"
  | "attempt";
const duration = (ms: number) =>
  `${Math.floor(Math.max(0, ms) / 60000)
    .toString()
    .padStart(2, "0")}:${Math.floor((Math.max(0, ms) % 60000) / 1000)
    .toString()
    .padStart(2, "0")}`;
const date = (ms: number) =>
  new Date(ms).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export default function Workspace() {
  const [view, setView] = useState<View>("today");
  const [diagnosticId, setDiagnosticId] = useState<string>();
  const [reviewFlagId, setReviewFlagId] = useState<string>();
  const [state, setState] = useState<any>();
  const storageMode = useRef<"practice" | "test">("practice");
  const [attempt, setAttempt] = useState<Attempt>();
  const [source, setSource] = useState("");
  const [connection, setConnection] = useState<BridgeConnection>(() =>
    initialBridgeState(),
  );
  const connectionRef = useRef<BridgeConnection>(connection);
  connectionRef.current = connection;
  const awaitingLeetCodeLogin = useRef(false);
  const loginPopupRef = useRef<PopupHandle | null>(null);
  const stopLoginWatchRef = useRef<(() => void) | undefined>(undefined);
  const bridgeProbeInFlight = useRef<Promise<BridgeConnection> | undefined>(
    undefined,
  );
  const lastAutoBridgeCheckAt = useRef(0);
  const [agentStatus, setAgentStatus] = useState<any>();
  const [preferredLanguage, setPreferredLanguage] = useState<LanguageId>("java");
  const [sessionLanguage, setSessionLanguage] = useState<LanguageId>("java");
  const [javaStatus, setJavaStatus] = useState("Warming Java…");
  const [cppStatus, setCppStatus] = useState("Not loaded");
  const [cppDetail, setCppDetail] = useState("C++26 · local clangd LSP");
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [saveStatus, setSaveStatus] = useState("All changes saved");
  const [now, setNow] = useState(Date.now());
  const [selected, setSelected] = useState<Problem>();
  const [minutes, setMinutes] = useState(25);
  const [testSession, setTestSession] = useState(false);
  const [otherTab, setOtherTab] = useState(false);
  const [judgeBusy, setJudgeBusy] = useState(false);
  const recorder = useRef<Recorder | undefined>(undefined);
  const active = useRef<Attempt | undefined>(undefined);
  active.current = attempt;
  const releaseLock = useRef<(() => Promise<void>) | undefined>(undefined);
  const owner = useRef(false);
  const opening = useRef(false);
  const closing = useRef(false);
  const automaticallyFinished = useRef("");
  const pollBusy = useRef(false);
  const pausePending = useRef(0);
  const agentWork = useRef<
    | { token: string; id: string; poll?: ReturnType<typeof setInterval> }
    | undefined
  >(undefined);
  const prescription = useProblemPrescription(
    view === "today" && !!state && !state.recommendation && !state.sandboxMode,
    state?.serverTime,
    !!connection?.isSignedIn,
    !!agentStatus?.signedIn,
    preferredLanguage,
  );
  const updatePreferredLanguage = (next: LanguageId) => {
    setPreferredLanguage(next);
    try {
      localStorage.setItem(PREFERRED_LANGUAGE_KEY, next);
    } catch {}
    if (next === "cpp") void cpp().prepare().catch(() => {});
    else void java().prepare().catch(() => {});
  };
  const reload = useCallback(async () => {
    const data = await api("/api/state");
    storageMode.current = data.sandboxMode ? "test" : "practice";
    setState(data);
    return data;
  }, []);
  const showError = (e: unknown) => setError(errorText(e));
  const refreshAttempt = async (isCurrent = () => true) => {
    if (!active.current) return;
    const id = active.current.id;
    const { attempt: a } = await api("/api/attempts/" + id);
    if (active.current?.id === id && isCurrent()) {
      const current =
        recorder.current?.attempt.id === id
          ? recorder.current.acceptAttempt(a)
          : a;
      active.current = current;
      setAttempt(current);
    }
    return a as Attempt;
  };
  const acquire = async (id: string) => {
    await releaseLock.current?.();
    releaseLock.current = undefined;
    owner.current = false;
    setOtherTab(true);
    if (!navigator.locks) {
      owner.current = true;
      setOtherTab(false);
      return true;
    }
    return new Promise<boolean>((resolve) => {
      const held = navigator.locks.request(
        "duo-attempt-" + id,
        { ifAvailable: true },
        async (lock) => {
          if (!lock) {
            resolve(false);
            return;
          }
          owner.current = true;
          setOtherTab(false);
          resolve(true);
          await new Promise<void>((release) => {
            releaseLock.current = () => {
              owner.current = false;
              release();
              return held.then(() => {});
            };
          });
        },
      );
    });
  };
  const open = useCallback(async (id: string) => {
    if (opening.current) return;
    opening.current = true;
    setBusy("Recovering your session");
    setError("");
    try {
      const { attempt: a, serverTime } = await api("/api/attempts/" + id);
      const owned = await acquire(id);
      const r = new Recorder(a, serverTime, setSaveStatus);
      recorder.current = r;
      if (owned) await r.recover();
      const recovered = r.attempt;
      setAttempt(recovered);
      setSource(recovered.source);
      setView("attempt");
      if (attemptLanguage(recovered) === "cpp") void cpp().prepare().catch(() => {});
      else void java().prepare().catch(() => {});
      localStorage.setItem(
        storageMode.current === "test"
          ? "duo-test-open-attempt"
          : "duo-open-attempt",
        id,
      );
    } catch (e) {
      showError(e);
    } finally {
      opening.current = false;
      setBusy("");
    }
  }, []);
  useEffect(() => {
    void reload()
      .then((data) => {
        const params = new URLSearchParams(window.location.search);
        const attemptParam = params.get("attempt");
        const traceId = params.get("trace");
        const flagId = params.get("flag");
        if (
          attemptParam &&
          data.attempts.some((a: AttemptSummary) => a.id === attemptParam)
        ) {
          void open(attemptParam);
          return;
        }
        if (flagId) {
          setReviewFlagId(flagId);
          setView("diagnostics");
          return;
        }
        if (traceId) {
          setDiagnosticId(traceId);
          setView("diagnostics");
          return;
        }
        const last = localStorage.getItem(
          data.sandboxMode ? "duo-test-open-attempt" : "duo-open-attempt",
        );
        if (last && data.attempts.some((a: AttemptSummary) => a.id === last))
          void open(last);
      })
      .catch(showError);
    void api("/api/agent")
      .then(setAgentStatus)
      .catch(() => setAgentStatus({ signedIn: false }));
    void runBridgeProbe().then((next) => {
      connectionRef.current = next;
      setConnection(next);
    });
    let initialLang: LanguageId = "java";
    try {
      initialLang = normalizeLanguage(localStorage.getItem(PREFERRED_LANGUAGE_KEY));
      setPreferredLanguage(initialLang);
    } catch {}
    const engine = java();
    const cppEngine = cpp();
    const listener = () => setJavaStatus(engine.state);
    const cppListener = () => {
      setCppStatus(cppEngine.state);
      setCppDetail(cppEngine.detail);
    };
    engine.listeners.add(listener);
    cppEngine.listeners.add(cppListener);
    listener();
    cppListener();
    if (initialLang === "cpp") void cppEngine.prepare().catch(() => {});
    else void engine.prepare().catch(() => {});
    const interval = setInterval(
      () => setNow(recorder.current?.now() ?? Date.now()),
      250,
    );
    return () => {
      clearInterval(interval);
      engine.listeners.delete(listener);
      cppEngine.listeners.delete(cppListener);
      stopLoginWatchRef.current?.();
      releaseLock.current?.();
    };
  }, [reload, open]);
  useEffect(() => {
    const interval = setInterval(() => {
      if (
        owner.current &&
        recorder.current &&
        ["active", "paused"].includes(active.current?.phase ?? "")
      )
        void recorder.current.flush().catch(() => {});
    }, 800);
    return () => clearInterval(interval);
  }, []);
  const finish = useCallback(
    async (expired = false, accepted?: JudgeJob) => {
      const a = active.current,
        r = recorder.current;
      if (
        !a ||
        !r ||
        !owner.current ||
        closing.current ||
        !["active", "paused"].includes(a.phase)
      )
        return;
      closing.current = true;
      setBusy(
        expired ? "Time is up · saving your attempt" : "Saving your attempt",
      );
      try {
        r.record({
          type: "finish",
          detail: expired
            ? "time budget reached"
            : accepted
              ? "submission accepted"
              : "finished early",
          ...(accepted ? { jobId: accepted.id } : {}),
        });
        await r.flush();
        const result = await api("/api/attempts/" + a.id, { action: "finish" });
        if (!result.attempt.sealed)
          await api("/api/attempts/" + a.id, { action: "seal" });
        const { attempt: done } = await api("/api/attempts/" + a.id);
        setAttempt(done);
        setSource(done.source);
        r.attempt = done;
        await reload();
        setNotice(
          expired
            ? "Time is up. Your work is saved — let’s take one useful thing from it."
            : accepted
              ? "Accepted — your assessment is saved. Let’s review what you learned."
              : "Attempt saved. Take a look at the moments that mattered.",
        );
      } catch (e) {
        showError(e);
      } finally {
        closing.current = false;
        setBusy("");
      }
    },
    [reload],
  );
  useEffect(() => {
    if (
      attempt?.phase === "active" &&
      clockRemaining(attempt, now) <= 0 &&
      !otherTab
    )
      void finish(true);
  }, [attempt, now, finish, otherTab]);
  useEffect(() => {
    if (
      !attempt ||
      !["active", "paused"].includes(attempt.phase) ||
      !owner.current ||
      otherTab ||
      busy ||
      judgeBusy
    )
      return;
    const accepted = acceptedSubmission(attempt.jobs);
    if (!accepted) return;
    const key = `${attempt.id}:${accepted.id}`;
    if (automaticallyFinished.current === key) return;
    automaticallyFinished.current = key;
    // The normal finish flow flushes all buffered edits before sealing. Never
    // seal on the server as a side effect of receiving a judge result.
    void finish(false, accepted);
  }, [attempt, busy, judgeBusy, otherTab, finish]);
  const changePause = useCallback(
    async (
      action: "pause" | "resume",
      reason: "manual" | "window-blur" | "tab-hidden" = "manual",
    ) => {
      const r = recorder.current;
      if (
        !r ||
        !owner.current ||
        closing.current ||
        (action === "resume" && pausePending.current > 0) ||
        (action === "pause"
          ? r.attempt.phase !== "active" || r.now() >= r.attempt.deadline
          : r.attempt.phase !== "paused")
      )
        return;
      pausePending.current++;
      setBusy(action === "pause" ? "Pausing" : "Resuming");
      try {
        if (action === "resume") {
          await r.flush();
          if (attemptLanguage(r.attempt) === "cpp") {
            await cpp().prepare().catch(() => {});
          } else {
            await java().prepare();
          }
          // Warming the language engine must never resume an assessment in a background window.
          if (document.hidden || !document.hasFocus()) return;
        }
        r.record({
          type: action,
          origin: reason,
          detail: action === "pause" ? reason : "explicit user resume",
        });
        active.current = r.attempt;
        setAttempt(r.attempt);
        await r.flush();
        if (recorder.current === r) {
          active.current = r.attempt;
          setAttempt(r.attempt);
        }
      } catch (e) {
        showError(e);
      } finally {
        pausePending.current--;
        if (!pausePending.current) setBusy("");
      }
    },
    [],
  );
  useEffect(() => {
    const record = (detail: string, away?: "window-blur" | "tab-hidden") => {
      const r = recorder.current;
      if (
        !owner.current ||
        !r ||
        closing.current ||
        !["active", "paused"].includes(r.attempt.phase)
      )
        return;
      // changePause records and freezes locally before its first network wait.
      if (away) void changePause("pause", away);
      if (r.attempt.phase === "paused" || r.now() < r.attempt.deadline)
        r.record({ type: "focus", detail });
    };
    const visibility = () =>
      record(
        document.hidden ? "hidden" : "visible",
        document.hidden ? "tab-hidden" : undefined,
      );
    const blur = () => record("window blurred", "window-blur");
    const focus = () => record("window focused");
    const lastActivity = new Map<string, number>();
    const activity = (event: Event) => {
      const r = recorder.current;
      if (
        !owner.current ||
        !r ||
        r.attempt.phase !== "paused" ||
        closing.current
      )
        return;
      const now = r.now();
      if (now - (lastActivity.get(event.type) ?? 0) < 5000) return;
      lastActivity.set(event.type, now);
      // Store the kind of interaction, never keys, clipboard contents or destinations.
      r.record({
        type: "pause-activity",
        detail:
          event.type === "pointerdown"
            ? "Pointer interaction"
            : event.type === "keydown"
              ? "Keyboard interaction"
              : "Scroll interaction",
      });
    };
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("blur", blur);
    window.addEventListener("focus", focus);
    for (const type of ["pointerdown", "keydown", "wheel"])
      document.addEventListener(type, activity, {
        capture: true,
        passive: true,
      });
    const unload = (e: BeforeUnloadEvent) => {
      if (recorder.current?.attempt.phase === "active") {
        void changePause("pause", "tab-hidden");
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", unload);
    return () => {
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("blur", blur);
      window.removeEventListener("focus", focus);
      for (const type of ["pointerdown", "keydown", "wheel"])
        document.removeEventListener(type, activity, true);
      window.removeEventListener("beforeunload", unload);
    };
  }, [changePause]);
  useEffect(() => {
    if (
      attempt?.phase === "active" &&
      (document.hidden || !document.hasFocus())
    )
      void changePause("pause", document.hidden ? "tab-hidden" : "window-blur");
  }, [attempt?.id, attempt?.phase, changePause]);
  useEffect(() => {
    const timer = setInterval(async () => {
      const a = active.current;
      if (!a || pollBusy.current) return;
      const jobs = a.jobs.filter((j) =>
        ["sending", "judging", "unknown"].includes(j.state),
      );
      if (!jobs.length) return;
      pollBusy.current = true;
      try {
        for (const local of jobs) {
          try {
            const remote: any = await bridge("job", { id: local.id });
            let merged = mergeJob(local, remote);
            if (merged.state === "complete" && merged.kind === "submit") {
              try {
                const verification: any = await bridge("verify", {
                  id: local.id,
                });
                merged.sourceVerification =
                  verification.sourceVerification ?? verification;
              } catch {
                /* Result remains visible when readback is unavailable. */
              }
            }
            await api("/api/attempts/" + a.id, { action: "job", job: merged });
          } catch {
            /* Unknown requests are never re-submitted automatically. */
          }
        }
        if (active.current?.id === a.id) await refreshAttempt();
      } finally {
        pollBusy.current = false;
      }
    }, 2500);
    return () => clearInterval(timer);
  }, []);
  const navigate = (next: View) => {
    if (next !== "attempt") void changePause("pause");
    setView(next);
    setError("");
    setNotice("");
    if (next !== "attempt")
      localStorage.removeItem(
        storageMode.current === "test"
          ? "duo-test-open-attempt"
          : "duo-open-attempt",
      );
    void reload().catch(showError);
    if (
      !["active", "paused"].includes(active.current?.phase ?? "") &&
      Date.now() - connectionRef.current.checkedAt > 3000
    ) {
      void checkBridge();
    }
  };
  const closeLoginPopup = useCallback(() => {
    stopLoginWatchRef.current?.();
    stopLoginWatchRef.current = undefined;
    awaitingLeetCodeLogin.current = false;
    void bridge("closeAuthWindow").catch(() => {});
    const popup = loginPopupRef.current;
    loginPopupRef.current = null;
    if (popup) {
      try {
        popup.close();
      } catch {
        /* Cross-origin opener policy may block close after third-party OAuth redirects. */
      }
    }
  }, []);
  const runBridgeProbe = useCallback(() => {
    if (!bridgeProbeInFlight.current) {
      bridgeProbeInFlight.current = probeLeetCodeBridge().finally(() => {
        bridgeProbeInFlight.current = undefined;
      });
    }
    return bridgeProbeInFlight.current;
  }, []);
  const checkBridge = useCallback(
    async (options: { manual?: boolean } = {}) => {
      if (options.manual) {
        setBusy("Checking LeetCode bridge");
        setError("");
        setNotice("");
      }
      try {
        const prev = connectionRef.current;
        const hadPendingLogin = awaitingLeetCodeLogin.current;
        const hadPopup = Boolean(loginPopupRef.current);
        const next = await runBridgeProbe();
        connectionRef.current = next;
        setConnection(next);
        if (next.kind === "ready") {
          closeLoginPopup();
          if (hadPopup) window.focus();
          if (
            options.manual ||
            hadPendingLogin ||
            (prev.kind !== "checking" && !prev.isSignedIn) ||
            (prev.isSignedIn && prev.username !== next.username)
          ) {
            setError("");
            setNotice(
              `Connected to LeetCode as ${next.username}${next.isPremium ? " (Premium)" : ""}.`,
            );
          }
          return next;
        }
        if (prev.isSignedIn && !next.isSignedIn) {
          setNotice((curr) =>
            curr.startsWith("Connected to LeetCode") ? "" : curr,
          );
        }
        if (options.manual) {
          setError(`${next.label}. ${next.detail}`);
        }
        return next;
      } finally {
        if (options.manual) setBusy("");
      }
    },
    [closeLoginPopup, runBridgeProbe],
  );
  useEffect(() => {
    const onReturn = () => {
      if (
        document.hidden ||
        ["active", "paused"].includes(active.current?.phase ?? "")
      )
        return;
      const cooldown =
        awaitingLeetCodeLogin.current || !connectionRef.current.isSignedIn
          ? 1500
          : 3000;
      const t = Date.now();
      if (t - lastAutoBridgeCheckAt.current < cooldown) return;
      lastAutoBridgeCheckAt.current = t;
      void checkBridge();
    };
    const idleSync = setInterval(() => {
      if (
        document.hidden ||
        ["active", "paused"].includes(active.current?.phase ?? "") ||
        !["today", "catalog", "connections"].includes(view)
      )
        return;
      lastAutoBridgeCheckAt.current = Date.now();
      void checkBridge();
    }, 20_000);
    window.addEventListener("focus", onReturn);
    document.addEventListener("visibilitychange", onReturn);
    return () => {
      clearInterval(idleSync);
      window.removeEventListener("focus", onReturn);
      document.removeEventListener("visibilitychange", onReturn);
    };
  }, [checkBridge, view]);
  const connect = async () => {
    if (
      (connection.kind === "signed-out" ||
        connection.kind === "verification-required") &&
      connection.externalUrl
    ) {
      stopLoginWatchRef.current?.();
      const bounds = popupWindowBounds(window);
      const mode =
        connection.kind === "verification-required" ? "verify" : "login";
      try {
        await bridge("openAuthWindow", { mode, ...bounds });
        loginPopupRef.current = null;
        awaitingLeetCodeLogin.current = true;
        setError("");
        setNotice(
          connection.kind === "signed-out"
            ? "Sign in to LeetCode in the popup window — it will close and connect automatically once you're in."
            : "Complete verification in the LeetCode popup — it will close and connect automatically once cleared.",
        );
        stopLoginWatchRef.current = watchLeetCodeLogin({
          popup: null,
          check: () => checkBridge(),
          shouldStop: () =>
            ["active", "paused"].includes(active.current?.phase ?? ""),
        });
        return;
      } catch {
        // Fallback if the unpacked browser extension hasn't been reloaded to v0.1.6 yet.
        const popup = window.open(
          connection.externalUrl,
          "duoleetcode-leetcode-signin",
          popupWindowFeatures(window),
        );
        if (!popup) {
          setError(
            "Your browser blocked the sign-in popup. Reload DuoLeetCode Local Bridge in chrome://extensions or allow popups for http://127.0.0.1:4318.",
          );
          return;
        }
        popup.focus?.();
        loginPopupRef.current = popup;
        awaitingLeetCodeLogin.current = true;
        setError("");
        setNotice(
          "Sign in to LeetCode in the popup window — reload DuoLeetCode Local Bridge once in chrome://extensions so sign-in popups can close themselves automatically.",
        );
        stopLoginWatchRef.current = watchLeetCodeLogin({
          popup,
          check: () => checkBridge(),
          shouldStop: () =>
            ["active", "paused"].includes(active.current?.phase ?? ""),
        });
        return;
      }
    }
    void checkBridge({ manual: true });
  };
  const choose = async (slug: string) => {
    setBusy("Preparing your problem");
    setError("");
    try {
      if (slug !== demoProblem.titleSlug) {
        const latest = await runBridgeProbe();
        connectionRef.current = latest;
        setConnection(latest);
        if (!latest.isSignedIn) {
          throw new Error(`${latest.label}. ${latest.detail}`);
        }
      }
      const p: Problem =
        slug === demoProblem.titleSlug
          ? demoProblem
          : await bridge("problem", { slug });
      if (p.locked)
        throw new Error("This problem is locked for the connected account.");
      const langs = availableLanguages(p);
      if (!langs.length)
        throw new Error("This problem has no Java or C++ starter code.");
      const normalized: Problem = { ...p, javaStarter: p.javaStarter ?? "" };
      const chosen = langs.includes(preferredLanguage)
        ? preferredLanguage
        : langs[0];
      setSessionLanguage(chosen);
      if (chosen === "cpp") void cpp().prepare().catch(() => {});
      else void java().prepare().catch(() => {});
      setSelected(normalized);
    } catch (e) {
      showError(e);
    } finally {
      setBusy("");
    }
  };
  const start = async () => {
    if (!selected) return;
    setBusy("Starting assessment");
    try {
      if (sessionLanguage === "cpp") {
        await cpp().prepare().catch(() => {});
      } else {
        await java().prepare();
      }
      const { attempt: a, serverTime } = await api("/api/state", {
        problem: selected,
        budgetMs: minutes * 60000,
        demonstration: selected.questionId === "demo" || testSession,
        language: sessionLanguage,
      });
      await acquire(a.id);
      const r = new Recorder(a, serverTime, setSaveStatus);
      recorder.current = r;
      setAttempt(a);
      setSource(a.source);
      setSelected(undefined);
      setTestSession(false);
      setView("attempt");
      localStorage.setItem(
        storageMode.current === "test"
          ? "duo-test-open-attempt"
          : "duo-open-attempt",
        a.id,
      );
      await reload();
    } catch (e) {
      showError(e);
    } finally {
      setBusy("");
    }
  };
  const edit = (value: string, edits: Edit[], origin: string) => {
    const a = active.current,
      r = recorder.current;
    if (
      !a ||
      !r ||
      a.phase !== "active" ||
      closing.current ||
      otherTab ||
      r.now() >= a.deadline
    )
      return;
    setSource(value);
    r.record({ type: "edit", edits, origin });
  };
  const pause = () =>
    void changePause(
      recorder.current?.attempt.phase === "paused" ? "resume" : "pause",
    );
  const judge = async (kind: "run" | "submit", input: string) => {
    if (!attempt || !recorder.current || judgeBusy) return;
    const lang = attemptLanguage(attempt);
    if (lang === "cpp") {
      let pingVersion: string | undefined;
      try {
        const meta = await bridge("ping");
        pingVersion =
          typeof meta?.version === "string" ? meta.version : undefined;
      } catch (e) {
        showError(e);
        return;
      }
      if (!isBridgeVersionAtLeast(pingVersion, CPP_MIN_BRIDGE_VERSION)) {
        setError(
          `C++26 requires DuoLeetCode Local Bridge v${CPP_MIN_BRIDGE_VERSION}+ (loaded: ${pingVersion ? `v${pingVersion}` : "unknown"}). In chrome://extensions, remove the older DuoLeetCode Local Bridge and click "Load unpacked" on spikes/leetcode/extension from this branch, then retry.`,
        );
        return;
      }
    }
    setJudgeBusy(true);
    setError("");
    let local: JudgeJob | undefined;
    try {
      const id = crypto.randomUUID();
      const e = recorder.current.record({ type: kind, jobId: id });
      await recorder.current.flush();
      local = {
        id,
        kind,
        state: "sending",
        source,
        input: kind === "run" ? input : undefined,
        seq: e.seq,
        createdAt: Date.now(),
      };
      await api("/api/attempts/" + attempt.id, { action: "job", job: local });
      await refreshAttempt();
      const remote = await bridge("start", {
        kind,
        slug: attempt.problem.titleSlug,
        code: source,
        input: kind === "run" ? input : undefined,
        idempotencyKey: id,
        lang: languageConfig(lang).leetcodeSlug,
      });
      await api("/api/attempts/" + attempt.id, {
        action: "job",
        job: mergeJob(local, remote),
      });
      await refreshAttempt();
    } catch (e) {
      showError(e);
      if (local) {
        try {
          await api("/api/attempts/" + attempt.id, {
            action: "job",
            job: { ...local, state: "unknown", error: errorText(e) },
          });
          await refreshAttempt();
        } catch {
          /* Recovery remains available through the original UUID. */
        }
      }
    } finally {
      setJudgeBusy(false);
    }
  };
  useAgentSymbols(
    attempt?.id,
    Boolean(
      busy && attempt?.sealed && attemptLanguage(attempt) === "java",
    ),
  );
  const runAgent = async (
    action: "evaluate" | "coach" | "reflect" | "prepare",
    message?: CoachRequest,
  ) => {
    if (!attempt) return false;
    const token = crypto.randomUUID();
    agentWork.current = { token, id: attempt.id };
    const isCurrent = () => agentWork.current?.token === token;
    setBusy(
      action !== "coach"
        ? "Reviewing the evidence"
        : "Talking through your reasoning",
    );
    setError("");
    const poll =
      action !== "evaluate"
        ? setInterval(() => {
            void refreshAttempt(isCurrent).catch(() => {});
          }, 1500)
        : undefined;
    agentWork.current.poll = poll;
    try {
      if (recorder.current) await recorder.current.flush();
      if (!attempt.sealed)
        await api("/api/attempts/" + attempt.id, { action: "seal" });
      await api("/api/agent", { action, id: attempt.id, message });
      if (isCurrent()) {
        await refreshAttempt(isCurrent);
        await reload();
      }
      return true;
    } catch (e) {
      if (isCurrent()) {
        showError(e);
        await refreshAttempt(isCurrent).catch(() => {});
      }
      return false;
    } finally {
      clearInterval(poll);
      if (isCurrent()) {
        agentWork.current = undefined;
        setBusy("");
      }
    }
  };
  const mutation = async (body: unknown) => {
    if (!attempt) return;
    const { attempt: a } = await api("/api/attempts/" + attempt.id, body);
    const work = agentWork.current;
    if (a.phase === "complete" && work && work.id === a.id) {
      clearInterval(work.poll);
      agentWork.current = undefined;
      setBusy("");
    }
    setAttempt(a);
    await reload();
  };
  const completed =
    state?.attempts.filter(
      (a: AttemptSummary) => a.endedAt !== undefined && !a.demonstration,
    ) ?? [];
  const live = attempt && ["active", "paused"].includes(attempt.phase);
  const topbarLanguage =
    attempt && view === "attempt"
      ? attemptLanguage(attempt)
      : preferredLanguage;
  const topbarEngineStatus =
    topbarLanguage === "cpp" ? cppStatus : javaStatus;
  const topbarEngineReady =
    topbarLanguage === "cpp"
      ? cppStatus === "C++26 ready"
      : javaStatus === "Java ready";
  return (
    <div
      className={
        "app-shell" + (view === "attempt" && attempt ? " assessment-shell" : "")
      }
    >
      <aside className="sidebar">
        <Button
          className="brand"
          onClick={() => navigate("today")}
          aria-label="DuoLeetCode home"
        >
          <span className="brand-mark">
            <Code2 size={24} />
          </span>
          <span>
            duoleet<span className="brand-light">code</span>
            <small>SMALL STEPS. SHARPER THINKING.</small>
          </span>
        </Button>
        <div className="workspace-label">
          YOUR WORKSPACE <span>LOCAL</span>
        </div>
        <nav>
          {(
            [
              { id: "today", label: "Today", icon: Compass },
              { id: "catalog", label: "Problem library", icon: BookOpen },
              { id: "history", label: "Your progress", icon: TrendingUp },
              { id: "memory", label: "Coach memory", icon: MessageCircle },
              { id: "data", label: "Snapshots & data", icon: History },
              { id: "connections", label: "Connections", icon: Link2 },
              { id: "diagnostics", label: "Agent diagnostics", icon: Code2 },
              {
                id: "settings",
                label: "Agent settings",
                icon: SlidersHorizontal,
              },
            ] as const
          ).map(({ id, label, icon: Icon }) => (
            <NavLink
              component="button"
              key={id}
              active={view === id}
              label={label}
              aria-label={label}
              leftSection={<Icon size={19} />}
              rightSection={
                id === "today" ? <span className="nav-dot" /> : undefined
              }
              onClick={() => navigate(id)}
            />
          ))}
        </nav>
        {attempt && (
          <Button
            className="session-nav"
            onClick={() => {
              setView("attempt");
              localStorage.setItem(
                storageMode.current === "test"
                  ? "duo-test-open-attempt"
                  : "duo-open-attempt",
                attempt.id,
              );
            }}
          >
            <span className="eyebrow">
              {live ? "SESSION IN PROGRESS" : "YOUR LATEST SESSION"}
            </span>
            <strong>{attempt.problem.title}</strong>
            <span>
              {live ? (
                <>
                  <span className="pulse" />
                  {attempt.phase === "paused"
                    ? "Paused"
                    : duration(clockRemaining(attempt, now)) + " remaining"}
                </>
              ) : (
                <>
                  <History size={14} />
                  Open review
                </>
              )}
            </span>
            <ArrowUpRight size={17} />
          </Button>
        )}
        <div className="sidebar-bottom">
          <div className="loop-mini">
            <span>Practice</span>
            <ArrowRight size={12} />
            <span>Learn</span>
            <ArrowRight size={12} />
            <span>Iterate</span>
          </div>
          <p>
            Progress is a practice.
            <br />
            You can start small.
          </p>
          <div className="profile">
            <span className="avatar">L</span>
            <div>
              <strong>Your learning space</strong>
              <small>
                <span className="status-dot" /> Saved on this device
              </small>
            </div>
          </div>
        </div>
      </aside>
      <main
        className={view === "attempt" ? "app-main main-session" : "app-main"}
      >
        <header className="topbar">
          <div className="breadcrumb">
            Workspace <ChevronRight size={14} />
            <strong>
              {view === "diagnostics"
                ? "Agent diagnostics"
                : view === "today"
                  ? "Today"
                  : view === "catalog"
                    ? "Problem library"
                    : view === "history"
                      ? "Your progress"
                      : view === "connections"
                        ? "Connections"
                        : view === "memory"
                          ? "Coach memory"
                          : view === "data"
                            ? "Snapshots & data"
                            : view === "settings"
                              ? "Agent settings"
                              : attempt?.phase === "active"
                                ? "Assessment"
                                : "Your session"}
            </strong>
          </div>
          <div className="top-status">
            <span
              className={
                topbarEngineReady ? "status-dot" : "status-dot amber"
              }
            />
            {topbarEngineStatus}
            <span className="separator" />
            <span className="local-tag">
              {state?.sandboxMode ? "TEST MODE" : "LOCAL PRACTICE"}
            </span>
          </div>
        </header>
        {state?.sandboxMode && (
          <div className="banner">
            Test mode · Your real practice library is not connected.
          </div>
        )}
        {otherTab && attempt && (
          <div className="banner">
            <span>
              This attempt is open in another tab. Close that tab to edit here.
            </span>
            <Button onClick={() => open(attempt.id)}>
              Check editing access
            </Button>
          </div>
        )}
        {view === "attempt" &&
          live &&
          attempt &&
          attemptLanguage(attempt) === "cpp" &&
          connection.bridgeReachable &&
          !isBridgeVersionAtLeast(
            connection.version,
            CPP_MIN_BRIDGE_VERSION,
          ) && (
            <div role="alert" className="banner error">
              <span>
                C++26 requires DuoLeetCode Local Bridge v
                {CPP_MIN_BRIDGE_VERSION}+ (loaded:{" "}
                {connection.version ? `v${connection.version}` : "unknown"}).
                In chrome://extensions, remove the older extension and Load
                unpacked from spikes/leetcode/extension on this branch.
              </span>
              <Button
                className="button secondary compact"
                onClick={() => void checkBridge({ manual: true })}
              >
                Re-check bridge
              </Button>
            </div>
          )}
        {error && (
          <div role="alert" className="banner error">
            <span>{error}</span>
            <Button aria-label="Dismiss error" onClick={() => setError("")}>
              <X size={16} />
            </Button>
          </div>
        )}
        {notice && (
          <div role="status" className="banner">
            <CheckCircle2 size={17} />
            <span>{notice}</span>
            <Button
              aria-label="Dismiss notification"
              onClick={() => setNotice("")}
            >
              <X size={16} />
            </Button>
          </div>
        )}
        {busy && (
          <div className="working" role="status">
            <LoaderCircle className="spin" size={15} />
            {busy}…
          </div>
        )}
        {view === "today" && (
          <div className="page-content">
            <div className="page-heading">
              <div>
                <div className="eyebrow">
                  <span className="tiny-line" /> BUILD A LITTLE MOMENTUM
                </div>
                <h1>
                  One session.
                  <br />
                  <span>One step forward.</span>
                </h1>
                <p>
                  A focused challenge, a useful insight, and a clear next step.
                </p>
              </div>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "flex-end",
                  gap: 10,
                }}
              >
                <div className="date-chip">
                  <span>
                    {new Date(now).toLocaleDateString(undefined, {
                      weekday: "long",
                    })}
                  </span>
                  <strong>
                    {new Date(now).toLocaleDateString(undefined, {
                      month: "long",
                      day: "numeric",
                    })}
                  </strong>
                </div>
                <SegmentedControl
                  aria-label="Practice language"
                  size="xs"
                  value={preferredLanguage}
                  onChange={(value) =>
                    updatePreferredLanguage(value as LanguageId)
                  }
                  data={[
                    { value: "java", label: "Java 25" },
                    { value: "cpp", label: "C++26" },
                  ]}
                />
              </div>
            </div>
            <div className="home-grid">
              <ProblemPrescription
                controller={prescription}
                language={preferredLanguage}
                continuation={state?.recommendation}
                ready={
                  !!connection?.isSignedIn &&
                  !!agentStatus?.signedIn &&
                  !state?.sandboxMode
                }
                bridgeConnection={connection}
                agentSignedIn={!!agentStatus?.signedIn}
                disabled={!!busy}
                onOpen={open}
                onChoose={(slug, budget) => {
                  setMinutes(budget);
                  void choose(slug);
                }}
                onBrowse={() => navigate("catalog")}
                onConnect={() => navigate("connections")}
                onBridgeAction={connect}
              />
              <Panel className="panel intention-card">
                <span className="eyebrow">THE IDEA</span>
                <h3>
                  Finish with an insight.
                  <br />
                  Not another hour.
                </h3>
                <p>
                  Work within a timebox. See how your solution evolved. Take one
                  small skill into the next session.
                </p>
                <div className="intention-bottom">
                  <span className="round-icon">
                    <Zap size={20} />
                  </span>
                  <span>
                    Consistency grows from
                    <br />
                    <strong>sessions you want to return to.</strong>
                  </span>
                </div>
              </Panel>
            </div>
            <div className="section-heading">
              <h2>Your practice, with a feedback loop.</h2>
              <span>THREE SMALL STEPS</span>
            </div>
            <div className="steps-grid">
              {[
                {
                  n: "01",
                  icon: Timer,
                  title: "Give it a focused try",
                  body: "An independent, timed attempt. Completion and normal test feedback stay available.",
                },
                {
                  n: "02",
                  icon: History,
                  title: "See the moments that matter",
                  body: "Replay your code, inspect the evidence, and add context where the story is unclear.",
                },
                {
                  n: "03",
                  icon: Target,
                  title: "Make the next step smaller",
                  body: "A short follow-up turns a gap into something concrete to practice.",
                },
              ].map((s) => (
                <Panel className="step-card" key={s.n}>
                  <div>
                    <s.icon size={21} />
                    <span>{s.n}</span>
                  </div>
                  <h3>{s.title}</h3>
                  <p>{s.body}</p>
                </Panel>
              ))}
            </div>
            <div className="bottom-grid">
              <Panel className="panel progress-preview">
                <div className="section-heading">
                  <h3>A little more evidence, every time</h3>
                  <Button
                    className="text-button"
                    onClick={() => navigate("history")}
                  >
                    View progress <ArrowUpRight size={14} />
                  </Button>
                </div>
                <div className="mini-stats">
                  <div>
                    <strong>
                      {completed.length.toString().padStart(2, "0")}
                    </strong>
                    <span>assessments finished</span>
                  </div>
                  <div>
                    <strong>
                      {(
                        state?.followups.filter((s: any) => s.hasResponse)
                          .length ?? 0
                      )
                        .toString()
                        .padStart(2, "0")}
                    </strong>
                    <span>focused skills revisited</span>
                  </div>
                </div>
                <p>
                  {completed.length
                    ? "Your history separates successful submissions, independent practice, and supported recall."
                    : "Your story starts with one session. We’ll show real evidence here as you practice."}
                </p>
              </Panel>
              <Panel className="panel setup-preview">
                <span className="eyebrow">READY WHEN YOU ARE</span>
                <ConnectionLine
                  ok={connection.isSignedIn}
                  tone={
                    connection.isSignedIn
                      ? "ok"
                      : connection.bridgeReachable
                        ? "warn"
                        : "pending"
                  }
                  label={connection.label}
                  detail={connection.detail}
                />
                {!connection.isSignedIn && connection.externalUrl && (
                  <Button
                    className="text-button"
                    disabled={!!busy}
                    onClick={connect}
                  >
                    {connection.actionLabel} <ArrowUpRight size={14} />
                  </Button>
                )}
                <ConnectionLine
                  ok={!!agentStatus?.signedIn}
                  label="Your AI coach"
                  detail={
                    agentStatus?.signedIn
                      ? `Connected (${agentStatus.provider || "Local AI"})`
                      : "Connect Codex, Claude, or Antigravity"
                  }
                />
                <Button
                  className="text-button"
                  onClick={() => navigate("connections")}
                >
                  Manage connections <ArrowRight size={14} />
                </Button>
              </Panel>
            </div>
          </div>
        )}
        {view === "catalog" && (
          <Catalog
            language={preferredLanguage}
            onLanguageChange={updatePreferredLanguage}
            onChoose={choose}
            disabled={!!busy}
            connection={connection}
            onBridgeAction={connect}
            onRecheck={() => void checkBridge({ manual: true })}
          />
        )}
        {view === "history" && <Progress state={state} onOpen={open} />}
        {view === "settings" && <AgentSettings />}
        {view === "diagnostics" && (
          <AgentDiagnostics
            initialId={diagnosticId}
            onSelect={setDiagnosticId}
            initialFlag={reviewFlagId}
          />
        )}
        {view === "memory" && <CoachMemory onOpen={open} />}
        {view === "data" && (
          <DataManagement
            beforeSnapshot={async () => {
              await recorder.current?.flush();
            }}
          />
        )}
        {view === "connections" && (
          <div className="page-content">
            <div className="page-heading compact">
              <div>
                <span className="eyebrow">ON THIS DEVICE</span>
                <h1>Your connections</h1>
                <p>A local workspace, with your existing accounts.</p>
              </div>
            </div>
            <div className="connections-grid">
              <Panel className="panel connection-card">
                <span className="large-icon">
                  <Link2 />
                </span>
                <h2>LeetCode</h2>
                <p>
                  Problem descriptions, Java and C++ starter code, example
                  tests, Run and Submit — through your regular browser.
                </p>
                <ConnectionLine
                  ok={connection.isSignedIn}
                  tone={
                    connection.isSignedIn
                      ? "ok"
                      : connection.bridgeReachable
                        ? "warn"
                        : "pending"
                  }
                  label={connection.label}
                  detail={connection.detail}
                />
                <div className="connection-actions">
                  <Button
                    className="button primary"
                    onClick={connect}
                    disabled={!!busy}
                  >
                    {connection.actionLabel}
                    {connection.externalUrl ? (
                      <ArrowUpRight size={16} />
                    ) : (
                      <ArrowRight size={16} />
                    )}
                  </Button>
                  {connection.externalUrl && (
                    <Button
                      className="button secondary"
                      onClick={() => void checkBridge({ manual: true })}
                      disabled={!!busy}
                    >
                      Check status <RotateCcw size={15} />
                    </Button>
                  )}
                </div>
                <details
                  open={
                    connection.kind === "extension-missing" ||
                    connection.kind === "permissions-missing" ||
                    connection.kind === "unsupported-browser" ||
                    connection.kind === "untrusted-origin"
                  }
                >
                  <summary>Extension setup</summary>
                  <p>
                    Load the existing “DuoLeetCode Local Bridge” unpacked
                    extension from the project’s spikes/leetcode/extension
                    folder, then open http://127.0.0.1:4318/ in a normal
                    (non-incognito) tab of that browser. Once signed in to
                    LeetCode, no open LeetCode tab is needed.
                  </p>
                </details>
              </Panel>
              <Panel className="panel connection-card">
                <span className="large-icon">
                  <Sparkles />
                </span>
                <h2>AI learning team</h2>
                <p>
                  Codex, Claude (Claude Agent SDK · ACP), and Antigravity
                  (Gemini · ACP). Choose models per feature in Agent settings.
                </p>
                {Array.isArray(agentStatus?.providers) &&
                agentStatus.providers.length > 0 ? (
                  agentStatus.providers.map((p: any) => (
                    <ConnectionLine
                      key={p.id}
                      ok={!!p.signedIn}
                      label={`${p.name} · ${p.signedIn ? "Connected" : "Sign-in needed"}`}
                      detail={p.detail}
                    />
                  ))
                ) : (
                  <ConnectionLine
                    ok={!!agentStatus?.signedIn}
                    label={
                      agentStatus?.signedIn
                        ? "AI runtime connected"
                        : "AI sign-in needed"
                    }
                    detail={
                      agentStatus?.signedIn
                        ? "Using your connected local runtime."
                        : "Your assessment and recording work without AI."
                    }
                  />
                )}
                <div className="connection-actions">
                  <Button
                    className="button secondary"
                    disabled={!!busy}
                    onClick={async () => {
                      setBusy("Checking AI runtimes");
                      try {
                        const s = await api("/api/agent");
                        setAgentStatus(s);
                        if (!s.codexSignedIn && !s.signedIn) {
                          const login = await api("/api/agent", {
                            action: "login",
                          });
                          window.open(
                            login.authUrl,
                            "_blank",
                            "noopener,noreferrer",
                          );
                          setNotice(
                            "Complete sign-in, then click Check connection.",
                          );
                        }
                      } catch (e) {
                        showError(e);
                      } finally {
                        setBusy("");
                      }
                    }}
                  >
                    {agentStatus?.signedIn
                      ? "Refresh runtimes"
                      : "Sign in with ChatGPT"}
                    <ArrowUpRight size={16} />
                  </Button>
                  <Button
                    className="button secondary"
                    disabled={!!busy}
                    onClick={() => navigate("settings")}
                  >
                    Choose models <ArrowRight size={16} />
                  </Button>
                </div>
              </Panel>
              <Panel className="panel connection-card">
                <span className="large-icon">
                  <Code2 />
                </span>
                <h2>Java in your browser</h2>
                <p>
                  Semantic completion from javacs, running in a browser JVM. No
                  local language-server process required.
                </p>
                <ConnectionLine
                  ok={javaStatus === "Java ready"}
                  label={javaStatus}
                  detail="Java 25 preview API profile · runtime downloaded on demand"
                />
                <Button
                  className="button secondary"
                  onClick={() => {
                    void java().prepare().catch(showError);
                  }}
                >
                  Warm up Java <RotateCcw size={15} />
                </Button>
                <p className="small">
                  The runtime currently needs an internet connection. Run and
                  Submit use LeetCode’s judge.
                </p>
              </Panel>
              <Panel className="panel connection-card">
                <span className="large-icon">
                  <Code2 />
                </span>
                <h2>C++26 local toolchain</h2>
                <p>
                  Semantic completion, hover signatures, and diagnostics from
                  your local clangd process using -std=c++26.
                </p>
                <ConnectionLine
                  ok={cppStatus === "C++26 ready"}
                  tone={
                    cppStatus === "C++26 ready"
                      ? "ok"
                      : cppStatus === "C++26 unavailable"
                        ? "warn"
                        : "pending"
                  }
                  label={cppStatus}
                  detail={cppDetail}
                />
                <Button
                  className="button secondary"
                  onClick={() => {
                    void cpp().prepare().catch(showError);
                  }}
                >
                  Warm up C++26 <RotateCcw size={15} />
                </Button>
                <p className="small">
                  Requires clangd on this machine (or DUO_CLANGD_BIN). Run and
                  Submit use LeetCode’s judge.
                </p>
              </Panel>
              <Panel className="panel connection-card">
                <span className="large-icon">
                  <FlaskConical />
                </span>
                <h2>Try the whole flow</h2>
                <p>
                  An original local exercise lets you explore the timer,
                  recording, timeline, and coaching without submitting to
                  LeetCode.
                </p>
                <p className="small">
                  Marked as a demonstration and excluded from your progress.
                  Remote judging is unavailable for this exercise.
                </p>
                <Button
                  className="button secondary"
                  disabled={!!busy}
                  onClick={() => choose(demoProblem.titleSlug)}
                >
                  Open a demo assessment <ArrowRight size={16} />
                </Button>
              </Panel>
            </div>
          </div>
        )}
        {view === "attempt" &&
          attempt &&
          (live ? (
            <Assessment
              attempt={attempt}
              source={source}
              onEdit={edit}
              remaining={clockRemaining(attempt, now)}
              busy={!!busy || otherTab}
              judgeBusy={judgeBusy}
              onPause={pause}
              onFinish={() => finish(false)}
              onHome={() => navigate("today")}
              onJudge={judge}
              saveStatus={
                otherTab ? "This attempt is open in another tab" : saveStatus
              }
              onAssistance={async (detail) => {
                recorder.current?.record({ type: "assistance", detail });
                await recorder.current?.flush();
              }}
              onRecordHelp={async (id, stage, detail) => {
                const r = recorder.current;
                if (
                  !r ||
                  !owner.current ||
                  closing.current ||
                  active.current?.phase !== "active" ||
                  r.now() >= r.attempt.deadline
                )
                  throw new Error(
                    "Resume the assessment timer to use Java help.",
                  );
                const event =
                  r.events.find(
                    (e) => e.assistanceId === id && e.assistanceStage === stage,
                  ) ??
                  r.record({
                    type: "assistance",
                    detail,
                    assistanceId: id,
                    assistanceStage: stage,
                  });
                await r.flush();
                return event;
              }}
            />
          ) : (
            <Review
              attempt={attempt}
              busy={!!busy}
              onMutate={mutation}
              onAgent={runAgent}
              onError={showError}
              key={attempt.id}
              onHome={() => navigate("today")}
            />
          ))}
        {view === "attempt" && !attempt && !busy && (
          <div className="empty-state">
            Choose an assessment to get started.
          </div>
        )}
      </main>
      {selected && (
        <Modal
          opened
          onClose={() => setSelected(undefined)}
          title="Make room for one attempt."
          size={540}
          className="duo-prepare-modal"
          closeButtonProps={{ "aria-label": "Close preparation" }}
        >
          <span className="pill mint">
            <Timer size={14} /> BEFORE YOU BEGIN
          </span>
          <p className="modal-intro">
            {selected.title}{" "}
            <span className="difficulty">{selected.difficulty}</span>
          </p>
          <label className="field-label" htmlFor="session-language">
            Language
          </label>
          <SegmentedControl
            id="session-language"
            aria-label="Session language"
            value={sessionLanguage}
            onChange={(value) => {
              const lang = value as LanguageId;
              setSessionLanguage(lang);
              updatePreferredLanguage(lang);
            }}
            data={[
              {
                value: "java",
                label: "Java 25",
                disabled: !starterForLanguage(selected, "java"),
              },
              {
                value: "cpp",
                label: "C++26",
                disabled: !starterForLanguage(selected, "cpp"),
              },
            ]}
          />
          <label className="field-label" htmlFor="time-budget">
            Your timebox
          </label>
          <div className="duo-timebox">
            <SegmentedControl
              aria-label="Suggested timeboxes"
              value={String(minutes)}
              onChange={(value) => setMinutes(Number(value))}
              data={[15, 25, 40].map((n) => ({
                value: String(n),
                label: `${n} min`,
              }))}
            />
            <NumberInput
              id="time-budget"
              aria-label="Time budget in minutes"
              min={1}
              max={90}
              value={minutes}
              onChange={(value) => setMinutes(Number(value))}
              suffix=" min"
              allowDecimal={false}
            />
          </div>
          {selected.questionId !== "demo" && (
            <Checkbox
              checked={testSession}
              onChange={(e) => setTestSession(e.currentTarget.checked)}
              label="Test the app — exclude this session from my progress"
            />
          )}
          {testSession && (
            <p className="small">
              Run and Submit still use your real LeetCode account.
            </p>
          )}
          <div className="preflight">
            <p>
              <Check size={16} /> Problem and{" "}
              {languageConfig(sessionLanguage).shortLabel} starter code prepared
            </p>
            <p>
              {(
                sessionLanguage === "cpp"
                  ? cppStatus === "C++26 ready"
                  : javaStatus === "Java ready"
              ) ? (
                <Check size={16} />
              ) : (
                <LoaderCircle className="spin" size={16} />
              )}{" "}
              {sessionLanguage === "cpp" ? cppStatus : javaStatus}
            </p>
            <p>
              <ShieldCheck size={16} /> Your independent attempt stays separate
              from coaching
            </p>
          </div>
          {sessionLanguage === "cpp" && cppStatus === "C++26 unavailable" && (
            <p className="small">
              Local clangd checks are unavailable; syntax highlighting and
              LeetCode judging still work.
            </p>
          )}
          <p className="small">
            The problem opens when the timer starts. Switching tabs keeps the
            timer running. Leaving this window pauses the assessment; resume
            explicitly when you return.
          </p>
          <Button
            className="button primary full"
            disabled={
              !!busy ||
              (sessionLanguage === "java"
                ? javaStatus !== "Java ready"
                : cppStatus === "Warming C++26…") ||
              minutes < 1 ||
              minutes > 90
            }
            onClick={start}
          >
            Start {minutes}-minute assessment <ArrowRight size={17} />
          </Button>
        </Modal>
      )}
    </div>
  );
}

function ConnectionLine({
  ok,
  tone,
  label,
  detail,
}: {
  ok: boolean;
  tone?: "ok" | "warn" | "pending";
  label: string;
  detail: string;
}) {
  const resolvedTone = tone ?? (ok ? "ok" : "pending");
  return (
    <div className="connection-line">
      <span
        className={
          resolvedTone === "ok"
            ? "connection-check"
            : resolvedTone === "warn"
              ? "connection-check warn"
              : "connection-check pending"
        }
      >
        {resolvedTone === "ok" ? <Check size={14} /> : <span />}
      </span>
      <div>
        <strong>{label}</strong>
        <small>{detail}</small>
      </div>
    </div>
  );
}

function Catalog({
  language,
  onLanguageChange,
  onChoose,
  disabled,
  connection,
  onBridgeAction,
  onRecheck,
}: {
  language: LanguageId;
  onLanguageChange: (language: LanguageId) => void;
  onChoose: (slug: string) => void;
  disabled: boolean;
  connection: BridgeConnection;
  onBridgeAction: () => void;
  onRecheck: () => void;
}) {
  const [search, setSearch] = useState("");
  const [difficulty, setDifficulty] = useState("");
  const [skip, setSkip] = useState(0);
  const [data, setData] = useState<any>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!connection.bridgeReachable && connection.kind !== "checking") {
      setLoading(false);
      return;
    }
    let live = true;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const d = await bridge("list", { search, difficulty, skip, limit: 20 });
        if (live) {
          setData(d);
          setError("");
        }
      } catch (e) {
        if (live) setError(errorText(e));
      } finally {
        if (live) setLoading(false);
      }
    }, 300);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [search, difficulty, skip, connection.bridgeReachable, connection.kind, connection.isSignedIn]);
  return (
    <div className="page-content">
      <div className="page-heading compact">
        <div>
          <span className="eyebrow">PICK A BOUNDED CHALLENGE</span>
          <h1>Problem library</h1>
          <p>
            Your connected LeetCode catalog. Every problem starts with a
            timebox.
          </p>
        </div>
        <SegmentedControl
          aria-label="Catalog language"
          size="xs"
          value={language}
          onChange={(value) => onLanguageChange(value as LanguageId)}
          data={[
            { value: "java", label: "Java 25" },
            { value: "cpp", label: "C++26" },
          ]}
        />
      </div>
      <div className="library-tools">
        <TextInput
          aria-label="Search problems"
          value={search}
          placeholder="Search problems by title…"
          onChange={(e) => {
            setSearch(e.target.value);
            setSkip(0);
          }}
        />
        <Select
          aria-label="Filter difficulty"
          value={difficulty || "all"}
          allowDeselect={false}
          onChange={(value) => {
            setDifficulty(value === "all" ? "" : (value ?? ""));
            setSkip(0);
          }}
          data={[
            { value: "all", label: "All difficulties" },
            { value: "EASY", label: "Easy" },
            { value: "MEDIUM", label: "Medium" },
            { value: "HARD", label: "Hard" },
          ]}
        />
      </div>
      {!connection.isSignedIn && connection.kind !== "checking" && (
        <div className="banner error" style={{ marginInline: 0, marginBottom: 14 }}>
          <span>
            <strong>{connection.label}.</strong> {connection.detail}
          </span>
          <div className="connection-actions" style={{ marginLeft: "auto" }}>
            <Button
              className="button primary"
              disabled={disabled}
              onClick={onBridgeAction}
            >
              {connection.actionLabel}
              {connection.externalUrl ? (
                <ArrowUpRight size={14} />
              ) : (
                <ArrowRight size={14} />
              )}
            </Button>
            {connection.externalUrl && (
              <Button
                className="button secondary"
                disabled={disabled}
                onClick={onRecheck}
              >
                Check status
              </Button>
            )}
            <Button
              className="button secondary"
              disabled={disabled}
              onClick={() => onChoose(demoProblem.titleSlug)}
            >
              Try local exercise
            </Button>
          </div>
        </div>
      )}
      {error && <div className="banner error">{error}</div>}
      <Panel className="panel problem-list">
        <div className="table-header">
          <span>PROBLEM</span>
          <span>DIFFICULTY</span>
          <span>ACCESS</span>
        </div>
        {data?.questions?.map((p: any) => (
          <Button
            className="problem-row"
            key={p.titleSlug}
            disabled={disabled || loading}
            onClick={() => onChoose(p.titleSlug)}
          >
            <span>
              <small>
                {p.questionFrontendId.padStart?.(3, "0") ??
                  p.questionFrontendId}
              </small>
              <strong>{p.title}</strong>
            </span>
            <span className={"difficulty " + p.difficulty.toLowerCase()}>
              {p.difficulty}
            </span>
            <span className="problem-access">
              {p.isPaidOnly ? "Premium" : "Available"}
              <ArrowUpRight size={16} />
            </span>
          </Button>
        ))}
        {loading && (
          <div className="empty-state">
            <LoaderCircle className="spin" size={20} />
            Loading problems…
          </div>
        )}
        {!loading && data?.questions?.length === 0 && (
          <div className="empty-state">
            No problems matched. Try another search.
          </div>
        )}
      </Panel>
      <div className="pagination">
        <span>
          {data
            ? `${skip + 1}–${Math.min(skip + 20, data.totalNum)} of ${data.totalNum} problems`
            : connection.bridgeReachable
              ? connection.label
              : "Connect the browser bridge to browse problems."}
        </span>
        <div>
          <Button
            className="icon-button"
            aria-label="Previous page"
            disabled={skip === 0 || loading}
            onClick={() => setSkip(Math.max(0, skip - 20))}
          >
            <ChevronLeft size={17} />
          </Button>
          <Button
            className="icon-button"
            aria-label="Next page"
            disabled={!data || skip + 20 >= data.totalNum || loading}
            onClick={() => setSkip(skip + 20)}
          >
            <ChevronRight size={17} />
          </Button>
        </div>
      </div>
    </div>
  );
}

function Assessment({
  attempt,
  source,
  onEdit,
  remaining,
  busy,
  judgeBusy,
  onPause,
  onFinish,
  onHome,
  onJudge,
  saveStatus,
  onAssistance,
  onRecordHelp,
}: {
  attempt: Attempt;
  source: string;
  onEdit: (v: string, e: Edit[], o: string) => void;
  remaining: number;
  busy: boolean;
  judgeBusy: boolean;
  onPause: () => void;
  onFinish: () => void;
  onHome: () => void;
  onJudge: (k: "run" | "submit", i: string) => void;
  saveStatus: string;
  onAssistance: (detail: string) => Promise<void>;
  onRecordHelp: RecordHelp;
}) {
  const lang = languageConfig(attempt.language);
  const workbenchId = useId();
  const [input, setInput] = useState(attempt.problem.exampleInputs.raw);
  const [selectedTestCase, setSelectedTestCase] = useState(0);
  const [testCaseNotice, setTestCaseNotice] = useState("");
  const [tab, setTab] = useState<"tests" | "results">("tests");
  const [assistance, setAssistance] = useState("");
  const [showAssistance, setShowAssistance] = useState(false);
  const [referenceOpen, setReferenceOpen] = useState(false);
  const chatEditor = useEditorChat(source, lang.id);
  const [problemHidden, setProblemHidden] = useState(false);
  const [testsHidden, setTestsHidden] = useState(false);
  const [diagnosticStatus, setDiagnosticStatus] = useState(
    `Checking ${lang.shortLabel}…`,
  );
  const [diagnosticErrors, setDiagnosticErrors] = useState(0);
  const [diagnosticDetail, setDiagnosticDetail] = useState("");
  const [diagnosticsRetry, setDiagnosticsRetry] = useState(0);
  const paused = attempt.phase === "paused";
  const parameterCount = testParameters(attempt.problem).length;
  const validInput =
    Boolean(input.trim()) &&
    (!parameterCount || Boolean(splitTestCases(input, parameterCount)));
  const pending = attempt.jobs.some(
    (j) => j.state === "sending" || j.state === "judging",
  );
  return (
    <div className="assessment-content">
      <div
        className="assessment-workbench"
        inert={paused || undefined}
        aria-hidden={paused || undefined}
      >
        <header className="assessment-toolbar">
          <Button
            className="workspace-home"
            onClick={onHome}
            aria-label="Back to Today"
            title={
              paused
                ? "Back to Today · assessment remains paused"
                : "Back to Today · the timer keeps running"
            }
            disabled={busy}
          >
            <Code2 size={20} />
          </Button>
          <div className="workspace-problem-title">
            <h1 title={attempt.problem.title}>{attempt.problem.title}</h1>
            <span className="difficulty">{attempt.problem.difficulty}</span>
            {attempt.demonstration && (
              <span className="workspace-demo">TEST SESSION</span>
            )}
          </div>
          <div className="workspace-panel-actions">
            <Button
              className={"workspace-toggle" + (problemHidden ? "" : " active")}
              onClick={() => setProblemHidden(!problemHidden)}
              aria-label={problemHidden ? "Show problem" : "Hide problem"}
              title={problemHidden ? "Show problem" : "Hide problem"}
              aria-pressed={!problemHidden}
            >
              <BookOpen size={16} />
              <span>Problem</span>
            </Button>
            <Button
              className={"workspace-toggle" + (testsHidden ? "" : " active")}
              onClick={() => setTestsHidden(!testsHidden)}
              aria-label={testsHidden ? "Show tests" : "Hide tests"}
              title={testsHidden ? "Show tests" : "Hide tests"}
              aria-pressed={!testsHidden}
            >
              <FlaskConical size={16} />
              <span>Tests</span>
            </Button>
            <Button
              className={"workspace-toggle" + (referenceOpen ? " active" : "")}
              onClick={() => {
                if (!referenceOpen && chatEditor.current)
                  chatEditor.requestHelp(chatEditor.current);
                setReferenceOpen(!referenceOpen);
              }}
              title={`${lang.helpLabel} · ⌘⇧H / Ctrl+Shift+H in the editor`}
              aria-pressed={referenceOpen}
              aria-label={
                referenceOpen ? `Hide ${lang.helpLabel}` : `Show ${lang.helpLabel}`
              }
            >
              <MessageCircle size={16} />
              <span>{lang.helpLabel}</span>
            </Button>
          </div>
          <div
            className={"workspace-timer" + (remaining < 60000 ? " urgent" : "")}
            aria-label={paused ? "Assessment paused" : "Time remaining"}
          >
            <Clock3 size={15} />
            <strong>{duration(remaining)}</strong>
            <Button
              onClick={onPause}
              disabled={busy || remaining <= 0}
              aria-label={paused ? "Resume assessment" : "Pause assessment"}
              title={paused ? "Resume" : "Pause"}
            >
              {paused ? <Play size={15} /> : <Pause size={15} />}
            </Button>
          </div>
          <div className="workspace-judge-actions">
            <Button
              className="button secondary"
              disabled={
                paused ||
                busy ||
                judgeBusy ||
                pending ||
                !validInput ||
                remaining <= 0 ||
                attempt.problem.questionId === "demo"
              }
              onClick={() => {
                setTab("results");
                setTestsHidden(false);
                onJudge("run", input);
              }}
            >
              <Play size={14} />
              <span>Run tests</span>
            </Button>
            <div className="workspace-submit-group">
              <Button
                className="button primary"
                title="Submit to the full judge suite. An accepted submission ends the assessment."
                disabled={
                  paused ||
                  busy ||
                  judgeBusy ||
                  pending ||
                  remaining <= 0 ||
                  attempt.problem.questionId === "demo"
                }
                onClick={() => {
                  setTab("results");
                  setTestsHidden(false);
                  onJudge("submit", input);
                }}
              >
                <ArrowUpRight size={14} />
                {pending || judgeBusy ? "Judging…" : "Submit"}
              </Button>
              <AssessmentMenu
                disabled={busy || remaining <= 0}
                assistanceDisabled={paused || busy || remaining <= 0}
                onFinish={onFinish}
                onAssistance={() => setShowAssistance(!showAssistance)}
              />
            </div>
          </div>
        </header>
        <SplitPane
          label={`Resize workspace and ${lang.helpLabel}`}
          storageKey="duo-java-help-width"
          initial={73}
          secondHidden={!referenceOpen}
          first={
            <SplitPane
              label="Resize problem and editor"
              storageKey="duo-problem-width"
              firstHidden={problemHidden}
              first={
                <Panel className="problem-pane">
                  <div className="pane-title">
                    <BookOpen size={16} /> Problem{" "}
                    <span>
                      {attempt.problem.questionId === "demo"
                        ? "LOCAL EXERCISE"
                        : "LEETCODE"}
                    </span>
                  </div>
                  <ProblemDescription content={attempt.problem.content} />
                </Panel>
              }
              second={
                <Panel className="coding-pane">
                  <div className="pane-title">
                    <span className="file-tab">
                      <Code2 size={16} /> {lang.filename}
                    </span>
                    <span>{lang.badge}</span>
                  </div>
                  <SplitPane
                    label="Resize editor and tests"
                    direction="vertical"
                    storageKey="duo-editor-height-page"
                    initial={68}
                    secondHidden={testsHidden}
                    first={
                      <div className="editor-section">
                        <div className="editor-area">
                          <CodeEditor
                            value={source}
                            language={lang.id}
                            reviewTarget={{
                              attemptId: attempt.id,
                              source: "recording",
                            }}
                            onEdit={onEdit}
                            onContextChange={chatEditor.onChange}
                            onAskHelp={(context) => {
                              chatEditor.requestHelp(context);
                              setReferenceOpen(true);
                            }}
                            helpDisabled={paused || busy || remaining <= 0}
                            diagnosticsRetry={diagnosticsRetry}
                            onDiagnostics={(count, status, detail) => {
                              setDiagnosticErrors(count);
                              setDiagnosticStatus(status);
                              setDiagnosticDetail(detail ?? "");
                            }}
                            readOnly={paused || busy || remaining <= 0}
                          />
                        </div>
                        <div className="editor-status">
                          <span>
                            <span className="status-dot" />
                            {saveStatus}
                          </span>
                          <span
                            className={diagnosticErrors ? "error-text" : ""}
                            role="status"
                          >
                            <span title={diagnosticDetail || undefined}>
                              {diagnosticStatus}
                            </span>
                            {(diagnosticStatus === "Java checks unavailable" ||
                              diagnosticStatus === "C++26 checks unavailable") && (
                              <Button
                                className="button ghost compact"
                                onClick={() =>
                                  setDiagnosticsRetry((value) => value + 1)
                                }
                              >
                                Retry {lang.shortLabel} checks
                              </Button>
                            )}
                          </span>
                          <span>Tab accepts suggestions · 4 spaces</span>
                        </div>
                      </div>
                    }
                    second={
                      <div className="test-area">
                        <Tabs
                          id={workbenchId}
                          className="duo-test-tabs"
                          value={tab}
                          onChange={(value) =>
                            setTab(value as "tests" | "results")
                          }
                        >
                          <Tabs.List aria-label="Test workbench">
                            <Tabs.Tab value="tests">Test cases</Tabs.Tab>
                            <Tabs.Tab
                              value="results"
                              rightSection={
                                attempt.jobs.length > 0 ? (
                                  <Badge size="xs" variant="light">
                                    {attempt.jobs.length}
                                  </Badge>
                                ) : undefined
                              }
                            >
                              Results
                            </Tabs.Tab>
                            <span className="judge-label">LeetCode judge</span>
                          </Tabs.List>
                        </Tabs>
                        <div
                          className="test-scroll"
                          role="tabpanel"
                          id={`${workbenchId}-panel-${tab}`}
                          aria-labelledby={`${workbenchId}-tab-${tab}`}
                        >
                          {tab === "tests" ? (
                            <>
                              {testCaseNotice && (
                                <p
                                  className="test-case-notice small"
                                  role="status"
                                >
                                  {testCaseNotice}
                                </p>
                              )}
                              <TestCases
                                problem={attempt.problem}
                                value={input}
                                onChange={(value) => {
                                  setInput(value);
                                  setTestCaseNotice("");
                                }}
                                readOnly={paused || busy || remaining <= 0}
                                initialSelected={selectedTestCase}
                              />
                            </>
                          ) : (
                            <JudgeResults
                              jobs={attempt.jobs}
                              problem={attempt.problem}
                              testInput={input}
                              testInputReadOnly={
                                paused || busy || remaining <= 0
                              }
                              onAddTestCase={(nextInput, index, existing) => {
                                setInput(nextInput);
                                setSelectedTestCase(index);
                                setTestCaseNotice(
                                  existing
                                    ? "This input is already in your test cases."
                                    : "Failing case added. Run tests will include it with your other cases.",
                                );
                                setTab("tests");
                                setTestsHidden(false);
                              }}
                            />
                          )}
                        </div>
                      </div>
                    }
                  />
                  {showAssistance && (
                    <div className="assistance-box">
                      <label className="field-label" htmlFor="assistance">
                        What help did you use?
                      </label>
                      <TextInput
                        id="assistance"
                        value={assistance}
                        onChange={(e) => setAssistance(e.target.value)}
                        placeholder={lang.outsideHelpExample}
                      />
                      <Button
                        className="button secondary"
                        disabled={
                          !assistance.trim() || paused || remaining <= 0 || busy
                        }
                        onClick={async () => {
                          await onAssistance(assistance);
                          setAssistance("");
                          setShowAssistance(false);
                        }}
                      >
                        Save context
                      </Button>
                    </div>
                  )}
                </Panel>
              }
            />
          }
          second={
            <JavaHelpChat
              attemptId={attempt.id}
              initial={attempt.javaHelp ?? []}
              language={lang.id}
              open={referenceOpen}
              disabled={paused || busy || remaining <= 0}
              onRecord={onRecordHelp}
              onClose={() => setReferenceOpen(false)}
              editor={chatEditor}
            />
          }
        />
      </div>
      <Modal
        opened={paused}
        onClose={() => {}}
        withCloseButton={false}
        closeOnClickOutside={false}
        closeOnEscape={false}
        centered
        zIndex={10000}
        title="Assessment paused"
        overlayProps={{ blur: 14, backgroundOpacity: 0.9 }}
        classNames={{ content: "assessment-pause-card" }}
      >
        <div className="assessment-pause-content">
          <span className="round-icon">
            <Pause />
          </span>
          <h2>Take your time.</h2>
          <p>
            Your solving clock is stopped. The problem, code, tests and help
            stay covered until you resume.
          </p>
          <strong>{duration(remaining)} remaining</strong>
          <Button
            className="button primary"
            onClick={onPause}
            disabled={busy}
            autoFocus
          >
            Resume assessment <Play size={16} />
          </Button>
          <Button className="text-button" onClick={onHome} disabled={busy}>
            Back to Today · stay paused
          </Button>
          <small>
            Leaving this window pauses automatically. Coming back won’t restart
            the clock.
          </small>
          <span className="pause-save-status" role="status">
            {saveStatus}
          </span>
        </div>
      </Modal>
    </div>
  );
}

function Review({
  attempt: a,
  busy,
  onMutate,
  onAgent,
  onError,
  onHome,
}: {
  attempt: Attempt;
  busy: boolean;
  onMutate: (b: unknown) => Promise<void>;
  onAgent: (
    a: "evaluate" | "coach" | "reflect" | "prepare",
    message?: CoachRequest,
  ) => Promise<boolean>;
  onError: (e: unknown) => void;
  onHome: () => void;
}) {
  const [showLearning, setShowLearning] = useState(
    a.phase === "learn" || (a.phase === "complete" && !!a.followup),
  );
  const reviewLang = attemptLanguage(a);
  const [coached, setCoached] = useState(a.followup?.coachedCode ?? a.source);
  const [coachedDirty, setCoachedDirty] = useState(false);
  const coachedChat = useEditorChat(coached, reviewLang);
  const evaluation =
    a.evaluations[a.followup?.evaluationRevision ?? a.evaluations.length - 1];
  const safe = (fn: () => Promise<void>) => void fn().catch(onError);
  if (showLearning && (a.phase === "learn" || a.phase === "complete"))
    return (
      <div className="page-content learning-page">
        <div className="page-heading compact">
          <div>
            <span className="eyebrow">03 / LEARN & ITERATE</span>
            <h1>Make one thing click.</h1>
            <p>
              A small follow-up, built from your {a.problem.title} assessment.
            </p>
          </div>
          <Button
            className="text-button"
            onClick={() =>
              safe(async () => {
                if (a.phase !== "review") await onMutate({ action: "reflect" });
                setShowLearning(false);
              })
            }
          >
            Back to recording & review <ChevronRight size={15} />
          </Button>
        </div>
        <FocusedLearning
          attempt={a}
          busy={busy}
          onMutate={onMutate}
          onAgent={onAgent}
          onError={onError}
          onHome={onHome}
          editor={a.followup?.feedback ? coachedChat : undefined}
          saveWorkspace={async () => {
            if (coachedDirty || a.followup?.coachedCode === undefined) {
              await onMutate({ action: "coached-code", code: coached });
              setCoachedDirty(false);
            }
          }}
        />
        <Panel className="panel learning-summary" id="learning-review">
          <span className="eyebrow">ASSESSMENT FEEDBACK</span>
          <h3>{a.problem.title}</h3>
          <p>{evaluation?.summary}</p>
          <Findings evaluation={evaluation} />
          <ResearchSources research={evaluation?.research} />
          {evaluation && (
            <ReviewFlagButton
              target={{
                kind: "evaluation",
                attemptId: a.id,
                createdAt: evaluation.createdAt,
              }}
            />
          )}
        </Panel>
        {a.followup?.feedback && (
          <Panel className="panel coached-workspace">
            <div className="pane-title">
              <Code2 size={16} /> Optional coached workspace{" "}
              <span>SEPARATE FROM YOUR ASSESSMENT</span>
            </div>
            <div className="coached-editor">
              <CodeEditor
                value={coached}
                language={reviewLang}
                reviewTarget={{ attemptId: a.id, source: "coached" }}
                onContextChange={coachedChat.onChange}
                onAskHelp={coachedChat.requestHelp}
                helpDisabled={busy || a.phase === "complete"}
                onEdit={(value) => {
                  setCoached(value);
                  setCoachedDirty(true);
                }}
              />
            </div>
            <div className="coding-actions">
              <span className="small">
                Your timed assessment is preserved unchanged.
              </span>
              <Button
                className="button secondary"
                disabled={!coachedDirty || busy}
                onClick={() =>
                  safe(async () => {
                    await onMutate({ action: "coached-code", code: coached });
                    setCoachedDirty(false);
                  })
                }
              >
                {coachedDirty
                  ? "Save coached changes"
                  : "Coached changes saved"}
              </Button>
            </div>
          </Panel>
        )}
      </div>
    );
  return (
    <ReflectionWorkspace
      attempt={a}
      busy={busy}
      onMutate={onMutate}
      onAgent={onAgent}
      onError={onError}
      onHome={onHome}
      onLearn={() =>
        safe(async () => {
          if (a.phase === "review" || a.phase === "complete")
            await onMutate({ action: "learn" });
          setShowLearning(true);
        })
      }
    />
  );
}

function Findings({
  evaluation,
}: {
  evaluation: Attempt["evaluations"][number] | undefined;
}) {
  return (
    <div className="findings-grid">
      <div>
        <span className="eyebrow positive">WHAT YOU DEMONSTRATED</span>
        {evaluation?.strengths.map((f, i) => (
          <div className="finding" key={i}>
            <CheckCircle2 size={17} />
            <div>
              <strong>{f.skill}</strong>
              <p>{f.observation}</p>
              <small>
                Evidence:{" "}
                {f.evidence
                  .map((n) => (n === 0 ? "final snapshot" : `event ${n}`))
                  .join(", ")}
              </small>
            </div>
          </div>
        ))}
        {evaluation?.strengths.length === 0 && (
          <p>
            There isn’t enough evidence to make a confident strength claim yet.
          </p>
        )}
      </div>
      <div>
        <span className="eyebrow amber-text">WHERE TO FOCUS NEXT</span>
        {evaluation?.gaps.map((f, i) => (
          <div className="finding" key={i}>
            <Target size={17} />
            <div>
              <strong>{f.skill}</strong>
              <p>{f.observation}</p>
              <small>
                Evidence:{" "}
                {f.evidence
                  .map((n) => (n === 0 ? "final snapshot" : `event ${n}`))
                  .join(", ")}
              </small>
            </div>
          </div>
        ))}
        {evaluation?.gaps.length === 0 && (
          <p>
            No consequential gap was established. A transfer exercise can
            provide more evidence.
          </p>
        )}
      </div>
    </div>
  );
}

function Progress({
  state,
  onOpen,
}: {
  state: any;
  onOpen: (id: string) => void;
}) {
  const attempts: AttemptSummary[] = state?.attempts ?? [];
  const real = attempts.filter((a) => !a.demonstration);
  const accepted = real.filter((a) => a.verdict === "Accepted");
  const days = new Set(
    real.map((a) => new Date(a.createdAt).toLocaleDateString()),
  ).size;
  return (
    <div className="page-content">
      <div className="page-heading compact">
        <div>
          <span className="eyebrow">PROGRESS YOU CAN POINT TO</span>
          <h1>A record of getting better.</h1>
          <p>
            Observed work, independent recall, and the skills worth revisiting.
          </p>
        </div>
      </div>
      <div className="stats-grid">
        <Panel className="panel">
          <span className="eyebrow">ASSESSMENTS</span>
          <strong>{real.length}</strong>
          <p>One attempt per session</p>
        </Panel>
        <Panel className="panel">
          <span className="eyebrow">ACCEPTED SOLUTIONS</span>
          <strong>{accepted.length}</strong>
          <p>Confirmed by LeetCode</p>
        </Panel>
        <Panel className="panel">
          <span className="eyebrow">DAYS PRACTICED</span>
          <strong>{days}</strong>
          <p>Every return counts</p>
        </Panel>
        <Panel className="panel">
          <span className="eyebrow">FOCUSED FOLLOW-UPS</span>
          <strong>
            {state?.followups.filter((s: any) => s.hasResponse).length ?? 0}
          </strong>
          <p>First responses preserved</p>
        </Panel>
      </div>
      <PracticeLibrary
        key={String(Boolean(state?.sandboxMode))}
        attempts={attempts}
        sandboxMode={Boolean(state?.sandboxMode)}
        onOpen={onOpen}
      />
      <div className="section-heading">
        <h2>Skill evidence</h2>
        <span>OBSERVATIONS, NOT MASTERY SCORES</span>
      </div>
      <div className="skills-grid">
        {state?.followups.map((s: any, i: number) => (
          <Panel className="panel" key={i}>
            <span className="pill mint">
              {s.hasResponse ? "FOCUSED RECALL" : "SESSION RECORD"}
            </span>
            <h3>{s.skill}</h3>
            <p>
              {!s.hasResponse && s.reflectionStatus === "ready"
                ? "Understanding explained during reflection"
                : s.understanding?.status === "sufficient"
                  ? s.understanding.support === "independent"
                    ? "Understanding demonstrated in the first response"
                    : s.understanding.support === "coached"
                      ? "Understanding demonstrated during coaching"
                      : "Session understanding demonstrated; independent recall unassessed"
                  : s.learningExit?.reason === "skipped"
                    ? "Coaching skipped; understanding not checked"
                    : s.learningExit?.reason === "manual"
                      ? "Moved on manually; understanding check unfinished"
                      : s.outcome === "independent"
                        ? "Demonstrated on the first response"
                        : s.outcome === "partial"
                          ? "Partially demonstrated; coaching followed"
                          : s.outcome === "unassessed"
                            ? "Independent recall is not yet assessed"
                            : "Needs another focused practice opportunity"}
            </p>
            <small>{date(s.date)} · One observation</small>
          </Panel>
        ))}
        {!state?.followups.length && (
          <Panel className="panel empty-skill">
            <Target size={22} />
            <p>
              Complete a focused follow-up to start building evidence of recall.
              Historical coaching notes will stay separate from newly observed
              performance.
            </p>
          </Panel>
        )}
      </div>
      <div className="section-heading">
        <h2>A starting point from your earlier practice</h2>
        <span>IMPORTED · NOT NEW ASSESSMENTS</span>
      </div>
      <div className="skills-grid">
        {state?.importedHistory?.map((s: any) => (
          <Panel className="panel" key={s.id}>
            <span className="pill">{s.provenance}</span>
            <h3>{s.skill}</h3>
            <p>{s.observation}</p>
            <p className="small">{s.support}</p>
            <a
              className="text-button"
              href={s.source}
              target="_blank"
              rel="noreferrer"
            >
              {s.date ?? "Date unknown"} notes
              {s.profile ? ` · ${s.profile}` : ""} <ArrowUpRight size={12} />
            </a>
          </Panel>
        ))}
      </div>
    </div>
  );
}
