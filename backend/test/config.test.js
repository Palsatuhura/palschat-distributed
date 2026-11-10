const test = require("node:test");
const assert = require("node:assert/strict");

const { validateEnv } = require("../src/config/env");
const { parseOrigins, DEFAULT_ORIGINS } = require("../src/config/cors");

const GOOD = {
  JWT_SECRET: "k3J9xQ2vL8mZ5pR7tY1wB4nC6dF0gH3sA9uE2iO5",
  MONGO_URI: "mongodb+srv://user:pass@cluster.example.net/db",
  REDIS_URL: "rediss://default:pass@host.upstash.io:6379",
};

test("validateEnv accepts a complete, strong configuration", () => {
  assert.deepEqual(validateEnv(GOOD), { errors: [], warnings: [] });
});

test("validateEnv requires JWT_SECRET, MONGO_URI and REDIS_URL", () => {
  const { errors } = validateEnv({});
  assert.equal(errors.length, 3);
  assert.ok(errors.some((e) => e.includes("JWT_SECRET")));
  assert.ok(errors.some((e) => e.includes("MONGO_URI")));
  assert.ok(errors.some((e) => e.includes("REDIS_URL")));
});

test("validateEnv rejects short and placeholder secrets", () => {
  assert.ok(validateEnv({ ...GOOD, JWT_SECRET: "short" }).errors.some((e) => /too short/.test(e)));

  const placeholder = "your_super_secret_jwt_key_change_this_in_production";
  assert.ok(validateEnv({ ...GOOD, JWT_SECRET: placeholder }).errors.some((e) => /placeholder/.test(e)));
});

test("validateEnv warns about unencrypted redis:// to a remote host only", () => {
  const remote = validateEnv({ ...GOOD, REDIS_URL: "redis://default:pass@host.upstash.io:6379" });
  assert.equal(remote.errors.length, 0);
  assert.equal(remote.warnings.length, 1);

  for (const url of ["redis://localhost:6379", "redis://127.0.0.1:6379"]) {
    assert.equal(validateEnv({ ...GOOD, REDIS_URL: url }).warnings.length, 0, url);
  }
});

test("validateEnv rejects wildcard CORS origins and TRUST_PROXY=true", () => {
  assert.ok(validateEnv({ ...GOOD, CORS_ORIGINS: "https://a.com,*" }).errors.length > 0);
  assert.ok(validateEnv({ ...GOOD, TRUST_PROXY: "true" }).errors.length > 0);
  assert.equal(validateEnv({ ...GOOD, TRUST_PROXY: "1" }).errors.length, 0);
});

test("parseOrigins falls back to the local development origins", () => {
  assert.deepEqual(parseOrigins(undefined), DEFAULT_ORIGINS);
  assert.deepEqual(parseOrigins(""), DEFAULT_ORIGINS);
  assert.deepEqual(parseOrigins("   "), DEFAULT_ORIGINS);
});

test("parseOrigins trims whitespace and trailing slashes", () => {
  assert.deepEqual(parseOrigins(" https://a.com/ , https://b.com//,,"), ["https://a.com", "https://b.com"]);
});

test("parseOrigins returns a copy of the defaults, not the shared array", () => {
  parseOrigins(undefined).push("http://evil.example");
  assert.equal(DEFAULT_ORIGINS.includes("http://evil.example"), false);
});

// ─── token lifetime ─────────────────────────────────────────────────────────

const {
  parseDurationSeconds,
  resolveTokenSeconds,
  DEFAULT_TOKEN_SECONDS,
} = require("../src/config/env");

test("parseDurationSeconds understands units and bare seconds", () => {
  assert.equal(parseDurationSeconds("30s"), 30);
  assert.equal(parseDurationSeconds("30m"), 1800);
  assert.equal(parseDurationSeconds("12h"), 43200);
  assert.equal(parseDurationSeconds("1d"), 86400);
  assert.equal(parseDurationSeconds("2w"), 1209600);
  assert.equal(parseDurationSeconds(" 2 H "), 7200);
  assert.equal(parseDurationSeconds("3600"), 3600);
  assert.equal(parseDurationSeconds(3600), 3600);
});

test("parseDurationSeconds rejects anything else", () => {
  for (const value of ["", "abc", "1.5h", "-5m", "10x", "1 day", "h", "1d2h", "0x10"]) {
    assert.equal(parseDurationSeconds(value), null, JSON.stringify(value));
  }
});

test("a bare number is SECONDS, never milliseconds", () => {
  // jsonwebtoken would read the string "3600" as 3600 ms; we must not pass that on.
  assert.equal(resolveTokenSeconds("3600"), 3600);
});

test("resolveTokenSeconds defaults to 24 hours when unset or invalid", () => {
  assert.equal(DEFAULT_TOKEN_SECONDS, 86400);
  for (const value of [undefined, null, "", "   ", "garbage", "5s"]) {
    assert.equal(resolveTokenSeconds(value), DEFAULT_TOKEN_SECONDS, JSON.stringify(value));
  }
  assert.equal(resolveTokenSeconds("2h"), 7200);
});

test("validateEnv checks JWT_EXPIRES_IN", () => {
  assert.equal(validateEnv({ ...GOOD, JWT_EXPIRES_IN: "12h" }).errors.length, 0);
  assert.equal(validateEnv({ ...GOOD, JWT_EXPIRES_IN: "" }).errors.length, 0, "empty means default");

  assert.ok(validateEnv({ ...GOOD, JWT_EXPIRES_IN: "forever" }).errors.length > 0);
  assert.ok(validateEnv({ ...GOOD, JWT_EXPIRES_IN: "5s" }).errors.length > 0, "too short to be useful");

  const long = validateEnv({ ...GOOD, JWT_EXPIRES_IN: "30d" });
  assert.equal(long.errors.length, 0);
  assert.equal(long.warnings.length, 1, "long-lived tokens only warn");
});

test("validateEnv warns while the client-IP diagnostic is on", () => {
  assert.equal(validateEnv({ ...GOOD, DEBUG_CLIENT_IP: "true" }).warnings.length, 1);
  assert.equal(validateEnv({ ...GOOD, DEBUG_CLIENT_IP: "false" }).warnings.length, 0);
  assert.equal(validateEnv(GOOD).warnings.length, 0);
});
