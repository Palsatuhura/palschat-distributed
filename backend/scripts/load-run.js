/**
 * Load test + retry check against a RUNNING server.
 *
 * 1. Retry check: sending the same message twice with the same clientId must
 *    save it only once.
 * 2. Load: USERS people (in pairs) each send MESSAGES messages. It measures
 *    how long the server takes to confirm each message, whether every
 *    message reaches the other person, and messages per second.
 * 3. Clean up: the test accounts are deleted afterwards.
 *
 * Usage (development database only!):
 *   cd backend
 *   API_URL=http://localhost:5000/api USERS=20 MESSAGES=30 npm run load-test
 *
 * Settings:
 *   API_URL     address of the API           (default http://localhost:5000/api)
 *   USERS       number of people, even       (default 20)
 *   MESSAGES    messages each person sends   (default 30)
 *   GAP_MS      pause between one person's messages (default 800; the server
 *               allows 20 messages per 10 seconds per connection)
 *
 * The server's register limit must be higher than USERS, e.g. put
 *   RATE_LIMIT_REGISTER_MAX=500
 * in backend/.env while testing. Do NOT run this against production.
 */
const { io } = require("socket.io-client");

const API_URL = process.env.API_URL || "http://localhost:5000/api";
const SOCKET_URL = process.env.SOCKET_URL || API_URL.replace(/\/api\/?$/, "");
const USERS = Math.max(2, Math.floor(Number(process.env.USERS || 20) / 2) * 2);
const MESSAGES = Math.max(1, Number(process.env.MESSAGES || 30));
const GAP_MS = Math.max(100, Number(process.env.GAP_MS || 800));
const RUN = Date.now().toString(36);
const PASSWORD = "Passw0rd!load";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(method, path, { token, body } = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = null;
  try {
    data = await response.json();
  } catch {
    /* not JSON */
  }
  return { status: response.status, data };
}

const connect = (token) =>
  new Promise((resolve, reject) => {
    const socket = io(SOCKET_URL, { transports: ["websocket"], auth: { token }, reconnection: false });
    socket.once("connect", () => resolve(socket));
    socket.once("connect_error", (e) => reject(new Error(`socket: ${e.message}`)));
    setTimeout(() => reject(new Error("socket connect timeout")), 15000);
  });

const send = (socket, payload, timeoutMs = 15000) =>
  new Promise((resolve) => {
    const start = performance.now();
    socket.timeout(timeoutMs).emit("send_message", payload, (err, res) => {
      resolve({ ms: performance.now() - start, ok: !err && res?.ok, res, err });
    });
  });

const percentile = (sorted, p) =>
  sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] : 0;

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? `  -> ${detail}` : ""}`);
  if (!ok) failures += 1;
};

async function main() {
  console.log(`Server: ${API_URL}   people: ${USERS}   messages each: ${MESSAGES}\n`);

  // ── set up people and chats ───────────────────────────────────────────
  const people = [];
  for (let i = 0; i < USERS; i += 1) {
    const email = `load${i}.${RUN}@load-test.test`;
    const { status, data } = await api("POST", "/auth/register", {
      body: { name: `Load ${i}`, email, password: PASSWORD, gender: "unspecified" },
    });
    if (status !== 201) throw new Error(`register failed (${status}): ${data?.message}. Is RATE_LIMIT_REGISTER_MAX high enough?`);
    people.push({ id: data.user._id, token: data.token, email });
  }
  console.log(`Created ${people.length} test accounts.`);

  const pairs = [];
  for (let i = 0; i < USERS; i += 2) {
    const a = people[i];
    const b = people[i + 1];
    const { status, data } = await api("POST", "/conversations", { token: a.token, body: { participantId: b.id } });
    if (![200, 201].includes(status)) throw new Error(`could not open a chat (${status}): ${data?.message}`);
    pairs.push({ a, b, conversationId: data._id });
  }

  for (const p of people) p.socket = await connect(p.token);
  console.log(`Connected ${people.length} sockets.\n`);

  // ── 1. retry check ────────────────────────────────────────────────────
  const first = pairs[0];
  const label = `retry-${RUN}-0001`;
  const one = await send(first.a.socket, { conversationId: first.conversationId, text: "retry check", clientId: label });
  const two = await send(first.a.socket, { conversationId: first.conversationId, text: "retry check", clientId: label });
  check("first send is confirmed", one.ok, JSON.stringify(one.res));
  check("sending again with the same label is confirmed too", two.ok, JSON.stringify(two.res));
  check(
    "...and returns the SAME message (no duplicate)",
    one.ok && two.ok && one.res.message._id === two.res.message._id
  );
  const history = await api("GET", `/conversations/${first.conversationId}/messages`, { token: first.a.token });
  const copies = (history.data || []).filter((m) => m.text === "retry check").length;
  check("the chat holds exactly one copy", copies === 1, `copies: ${copies}`);

  // ── 2. load ───────────────────────────────────────────────────────────
  const expectedFor = new Map(); // person id -> messages they should receive
  const receivedBy = new Map();
  for (const p of people) {
    receivedBy.set(p.id, new Set());
    p.socket.on("receive_message", (m) => {
      if (String(m.sender?._id ?? m.sender) !== p.id && String(m.text).startsWith("load-")) {
        receivedBy.get(p.id).add(String(m._id));
      }
    });
  }

  const latencies = [];
  let failedSends = 0;
  const started = performance.now();

  await Promise.all(
    people.map(async (p, i) => {
      const pair = pairs[Math.floor(i / 2)];
      const peer = i % 2 === 0 ? pair.b : pair.a;
      expectedFor.set(peer.id, (expectedFor.get(peer.id) || 0) + MESSAGES);
      await sleep((i % 10) * 50); // spread the starts a little
      for (let n = 0; n < MESSAGES; n += 1) {
        const r = await send(p.socket, {
          conversationId: pair.conversationId,
          text: `load-${i}-${n}`,
          clientId: `load-${RUN}-${i}-${n}`,
        });
        if (r.ok) latencies.push(r.ms);
        else failedSends += 1;
        await sleep(GAP_MS);
      }
    })
  );

  const seconds = (performance.now() - started) / 1000;
  await sleep(2000); // let the last deliveries arrive

  const sent = latencies.length;
  const total = USERS * MESSAGES;
  let delivered = 0;
  let expected = 0;
  for (const p of people) {
    delivered += receivedBy.get(p.id).size;
    expected += expectedFor.get(p.id) || 0;
  }
  latencies.sort((x, y) => x - y);

  console.log("\n── Load results ─────────────────────────────");
  console.log(`Messages attempted:   ${total}`);
  console.log(`Confirmed by server:  ${sent}   failed: ${failedSends}`);
  console.log(`Delivered to peers:   ${delivered} of ${expected}`);
  console.log(`Time taken:           ${seconds.toFixed(1)} s   (${(sent / seconds).toFixed(1)} messages/s)`);
  console.log(
    `Confirmation time:    median ${percentile(latencies, 50).toFixed(0)} ms, ` +
      `95% under ${percentile(latencies, 95).toFixed(0)} ms, slowest ${(latencies[latencies.length - 1] || 0).toFixed(0)} ms`
  );
  check("every message was confirmed", failedSends === 0, `${failedSends} failed`);
  check("every message reached the other person", delivered === expected, `${delivered}/${expected}`);

  // ── 3. clean up ───────────────────────────────────────────────────────
  for (const p of people) p.socket.disconnect();
  let removed = 0;
  for (const p of people) {
    const r = await api("DELETE", "/users/me", { token: p.token, body: { password: PASSWORD, confirm: "DELETE" } });
    if (r.status === 200) removed += 1;
  }
  console.log(`\nRemoved ${removed} of ${people.length} test accounts.`);
  console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll checks passed");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error("\nLoad test stopped:", e.message);
  process.exit(1);
});
