# Architecture

## Overview

```mermaid
flowchart LR
  subgraph Browsers
    A[Browser A]
    B[Browser B]
  end
  FE[Static frontend<br/>React + Vite]
  subgraph Backend instances
    S1[Server 1<br/>Express + Socket.IO]
    S2[Server 2<br/>Express + Socket.IO]
  end
  R[(Redis<br/>pub/sub, presence,<br/>rate limits)]
  M[(MongoDB Atlas<br/>users, chats, messages,<br/>sessions, files)]

  A -- loads --> FE
  B -- loads --> FE
  A <-- HTTPS + WSS --> S1
  B <-- HTTPS + WSS --> S2
  S1 <--> R
  S2 <--> R
  S1 --> M
  S2 --> M
```

Any server can hold any person's connection. When Server 1 emits to a room, the Redis adapter relays it to Server 2, so Browser B still receives it.

## How a message travels

```mermaid
sequenceDiagram
  participant A as Sender
  participant S as Server (any)
  participant DB as MongoDB
  participant R as Redis
  participant B as Recipient
  A->>S: send_message (JWT checked on connect)
  S->>S: validate text, membership, block list, rate limit
  S->>DB: save message
  S->>R: emit to room user:<id> of each member
  R-->>B: delivered through whichever server B is on
  B->>S: mark_delivered / mark_read
  S->>R: tell the sender (ticks)
```

## Data

| Collection | Holds |
|------------|-------|
| User | name, email, password hash, gender, picture, about, blocked list, deletedAt |
| Session | one per logged-in device (so devices can be listed and ended) |
| Conversation | participants, group details, and each person's own state (cleared, hidden, pinned, muted, archived) |
| Message | text, sender, reply, attachment, deleted markers, delivered and read lists |
| Attachment | file bytes with a one-hour expiry until it is attached to a message |

## Real-time rooms

- `user:<id>`: everything addressed to one person on all their devices
- `session:<id>`: one login, so it can be ended instantly
- `conversation:<id>`: typing indicators for the open chat

## Safe re-sending

Every message carries a random `clientId`. If the connection drops and the browser sends the message again, the server finds the message already saved for that sender and `clientId` and returns it instead of saving a second copy. A unique database index on (sender, clientId) closes the remaining race when two copies arrive at the same moment. The browser retries up to three times automatically.

## Design choices

- **User id always comes from the token**, never from the request body.
- **Membership is checked on every read and write** of a conversation, message or file.
- **Per-person state** (clear chat, pin, mute) is stored per person, so one person's actions never change another's view.
- **Redis is shared** for presence and rate limits so the limits hold across servers.
