/**
 * Redis connection check: how far away is your Redis, and does the rate
 * limiter's one-step counter work against the REAL server?
 *
 *   npm run check:redis
 *
 * It reads REDIS_URL from backend/.env and prints only timings and results,
 * never the address or password. It uses one temporary key and deletes it.
 */
require("dotenv").config();

const { createClient } = require("redis");
const { RedisStore } = require("../src/middleware/rateLimiter");

const ok = (label, pass, detail = "") => {
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}${detail ? `  -> ${detail}` : ""}`);
  if (!pass) process.exitCode = 1;
};

async function main() {
  if (!process.env.REDIS_URL) {
    console.error("REDIS_URL is not set in backend/.env");
    process.exit(2);
  }

  const client = createClient({ url: process.env.REDIS_URL, socket: { connectTimeout: 10000 } });
  client.on("error", () => {}); // reported by the checks below

  const started = Date.now();
  await client.connect();
  console.log(`Connected in ${Date.now() - started} ms\n`);

  // Round-trip time: one small command, five times.
  const times = [];
  for (let i = 0; i < 5; i += 1) {
    const t = Date.now();
    await client.ping();
    times.push(Date.now() - t);
  }
  const typical = [...times].sort((a, b) => a - b)[2];
  console.log(`PING times (ms): ${times.join(", ")}   typical: ${typical} ms`);
  ok("round trip under 150 ms (Redis is close to this machine)", typical < 150, `${typical} ms`);
  if (typical >= 150) {
    console.log("      A slow round trip makes every request and presence update slower.");
    console.log("      Create the Redis database in the region nearest to where the SERVER runs.\n");
  }

  // The limiter's counter, against the real server.
  const store = new RedisStore(client, { timeoutMs: 10000 });
  const key = `rl:check-redis:${Date.now()}`;

  const first = await store.increment(key, 30000);
  const second = await store.increment(key, 30000);
  ok("first hit counts 1", first.count === 1, JSON.stringify(first));
  ok("second hit counts 2", second.count === 2, JSON.stringify(second));
  ok("the counter expires on its own (about 30 s)", second.resetMs > 0 && second.resetMs <= 30000, `${second.resetMs} ms`);

  const t = Date.now();
  await store.increment(key, 30000);
  console.log(`One limiter step took ${Date.now() - t} ms (should be about one round trip)`);

  await client.del(key);
  await client.quit();

  console.log(process.exitCode ? "\nSome checks FAILED." : "\nAll checks passed.");
}

main().catch((error) => {
  console.error(`\nScript error: ${error.message}`);
  process.exit(2);
});
