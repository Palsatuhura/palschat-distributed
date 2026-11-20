import api from "./axios";
import { MAX_ATTACHMENT_BYTES, checkFileSize } from "./attachmentInfo";

/**
 * Browser-side helpers for pictures and files in chats.
 */

const SHRINKABLE = ["image/jpeg", "image/png", "image/webp"];
const MAX_SIDE = 1600;

/**
 * Pictures are shrunk before upload (longest side 1600 px, JPEG) so they are
 * quick to send and cheap to store. Other files go as they are.
 * Resolves to { blob, name } or rejects with an Error whose message can be
 * shown to the person.
 */
export const prepareFile = async (file) => {
  const tooBig = checkFileSize(file.size);
  const isShrinkable = SHRINKABLE.includes(file.type);

  if (!isShrinkable) {
    if (tooBig) throw new Error(tooBig);
    return { blob: file, name: file.name };
  }

  // Small pictures are sent untouched.
  if (file.size <= 300 * 1024) return { blob: file, name: file.name };

  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("Could not read that picture."));
      el.src = url;
    });
    const scale = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff"; // JPEG has no transparency
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    let quality = 0.85;
    let blob = await new Promise((r) => canvas.toBlob(r, "image/jpeg", quality));
    while (blob && blob.size > MAX_ATTACHMENT_BYTES && quality > 0.4) {
      quality -= 0.15;
      blob = await new Promise((r) => canvas.toBlob(r, "image/jpeg", quality));
    }
    if (!blob || blob.size > MAX_ATTACHMENT_BYTES) {
      throw new Error("Could not shrink that picture enough. Try a smaller one.");
    }
    const name = file.name.replace(/\.[^.]+$/, "") + ".jpg";
    return { blob, name };
  } finally {
    URL.revokeObjectURL(url);
  }
};

/** Upload to a conversation. Resolves to the server's { id, name, mime, kind, size }. */
export const uploadAttachment = async (conversationId, blob, name, onProgress) => {
  const { data } = await api.post(`/conversations/${conversationId}/attachments`, blob, {
    headers: {
      "Content-Type": blob.type || "application/octet-stream",
      "X-File-Name": encodeURIComponent(name),
    },
    onUploadProgress: (e) => {
      if (onProgress && e.total) onProgress(Math.round((e.loaded / e.total) * 100));
    },
  });
  return data;
};

// Pictures already loaded in this tab, so scrolling does not fetch them again.
// Capped, oldest dropped (and released) first.
const CACHE_LIMIT = 40;
const cache = new Map(); // attachmentId -> Promise<objectUrl>

const download = (conversationId, attachmentId) =>
  api
    .get(`/conversations/${conversationId}/attachments/${attachmentId}`, { responseType: "blob" })
    .then(({ data }) => URL.createObjectURL(data));

/** An object URL for the file (needs the login token, so img src alone cannot do it). */
export const getAttachmentUrl = (conversationId, attachmentId) => {
  if (cache.has(attachmentId)) return cache.get(attachmentId);

  const promise = download(conversationId, attachmentId);
  cache.set(attachmentId, promise);
  promise.catch(() => cache.delete(attachmentId));

  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    const old = cache.get(oldest);
    cache.delete(oldest);
    old.then((u) => URL.revokeObjectURL(u)).catch(() => {});
  }
  return promise;
};

/** Forget everything (logout), so the next person on this browser sees none of it. */
export const clearAttachmentCache = () => {
  for (const p of cache.values()) p.then((u) => URL.revokeObjectURL(u)).catch(() => {});
  cache.clear();
};

/** Save a file to the person's computer. */
export const saveAttachment = async (conversationId, attachment) => {
  const url = await getAttachmentUrl(conversationId, attachment.id);
  const a = document.createElement("a");
  a.href = url;
  a.download = attachment.name || "file";
  document.body.appendChild(a);
  a.click();
  a.remove();
};
