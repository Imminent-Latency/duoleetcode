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
  Tabs,
} from "@mantine/core";
import { SplitPane } from "./split-pane";
import { TestCases, JudgeResults } from "./test-workbench";
import AssessmentMenu from "./assessment-menu";
import ReflectionWorkspace from "./reflection-workspace";
import AgentSettings from "./agent-settings";
import AgentDiagnostics, { type DiagnosticsTab } from "./agent-diagnostics";
import CoachMemory from "./coach-memory";
import DataManagement from "./data-management";
import { useProblemPrescription } from "./problem-prescription";
import TodayView from "./today-view";
import ProblemCatalog from "./problem-catalog";
import ProgressView, { type ProgressTab } from "./progress-view";
import ConnectionsView from "./connections-view";
import SettingsView, {
  SETTINGS_PAGE_LABELS,
  type SettingsPage,
} from "./settings-view";
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
  ChevronRight,
  Clock3,
  Code2,
  Compass,
  FlaskConical,
  History,
  MessageCircle,
  LoaderCircle,
  Pause,
  Play,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Target,
  Timer,
  TrendingUp,
  X,
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
import type { Prescription } from "@/lib/prescription-types";
import { isManualTimeboxRated } from "@/lib/skill-ratings";
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
// Top-level sections. Settings and Progress have nested sub-pages kept in
// separate state (settingsPage / progressTab) so the last one is remembered.
type View = "today" | "catalog" | "history" | "memory" | "settings" | "attempt";
type Section = Exclude<View, "attempt">;
const SECTION_LABELS: Record<Section, string> = {
  today: "Today",
  catalog: "Problem library",
  history: "Progress",
  memory: "Coach memory",
  settings: "Settings",
};
const PRIMARY_NAV = [
  { id: "today", label: "Today", icon: Compass },
  { id: "catalog", label: "Problem library", icon: BookOpen },
  { id: "history", label: "Progress", icon: TrendingUp },
  { id: "memory", label: "Coach memory", icon: MessageCircle },
] as const;
const duration = (ms: number) =>
  `${Math.floor(Math.max(0, ms) / 60000)
    .toString()
    .padStart(2, "0")}:${Math.floor((Math.max(0, ms) % 60000) / 1000)
    .toString()
    .padStart(2, "0")}`;
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export default function Workspace() {
  const [view, setView] = useState<View>("today");
  const [settingsPage, setSettingsPage] = useState<SettingsPage>("general");
  const [progressTab, setProgressTab] = useState<ProgressTab>("overview");
  const [diagnosticsTab, setDiagnosticsTab] = useState<DiagnosticsTab>();
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
  const [preferredLanguage, setPreferredLanguage] =
    useState<LanguageId>("java");
  const languageOverridden = useRef(false);
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
  const [selectedPrescription, setSelectedPrescription] =
    useState<Prescription>();
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
    Boolean(connection?.isPremium),
  );
  const catalogSyncBusy = useRef(false);
  const updatePreferredLanguage = (next: LanguageId) => {
    languageOverridden.current = true;
    setPreferredLanguage(next);
    try {
      localStorage.setItem(PREFERRED_LANGUAGE_KEY, next);
    } catch {}
    if (next === "cpp")
      void cpp()
        .prepare()
        .catch(() => {});
    else
      void java()
        .prepare()
        .catch(() => {});
  };
  const reload = useCallback(async () => {
    const data = await api("/api/state");
    storageMode.current = data.sandboxMode ? "test" : "practice";
    setState(data);
    return data;
  }, []);
  useEffect(() => {
    if (
      !connection.isSignedIn ||
      !state ||
      state.sandboxMode ||
      view === "attempt"
    )
      return;
    const sync = state.ratings?.catalogSync;
    if (!sync?.needsRefresh) return;
    if (sync.backoffUntil && Date.now() < sync.backoffUntil) return;
    if (catalogSyncBusy.current) return;
    let live = true;
    const timer = setTimeout(async () => {
      catalogSyncBusy.current = true;
      try {
        const page: any = await bridge("list", {
          skip: sync.nextSkip ?? 0,
          limit: 100,
        });
        if (!live) return;
        await api("/api/catalog-sync", {
          action: "ingest-page",
          skip: sync.nextSkip ?? 0,
          totalNum: Number(page.totalNum ?? 0),
          questions: Array.isArray(page.questions) ? page.questions : [],
        });
        if (live) await reload().catch(() => {});
      } catch (e) {
        if (live) {
          await api("/api/catalog-sync", {
            action: "record-error",
            error: errorText(e),
          }).catch(() => {});
        }
      } finally {
        catalogSyncBusy.current = false;
      }
    }, 800);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [
    connection.isSignedIn,
    state?.ratings?.catalogSync?.nextSkip,
    state?.ratings?.catalogSync?.needsRefresh,
    state?.ratings?.catalogSync?.backoffUntil,
    state?.sandboxMode,
    view,
    reload,
  ]);
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
      if (attemptLanguage(recovered) === "cpp")
        void cpp()
          .prepare()
          .catch(() => {});
      else
        void java()
          .prepare()
          .catch(() => {});
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
    let initialLang: LanguageId = "java";
    try {
      initialLang = normalizeLanguage(
        localStorage.getItem(PREFERRED_LANGUAGE_KEY),
      );
      setPreferredLanguage(initialLang);
    } catch {}
    void reload()
      .then((data) => {
        if (data.defaultLanguage && !languageOverridden.current) {
          const serverLang = normalizeLanguage(data.defaultLanguage);
          setPreferredLanguage(serverLang);
          try {
            localStorage.setItem(PREFERRED_LANGUAGE_KEY, serverLang);
          } catch {}
          if (serverLang !== initialLang) {
            if (serverLang === "cpp")
              void cpp()
                .prepare()
                .catch(() => {});
            else
              void java()
                .prepare()
                .catch(() => {});
          }
        }
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
          setSettingsPage("diagnostics");
          setView("settings");
          return;
        }
        if (traceId) {
          setDiagnosticId(traceId);
          setSettingsPage("diagnostics");
          setView("settings");
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
            ? "Time is up. Attempt saved."
            : accepted
              ? "Accepted. Attempt saved."
              : "Attempt saved.",
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
            await cpp()
              .prepare()
              .catch(() => {});
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
  // `sub` opens a nested page; omitted, the section's last sub-page is kept.
  function navigate(next: "settings", sub?: SettingsPage): void;
  function navigate(next: "history", sub?: ProgressTab): void;
  function navigate(next: View): void;
  function navigate(next: View, sub?: SettingsPage | ProgressTab) {
    if (next !== "attempt") void changePause("pause");
    if (next === "settings" && sub) setSettingsPage(sub as SettingsPage);
    if (next === "history" && sub) setProgressTab(sub as ProgressTab);
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
  }
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
        !(
          view === "today" ||
          view === "catalog" ||
          (view === "settings" && settingsPage === "connections")
        )
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
  }, [checkBridge, view, settingsPage]);
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
            ? "Sign in to LeetCode in the popup window. It will close automatically once signed in."
            : "Complete verification in the LeetCode popup. It will close automatically once cleared.",
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
          "Sign in to LeetCode in the popup window. Reload DuoLeetCode Local Bridge in chrome://extensions for automatic popup closing.",
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
      if (chosen === "cpp")
        void cpp()
          .prepare()
          .catch(() => {});
      else
        void java()
          .prepare()
          .catch(() => {});
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
        await cpp()
          .prepare()
          .catch(() => {});
      } else {
        await java().prepare();
      }
      const { attempt: a, serverTime } = await api("/api/state", {
        problem: selected,
        budgetMs: minutes * 60000,
        demonstration: selected.questionId === "demo" || testSession,
        language: sessionLanguage,
        ...(!testSession &&
        selectedPrescription &&
        selectedPrescription.slug === selected.titleSlug
          ? {
              prescriptionId: selectedPrescription.id,
              selectionSpoilerRevealed: Boolean(
                selectedPrescription.selectionSpoilerRevealed,
              ),
              isPremium: Boolean(connectionRef.current.isPremium),
            }
          : {}),
      });
      await acquire(a.id);
      const r = new Recorder(a, serverTime, setSaveStatus);
      recorder.current = r;
      setAttempt(a);
      setSource(a.source);
      setSelected(undefined);
      setSelectedPrescription(undefined);
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
    Boolean(busy && attempt?.sealed && attemptLanguage(attempt) === "java"),
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
  const topbarEngineStatus = topbarLanguage === "cpp" ? cppStatus : javaStatus;
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
          </span>
        </Button>
        <nav aria-label="Workspace">
          {PRIMARY_NAV.map(({ id, label, icon: Icon }) => (
            <NavLink
              component="button"
              key={id}
              active={view === id}
              label={label}
              aria-label={label}
              title={label}
              leftSection={<Icon size={19} />}
              rightSection={
                id === "today" ? <span className="nav-dot" /> : undefined
              }
              onClick={() => navigate(id)}
            />
          ))}
          <div className="nav-divider" role="separator" />
          <NavLink
            component="button"
            active={view === "settings"}
            label="Settings"
            aria-label="Settings"
            title="Settings"
            leftSection={<SlidersHorizontal size={19} />}
            onClick={() => navigate("settings")}
          />
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
            <span className="session-status">
              {live ? "In progress" : "Latest session"}
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
      </aside>
      <main
        className={view === "attempt" ? "app-main main-session" : "app-main"}
      >
        <header className="topbar">
          <div className="breadcrumb">
            Workspace <ChevronRight size={14} />
            {view === "settings" && (
              <>
                {SECTION_LABELS.settings} <ChevronRight size={14} />
              </>
            )}
            <strong>
              {view === "settings"
                ? SETTINGS_PAGE_LABELS[settingsPage]
                : view !== "attempt"
                  ? SECTION_LABELS[view]
                  : attempt?.phase === "active"
                    ? "Assessment"
                    : "Your session"}
            </strong>
          </div>
          <div className="top-status">
            <span
              className={topbarEngineReady ? "status-dot" : "status-dot amber"}
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
                {connection.version ? `v${connection.version}` : "unknown"}). In
                chrome://extensions, remove the older extension and Load
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
          <TodayView
            now={now}
            state={state}
            language={preferredLanguage}
            onLanguageChange={updatePreferredLanguage}
            prescription={prescription}
            connection={connection}
            agentStatus={agentStatus}
            busy={!!busy}
            completedCount={completed.length}
            onOpen={open}
            onChoosePrescribed={(slug, budget, rx) => {
              setMinutes(budget);
              setSelectedPrescription(rx);
              void choose(slug);
            }}
            onBrowse={() => {
              setSelectedPrescription(undefined);
              navigate("catalog");
            }}
            onManageConnections={() => navigate("settings", "connections")}
            onBridgeAction={connect}
            onViewProgress={() => navigate("history")}
            onRetryDrain={async () => {
              try {
                await api("/api/ratings", { action: "retry-drain" });
                await reload();
              } catch (e) {
                showError(e);
              }
            }}
            onWelcomeUpdated={async () => {
              await reload();
            }}
            onError={showError}
          />
        )}
        {view === "catalog" && (
          <ProblemCatalog
            language={preferredLanguage}
            onLanguageChange={updatePreferredLanguage}
            onChoose={(slug) => {
              setSelectedPrescription(undefined);
              void choose(slug);
            }}
            disabled={!!busy}
            connection={connection}
            onBridgeAction={connect}
            onRecheck={() => void checkBridge({ manual: true })}
          />
        )}
        {view === "history" && (
          <ProgressView
            state={state}
            tab={progressTab}
            onTabChange={setProgressTab}
            onOpen={open}
            onRefresh={reload}
            onError={showError}
          />
        )}
        {view === "memory" && <CoachMemory onOpen={open} />}
        {view === "settings" && (
          <SettingsView
            page={settingsPage}
            onPageChange={(page) => navigate("settings", page)}
            pages={{
              general: (
                <AgentSettings
                  onDefaultLanguageChange={updatePreferredLanguage}
                  onOpenUsage={() => {
                    setDiagnosticsTab("usage");
                    navigate("settings", "diagnostics");
                  }}
                />
              ),
              connections: (
                <ConnectionsView
                  connection={connection}
                  agentStatus={agentStatus}
                  busy={!!busy}
                  javaStatus={javaStatus}
                  cppStatus={cppStatus}
                  cppDetail={cppDetail}
                  onBridgeAction={connect}
                  onRecheckBridge={() => void checkBridge({ manual: true })}
                  onRefreshRuntimes={async () => {
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
                  onChooseModels={() => navigate("settings", "general")}
                  onWarmJava={() => {
                    void java().prepare().catch(showError);
                  }}
                  onWarmCpp={() => {
                    void cpp().prepare().catch(showError);
                  }}
                  onOpenDemo={() => choose(demoProblem.titleSlug)}
                />
              ),
              data: (
                <DataManagement
                  beforeSnapshot={async () => {
                    await recorder.current?.flush();
                  }}
                />
              ),
              diagnostics: (
                <AgentDiagnostics
                  initialId={diagnosticId}
                  onSelect={setDiagnosticId}
                  initialFlag={reviewFlagId}
                  initialTab={diagnosticsTab}
                  onTabChange={setDiagnosticsTab}
                />
              ),
            }}
          />
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
          onClose={() => {
            setSelected(undefined);
            setSelectedPrescription(undefined);
          }}
          title="Start assessment"
          size={540}
          className="duo-prepare-modal"
          closeButtonProps={{ "aria-label": "Close preparation" }}
        >
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
          {selectedPrescription &&
            selectedPrescription.slug === selected.titleSlug &&
            !testSession && (
              <p className="small">
                {isManualTimeboxRated(selectedPrescription.minutes, minutes)
                  ? `Within ±5 min of prescribed ${selectedPrescription.minutes} min: rated session.`
                  : `Outside ±5 min of prescribed ${selectedPrescription.minutes} min: unrated practice.`}
              </p>
            )}
          {selected.questionId !== "demo" && (
            <Checkbox
              checked={testSession}
              onChange={(e) => setTestSession(e.currentTarget.checked)}
              label="Test session (exclude from progress)"
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
                referenceOpen
                  ? `Hide ${lang.helpLabel}`
                  : `Show ${lang.helpLabel}`
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
                              diagnosticStatus ===
                                "C++26 checks unavailable") && (
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
            <h1>Focused practice</h1>
            <p>Follow-up from {a.problem.title}.</p>
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
          <h3>Assessment feedback: {a.problem.title}</h3>
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
        <h4 className="finding-heading positive">Demonstrated</h4>
        {evaluation?.strengths.map((f, i) => (
          <div className="finding" key={i}>
            <CheckCircle2 size={17} />
            <div>
              <strong>{f.skill}</strong>
              <p>{f.observation}</p>
              {f.evidence.length > 0 && (
                <small>
                  Evidence:{" "}
                  {f.evidence
                    .map((n) => (n === 0 ? "final snapshot" : `event ${n}`))
                    .join(", ")}
                </small>
              )}
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
        <h4 className="finding-heading amber-text">Focus next</h4>
        {evaluation?.gaps.map((f, i) => (
          <div className="finding" key={i}>
            <Target size={17} />
            <div>
              <strong>{f.skill}</strong>
              <p>{f.observation}</p>
              {f.evidence.length > 0 && (
                <small>
                  Evidence:{" "}
                  {f.evidence
                    .map((n) => (n === 0 ? "final snapshot" : `event ${n}`))
                    .join(", ")}
                </small>
              )}
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
