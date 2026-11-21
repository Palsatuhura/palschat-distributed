# Security and threat model

## What is protected

Accounts and passwords, private messages and files, the list of who talks to whom, and the availability of the service.

## Who might attack

| Attacker | Goal |
|----------|------|
| Outsider with no account | Guess passwords, flood the service, read others' data |
| Registered user | Read chats they are not in, impersonate others, abuse uploads |
| Someone with a stolen token or device | Keep using another person's account |
| Network eavesdropper | Read traffic |

## Threats and controls

| Threat | Control |
|--------|---------|
| Password guessing | bcrypt hashing; login limits per IP and per account; a dummy hash comparison so "unknown email" and "wrong password" take the same time |
| Weak or oversized input | Server-side validation of every field and length; strings only |
| NoSQL injection | Validators reject objects such as `{ "$ne": "" }`; ids are checked as ObjectIds |
| Reading other people's chats | Membership check on every conversation, message and file request; ids from the token only |
| Stolen token | Tokens are short-lived (24 h) and tied to a session; any device can be ended and the socket closes at once |
| Account takeover after password change | Changing the password ends other sessions |
| Hostile uploads | File type decided by reading the file's first bytes, not its name or claimed type; 4 MB limit; served with `nosniff` and a sandbox CSP; upload rate limit |
| Flooding | Per-IP API limits; per-socket event limits and a tighter limit on `send_message` |
| Cross-site requests | Strict CORS list (`CORS_ORIGINS`); token sent in a header, not a cookie |
| Browser attacks on the API | `helmet` security headers |
| Eavesdropping | HTTPS and secure WebSockets |
| Harassment | Block (both directions), mute, leave group |
| Leftover data | Deleting an account erases name, email, picture and about, ends all sessions and removes the person from groups; delete for everyone erases text and file |
| Privacy in logs | Routine events are only logged with `LOG_LEVEL=debug` |

## Not protected (honest limits)

- **No end-to-end encryption.** The server and the database host can read messages. Adding it needs key management and changes search, multi-device and group behaviour.
- **Files are stored in the database**, not scanned for viruses.
- **No password reset or email verification yet**, so a forgotten password cannot be recovered and email ownership is not proved.
- **Tokens live in the browser's storage**, so a script injected into the page could read one. The React front end avoids raw HTML, and files are served in a sandbox, but this is the usual trade-off of token-based login.
- **A blocked person is not told** they are blocked until they try to send (intentional).

## Checks included

`npm test` in `backend/` runs tests for validation, authorization, sessions, rate limits, privacy rules, uploads and message deletion. Scripts such as `npm run check:authz` and `npm run check:hardening` run against a live server.
