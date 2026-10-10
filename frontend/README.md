# Chat App — Frontend

React + Vite + Tailwind CSS + Socket.io-client frontend for the real-time chat application.

## Prerequisites

- Node.js v18+
- The backend server must be running on port 5000

## Setup

### 1. Install dependencies
```bash
cd frontend
npm install
```

### 2. Environment variables
The `.env` file is already configured to point to the local backend:
```
VITE_API_URL=http://localhost:5000/api
VITE_SOCKET_URL=http://localhost:5000
```

### 3. Start the development server
```bash
npm run dev
```

The app will open at **http://localhost:5173**

## Features

- 🔐 **Authentication** — Register/login with JWT session persistence
- 👥 **User list** — See all registered users with real-time online/offline status
- 💬 **1-on-1 chat** — Private messaging with full history
- 👥 **Group chat** — Create groups with multiple users
- ⚡ **Real-time** — Socket.io powered instant message delivery
- ✍️ **Typing indicators** — See when others are typing
- 🔢 **Unread badges** — Track unread messages per conversation
- 📱 **Responsive** — Mobile-friendly with collapsible sidebar
- ✅ **Read receipts** — See when messages have been read

## Project Structure
```
frontend/
├── src/
│   ├── components/
│   │   ├── ChatWindow.jsx       # Main chat area
│   │   ├── CreateGroupModal.jsx # Group chat creation
│   │   ├── MessageBubble.jsx    # Individual message
│   │   ├── ProtectedRoute.jsx   # Auth route guard
│   │   ├── Sidebar.jsx          # Contact/conversation list
│   │   └── UserAvatar.jsx       # Avatar with status dot
│   ├── hooks/
│   │   └── useSocket.js         # Socket.io lifecycle hook
│   ├── lib/
│   │   ├── axios.js             # Axios with JWT interceptor
│   │   └── socket.js            # Socket.io-client singleton
│   ├── pages/
│   │   ├── ChatPage.jsx         # Main chat layout
│   │   ├── LoginPage.jsx        # Login form
│   │   └── RegisterPage.jsx     # Registration form
│   ├── store/
│   │   ├── authStore.js         # Zustand auth state (persisted)
│   │   └── chatStore.js         # Zustand chat state
│   ├── App.jsx                  # Router setup
│   ├── main.jsx                 # React entry point
│   └── index.css                # Tailwind + global styles
├── .env
├── index.html
├── package.json
├── tailwind.config.js
└── vite.config.js
```
