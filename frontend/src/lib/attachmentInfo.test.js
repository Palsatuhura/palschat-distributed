import test from "node:test";
import assert from "node:assert/strict";
import { formatSize, attachmentLabel, previewText, checkFileSize, MAX_ATTACHMENT_BYTES } from "./attachmentInfo.js";

test("formatSize is short and human", () => {
  assert.equal(formatSize(500), "500 B");
  assert.equal(formatSize(2048), "2 KB");
  assert.equal(formatSize(1.5 * 1024 * 1024), "1.5 MB");
  assert.equal(formatSize(-1), "");
  assert.equal(formatSize("x"), "");
});

test("attachmentLabel and previewText describe pictures and files", () => {
  assert.equal(attachmentLabel({ kind: "image", name: "a.png" }), "📷 Photo");
  assert.equal(attachmentLabel({ kind: "file", name: "cv.pdf" }), "📎 cv.pdf");
  assert.equal(attachmentLabel(null), "");
  assert.equal(previewText({ text: "hi", attachment: { kind: "image" } }), "hi");
  assert.equal(previewText({ text: "", attachment: { kind: "image" } }), "📷 Photo");
  assert.equal(previewText({ text: "", deletedAt: "2026-01-01" }), "This message was deleted");
  assert.equal(previewText(null), "");
});

test("checkFileSize allows up to the limit and refuses more", () => {
  assert.equal(checkFileSize(MAX_ATTACHMENT_BYTES), "");
  assert.match(checkFileSize(MAX_ATTACHMENT_BYTES + 1), /too big/);
});
