const Session = require("../models/Session");
const { signToken } = require("./jwt");
const { resolveTokenSeconds } = require("../config/env");
const { sessionMaxSeconds, tokenSecondsFor, describeDevice } = require("./sessions");

/** Room that holds every socket of one login session. */
const sessionRoom = (sessionId) => `session:${sessionId}`;

/**
 * Start a login session for a user and sign its first token.
 * Returns { session, token }.
 */
const createSession = async (user, req) => {
  const maxSeconds = sessionMaxSeconds();
  const session = await Session.create({
    user: user._id,
    device: describeDevice(req?.headers?.["user-agent"]),
    expiresAt: new Date(Date.now() + maxSeconds * 1000),
  });

  const seconds = tokenSecondsFor(
    session.expiresAt,
    resolveTokenSeconds(process.env.JWT_EXPIRES_IN)
  );
  const token = signToken(user._id, session._id, seconds);
  return { session, token };
};

/**
 * Tell every open socket of these sessions that the login has ended, then
 * close them. Works across servers (Redis adapter). Best effort: the sessions
 * are already deleted, so even a socket we miss is refused when it reconnects.
 */
const endSessionsLive = (io, sessionIds) => {
  if (!io) return;
  for (const id of sessionIds) {
    try {
      const room = sessionRoom(id);
      io.in(room).emit("session_ended", { code: "SESSION_ENDED" });
      io.in(room).disconnectSockets(true);
    } catch {
      /* ignore */
    }
  }
};

module.exports = { sessionRoom, createSession, endSessionsLive };
