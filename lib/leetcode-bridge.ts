import { bridge } from "./browser";

export type BridgeStateKind =
  | "checking"
  | "ready"
  | "signed-out"
  | "extension-missing"
  | "unsupported-browser"
  | "untrusted-origin"
  | "permissions-missing"
  | "verification-required"
  | "rate-limited"
  | "network-error";

export const LEETCODE_LOGIN_URL = "https://leetcode.com/accounts/login/";
export const LEETCODE_HOME_URL = "https://leetcode.com/";

export type BridgeConnection = {
  kind: BridgeStateKind;
  bridgeReachable: boolean;
  isSignedIn: boolean;
  username?: string;
  isPremium?: boolean;
  version?: string;
  hasCsrfCookie?: boolean;
  label: string;
  detail: string;
  actionLabel: string;
  externalUrl?: string;
  checkedAt: number;
};

export type BridgeSender = (
  op: string,
  args?: Record<string, unknown>,
) => Promise<any>;

export function initialBridgeState(now = Date.now()): BridgeConnection {
  return {
    kind: "checking",
    bridgeReachable: false,
    isSignedIn: false,
    label: "Checking LeetCode bridge…",
    detail: "Contacting DuoLeetCode Local Bridge in this browser.",
    actionLabel: "Checking…",
    checkedAt: now,
  };
}

function classifyTransportFailure(
  error: unknown,
  now: number,
): BridgeConnection | null {
  const message = error instanceof Error ? error.message : String(error);
  const code = (error as { code?: string })?.code;
  if (/where DuoLeetCode Local Bridge is installed/i.test(message)) {
    return {
      kind: "unsupported-browser",
      bridgeReachable: false,
      isSignedIn: false,
      label: "Unsupported browser for extension bridge",
      detail:
        "This browser does not expose Chrome extension messaging. Open http://127.0.0.1:4318/ in Chromium, Chrome, or Dia where DuoLeetCode Local Bridge is installed.",
      actionLabel: "Retry check",
      checkedAt: now,
    };
  }
  if (
    code === "UNTRUSTED_CALLER" ||
    /Untrusted caller/i.test(message)
  ) {
    return {
      kind: "untrusted-origin",
      bridgeReachable: false,
      isSignedIn: false,
      label: "Bridge blocked in this tab or origin",
      detail:
        "Open http://127.0.0.1:4318/ directly in a normal, non-incognito top-level tab.",
      actionLabel: "Retry check",
      checkedAt: now,
    };
  }
  if (
    /Could not establish connection|Receiving end does not exist|Invalid extension id|did not respond/i.test(
      message,
    )
  ) {
    return {
      kind: "extension-missing",
      bridgeReachable: false,
      isSignedIn: false,
      label: "Extension not detected",
      detail:
        "DuoLeetCode Local Bridge is not installed, disabled in chrome://extensions, or blocked in Incognito.",
      actionLabel: "Check browser extension",
      checkedAt: now,
    };
  }
  return null;
}

export async function probeLeetCodeBridge(
  send: BridgeSender = bridge,
  now = Date.now(),
): Promise<BridgeConnection> {
  type BridgeMeta = {
    version?: string;
    hasCsrfCookie?: boolean;
    leetcodePermission?: boolean;
    judgeHeaderPermission?: boolean;
  };
  let meta: BridgeMeta | undefined;
  try {
    meta = await send("ping");
  } catch (e) {
    return (
      classifyTransportFailure(e, now) ?? {
        kind: "extension-missing",
        bridgeReachable: false,
        isSignedIn: false,
        label: "Browser bridge unavailable",
        detail: e instanceof Error ? e.message : String(e),
        actionLabel: "Retry connection",
        checkedAt: now,
      }
    );
  }

  if (
    meta &&
    (meta.leetcodePermission === false || meta.judgeHeaderPermission === false)
  ) {
    return {
      kind: "permissions-missing",
      bridgeReachable: true,
      isSignedIn: false,
      version: meta.version,
      label: "Extension missing LeetCode permission",
      detail:
        "Bridge responded, but site access to https://leetcode.com/* is disabled in chrome://extensions.",
      actionLabel: "Re-check permissions",
      checkedAt: now,
    };
  }

  try {
    const status = await send("status");
    const vSuffix = meta?.version ? ` (v${meta.version})` : "";
    if (status?.isSignedIn) {
      const premium = status.isPremium ? " · Premium" : "";
      return {
        kind: "ready",
        bridgeReachable: true,
        isSignedIn: true,
        username: status.username,
        isPremium: Boolean(status.isPremium),
        version: meta?.version,
        hasCsrfCookie: meta?.hasCsrfCookie,
        label: `Signed in as ${status.username}${premium}`,
        detail: `Bridge active${vSuffix} · LeetCode credentials stay in your browser.`,
        actionLabel: "Check connection",
        checkedAt: now,
      };
    }
    return {
      kind: "signed-out",
      bridgeReachable: true,
      isSignedIn: false,
      version: meta?.version,
      hasCsrfCookie: meta?.hasCsrfCookie,
      label: "Bridge connected · LeetCode sign-in needed",
      detail: `Extension${vSuffix} is active, but this browser isn't signed in to LeetCode (or your session expired).`,
      actionLabel: "Sign in to LeetCode",
      externalUrl: status?.loginUrl || LEETCODE_LOGIN_URL,
      checkedAt: now,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const code = (e as { code?: string })?.code;

    // Older 0.1.4 extensions omit permission metadata on ping; check diagnostics only when status fails.
    if (
      meta?.leetcodePermission === undefined &&
      meta?.judgeHeaderPermission === undefined
    ) {
      try {
        const diag: BridgeMeta = await send("diagnostics");
        meta = { ...meta, ...diag };
        if (
          diag?.leetcodePermission === false ||
          diag?.judgeHeaderPermission === false
        ) {
          return {
            kind: "permissions-missing",
            bridgeReachable: true,
            isSignedIn: false,
            version: diag.version,
            label: "Extension missing LeetCode permission",
            detail:
              "Bridge responded, but site access to https://leetcode.com/* is disabled in chrome://extensions.",
            actionLabel: "Re-check permissions",
            checkedAt: now,
          };
        }
      } catch {
        /* Diagnostics are optional; classify the status failure directly. */
      }
    }

    const vSuffix = meta?.version ? ` (v${meta.version})` : "";

    if (
      code === "VERIFICATION_REQUIRED" ||
      /verification page|browser-verification challenge|HTTP 403/i.test(message)
    ) {
      return {
        kind: "verification-required",
        bridgeReachable: true,
        isSignedIn: false,
        version: meta?.version,
        label: "Bridge connected · LeetCode verification needed",
        detail:
          "LeetCode returned a browser-verification page instead of account status. Open LeetCode in a tab to refresh your session, then return here.",
        actionLabel: "Open LeetCode",
        externalUrl: LEETCODE_HOME_URL,
        checkedAt: now,
      };
    }
    if (code === "RATE_LIMITED" || /429|rate limit/i.test(message)) {
      return {
        kind: "rate-limited",
        bridgeReachable: true,
        isSignedIn: false,
        version: meta?.version,
        label: "Bridge connected · Temporarily rate-limited",
        detail:
          "LeetCode rate-limited status requests from this browser. Wait a moment and check again.",
        actionLabel: "Check again",
        checkedAt: now,
      };
    }
    if (
      code === "SIGNED_OUT" ||
      code === "CSRF_MISSING" ||
      /not (?:logged|signed) in|authentication|session needs refreshing/i.test(
        message,
      )
    ) {
      return {
        kind: "signed-out",
        bridgeReachable: true,
        isSignedIn: false,
        version: meta?.version,
        label: "Bridge connected · LeetCode sign-in needed",
        detail: `Extension${vSuffix} is active, but your LeetCode login session needs to be refreshed.`,
        actionLabel: "Sign in to LeetCode",
        externalUrl: LEETCODE_LOGIN_URL,
        checkedAt: now,
      };
    }
    return {
      kind: "network-error",
      bridgeReachable: true,
      isSignedIn: false,
      version: meta?.version,
      label: "Bridge connected · Cannot reach LeetCode",
      detail: message,
      actionLabel: "Retry check",
      checkedAt: now,
    };
  }
}

export type PopupHandle = {
  closed: boolean;
  close: () => void;
  focus?: () => void;
};

export function popupWindowBounds(
  win: {
    screenX?: number;
    screenY?: number;
    outerWidth?: number;
    outerHeight?: number;
  },
  width = 520,
  height = 700,
) {
  const left = Math.max(
    0,
    Math.round(
      (win.screenX ?? 0) + Math.max(0, ((win.outerWidth ?? width) - width) / 2),
    ),
  );
  const top = Math.max(
    0,
    Math.round(
      (win.screenY ?? 0) +
        Math.max(0, ((win.outerHeight ?? height) - height) / 2),
    ),
  );
  return { width, height, left, top };
}

export function popupWindowFeatures(
  win: {
    screenX?: number;
    screenY?: number;
    outerWidth?: number;
    outerHeight?: number;
  },
  width = 520,
  height = 700,
): string {
  const b = popupWindowBounds(win, width, height);
  return `popup=yes,width=${b.width},height=${b.height},left=${b.left},top=${b.top}`;
}

export function watchLeetCodeLogin({
  popup,
  check,
  shouldStop = () => false,
  firstDelayMs = 1800,
  intervalMs = 2500,
  maxDurationMs = 180_000,
  now = () => Date.now(),
}: {
  popup: PopupHandle | null;
  check: () => Promise<BridgeConnection>;
  shouldStop?: () => boolean;
  firstDelayMs?: number;
  intervalMs?: number;
  maxDurationMs?: number;
  now?: () => number;
}): () => void {
  const startedAt = now();
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const stop = () => {
    stopped = true;
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  };

  const tick = async () => {
    if (stopped) return;
    if (now() - startedAt > maxDurationMs || shouldStop()) {
      stop();
      return;
    }
    try {
      const next = await check();
      if (stopped) return;
      if (next.kind === "ready") {
        stop();
        try {
          popup?.close();
        } catch {
          /* Cross-origin opener policy may block close after third-party OAuth redirects. */
        }
        return;
      }
    } catch {
      /* Keep polling quietly until ready, timeout, or explicit stop. */
    }
    if (!stopped) {
      timer = setTimeout(() => {
        void tick();
      }, intervalMs);
    }
  };

  timer = setTimeout(() => {
    void tick();
  }, firstDelayMs);

  return stop;
}
