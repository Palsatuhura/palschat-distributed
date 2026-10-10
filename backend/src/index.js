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

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const { createClient } = require("redis");
const { createAdapter } = require("@socket.io/redis-adapter");

const connectDB = require("./config/db");
const authRoutes = require("./routes/auth");
const userRoutes = require("./routes/users");
const conversationRoutes = require("./routes/conversations");
const socketHandler = require("./socket/socketHandler");

const app = express();
const httpServer = http.createServer(app);

// ─── CORS Configuration ────────────────────────────────────────────────────

const corsOptions = {
  origin: [
    "http://localhost:5173",
    "http://localhost:5174",
    "http://localhost:3000",
  ],
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
    origin: [
      "http://localhost:5173",
      "http://localhost:5174",
      "http://localhost:3000",
    ],
    methods: ["GET", "POST"],
    credentials: true,
  },
});

// ─── Express Middleware ────────────────────────────────────────────────────

app.use(
  express.json({
    limit: "10mb",
  })
);

app.use(
  express.urlencoded({
    extended: true,
  })
);

// ─── API Routes ────────────────────────────────────────────────────────────

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

// ─── Health Check ──────────────────────────────────────────────────────────

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
