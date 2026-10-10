# Chat App — Backend

Node.js + Express + Socket.io + MongoDB backend for the real-time chat application.

## Prerequisites

- Node.js v18+
- MongoDB (local or MongoDB Atlas)

## Setup

### 1. Install dependencies
```bash
cd backend
npm install
```

### 2. Configure environment variables
The `.env` file is already provided. Edit it to set your MongoDB URI and JWT secret:
```
PORT=5000
MONGO_URI=mongodb://localhost:27017/chatapp
JWT_SECRET=your_super_secret_jwt_key_change_this_in_production
```

### 3. Start the development server
```bash
npm run dev
```

The server will start on **http://localhost:5000**

## API Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/auth/register` | ❌ | Register new user |
| POST | `/api/auth/login` | ❌ | Login and get JWT |
| GET | `/api/users` | ✅ | List all users |
| GET | `/api/conversations` | ✅ | Get user's conversations |
| POST | `/api/conversations` | ✅ | Create/get conversation |
| GET | `/api/conversations/:id/messages` | ✅ | Get message history |
| GET | `/api/health` | ❌ | Health check |

## Socket.io Events

### Client → Server
| Event | Payload | Description |
|-------|---------|-------------|
| `user_connected` | `userId` | Register presence on connect |
| `join_conversation` | `conversationId` | Join a chat room |
| `leave_conversation` | `conversationId` | Leave a chat room |
| `send_message` | `{ conversationId, senderId, text }` | Send a message |
| `typing` | `{ conversationId, userId, userName }` | Start typing |
| `stop_typing` | `{ conversationId, userId }` | Stop typing |
| `mark_read` | `{ conversationId, userId }` | Mark messages as read |

### Server → Client
| Event | Payload | Description |
|-------|---------|-------------|
| `user_online` | `{ userId }` | A user came online |
| `user_offline` | `{ userId, lastSeen }` | A user went offline |
| `online_users` | `[userId, ...]` | List of currently online users |
| `receive_message` | `Message object` | New message in room |
| `typing` | `{ userId, userName, conversationId }` | User is typing |
| `stop_typing` | `{ userId, conversationId }` | User stopped typing |
| `messages_read` | `{ conversationId, userId }` | Messages read receipt |

## Project Structure
```
backend/
├── src/
│   ├── config/
│   │   └── db.js              # MongoDB connection
│   ├── controllers/
│   │   ├── authController.js  # Register & login logic
│   │   ├── userController.js  # List users
│   │   ├── conversationController.js
│   │   └── messageController.js
│   ├── middleware/
│   │   └── auth.js            # JWT verification middleware
│   ├── models/
│   │   ├── User.js
│   │   ├── Conversation.js
│   │   └── Message.js
│   ├── routes/
│   │   ├── auth.js
│   │   ├── users.js
│   │   └── conversations.js
│   ├── socket/
│   │   └── socketHandler.js   # All Socket.io event handlers
│   └── index.js               # Entry point
├── .env
└── package.json
```
