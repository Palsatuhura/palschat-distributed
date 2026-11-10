/**
 * End-to-end hardening check (Phase 2)
 *
 * Verifies against a RUNNING server that:
 *   - security headers are set and X-Powered-By is gone
 *   - oversized and malformed request bodies get 413 / 400, not 500
 *   - login and registration validate their input (including NoSQL operator
 *     injection) and do not reveal whether an email exists
 *   - forged and wrongly-signed tokens are rejected (REST and socket)
 *   - CORS allows the configured origin and nothing else
 *   - repeated failed logins are rate limited (429 + Retry-After)
 *   - a socket that floods events is throttled, then disconnected
 *
 * Usage:
 *   1. Start the backend (npm run dev) with a DEVELOPMENT database.
 *   2. npm run check:hardening
 *
 * Optional environment variables:
 *   API_URL          default http://localhost:5000/api
 *   SOCKET_URL       default API_URL without the trailing /api
 *   ALLOWED_ORIGIN   an origin the server's CORS_ORIGINS allows
 *                    (default http://localhost:5173)
 *   SKIP_RATE_LIMIT=1  skip the login rate-limit check
 *   SKIP_SOCKET=1      skip the socket checks
 *   TOKEN_MAX_SECONDS  longest acceptable token lifetime (default 86400)
 *
 * NOTE: the rate-limit check deliberately fails logins, and failed logins
 * count against your IP address for 15 minutes. Running this script twice in
 * a row can therefore trip the per-IP limit. If that happens the script says
 * so; wait for the time it reports (or restart Redis counters) and run again.
 *
 * Test users use @authz-check.test emails. Remove them afterwards with:
 *   db.users.deleteMany({ email: /@authz-check\.test$/ })
 *
 * Do NOT run this against a production database.
 */
const crypto = require("crypto");
const http = require("http");
const https = require("https");

const API_URL = process.env.API_URL || "http://localhost:5000/api";
const SOCKET_URL = process.env.SOCKET_URL || API_URL.replace(/\/api\/?$/, "");
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "http://localhost:5173";
const EVIL_ORIGIN = "http://evil.example";
const RUN = Date.now().toString(36);

const EVENT_TIMEOUT_MS = 10000;

let failures = 0;

const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? `  -> ${detail}` : ""}`);
  if (!ok) failures += 1;
};

const skip = (name, reason) => console.log(`SKIP  ${name}  (${reason})`);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(predicate, timeoutMs = EVENT_TIMEOUT_MS, intervalMs = 50) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return true;
    await sleep(intervalMs);
  }
  return false;
}

// JSON helper built on fetch (no custom Origin header needed).
async function api(method, path, { token, body, rawBody } = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: rawBody !== undefined ? rawBody : body === undefined ? undefined : JSON.stringify(body),
  });

  let data = null;
  try {
    data = await response.json();
  } catch {
    // Non-JSON response; leave data as null.
  }

  return { status: response.status, data, headers: response.headers };
}

// Low-level request, used where the Origin header must be set explicitly
// (fetch treats Origin specially in some runtimes).
function rawRequest(method, path, headers = {}) {
  const url = new URL(`${API_URL}${path}`);
  const client = url.protocol === "https:" ? https : http;

  return new Promise((resolve, reject) => {
    const req = client.request(url, { method, headers }, (res) => {
      res.resume();
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers }));
    });
    req.on("error", reject);
    req.end();
  });
}

const b64url = (value) => Buffer.from(typeof value === "string" ? value : JSON.stringify(value)).toString("base64url");

const forgeNoneToken = (userId) => `${b64url({ alg: "none", typ: "JWT" })}.${b64url({ id: userId })}.`;

const forgeHs256Token = (userId, secret) => {
  const unsigned = `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url({ id: userId, exp: Math.floor(Date.now() / 1000) + 3600 })}`;
  const signature = crypto.createHmac("sha256", secret).update(unsigned).digest("base64url");
  return `${unsigned}.${signature}`;
};

async function registerUser(label) {
  const { status, data } = await api("POST", "/auth/register", {
    body: {
      name: `${label} ${RUN}`,
      email: `${label}.${RUN}@authz-check.test`,
      password: "Passw0rd!check",
    },
  });

  if (status === 429) {
    throw new Error("Registration is rate limited (too many accounts from this IP in the last hour). Wait, or raise RATE_LIMIT_REGISTER_MAX for development.");
  }
  if (status !== 201) {
    throw new Error(`Could not register ${label}: HTTP ${status} ${JSON.stringify(data)}`);
  }

  return { token: data.token, user: data.user, email: `${label}.${RUN}@authz-check.test` };
}

async function main() {
  console.log(`API:    ${API_URL}`);
  console.log(`Socket: ${SOCKET_URL}`);
  console.log(`Origin: ${ALLOWED_ORIGIN}\n`);

  const alice = await registerUser("alice-h");
  const bob = await registerUser("bob-h");

  // ── Headers ──────────────────────────────────────────────────────────────
  console.log("Headers");

  const health = await api("GET", "/health");
  check("health endpoint responds 200", health.status === 200, `HTTP ${health.status}`);
  check("X-Content-Type-Options: nosniff is set", health.headers.get("x-content-type-options") === "nosniff");
  check("X-Powered-By is not disclosed", health.headers.get("x-powered-by") === null);
  check("Strict-Transport-Security is set", health.headers.get("strict-transport-security") !== null);

  // ── Request bodies ───────────────────────────────────────────────────────
  console.log("\nRequest bodies");

  const oversized = await api("POST", "/auth/login", {
    body: { email: "a@b.co", password: "x".repeat(200 * 1024) },
  });
  check("200 KB body is rejected with 413", oversized.status === 413, `HTTP ${oversized.status}`);

  const malformed = await api("POST", "/auth/login", { rawBody: '{"email": ' });
  check("malformed JSON is a 400, not a 500", malformed.status === 400, `HTTP ${malformed.status}`);

  // ── Input validation ─────────────────────────────────────────────────────
  console.log("\nInput validation");

  const good = { name: "Validation Test", email: `v.${RUN}@authz-check.test`, password: "Passw0rd!check" };
  const bad = (label, overrides, expected = 400) =>
    api("POST", "/auth/register", { body: { ...good, ...overrides } }).then((r) =>
      check(label, r.status === expected, `HTTP ${r.status} ${JSON.stringify(r.data)}`)
    );

  await bad("register: 7-character password is rejected", { password: "Short1!" });
  await bad("register: password over 72 bytes is rejected", { password: "a".repeat(73) });
  await bad("register: numeric password is rejected", { password: 12345678 });
  await bad("register: invalid email is rejected", { email: "not-an-email" });
  await bad("register: object as email is rejected", { email: { $ne: null } });
  await bad("register: object as name is rejected", { name: { $gt: "" } });

  const injection = await api("POST", "/auth/login", { body: { email: { $ne: null }, password: "anything1" } });
  check("login: operator-injection email is rejected (400)", injection.status === 400, `HTTP ${injection.status}`);

  const passwordInjection = await api("POST", "/auth/login", { body: { email: alice.email, password: { $ne: null } } });
  check("login: operator-injection password is rejected (400)", passwordInjection.status === 400, `HTTP ${passwordInjection.status}`);

  const wrongPassword = await api("POST", "/auth/login", { body: { email: alice.email, password: "wrong-password-1" } });
  const unknownEmail = await api("POST", "/auth/login", { body: { email: `nobody.${RUN}@authz-check.test`, password: "wrong-password-1" } });

  for (const attempt of [wrongPassword, unknownEmail]) {
    if (attempt.status === 429) {
      throw new Error(`Your IP is already rate limited (probably from a previous run). Retry-After: ${attempt.headers.get("retry-after")}s.`);
    }
  }

  check(
    "login: wrong password and unknown email look identical (401, same message)",
    wrongPassword.status === 401 && unknownEmail.status === 401 && wrongPassword.data?.message === unknownEmail.data?.message,
    `${wrongPassword.status}/${unknownEmail.status}`
  );

  // ── Tokens ───────────────────────────────────────────────────────────────
  console.log("\nTokens");

  const validToken = await api("GET", "/users", { token: alice.token });
  check("a real token is accepted (control)", validToken.status === 200, `HTTP ${validToken.status}`);

  // Login tokens are short-lived (default 24h). Raise TOKEN_MAX_SECONDS if you
  // set a longer JWT_EXPIRES_IN on purpose.
  const tokenMaxSeconds = Number(process.env.TOKEN_MAX_SECONDS) || 24 * 60 * 60;
  let lifetime = null;
  try {
    const claims = JSON.parse(Buffer.from(alice.token.split(".")[1], "base64url").toString());
    lifetime = claims.exp - claims.iat;
  } catch {
    // leave lifetime as null: reported below
  }
  check(
    `login token expires within ${tokenMaxSeconds}s (this one: ${lifetime}s)`,
    Number.isFinite(lifetime) && lifetime > 0 && lifetime <= tokenMaxSeconds,
    "token has no readable exp/iat, or JWT_EXPIRES_IN is longer than TOKEN_MAX_SECONDS"
  );

  const noneToken = await api("GET", "/users", { token: forgeNoneToken(alice.user._id) });
  check('forged token with alg "none" is rejected (401)', noneToken.status === 401, `HTTP ${noneToken.status}`);

  const wrongSecret = await api("GET", "/users", {
    token: forgeHs256Token(alice.user._id, "a-completely-different-secret-value-0123456789"),
  });
  check("token signed with the wrong secret is rejected (401)", wrongSecret.status === 401, `HTTP ${wrongSecret.status}`);

  const garbage = await api("GET", "/users", { token: "not.a.jwt" });
  check("garbage token is rejected (401)", garbage.status === 401, `HTTP ${garbage.status}`);

  // ── CORS ─────────────────────────────────────────────────────────────────
  console.log("\nCORS");

  const preflight = (origin) =>
    rawRequest("OPTIONS", "/users", {
      Origin: origin,
      "Access-Control-Request-Method": "GET",
      "Access-Control-Request-Headers": "authorization",
    });

  const allowed = await preflight(ALLOWED_ORIGIN);
  check(
    `allowed origin (${ALLOWED_ORIGIN}) is echoed back`,
    allowed.headers["access-control-allow-origin"] === ALLOWED_ORIGIN,
    `got ${allowed.headers["access-control-allow-origin"]} (set ALLOWED_ORIGIN if you changed CORS_ORIGINS)`
  );

  const evil = await preflight(EVIL_ORIGIN);
  check("unlisted origin gets no Access-Control-Allow-Origin", !evil.headers["access-control-allow-origin"]);

  // ── Sockets ──────────────────────────────────────────────────────────────
  if (process.env.SKIP_SOCKET === "1") {
    skip("socket checks", "SKIP_SOCKET=1");
  } else {
    await socketChecks(alice, bob);
  }

  // ── Rate limiting (last: it burns this IP's failed-login budget) ─────────
  console.log("\nRate limiting");

  if (process.env.SKIP_RATE_LIMIT === "1") {
    skip("login rate limit", "SKIP_RATE_LIMIT=1");
  } else {
    const victim = `ratelimit.${RUN}@authz-check.test`;
    const statuses = [];
    let retryAfter = null;

    for (let i = 0; i < 12; i += 1) {
      const attempt = await api("POST", "/auth/login", { body: { email: victim, password: "wrong-password-1" } });
      statuses.push(attempt.status);
      if (attempt.status === 429) {
        retryAfter = attempt.headers.get("retry-after");
        break;
      }
    }

    const firstBlocked = statuses.indexOf(429);
    check(
      "repeated failed logins for one account end in 429",
      firstBlocked > 0,
      `statuses: ${statuses.join(",")}`
    );
    check(
      "the first attempts are answered normally (401) before blocking starts",
      firstBlocked > 0 && statuses.slice(0, firstBlocked).every((s) => s === 401),
      `statuses: ${statuses.join(",")}`
    );
    check("the 429 carries a Retry-After header", Number(retryAfter) >= 1, `Retry-After: ${retryAfter}`);

    const unaffected = await api("POST", "/auth/login", { body: { email: alice.email, password: "Passw0rd!check" } });
    check("a different account can still log in while one is blocked (control)", unaffected.status === 200, `HTTP ${unaffected.status}`);
  }

  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

async function socketChecks(alice, bob) {
  console.log("\nSockets");

  const { io } = require("socket.io-client");

  const connect = (token, options = {}) =>
    new Promise((resolve, reject) => {
      const socket = io(SOCKET_URL, {
        auth: token === undefined ? {} : { token },
        transports: ["websocket"],
        reconnection: false,
        ...options,
      });

      socket.errors = [];
      socket.on("error", (payload) => socket.errors.push(payload));
      socket.once("connect", () => resolve(socket));
      socket.once("connect_error", reject);
    });

  const rejected = (token) =>
    connect(token).then(
      (socket) => { socket.close(); return false; },
      () => true
    );

  check("socket without a token is refused", await rejected(undefined));
  check('socket with a forged alg "none" token is refused', await rejected(forgeNoneToken(alice.user._id)));
  check(
    "socket with a wrongly-signed token is refused",
    await rejected(forgeHs256Token(alice.user._id, "a-completely-different-secret-value-0123456789"))
  );

  // A conversation to post into.
  const dm = await api("POST", "/conversations", { token: alice.token, body: { participantId: bob.user._id } });
  const convId = dm.data?._id;
  if (!convId) throw new Error(`Could not create a conversation: HTTP ${dm.status}`);

  // ── message budget ───────────────────────────────────────────────────────
  const sender = await connect(alice.token);
  const join = await sender.timeout(EVENT_TIMEOUT_MS).emitWithAck("join_conversation", convId).catch(() => ({ ok: false }));
  check("participant can join (control)", join.ok === true);

  for (let i = 0; i < 40; i += 1) {
    sender.emit("send_message", { conversationId: convId, text: `flood ${i}` });
  }

  const warned = await waitFor(() => sender.errors.some((e) => /too many/i.test(e?.message || "")));
  check("a burst of 40 messages triggers a 'too many requests' warning", warned);

  await sleep(1500); // let the server finish persisting what it accepted
  const history = await api("GET", `/conversations/${convId}/messages`, { token: alice.token });
  const stored = Array.isArray(history.data) ? history.data.filter((m) => /^flood \d+$/.test(m.text)).length : -1;
  check("some of the burst was stored (control)", stored > 0, `stored ${stored}`);
  check("no more than 20 of the 40 messages were accepted", stored >= 0 && stored <= 20, `stored ${stored}`);

  sender.close();

  // ── flood disconnect ─────────────────────────────────────────────────────
  const flooder = await connect(alice.token);
  let disconnectReason = null;
  flooder.on("disconnect", (reason) => { disconnectReason = reason; });

  for (let i = 0; i < 800; i += 1) {
    flooder.emit("typing", { conversationId: convId });
  }

  const disconnected = await waitFor(() => disconnectReason !== null);
  check("a socket flooding 800 events is disconnected by the server", disconnected && disconnectReason === "io server disconnect", `reason: ${disconnectReason}`);

  flooder.close();

  // ── oversized payload ────────────────────────────────────────────────────
  const big = await connect(alice.token);
  let bigReason = null;
  big.on("disconnect", (reason) => { bigReason = reason; });
  big.emit("send_message", { conversationId: convId, text: "x".repeat(300 * 1024) });

  check("a 300 KB event closes the connection", await waitFor(() => bigReason !== null), "connection stayed open");
  big.close();
}

main().catch((error) => {
  console.error(`\nScript error: ${error.message}`);
  if (error.cause?.code === "ECONNREFUSED") {
    console.error("Is the backend running? Start it with: npm run dev");
  }
  process.exit(2);
});
