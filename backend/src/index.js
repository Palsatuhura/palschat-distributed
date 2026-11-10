/**
 * Backend Entry Point
 * Express + Socket.io + MongoDB + Redis Adapter + Redis Presence
 *
 * Distributed architecture:
 *
 *   Client
 *      ↓
 *   Socket.io Server
 *      ↓
 *   Redis Adapter
 *      ↓
 *   Upstash Redis
 *
 * Redis is also used as the shared presence store.
 */

require("dotenv").config();

// Refuse to start with a missing or weak configuration (see config/env.js).
const { validateEnv } = require("./config/env");

const envCheck = validateEnv(process.env);

envCheck.warnings.forEach((warning) => console.warn(`⚠️  ${warning}`));

if (envCheck.errors.length > 0) {
  console.error("❌ Invalid configuration:");
  envCheck.errors.forEach((error) => console.error(`   - ${error}`));
  console.error("   Fix backend/.env and start the server again.");
  process.exit(1);
}

const express = require("express");
const http = require("http");
const helmet = require("helmet");
const { Server } = require("socket.io");
const cors = require("cors");
const { createClient } = require("redis");
const { createAdapter } = require("@socket.io/redis-adapter");

const connectDB = require("./config/db");
const authRoutes = require("./routes/auth");
const userRoutes = require("./routes/users");
const conversationRoutes = require("./routes/conversations");
const socketHandler = require("./socket/socketHandler");
const { allowedOrigins } = require("./config/cors");
const { apiLimiter, setRedisClient } = require("./middleware/rateLimiter");

const app = express();
const httpServer = http.createServer(app);

// ─── Security headers & proxy ──────────────────────────────────────────────

// Sets X-Content-Type-Options, Strict-Transport-Security, frame protection
// and others, and removes X-Powered-By. This server only returns JSON, so the
// default policy is appropriate.
app.use(helmet());

// When running behind a reverse proxy or load balancer (nginx, Render, ...),
// set TRUST_PROXY to the number of proxies in front of the app (usually 1).
// Otherwise every client appears to have the proxy's IP address and shares a
// single rate-limit budget. Leave it unset when clients connect directly.
const trustProxyHops = Number.parseInt(process.env.TRUST_PROXY, 10);

if (Number.isInteger(trustProxyHops) && trustProxyHops > 0) {
  app.set("trust proxy", trustProxyHops);
}

// ─── CORS Configuration ────────────────────────────────────────────────────

// Allowed origins come from CORS_ORIGINS (config/cors.js), so deploying to a
// real domain needs no code change.
const corsOptions = {
  origin: allowedOrigins,
  methods: [
    "GET",
    "POST",
    "PUT",
    "DELETE",
    "OPTIONS",
  ],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
  ],
  credentials: true,
};

app.use(cors(corsOptions));

// ─── Socket.io Setup ───────────────────────────────────────────────────────

const io = new Server(httpServer, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"],
    credentials: true,
  },
  // Messages are capped at 2000 characters, so 100 KB per event is generous.
  // Socket.IO's default is 1 MB, which lets one client push large payloads.
  maxHttpBufferSize: 100 * 1024,
});

// ─── Express Middleware ────────────────────────────────────────────────────

// The API only accepts small JSON bodies (messages are capped at 2000
// characters), so 100 KB leaves plenty of room. 10 MB invites abuse.
app.use(
  express.json({
    limit: "100kb",
  })
);

// ─── Health Check ──────────────────────────────────────────────────────────

// Registered before the rate limiter so monitors and load balancers that poll
// it are never throttled.
app.get(
  "/api/health",
  (req, res) => {
    res.status(200).json({
      status: "OK",
      timestamp:
        new Date().toISOString(),
    });
  }
);

// ─── API Routes ────────────────────────────────────────────────────────────

// Opt-in diagnostic for choosing TRUST_PROXY on a hosting platform. It is
// OFF unless DEBUG_CLIENT_IP=true, and startup prints a warning while it is on.
// See backend/.env.example for how to use it.
if (process.env.DEBUG_CLIENT_IP === "true") {
  app.get("/api/debug/client-ip", (req, res) => {
    res.status(200).json({
      ip: req.ip,
      ips: req.ips,
      xForwardedFor: req.headers["x-forwarded-for"] || null,
      trustProxy: app.get("trust proxy"),
    });
  });
}

// Blanket per-IP limit for the whole API. Login and registration have their
// own, stricter limits in routes/auth.js.
app.use("/api", apiLimiter);

app.use(
  "/api/auth",
  authRoutes
);

app.use(
  "/api/users",
  userRoutes
);

app.use(
  "/api/conversations",
  conversationRoutes
);

// ─── 404 Handler ───────────────────────────────────────────────────────────

app.use(
  (req, res) => {
    res.status(404).json({
      message:
        `Route ${req.originalUrl} not found`,
    });
  }
);

// ─── Global Error Handler ──────────────────────────────────────────────────

app.use(
  (err, req, res, next) => {
    // Client mistakes raised by body-parser (invalid JSON, body too large)
    // carry a 4xx status; they are not server faults and must not be
    // reported as 500.
    const status = err.status || err.statusCode;

    if (status >= 400 && status < 500) {
      return res.status(status).json({
        message:
          err.type === "entity.too.large"
            ? "Request body is too large"
            : "Invalid request",
      });
    }

    console.error(
      "Unhandled error:",
      err
    );

    res.status(500).json({
      message:
        "Internal server error",
    });
  }
);

// ─── Start Server ──────────────────────────────────────────────────────────

const PORT =
  process.env.PORT || 5000;

const startServer = async () => {
  try {
    // ─── MongoDB ──────────────────────────────────────────────────────────

    await connectDB();

    // ─── Redis clients ────────────────────────────────────────────────────

    const pubClient =
      createClient({
        url: process.env.REDIS_URL,
      });

    const subClient =
      pubClient.duplicate();

    // Dedicated Redis client for presence.
    const presenceClient =
      pubClient.duplicate();

    // ─── Redis error handlers ─────────────────────────────────────────────

    pubClient.on(
      "error",
      (err) => {
        console.error(
          "❌ Redis Publisher Error:",
          err.message
        );
      }
    );

    subClient.on(
      "error",
      (err) => {
        console.error(
          "❌ Redis Subscriber Error:",
          err.message
        );
      }
    );

    presenceClient.on(
      "error",
      (err) => {
        console.error(
          "❌ Redis Presence Error:",
          err.message
        );
      }
    );

    console.log(
      "🔄 Connecting to Upstash Redis..."
    );

    await Promise.all([
      pubClient.connect(),
      subClient.connect(),
      presenceClient.connect(),
    ]);

    console.log(
      "✅ Upstash Redis connected"
    );

    console.log(
      "✅ Redis presence client connected"
    );

    // Share the presence connection with the HTTP rate limiter so request
    // counts are global across every backend instance.
    setRedisClient(presenceClient);

    // ─── Socket.IO Redis adapter ──────────────────────────────────────────

    io.adapter(
      createAdapter(
        pubClient,
        subClient
      )
    );

    console.log(
      "🔗 Socket.io Redis adapter enabled"
    );

    // ─── Socket handlers ──────────────────────────────────────────────────

    socketHandler(
      io,
      presenceClient
    );

    // ─── Start HTTP server ────────────────────────────────────────────────

    httpServer.listen(
      PORT,
      () => {
        console.log(
          `🚀 Server running on http://localhost:${PORT}`
        );

        console.log(
          `📡 Socket.io ready on http://localhost:${PORT}`
        );

        console.log(
          `🌐 Distributed mode enabled`
        );

        console.log(
          `👥 Redis presence enabled`
        );
      }
    );
  } catch (error) {
    console.error(
      "❌ Server startup failed:",
      error.message
    );

    process.exit(1);
  }
};

startServer();
