# PalsChat Distributed

A real-time, secure chat system built to run on several servers at once. People can chat one-to-one or in groups, send pictures and files, and manage their own devices and privacy.

**Live site:** https://palschat.onrender.com  (API: https://palschat-distributed.onrender.com)

## Features

- Accounts with hashed passwords, per-device login sessions, and "sign out of other devices"
- One-to-one and group chats, typing indicators, online status, delivered and read ticks
- Reply to messages, delete for me, delete for everyone (within 48 hours)
- Pictures and files (images, PDF, Office documents, text) up to 4 MB
- Block people; pin, mute and archive chats; clear or delete a chat for yourself
- Delete your account (your messages stay, shown as "Deleted user")
- Light, dark and system themes, five accent colours, desktop notifications and sounds
- Default profile pictures chosen from the gender picked at signup

## How it is built

| Part | Technology |
|------|------------|
| Frontend | React, Vite, Tailwind CSS, Zustand |
| Backend | Node.js, Express, Socket.IO |
| Database | MongoDB Atlas (Mongoose) |
| Shared real-time state | Redis (Upstash), Socket.IO Redis adapter |
| Hosting | Render (API as a web service, frontend as a static site) |

Because the Socket.IO servers share Redis, a message sent to one server reaches people connected to any other. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Documents

- [Architecture](docs/ARCHITECTURE.md): diagram and how a message travels
- [Security and threat model](docs/SECURITY.md): what is protected, how, and what is not
- [User guide](docs/USER_GUIDE.md): how to use every feature

## Run it on your computer

You need Node.js 18 or newer, a MongoDB database (a free Atlas cluster works) and, optionally, a Redis URL. Without Redis the backend runs as a single server.

```bash
# 1. Backend
cd backend
cp .env.example .env        # then fill in MONGO_URI and JWT_SECRET
npm install
npm run dev                 # http://localhost:5000

# 2. Frontend (second terminal)
cd frontend
npm install
npm run dev                 # http://localhost:5173
```

The frontend needs `VITE_API_URL` and `VITE_SOCKET_URL` (see `frontend/README.md`).

### Backend settings (environment variables)

| Name | Purpose |
|------|---------|
| `MONGO_URI` | MongoDB connection string (required) |
| `JWT_SECRET` | Long random secret that signs login tokens (required) |
| `CORS_ORIGINS` | Comma-separated list of frontend addresses allowed to call the API |
| `REDIS_URL` | Enables several servers working together |
| `JWT_EXPIRES_IN` | Lifetime of one token (default 24 hours; renewed quietly while in use) |
| `SESSION_MAX_DAYS` | Longest a login may last (default 30) |
| `TRUST_PROXY` | Number of proxies in front of the server (Render: 1) |
| `LOG_LEVEL` | Set to `debug` to print routine events; errors always print |
| `RATE_LIMIT_*` | Optional overrides for the rate limits |

## Tests

```bash
cd backend  && npm test     # API, validation, sockets, rate limits, privacy rules
cd frontend && npm test     # helpers and state logic
```

### Load test

With the backend running locally against a **development** database (and `RATE_LIMIT_REGISTER_MAX=500` in `backend/.env`):

```bash
cd backend
USERS=20 MESSAGES=30 npm run load-test
```

It checks that a retried message is saved only once, then has 20 people exchange 600 messages and reports confirmation times, delivery and messages per second. It removes its test accounts afterwards.

## Known limits

- Messages are encrypted in transit (HTTPS and secure WebSockets) but **not end-to-end encrypted**; the server can read them.
- Files are stored in MongoDB, so the free 512 MB limit applies. A production system should use object storage such as S3 or R2.
- The free Render plan sleeps after inactivity, so the first request can take about a minute.
- There is no password reset by email yet.
