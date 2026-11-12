/**
 * End-to-end presence check (Phase 4)
 *
 * Creates two throwaway users against a RUNNING server and verifies the
 * green "online" dots behave:
 *   - others are told when a user comes online and goes offline
 *   - a page refresh (disconnect + quick reconnect) does NOT flicker offline
 *   - a user with two tabs stays online until the LAST one closes
 *   - a freshly connected client is told who is online
 *
 * It waits for the real grace period (PRESENCE_GRACE_MS, default 3 s), so the
 * run takes about 20 seconds.
 *
 * Usage (server running, DEVELOPMENT database):
 *   npm run check:presence
 *
 * Uses 2 registrations (keep RATE_LIMIT_REGISTER_MAX=50 in backend/.env).
 * Test users end in @presence-check.test.
 *
 * Do NOT run this against a production database.
 */
const { io } = require("socket.io-client");

const API_URL = process.env.API_URL || "http://localhost:5000/api";
const SOCKET_URL = process.env.SOCKET_URL || API_URL.replace(/\/api\/?$/, "");
const RUN = Date.now().toString(36);

// Remote databases can be slow; be generous so slowness is not a false FAIL.
const EVENT_TIMEOUT_MS = 10000;
// After a positive control succeeded, wait this long so that a leaked event
// (which would travel the same path) has had time to arrive.
const GRACE_MS = 600;

let failures = 0;

const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? `  -> ${detail}` : ""}`);
  if (!ok) failures += 1;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(predicate, timeoutMs = EVENT_TIMEOUT_MS, intervalMs = 50) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return true;
    await sleep(intervalMs);
  }
  return false;
}

async function api(method, path, { token, body } = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  let data = null;
  try {
    data = await response.json();
  } catch {
    // Non-JSON response; leave data as null.
  }

  return { status: response.status, data };
}

async function registerUser(label) {
  const { status, data } = await api("POST", "/auth/register", {
    body: {
      name: `${label} ${RUN}`,
      email: `${label}.${RUN}@presence-check.test`,
      password: "Passw0rd!check",
    },
  });

  if (status !== 201) {
    throw new Error(`Could not register ${label}: HTTP ${status} ${JSON.stringify(data)}`);
  }

  return { token: data.token, user: data.user };
}

function connectSocket(token) {
  return new Promise((resolve, reject) => {
    const socket = io(SOCKET_URL, {
      auth: { token },
      transports: ["websocket"],
      reconnection: false,
    });

    socket.received = [];
    socket.errors = [];

    socket.onAny((event, payload) => socket.received.push({ event, payload }));
    socket.on("error", (payload) => socket.errors.push(payload));

    socket.once("connect", () => resolve(socket));
    socket.once("connect_error", reject);
  });
}

// join_conversation acknowledges with { ok, message }. A missing ack means the
// server dropped or ignored the event, which is reported as a failure.
async function joinConversation(socket, conversationId) {
  try {
    return await socket.timeout(EVENT_TIMEOUT_MS).emitWithAck("join_conversation", conversationId);
  } catch {
    return { ok: false, message: "no acknowledgement from server (timed out)" };
  }
}

const eventsOf = (socket, event) => socket.received.filter((entry) => entry.event === event);
const hasMessage = (socket, text) =>
  eventsOf(socket, "receive_message").some((e) => e.payload?.text === text);



const eventsFor = (socket, event, userId) =>
  eventsOf(socket, event).filter((e) => e.payload?.userId === userId);

async function main() {
  console.log(`API:    ${API_URL}`);
  console.log(`Socket: ${SOCKET_URL}\n`);

  const alice = await registerUser("alice-p");
  const bob = await registerUser("bob-p");
  const aliceId = alice.user._id;

  // Bob watches. His own connection is the positive control for everything.
  const sb = await connectSocket(bob.token);
  check("bob connects and is told who is online", await waitFor(() => eventsOf(sb, "online_users").length > 0));

  console.log("\nComing online");
  let sa = await connectSocket(alice.token);
  check("bob is told when alice comes online", await waitFor(() => eventsFor(sb, "user_online", aliceId).length === 1));
  check("alice is told bob is already online", await waitFor(() => (eventsOf(sa, "online_users")[0]?.payload || []).includes(bob.user._id)));

  console.log("\nTwo tabs");
  const sa2 = await connectSocket(alice.token);
  await waitFor(() => eventsOf(sa2, "online_users").length > 0);
  await sleep(GRACE_MS);
  check("a second tab does not announce 'online' again", eventsFor(sb, "user_online", aliceId).length === 1);

  sa.close();
  await sleep(5000); // longer than the grace period
  check("closing ONE of two tabs keeps alice online", eventsFor(sb, "user_offline", aliceId).length === 0);

  console.log("\nPage refresh");
  sa2.close();
  await sleep(300);
  const sa3 = await connectSocket(alice.token); // reconnects well inside the grace period
  await sleep(6000);
  check("a quick reconnect does NOT announce alice offline (no flicker)", eventsFor(sb, "user_offline", aliceId).length === 0);
  check("...and does not announce her online a second time", eventsFor(sb, "user_online", aliceId).length === 1);

  console.log("\nGoing offline");
  const closedAt = Date.now();
  sa3.close();
  check("bob is told when alice really leaves", await waitFor(() => eventsFor(sb, "user_offline", aliceId).length === 1, 15000));
  const delay = Date.now() - closedAt;
  check("...after a short grace period, not instantly", delay >= 1000, `${delay} ms`);
  const offline = eventsFor(sb, "user_offline", aliceId)[0];
  check("...with a last-seen time", Boolean(offline?.payload?.lastSeen), JSON.stringify(offline?.payload));

  await sleep(GRACE_MS);
  check("alice is announced offline only once", eventsFor(sb, "user_offline", aliceId).length === 1);

  console.log("\nComing back");
  const sa4 = await connectSocket(alice.token);
  check("bob is told when alice returns", await waitFor(() => eventsFor(sb, "user_online", aliceId).length === 2));

  for (const socket of [sb, sa4]) socket.close();

  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(`\nScript error: ${error.message}`);
  if (error.cause?.code === "ECONNREFUSED") {
    console.error("Is the backend running? Start it with: npm run dev");
  }
  process.exit(2);
});
