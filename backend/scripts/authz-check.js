/**
 * End-to-end authorization check (Phase 1)
 *
 * Creates three throwaway users (alice, bob, mallory) against a RUNNING
 * server and verifies that an outsider (mallory) cannot read, join, post to
 * or spy on a conversation that only alice and bob belong to, and that
 * malformed input is rejected instead of crashing the server.
 *
 * Every "must NOT happen" check is paired with a positive control (something
 * that MUST happen first), so a check cannot pass just because the server was
 * slow or silent.
 *
 * Usage:
 *   1. Start the backend (npm run dev) with a DEVELOPMENT database.
 *   2. npm install            (socket.io-client is a devDependency)
 *   3. npm run check:authz
 *
 * Optional environment variables:
 *   API_URL     default http://localhost:5000/api
 *   SOCKET_URL  default API_URL without the trailing /api
 *
 * Test users use @authz-check.test emails. Remove them afterwards with:
 *   db.users.deleteMany({ email: /@authz-check\.test$/ })
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
      email: `${label}.${RUN}@authz-check.test`,
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

async function main() {
  console.log(`API:    ${API_URL}`);
  console.log(`Socket: ${SOCKET_URL}\n`);

  const alice = await registerUser("alice");
  const bob = await registerUser("bob");
  const mallory = await registerUser("mallory");

  // ── REST: creation, privacy and validation ───────────────────────────────
  console.log("REST checks");

  const dm = await api("POST", "/conversations", {
    token: alice.token,
    body: { participantId: bob.user._id },
  });
  check("alice can create a DM with bob", dm.status === 201 || dm.status === 200, `HTTP ${dm.status}`);
  const convId = dm.data?._id;
  if (!convId) throw new Error("No conversation id returned; cannot continue");

  const users = await api("GET", "/users", { token: mallory.token });
  check(
    "GET /users does not expose email addresses",
    Array.isArray(users.data) && users.data.length > 0 && users.data.every((u) => !("email" in u))
  );

  check(
    "conversation participants do not expose email addresses",
    Array.isArray(dm.data.participants) && dm.data.participants.every((p) => !("email" in p))
  );

  const outsiderHistory = await api("GET", `/conversations/${convId}/messages`, {
    token: mallory.token,
  });
  check("outsider cannot read history over REST (403)", outsiderHistory.status === 403, `HTTP ${outsiderHistory.status}`);

  const badId = await api("GET", "/conversations/not-an-id/messages", { token: alice.token });
  check("malformed conversation id returns 400", badId.status === 400, `HTTP ${badId.status}`);

  const selfDm = await api("POST", "/conversations", {
    token: alice.token,
    body: { participantId: alice.user._id },
  });
  check("DM with yourself is rejected (400)", selfDm.status === 400, `HTTP ${selfDm.status}`);

  const ghostDm = await api("POST", "/conversations", {
    token: alice.token,
    body: { participantId: "0".repeat(24) },
  });
  check("DM with a non-existent user is rejected (404)", ghostDm.status === 404, `HTTP ${ghostDm.status}`);

  const injectedDm = await api("POST", "/conversations", {
    token: alice.token,
    body: { participantId: { $ne: null } },
  });
  check("operator-injection in participantId is rejected (400)", injectedDm.status === 400, `HTTP ${injectedDm.status}`);

  const bogusGroup = await api("POST", "/conversations", {
    token: alice.token,
    body: {
      isGroup: true,
      groupName: "bogus",
      participantIds: ["0".repeat(24), "1".repeat(24)],
    },
  });
  check("group with non-existent members is rejected (400)", bogusGroup.status === 400, `HTTP ${bogusGroup.status}`);

  const group = await api("POST", "/conversations", {
    token: alice.token,
    body: {
      isGroup: true,
      groupName: "Authz group",
      participantIds: [bob.user._id, bob.user._id, mallory.user._id, alice.user._id],
    },
  });
  check(
    "group de-duplicates members and does not double-add the creator",
    group.status === 201 && group.data?.participants?.length === 3,
    `HTTP ${group.status}, participants=${group.data?.participants?.length}`
  );

  // ── Socket: authorization ────────────────────────────────────────────────
  console.log("\nSocket checks");

  const sa = await connectSocket(alice.token);
  const sb = await connectSocket(bob.token);
  const sm = await connectSocket(mallory.token);

  // Sent immediately after "connect" on purpose: the server must already be
  // listening (see the note in socketHandler.js about handler registration).
  const [joinA, joinB, joinM] = await Promise.all([
    joinConversation(sa, convId),
    joinConversation(sb, convId),
    joinConversation(sm, convId),
  ]);

  check("alice can join her conversation", joinA.ok === true, joinA.message);
  check("bob can join his conversation", joinB.ok === true, joinB.message);
  check(
    "outsider's join is explicitly denied",
    joinM.ok === false && /participant/i.test(joinM.message || ""),
    JSON.stringify(joinM)
  );
  check(
    "outsider's join also raises an error event",
    await waitFor(() => sm.errors.length >= 1, 3000)
  );

  // Message flow. bob receiving it is the positive control for the checks below.
  sa.emit("send_message", { conversationId: convId, text: "hello from alice" });
  const bobGotIt = await waitFor(() => hasMessage(sb, "hello from alice"));
  check("bob receives alice's message", bobGotIt);

  await sleep(GRACE_MS);
  check(
    "mallory does NOT receive alice's message",
    bobGotIt && !hasMessage(sm, "hello from alice"),
    bobGotIt ? "mallory received it" : "inconclusive: bob never received it"
  );

  const errorsBefore = sm.errors.length;
  sm.emit("send_message", { conversationId: convId, text: "injected by mallory" });
  check(
    "outsider's send_message is rejected with an error event",
    await waitFor(() => sm.errors.length > errorsBefore)
  );

  await sleep(GRACE_MS);
  check(
    "participants never receive the outsider's message",
    !hasMessage(sa, "injected by mallory") && !hasMessage(sb, "injected by mallory")
  );

  const history = await api("GET", `/conversations/${convId}/messages`, { token: alice.token });
  check(
    "history contains alice's message but not the outsider's",
    Array.isArray(history.data) &&
      history.data.some((m) => m.text === "hello from alice") &&
      !history.data.some((m) => m.text === "injected by mallory")
  );

  // Typing. Events are handled in arrival order, so if mallory's typing were
  // relayed, bob would see it before alice's.
  sm.emit("typing", { conversationId: convId });
  sa.emit("typing", { conversationId: convId });
  const aliceTypingRelayed = await waitFor(() =>
    eventsOf(sb, "typing").some((e) => e.payload?.userId === alice.user._id)
  );
  check("participant's typing event is relayed to bob", aliceTypingRelayed);

  await sleep(GRACE_MS);
  check(
    "outsider's typing event is not relayed",
    aliceTypingRelayed && eventsOf(sb, "typing").every((e) => e.payload?.userId === alice.user._id)
  );

  // ── Robustness: malformed payloads must not crash the server ────────────
  console.log("\nRobustness checks");

  const events = ["join_conversation", "leave_conversation", "send_message", "typing", "stop_typing", "mark_read"];
  const badPayloads = [undefined, null, 5, "x", {}, { conversationId: { $ne: null } }, { conversationId: convId, text: { a: 1 } }];

  for (const event of events) {
    sm.emit(event); // no argument at all
    for (const payload of badPayloads) sm.emit(event, payload);
  }
  sm.emit("send_message", { conversationId: convId, text: "x".repeat(2001) });

  // Positive control: after the barrage the server must still process and
  // deliver a legitimate message.
  await sleep(GRACE_MS);
  sa.emit("send_message", { conversationId: convId, text: "still alive" });
  check(
    "server still delivers messages after malformed events",
    await waitFor(() => hasMessage(sb, "still alive"))
  );

  const health = await fetch(`${API_URL}/health`).then((r) => r.status).catch(() => 0);
  check("health endpoint still responds after malformed events", health === 200, `health HTTP ${health}`);

  for (const socket of [sa, sb, sm]) socket.close();

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
