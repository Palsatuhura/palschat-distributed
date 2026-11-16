/**
 * Unit tests for the chat store (npm test).
 */
import test from "node:test";
import assert from "node:assert/strict";
import useChatStore from "./chatStore.js";

const msg = (id, t, extra = {}) => ({ _id: id, createdAt: new Date(t).toISOString(), text: id, ...extra });
const reset = () => useChatStore.getState().resetChat();
const state = () => useChatStore.getState();

test("setActiveConversation clears messages when switching", () => {
  reset();
  state().setActiveConversation({ _id: "a" });
  state().setMessages([msg("m1", 1)]);
  state().setActiveConversation({ _id: "b" });
  assert.deepEqual(state().messages, []);
});

test("re-selecting the open conversation keeps its messages", () => {
  reset();
  state().setActiveConversation({ _id: "a" });
  state().setMessages([msg("m1", 1)]);
  state().setActiveConversation({ _id: "a", groupName: "renamed" });
  assert.equal(state().messages.length, 1);
  assert.equal(state().activeConversation.groupName, "renamed");
});

test("prependMessages puts an older page first and drops duplicates", () => {
  reset();
  state().setMessages([msg("m3", 3), msg("m4", 4)]);
  state().prependMessages([msg("m1", 1), msg("m2", 2), msg("m3", 3)]);
  assert.deepEqual(state().messages.map((m) => m._id), ["m1", "m2", "m3", "m4"]);
});

test("mergeMessages fills a gap in order and ignores messages it already has", () => {
  reset();
  state().setMessages([msg("m1", 1), msg("m4", 4)]);
  state().mergeMessages([msg("m2", 2), msg("m3", 3), msg("m4", 4)]);
  assert.deepEqual(state().messages.map((m) => m._id), ["m1", "m2", "m3", "m4"]);
});

test("mergeMessages with nothing new does not replace the array", () => {
  reset();
  state().setMessages([msg("m1", 1)]);
  const before = state().messages;
  state().mergeMessages([msg("m1", 1)]);
  assert.equal(state().messages, before);
});

test("addMessage ignores a message that is already there", () => {
  reset();
  state().addMessage(msg("m1", 1));
  state().addMessage(msg("m1", 1));
  assert.equal(state().messages.length, 1);
});

test("unread count rises for others' messages in a closed conversation only", () => {
  reset();
  state().setConversations([{ _id: "c1", updatedAt: "2026-01-01" }, { _id: "c2", updatedAt: "2026-01-01" }]);

  const fromOther = msg("m1", 5, { sender: { _id: "bob" } });
  const fromMe = msg("m2", 6, { sender: { _id: "me" } });

  state().updateConversationLastMessage("c1", fromOther, "c2", "me"); // c1 closed
  assert.equal(state().unreadCounts.c1, 1);

  state().updateConversationLastMessage("c1", fromMe, "c2", "me"); // my own message
  assert.equal(state().unreadCounts.c1, 1);

  state().updateConversationLastMessage("c2", fromOther, "c2", "me"); // c2 is open
  assert.equal(state().unreadCounts.c2, undefined);
});

test("a new message moves its conversation to the top of the sidebar", () => {
  reset();
  state().setConversations([
    { _id: "old", updatedAt: "2026-01-02T00:00:00Z" },
    { _id: "new", updatedAt: "2026-01-01T00:00:00Z" },
  ]);
  state().updateConversationLastMessage("new", msg("m1", Date.UTC(2026, 5, 1), { sender: "bob" }), null, "me");
  assert.deepEqual(state().conversations.map((c) => c._id), ["new", "old"]);
});

test("resetChat forgets the previous user's data", () => {
  state().setConversations([{ _id: "c1" }]);
  state().setMessages([msg("m1", 1)]);
  state().setActiveConversation({ _id: "c1" });
  state().resetChat();
  assert.equal(state().conversations.length, 0);
  assert.equal(state().messages.length, 0);
  assert.equal(state().activeConversation, null);
  assert.deepEqual(state().unreadCounts, {});
});

test("applyReceipt: a read receipt marks messages read AND delivered, for the open chat only", () => {
  reset();
  state().setActiveConversation({ _id: "c1" });
  state().setMessages([
    msg("m1", 1, { sender: { _id: "me" }, readBy: ["me"], deliveredTo: [] }),
    msg("m2", 2, { sender: { _id: "bob" }, readBy: ["bob"] }),
  ]);

  state().applyReceipt("other-conversation", "bob", "readBy");
  assert.deepEqual(state().messages[0].readBy, ["me"], "other conversation ignored");

  state().applyReceipt("c1", "bob", "readBy");
  assert.deepEqual(state().messages[0].readBy, ["me", "bob"]);
  assert.deepEqual(state().messages[0].deliveredTo, ["bob"]);
  assert.deepEqual(state().messages[1].readBy, ["bob"], "bob's own message is untouched");
});

test("applyReceipt: delivery does not mark as read, and repeats change nothing", () => {
  reset();
  state().setActiveConversation({ _id: "c1" });
  state().setMessages([msg("m1", 1, { sender: { _id: "me" }, readBy: ["me"] })]);

  state().applyReceipt("c1", "bob", "deliveredTo");
  assert.deepEqual(state().messages[0].deliveredTo, ["bob"]);
  assert.deepEqual(state().messages[0].readBy, ["me"]);

  const before = state().messages;
  state().applyReceipt("c1", "bob", "deliveredTo");
  assert.equal(state().messages, before, "no change, no new array");
});

test("addUser adds a new person once and ignores duplicates", () => {
  reset();
  state().setUsers([{ _id: "u1", name: "A" }]);
  state().addUser({ _id: "u2", name: "B" });
  state().addUser({ _id: "u2", name: "B" });
  assert.deepEqual(state().users.map((u) => u._id), ["u1", "u2"]);
});
