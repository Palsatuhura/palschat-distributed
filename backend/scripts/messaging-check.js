/**
 * End-to-end messaging check (Phase 3)
 *
 * Creates three throwaway users against a RUNNING server and verifies:
 *   - the history API returns the NEWEST messages and pages backwards
 *     correctly with ?before (the old code returned the OLDEST 50 forever)
 *   - sending is confirmed with an acknowledgement (success and failure)
 *   - a message reaches a participant who has NOT opened the conversation
 *     (needed for unread badges and the sidebar preview)
 *   - simultaneous "open DM" requests create exactly one conversation
 *
 * Every "must NOT happen" check follows a positive control.
 *
 * Usage (server running, DEVELOPMENT database):
 *   npm run check:messaging
 *
 * Uses 3 registrations, so for development keep RATE_LIMIT_REGISTER_MAX=50
 * in backend/.env. Test users end in @msg-check.test; remove them with
 *   db.users.deleteMany({ email: /@msg-check\.test$/ })
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
      email: `${label}.${RUN}@msg-check.test`,
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


// Like joinConversation in authz-check: the server answers with an ack.
async function sendWithAck(socket, payload) {
  try {
    return await socket.timeout(EVENT_TIMEOUT_MS).emitWithAck("send_message", payload);
  } catch {
    return { ok: false, message: "no acknowledgement from server (timed out)" };
  }
}

async function main() {
  console.log(`API:    ${API_URL}`);
  console.log(`Socket: ${SOCKET_URL}\n`);

  const alice = await registerUser("alice-m");
  const bob = await registerUser("bob-m");
  const carol = await registerUser("carol-m");

  // ── One DM per pair, even when requests race ─────────────────────────────
  console.log("Conversations");

  const racers = await Promise.all(
    Array.from({ length: 6 }, (_, i) =>
      api("POST", "/conversations", {
        token: i % 2 === 0 ? alice.token : bob.token,
        body: { participantId: i % 2 === 0 ? bob.user._id : alice.user._id },
      })
    )
  );
  const racerIds = new Set(racers.map((r) => r.data?._id));
  check(
    "6 simultaneous 'open DM' requests all succeed",
    racers.every((r) => r.status === 200 || r.status === 201),
    racers.map((r) => r.status).join(",")
  );
  check("...and they all return the SAME single conversation", racerIds.size === 1, `${racerIds.size} different conversations`);
  check("...and at most one of them reports 'created' (201)", racers.filter((r) => r.status === 201).length <= 1);

  const convId = [...racerIds][0];
  if (!convId) throw new Error("No conversation id returned; cannot continue");

  // ── Sending with acknowledgements ────────────────────────────────────────
  console.log("\nSending");

  const sa = await connectSocket(alice.token);
  const sb = await connectSocket(bob.token); // bob does NOT join the conversation room
  const sc = await connectSocket(carol.token);

  const joined = await joinConversation(sa, convId);
  check("alice can join her conversation (control)", joined.ok === true, JSON.stringify(joined));

  const sentTexts = [];
  let allAcked = true;
  let detail = "";
  for (let i = 1; i <= 12; i += 1) {
    const text = `page ${String(i).padStart(2, "0")}`;
    const ack = await sendWithAck(sa, { conversationId: convId, text });
    if (!(ack.ok === true && ack.message?._id && ack.message?.text === text)) {
      allAcked = false;
      detail = JSON.stringify(ack);
    }
    sentTexts.push(text);
  }
  check("12 messages are each acknowledged with the saved message", allAcked, detail);

  const outsider = await sendWithAck(sc, { conversationId: convId, text: "intruder" });
  check("an outsider's message is acknowledged as REJECTED", outsider.ok === false && /participant/i.test(outsider.message || ""), JSON.stringify(outsider));

  const invalid = await sendWithAck(sa, { conversationId: "not-an-id", text: "x" });
  check("an invalid message is acknowledged as rejected", invalid.ok === false, JSON.stringify(invalid));

  const tooLong = await sendWithAck(sa, { conversationId: convId, text: "x".repeat(2001) });
  check("an over-long message is acknowledged as rejected", tooLong.ok === false, JSON.stringify(tooLong));

  sa.emit("send_message", { conversationId: convId, text: "no ack requested" });
  sentTexts.push("no ack requested");
  // Wait until it has been stored and delivered, so the next message cannot
  // overtake it (they would be handled at the same time by the server).
  check("(control) a message sent without a callback is still delivered", await waitFor(() => hasMessage(sb, "no ack requested")));
  const health = await fetch(`${API_URL}/health`).then((r) => r.status).catch(() => 0);
  check("a send without an acknowledgement callback does not break the server", health === 200, `health HTTP ${health}`);

  // ── Delivery to people who have not opened the conversation ──────────────
  console.log("\nDelivery");

  const ackLast = await sendWithAck(sa, { conversationId: convId, text: "for bob's sidebar" });
  sentTexts.push("for bob's sidebar");
  check("(control) the message was accepted", ackLast.ok === true, JSON.stringify(ackLast));

  check(
    "bob receives it although he never joined the conversation room",
    await waitFor(() => hasMessage(sb, "for bob's sidebar"))
  );
  await waitFor(() => hasMessage(sa, "for bob's sidebar"));
  await sleep(GRACE_MS); // a duplicate delivery would have arrived by now
  check("alice (the sender) receives it exactly once, not twice", eventsOf(sa, "receive_message").filter((e) => e.payload?.text === "for bob's sidebar").length === 1);
  check("carol (not a participant) does NOT receive it", !hasMessage(sc, "for bob's sidebar"));

  // ── History paging ───────────────────────────────────────────────────────
  console.log("\nHistory");

  // Wait until every message is stored, since "no ack requested" is async.
  let latest = [];
  for (let i = 0; i < 20; i += 1) {
    const r = await api("GET", `/conversations/${convId}/messages?limit=100`, { token: alice.token });
    latest = Array.isArray(r.data) ? r.data : [];
    if (latest.length >= sentTexts.length) break;
    await sleep(500);
  }
  check("full history has all messages in the order they were sent", JSON.stringify(latest.map((m) => m.text)) === JSON.stringify(sentTexts), JSON.stringify(latest.map((m) => m.text)));

  const first = await api("GET", `/conversations/${convId}/messages?limit=5`, { token: alice.token });
  const firstTexts = (first.data || []).map((m) => m.text);
  check("limit=5 returns the 5 NEWEST messages, oldest of them first", JSON.stringify(firstTexts) === JSON.stringify(sentTexts.slice(-5)), JSON.stringify(firstTexts));

  // Walk backwards through the whole conversation with ?before.
  const collected = [...(first.data || [])];
  let pages = 1;
  let ok = first.status === 200;
  while (ok && collected.length < sentTexts.length && pages < 10) {
    const page = await api("GET", `/conversations/${convId}/messages?limit=5&before=${collected[0]._id}`, { token: alice.token });
    if (page.status !== 200 || !Array.isArray(page.data) || page.data.length === 0) { ok = false; break; }
    collected.unshift(...page.data);
    pages += 1;
  }
  check(
    "walking back with ?before reproduces the whole conversation, no gaps or repeats",
    ok && JSON.stringify(collected.map((m) => m.text)) === JSON.stringify(sentTexts),
    JSON.stringify(collected.map((m) => m.text))
  );

  const end = await api("GET", `/conversations/${convId}/messages?limit=5&before=${collected[0]._id}`, { token: alice.token });
  check("before the oldest message there is nothing more (empty page)", end.status === 200 && Array.isArray(end.data) && end.data.length === 0, `HTTP ${end.status} ${JSON.stringify(end.data)}`);

  const huge = await api("GET", `/conversations/${convId}/messages?limit=100000`, { token: alice.token });
  check("an enormous limit is accepted but capped (at most 100)", huge.status === 200 && huge.data.length <= 100);

  const junk = await api("GET", `/conversations/${convId}/messages?limit=abc`, { token: alice.token });
  check("a junk limit falls back to the default instead of erroring", junk.status === 200);

  const badCursor = await api("GET", `/conversations/${convId}/messages?before=nope`, { token: alice.token });
  check("a malformed ?before is rejected (400)", badCursor.status === 400, `HTTP ${badCursor.status}`);

  const injected = await api("GET", `/conversations/${convId}/messages?before[$ne]=1`, { token: alice.token });
  check("an operator-injection ?before is rejected (400)", injected.status === 400, `HTTP ${injected.status}`);

  // A real message id, but from a conversation alice-bob do not share with this one.
  const other = await api("POST", "/conversations", { token: alice.token, body: { participantId: carol.user._id } });
  const otherId = other.data?._id;
  const otherSocketJoin = await joinConversation(sa, otherId);
  const otherAck = await sendWithAck(sa, { conversationId: otherId, text: "other chat" });
  check("(control) alice posted in a second conversation", otherSocketJoin.ok === true && otherAck.ok === true);

  const foreign = await api("GET", `/conversations/${convId}/messages?before=${otherAck.message?._id}`, { token: alice.token });
  check("a message id from ANOTHER conversation is not accepted as a cursor (404)", foreign.status === 404, `HTTP ${foreign.status}`);

  const carolRead = await api("GET", `/conversations/${convId}/messages`, { token: carol.token });
  check("an outsider still cannot read the history (403)", carolRead.status === 403, `HTTP ${carolRead.status}`);

  // ── Typing and receipts (reach people who have not joined the room) ─────
  console.log("\nTyping and receipts");

  const typingFrom = (socket, userId) =>
    eventsOf(socket, "typing").filter((e) => e.payload?.userId === userId && e.payload?.conversationId === convId);

  sa.emit("typing", { conversationId: convId });
  check("bob sees alice typing without having joined the room", await waitFor(() => typingFrom(sb, alice.user._id).length === 1));
  check("...with her name", typingFrom(sb, alice.user._id)[0]?.payload?.userName === alice.user.name, JSON.stringify(typingFrom(sb, alice.user._id)[0]?.payload));

  sc.emit("typing", { conversationId: convId });
  await sleep(GRACE_MS);
  check("an outsider's typing is NOT relayed to bob", typingFrom(sb, carol.user._id).length === 0);

  sb.emit("mark_delivered", { conversationId: convId });
  check("alice is told bob's app received the messages", await waitFor(() => eventsOf(sa, "messages_delivered").some((e) => e.payload?.userId === bob.user._id && e.payload?.conversationId === convId)));

  const afterDelivery = await api("GET", `/conversations/${convId}/messages?limit=100`, { token: alice.token });
  const allDelivered = Array.isArray(afterDelivery.data) && afterDelivery.data.length > 0 && afterDelivery.data.every((m) => (m.deliveredTo || []).includes(bob.user._id));
  check("every message now lists bob in deliveredTo", allDelivered);
  check("...but none is marked read yet", afterDelivery.data.every((m) => !(m.readBy || []).includes(bob.user._id)));

  sb.emit("mark_read", { conversationId: convId });
  check("alice is told bob read the messages", await waitFor(() => eventsOf(sa, "messages_read").some((e) => e.payload?.userId === bob.user._id)));

  const afterRead = await api("GET", `/conversations/${convId}/messages?limit=100`, { token: alice.token });
  check("every message now lists bob in readBy", afterRead.data.every((m) => (m.readBy || []).includes(bob.user._id)));

  const readEvents = eventsOf(sa, "messages_read").length;
  sb.emit("mark_read", { conversationId: convId });
  sc.emit("mark_read", { conversationId: convId });
  sc.emit("mark_delivered", { conversationId: convId });
  await sleep(GRACE_MS);
  check("marking read again, or by an outsider, announces nothing new", eventsOf(sa, "messages_read").length === readEvents);
  check("an outsider cannot add themselves to deliveredTo", (await api("GET", `/conversations/${convId}/messages?limit=100`, { token: alice.token })).data.every((m) => !(m.deliveredTo || []).includes(carol.user._id)));

  for (const socket of [sa, sb, sc]) socket.close();

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
