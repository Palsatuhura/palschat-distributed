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
const mongoose = require("mongoose");
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
    "PATCH",
    "DELETE",
    "OPTIONS",
  ],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "X-File-Name",
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

// Controllers reach the socket server through app.get("io"), for example to
// tell every connected client (on every server) that a new user has joined.
app.set("io", io);

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
        socket: {
          // Give up on a connection attempt after 10 s instead of waiting
          // on the operating system, and retry with a growing pause.
          connectTimeout: 10000,
          reconnectStrategy: (retries) =>
            Math.min(retries * 200, 5000),
        },
      });

    const subClient =
      pubClient.duplicate();

    // Dedicated Redis client for presence AND the rate limiter. While it is
    // reconnecting, commands fail at once instead of piling up in a queue,
    // so a Redis outage slows down features instead of freezing requests.
    const presenceClient =
      pubClient.duplicate({
        disableOfflineQueue: true,
      });

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

    const presence =
      socketHandler(
        io,
        presenceClient
      );

    // ─── Graceful shutdown ────────────────────────────────────────────────
    // On Ctrl+C, a deploy, or a restart: take this server's users out of the
    // presence list, close connections, then exit. Without this they would
    // stay "online" until their entries expire.

    let shuttingDown = false;

    const shutdown = async (signal) => {
      if (shuttingDown) return;
      shuttingDown = true;

      console.log(
        `\n🛑 ${signal} received, shutting down...`
      );

      // Never hang forever on a stuck connection.
      setTimeout(() => {
        console.error("⏱️  Shutdown took too long, forcing exit");
        process.exit(1);
      }, 10000).unref();

      try {
        await presence.shutdown();

        // io.close() waits for browsers' idle keep-alive HTTP connections,
        // which can take a long time. Drop them, and never wait more than
        // 3 seconds for the rest.
        const closed = new Promise((resolve) =>
          io.close(resolve)
        );

        httpServer.closeAllConnections?.();

        await Promise.race([
          closed,
          new Promise((resolve) => setTimeout(resolve, 3000)),
        ]);

        await Promise.allSettled([
          pubClient.quit(),
          subClient.quit(),
          presenceClient.quit(),
          mongoose.connection.close(),
        ]);

        console.log("✅ Shutdown complete");
      } catch (error) {
        console.error(
          "Shutdown error:",
          error.message
        );
      }
    };

    process.once("SIGTERM", async () => {
      await shutdown("SIGTERM");
      process.exit(0);
    });

    process.once("SIGINT", async () => {
      await shutdown("SIGINT");
      process.exit(0);
    });

    // nodemon restarts the app by sending SIGUSR2 and expects it to be sent
    // back once cleanup is done.
    process.once("SIGUSR2", async () => {
      await shutdown("SIGUSR2");
      process.kill(process.pid, "SIGUSR2");
    });

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
