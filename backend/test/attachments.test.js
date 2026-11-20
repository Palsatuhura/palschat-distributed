/**
 * Pictures and files: what is allowed, and who can upload / download.
 * Run with: npm test
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const root = path.resolve(__dirname, "..");
const { detectType, cleanFileName } = require(path.join(root, "src/utils/attachmentTypes.js"));

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
const PDF = Buffer.from("%PDF-1.7\n...");
const ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]);
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP")]);

test("real pictures are recognised by their first bytes, whatever the name says", () => {
  assert.deepEqual(detectType(PNG, "x.jpg"), { mime: "image/png", kind: "image" });
  assert.equal(detectType(JPG, "a.png").mime, "image/jpeg");
  assert.equal(detectType(WEBP, "a.webp").mime, "image/webp");
  assert.equal(detectType(Buffer.from("GIF89a...."), "a.gif").mime, "image/gif");
});

test("documents: PDF, Office (by name) and plain text", () => {
  assert.deepEqual(detectType(PDF, "notes.pdf"), { mime: "application/pdf", kind: "file" });
  assert.match(detectType(ZIP, "report.docx").mime, /wordprocessingml/);
  assert.match(detectType(ZIP, "sheet.xlsx").mime, /spreadsheetml/);
  assert.match(detectType(ZIP, "slides.pptx").mime, /presentationml/);
  assert.equal(detectType(Buffer.from("hello, world\n"), "a.txt").mime, "text/plain");
  assert.equal(detectType(Buffer.from("a,b\n1,2\n"), "a.csv").mime, "text/csv");
});

test("anything that could run in a browser, or is not on the list, is refused", () => {
  assert.equal(detectType(Buffer.from("<html><script>alert(1)</script>"), "a.html"), null);
  assert.equal(detectType(Buffer.from("<svg onload=alert(1)>"), "a.svg"), null);
  // HTML renamed .txt is only ever served as a plain-text download, never as a page
  assert.equal(detectType(Buffer.from("<html>"), "a.txt").mime, "text/plain");
  assert.equal(detectType(ZIP, "program.exe"), null); // a zip that is not Office
  assert.equal(detectType(ZIP, "archive.zip"), null);
  assert.equal(detectType(Buffer.from([0, 1, 2, 3, 4]), "a.txt"), null); // binary pretending to be text
  assert.equal(detectType(PNG, "").mime, "image/png"); // pictures need no extension
  assert.equal(detectType(Buffer.alloc(0), "a.png"), null);
  assert.equal(detectType("not a buffer", "a.png"), null);
});

test("file names are cleaned: no folders, no odd characters, bounded", () => {
  assert.equal(cleanFileName("../../etc/passwd"), "passwd");
  assert.equal(cleanFileName("C:\\Users\\me\\cv.pdf"), "cv.pdf");
  assert.equal(cleanFileName("a<b>c|d.txt"), "abcd.txt");
  assert.equal(cleanFileName(""), "file");
  assert.equal(cleanFileName(undefined), "file");
  const long = cleanFileName("x".repeat(300) + ".pdf");
  assert.ok(long.length <= 100 && long.endsWith(".pdf"));
});

// ---- the upload / download endpoints, with stand-in models ----
const oid = (n) => n.toString(16).padStart(24, "0");
const [A, B, C] = [1, 2, 3].map(oid);
const CID = oid(50);
const FID = oid(70);
const stored = [];
const stub = (rel, exports) => {
  const file = path.join(root, rel);
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
};
stub("src/models/Conversation.js", {
  findOne: (q) => ({
    select: async () =>
      q._id === CID && [A, B].includes(String(q.participants)) ? { _id: CID, readOnly: false } : null,
  }),
});
stub("src/models/Attachment.js", {
  create: async (doc) => {
    const saved = { _id: FID, ...doc };
    stored.push(saved);
    return saved;
  },
  findOne: (q) => ({
    select: async () => {
      const f = stored[0];
      return f && String(f._id) === q._id && String(f.conversation) === q.conversation ? f : null;
    },
  }),
});
const { uploadAttachment, downloadAttachment } = require(path.join(root, "src/controllers/attachmentController.js"));

const call = async (fn, user, params, body, headers = {}) => {
  const out = { headers: {} };
  const res = {
    status(c) {
      out.c = c;
      return this;
    },
    json(j) {
      out.j = j;
    },
    set(h) {
      Object.assign(out.headers, h);
      return this;
    },
    end(b) {
      out.body = b;
    },
  };
  await fn(
    { user: { _id: user }, params, body, get: (h) => headers[h.toLowerCase()] },
    res
  );
  return out;
};

test("upload: members only, real files only, size limit", async () => {
  stored.length = 0;
  const head = { "x-file-name": encodeURIComponent("pic.png") };
  assert.equal((await call(uploadAttachment, C, { id: CID }, PNG, head)).c, 404);
  assert.equal((await call(uploadAttachment, A, { id: CID }, {}, head)).c, 400); // not raw bytes
  assert.equal((await call(uploadAttachment, A, { id: CID }, Buffer.alloc(0), head)).c, 400);
  assert.equal((await call(uploadAttachment, A, { id: CID }, Buffer.from("<html>"), { "x-file-name": "a.html" })).c, 415);
  assert.equal((await call(uploadAttachment, A, { id: CID }, Buffer.concat([PNG, Buffer.alloc(4 * 1024 * 1024)]), head)).c, 413);
  assert.equal(stored.length, 0);
  const ok = await call(uploadAttachment, A, { id: CID }, PNG, head);
  assert.equal(ok.c, 201);
  assert.equal(ok.j.kind, "image");
  assert.equal(ok.j.mime, "image/png");
  assert.equal(String(stored[0].uploader), A);
  assert.ok(stored[0].expireAt instanceof Date); // unused uploads expire
});

test("download: members only; the server sets the type; never runs as a page", async () => {
  stored.length = 0;
  stored.push({ _id: FID, conversation: CID, uploader: A, name: "cv.pdf", mime: "application/pdf", kind: "file", used: true, data: PDF });
  const P = { id: CID, attachmentId: FID };
  assert.equal((await call(downloadAttachment, C, P)).c, 404); // outsider
  assert.equal((await call(downloadAttachment, B, { id: CID, attachmentId: oid(71) })).c, 404);
  assert.equal((await call(downloadAttachment, A, { id: "bad", attachmentId: FID })).c, 400);
  const r = await call(downloadAttachment, B, P);
  assert.equal(r.c, 200);
  assert.equal(r.headers["Content-Type"], "application/pdf");
  assert.match(r.headers["Content-Disposition"], /^attachment;/);
  assert.equal(r.headers["X-Content-Type-Options"], "nosniff");
  assert.match(r.headers["Content-Security-Policy"], /sandbox/);
  // an upload no message has used yet can only be fetched by whoever uploaded it
  stored[0].used = false;
  assert.equal((await call(downloadAttachment, B, P)).c, 404);
  assert.equal((await call(downloadAttachment, A, P)).c, 200);
});
