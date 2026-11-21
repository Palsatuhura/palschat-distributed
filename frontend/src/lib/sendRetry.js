/**
 * Safe re-sending of messages. Each message carries a random label (clientId).
 * If the server never answers, the same message is sent again with the SAME
 * label, and the server saves it only once.
 */

export const MAX_SEND_ATTEMPTS = 3;

export const makeClientId = () => {
  try {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  } catch {
    /* fall through */
  }
  return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
};

/** What makes two sends "the same message". */
export const sendKey = ({ conversationId, text, attachmentId, replyTo }) =>
  JSON.stringify([conversationId, text, attachmentId || null, replyTo || null]);

/**
 * Keep the label while the person is retrying the very same message; make a
 * new one as soon as anything about it changed.
 * `previous` is { key, clientId } or null. Returns { key, clientId }.
 */
export const attemptFor = (previous, parts) => {
  const key = sendKey(parts);
  return previous && previous.key === key ? previous : { key, clientId: makeClientId() };
};

/** Should an unanswered send be tried again automatically? */
export const shouldRetry = (attemptNumber) => attemptNumber < MAX_SEND_ATTEMPTS;
