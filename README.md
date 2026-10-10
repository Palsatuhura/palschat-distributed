# 💬 ChatApp — Real-time Chat Application

A full-stack real-time chat application built as a portfolio/CV project. Features private and group messaging, live online status, typing indicators, and persistent message history.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + Vite |
| State Management | Zustand |
| Styling | Tailwind CSS |
| HTTP Client | Axios |
| Real-time | Socket.io-client |
| Backend | Node.js + Express.js |
| Real-time Server | Socket.io |
| Database | MongoDB + Mongoose |
| Authentication | JWT + bcrypt |

---

## Quick Start (2 Terminals)

### Terminal 1 — Backend (port 5000)
```bash
cd backend
npm install
npm run dev
```

### Terminal 2 — Frontend (port 5173)
```bash
cd frontend
npm install
npm run dev
```

Open **http://localhost:5173** in your browser.

> ⚠️ Make sure MongoDB is running locally before starting the backend.
> If using MongoDB Atlas, update `MONGO_URI` in `backend/.env`.

---

## Features

- 🔐 User registration & login with JWT session persistence
- 👤 User list with real-time **online/offline status** indicators
- 💬 **1-on-1 private chat** with full history loaded from database
- 👥 **Group chat** — create groups with multiple users
- ⚡ **Real-time messaging** via Socket.io (no page refresh needed)
- ✍️ **Typing indicator** — see when the other person is typing
- 🔢 **Unread message badges** per conversation
- ✅ **Read receipts** (single/double tick on messages)
- 📱 **Responsive UI** — sidebar collapses on mobile screens
- 🔍 Search/filter users and conversations

---

## Project Structure

```
Realtime-chat-app/
├── backend/               ← Node.js + Express + Socket.io + MongoDB
│   ├── src/
│   │   ├── config/        ← Database connection
│   │   ├── controllers/   ← Business logic (auth, users, chats, messages)
│   │   ├── middleware/     ← JWT authentication middleware
│   │   ├── models/        ← Mongoose schemas (User, Conversation, Message)
│   │   ├── routes/        ← Express route definitions
│   │   ├── socket/        ← Socket.io event handlers
│   │   └── index.js       ← Server entry point
│   ├── .env
│   ├── package.json
│   └── README.md
│
├── frontend/              ← React + Vite + Tailwind CSS
│   ├── src/
│   │   ├── components/    ← UI components (Sidebar, ChatWindow, etc.)
│   │   ├── hooks/         ← useSocket lifecycle hook
│   │   ├── lib/           ← Axios & Socket.io-client setup
│   │   ├── pages/         ← Login, Register, Chat pages
│   │   ├── store/         ← Zustand state (auth, chat)
│   │   └── App.jsx        ← React Router setup
│   ├── .env
│   ├── package.json
│   └── README.md
│
└── README.md              ← This file
```

---

## Environment Variables

### Backend (`backend/.env`)
```
PORT=5000
MONGO_URI=mongodb://localhost:27017/chatapp
JWT_SECRET=your_super_secret_jwt_key_change_this_in_production
```

### Frontend (`frontend/.env`)
```
VITE_API_URL=http://localhost:5000/api
VITE_SOCKET_URL=http://localhost:5000
```

---

## API Overview

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/auth/register` | ❌ | Register new user |
| POST | `/api/auth/login` | ❌ | Login and get JWT |
| GET | `/api/users` | ✅ | Get all users |
| GET | `/api/conversations` | ✅ | Get user's conversations |
| POST | `/api/conversations` | ✅ | Create/get conversation |
| GET | `/api/conversations/:id/messages` | ✅ | Get message history |

---

## Socket.io Events

| Direction | Event | Description |
|-----------|-------|-------------|
| Client → Server | `user_connected` | Announce presence |
| Client → Server | `join_conversation` | Join chat room |
| Client → Server | `send_message` | Send new message |
| Client → Server | `typing` / `stop_typing` | Typing status |
| Server → Client | `receive_message` | Incoming message |
| Server → Client | `user_online` / `user_offline` | Presence updates |
| Server → Client | `online_users` | Initial online list |

---

## Screenshots

> Register, then open two browser windows with different accounts to test real-time messaging!

---

*Built with ❤️ as a full-stack portfolio project.*
