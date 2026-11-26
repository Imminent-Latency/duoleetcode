import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CPP_MIN_BRIDGE_VERSION,
  initialBridgeState,
  isBridgeVersionAtLeast,
  LEETCODE_HOME_URL,
  LEETCODE_LOGIN_URL,
  popupWindowFeatures,
  probeLeetCodeBridge,
  watchLeetCodeLogin,
} from "../lib/leetcode-bridge";

function errWithCode(message: string, code?: string) {
  const e = new Error(message) as Error & { code?: string };
  if (code) e.code = code;
  return e;
}

test("initialBridgeState starts in checking state without false connection claims", () => {
  const s = initialBridgeState(1234);
  assert.equal(s.kind, "checking");
  assert.equal(s.bridgeReachable, false);
  assert.equal(s.isSignedIn, false);
  assert.equal(s.checkedAt, 1234);
});

test("probeLeetCodeBridge distinguishes signed-in vs bridge-connected-but-signed-out", async () => {
  const calls: string[] = [];
  const signedOut = await probeLeetCodeBridge(async (op) => {
    calls.push(op);
    if (op === "ping") {
      return {
        protocol: 1,
        version: "0.1.5",
        hasCsrfCookie: false,
        leetcodePermission: true,
        judgeHeaderPermission: true,
      };
    }
    if (op === "status") {
      return {
        isSignedIn: false,
        state: "signed-out",
        loginUrl: LEETCODE_LOGIN_URL,
      };
    }
    throw new Error("Unexpected op: " + op);
  }, 5000);

  assert.deepEqual(calls, ["ping", "status"]);
  assert.equal(signedOut.kind, "signed-out");
  assert.equal(signedOut.bridgeReachable, true);
  assert.equal(signedOut.isSignedIn, false);
  assert.equal(signedOut.label, "Bridge connected · LeetCode sign-in needed");
  assert.equal(signedOut.actionLabel, "Sign in to LeetCode");
  assert.equal(signedOut.externalUrl, LEETCODE_LOGIN_URL);
  assert.match(signedOut.detail, /v0\.1\.5/);

  const ready = await probeLeetCodeBridge(async (op) => {
    if (op === "ping") {
      return {
        protocol: 1,
        version: "0.1.5",
        hasCsrfCookie: true,
        leetcodePermission: true,
        judgeHeaderPermission: true,
      };
    }
    if (op === "status") {
      return { isSignedIn: true, username: "ldev", isPremium: true };
    }
    throw new Error("Unexpected op: " + op);
  }, 6000);

  assert.equal(ready.kind, "ready");
  assert.equal(ready.bridgeReachable, true);
  assert.equal(ready.isSignedIn, true);
  assert.equal(ready.username, "ldev");
  assert.equal(ready.isPremium, true);
  assert.equal(ready.label, "Signed in as ldev · Premium");
  assert.equal(ready.externalUrl, undefined);
});

test("probeLeetCodeBridge classifies transport failures: unsupported-browser, untrusted-origin, extension-missing", async () => {
  const unsupported = await probeLeetCodeBridge(async () => {
    throw new Error(
      "Open this app in the browser where DuoLeetCode Local Bridge is installed.",
    );
  });
  assert.equal(unsupported.kind, "unsupported-browser");
  assert.equal(unsupported.bridgeReachable, false);

  const untrusted = await probeLeetCodeBridge(async () => {
    throw errWithCode("Untrusted caller", "UNTRUSTED_CALLER");
  });
  assert.equal(untrusted.kind, "untrusted-origin");
  assert.equal(untrusted.bridgeReachable, false);

  const missing = await probeLeetCodeBridge(async () => {
    throw new Error("Could not establish connection. Receiving end does not exist.");
  });
  assert.equal(missing.kind, "extension-missing");
  assert.equal(missing.bridgeReachable, false);
  assert.equal(missing.label, "Extension not detected");
});

test("probeLeetCodeBridge detects missing extension host permissions on both 0.1.5 ping and 0.1.4 diagnostics fallback", async () => {
  const fastPerm = await probeLeetCodeBridge(async (op) => {
    if (op === "ping") {
      return {
        protocol: 1,
        version: "0.1.5",
        leetcodePermission: false,
        judgeHeaderPermission: true,
      };
    }
    throw new Error("Should not call status when ping reports missing permission");
  });
  assert.equal(fastPerm.kind, "permissions-missing");
  assert.equal(fastPerm.bridgeReachable, true);
  assert.equal(fastPerm.isSignedIn, false);

  const legacyCalls: string[] = [];
  const legacyPerm = await probeLeetCodeBridge(async (op) => {
    legacyCalls.push(op);
    if (op === "ping") return { protocol: 1 };
    if (op === "status") {
      throw new Error("LeetCode did not complete the request.");
    }
    if (op === "diagnostics") {
      return {
        version: "0.1.4",
        leetcodePermission: false,
        judgeHeaderPermission: true,
      };
    }
    throw new Error("Unexpected op: " + op);
  });
  assert.deepEqual(legacyCalls, ["ping", "status", "diagnostics"]);
  assert.equal(legacyPerm.kind, "permissions-missing");
  assert.equal(legacyPerm.version, "0.1.4");
});

test("probeLeetCodeBridge classifies verification-required, rate-limited, expired-session, and network-error", async () => {
  const verification = await probeLeetCodeBridge(async (op) => {
    if (op === "ping")
      return {
        protocol: 1,
        leetcodePermission: true,
        judgeHeaderPermission: true,
      };
    throw errWithCode(
      "LeetCode returned HTTP 403. The response is a browser-verification challenge.",
      "VERIFICATION_REQUIRED",
    );
  });
  assert.equal(verification.kind, "verification-required");
  assert.equal(verification.bridgeReachable, true);
  assert.equal(verification.externalUrl, LEETCODE_HOME_URL);

  const rateLimited = await probeLeetCodeBridge(async (op) => {
    if (op === "ping")
      return {
        protocol: 1,
        leetcodePermission: true,
        judgeHeaderPermission: true,
      };
    throw errWithCode("LeetCode returned HTTP 429.", "RATE_LIMITED");
  });
  assert.equal(rateLimited.kind, "rate-limited");
  assert.equal(rateLimited.bridgeReachable, true);

  const csrfExpired = await probeLeetCodeBridge(async (op) => {
    if (op === "ping")
      return {
        protocol: 1,
        version: "0.1.5",
        leetcodePermission: true,
        judgeHeaderPermission: true,
      };
    throw errWithCode(
      "Your LeetCode session needs refreshing.",
      "CSRF_MISSING",
    );
  });
  assert.equal(csrfExpired.kind, "signed-out");
  assert.equal(csrfExpired.externalUrl, LEETCODE_LOGIN_URL);

  const netErr = await probeLeetCodeBridge(async (op) => {
    if (op === "ping")
      return {
        protocol: 1,
        leetcodePermission: true,
        judgeHeaderPermission: true,
      };
    throw errWithCode(
      "LeetCode did not complete the request.",
      "NETWORK_ERROR",
    );
  });
  assert.equal(netErr.kind, "network-error");
  assert.equal(netErr.bridgeReachable, true);
  assert.equal(netErr.isSignedIn, false);
});

test("popupWindowFeatures centers the sign-in window and watchLeetCodeLogin auto-closes on ready", async () => {
  assert.equal(
    popupWindowFeatures({
      screenX: 100,
      screenY: 50,
      outerWidth: 1520,
      outerHeight: 900,
    }),
    "popup=yes,width=520,height=700,left=600,top=150",
  );

  let closeCount = 0;
  // Simulate a popup whose .closed turns true early due to COOP during OAuth,
  // verifying polling continues until ready and invokes close() on completion.
  const popup = {
    closed: true,
    close() {
      closeCount++;
    },
  };
  let attempts = 0;
  await new Promise<void>((resolve) => {
    watchLeetCodeLogin({
      popup,
      firstDelayMs: 5,
      intervalMs: 5,
      check: async () => {
        attempts++;
        if (attempts < 3) {
          return {
            kind: "signed-out",
            bridgeReachable: true,
            isSignedIn: false,
            label: "Bridge connected · LeetCode sign-in needed",
            detail: "Not signed in yet",
            actionLabel: "Sign in to LeetCode",
            externalUrl: LEETCODE_LOGIN_URL,
            checkedAt: Date.now(),
          };
        }
        resolve();
        return {
          kind: "ready",
          bridgeReachable: true,
          isSignedIn: true,
          username: "ldev",
          label: "Signed in as ldev",
          detail: "Bridge active",
          actionLabel: "Check connection",
          checkedAt: Date.now(),
        };
      },
    });
  });

  await new Promise((r) => setTimeout(r, 20));
  assert.equal(attempts, 3);
  assert.equal(closeCount, 1);
});

test("watchLeetCodeLogin stops immediately when cancelled or shouldStop becomes true", async () => {
  let calls = 0;
  const stop = watchLeetCodeLogin({
    popup: { closed: false, close() {} },
    firstDelayMs: 20,
    intervalMs: 10,
    check: async () => {
      calls++;
      return initialBridgeState();
    },
  });
  stop();
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(calls, 0);
});

test("isBridgeVersionAtLeast requires an explicit minimum semver and fails closed", () => {
  assert.equal(isBridgeVersionAtLeast(undefined, CPP_MIN_BRIDGE_VERSION), false);
  assert.equal(isBridgeVersionAtLeast("0.1.6", CPP_MIN_BRIDGE_VERSION), false);
  assert.equal(isBridgeVersionAtLeast("0.1.7", CPP_MIN_BRIDGE_VERSION), true);
  assert.equal(isBridgeVersionAtLeast("0.1.10", CPP_MIN_BRIDGE_VERSION), true);
  assert.equal(isBridgeVersionAtLeast("0.2.0", CPP_MIN_BRIDGE_VERSION), true);
});
