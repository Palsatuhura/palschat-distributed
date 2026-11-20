/**
 * Small pure helpers about pictures and files in messages (no browser APIs,
 * so they can be tested with `npm test`).
 */

// Must match MAX_ATTACHMENT_BYTES on the server.
export const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024;

// What the file picker offers. The server checks the real content again.
export const ACCEPT =
  "image/jpeg,image/png,image/webp,image/gif,.pdf,.docx,.xlsx,.pptx,.txt,.csv";

export const formatSize = (bytes) => {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n < 0) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
};

/** Short text for list previews, quotes and the reply bar. */
export const attachmentLabel = (attachment) => {
  if (!attachment) return "";
  return attachment.kind === "image" ? "📷 Photo" : `📎 ${attachment.name || "File"}`;
};

/** The words to show for a message in a preview: its text, else its file. */
export const previewText = (message) => {
  if (!message) return "";
  if (message.deletedAt) return "This message was deleted";
  return message.text || attachmentLabel(message.attachment);
};

/** Is this file small enough to send? Returns an error text or "". */
export const checkFileSize = (size) =>
  size > MAX_ATTACHMENT_BYTES ? "That file is too big. Send something under 4 MB." : "";
