/**
 * Which files may be sent, and what they REALLY are. No database here, so it
 * can be tested on its own.
 *
 * The browser's idea of the type is never trusted: the first bytes of the
 * file must match, and the type the server later answers with comes from
 * this table. Web pages and scripts (HTML, SVG, JS) are not on the list, so
 * nothing a person sends can run in another person's browser.
 */

const IMAGE = "image";
const FILE = "file";

const OFFICE = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

const startsWith = (buf, bytes, offset = 0) =>
  buf.length >= offset + bytes.length && bytes.every((b, i) => buf[offset + i] === b);

const extensionOf = (name) => {
  const m = /\.([A-Za-z0-9]{1,8})$/.exec(String(name || ""));
  return m ? m[1].toLowerCase() : "";
};

// Plain text: no NUL bytes and no control characters other than tab, CR, LF.
const looksLikeText = (buf) => {
  const n = Math.min(buf.length, 4096);
  for (let i = 0; i < n; i++) {
    const b = buf[i];
    if (b === 0) return false;
    if (b < 9 || (b > 13 && b < 32)) return false;
  }
  return true;
};

/**
 * Returns { mime, kind } for an allowed file, or null.
 *   kind "image" is shown in the chat; "file" is offered as a download.
 */
const detectType = (buffer, fileName) => {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return null;
  const ext = extensionOf(fileName);

  if (startsWith(buffer, [0xff, 0xd8, 0xff])) return { mime: "image/jpeg", kind: IMAGE };
  if (startsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { mime: "image/png", kind: IMAGE };
  }
  if (startsWith(buffer, [0x47, 0x49, 0x46, 0x38])) return { mime: "image/gif", kind: IMAGE };
  if (startsWith(buffer, [0x52, 0x49, 0x46, 0x46]) && startsWith(buffer, [0x57, 0x45, 0x42, 0x50], 8)) {
    return { mime: "image/webp", kind: IMAGE };
  }
  if (startsWith(buffer, [0x25, 0x50, 0x44, 0x46, 0x2d])) {
    return { mime: "application/pdf", kind: FILE };
  }
  // Word / Excel / PowerPoint files are zip archives; the name says which.
  if (startsWith(buffer, [0x50, 0x4b, 0x03, 0x04]) && OFFICE[ext]) {
    return { mime: OFFICE[ext], kind: FILE };
  }
  if ((ext === "txt" || ext === "csv") && looksLikeText(buffer)) {
    return { mime: ext === "csv" ? "text/csv" : "text/plain", kind: FILE };
  }
  return null;
};

/** A safe display name: no folders, no control characters, bounded length. */
const cleanFileName = (raw) => {
  let name = String(raw || "").normalize("NFC");
  name = name.split(/[\\/]/).pop();
  // eslint-disable-next-line no-control-regex
  name = name.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "").trim();
  if (name.length > 100) {
    const ext = extensionOf(name);
    name = name.slice(0, 90) + (ext ? "." + ext : "");
  }
  return name || "file";
};

module.exports = { detectType, cleanFileName, extensionOf, IMAGE, FILE };
