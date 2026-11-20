import test from "node:test";
import assert from "node:assert/strict";
import { decideNotification } from "./notify.js";
import { unreadTotal, tabTitle } from "./tabTitle.js";
import { isNearBottom, shouldFollowNewMessage } from "./scrollRules.js";

const base = { fromMe: false, muted: false, viewingChat: false, tabHidden: false, soundOn: true, desktopOn: true };

test("a message in another chat plays the sound, with no desktop pop-up while the tab is visible", () => {
  assert.deepEqual(decideNotification(base), { sound: true, desktop: false });
});

test("with the tab in the background both alerts fire (if switched on)", () => {
  assert.deepEqual(decideNotification({ ...base, tabHidden: true, viewingChat: true }), { sound: true, desktop: true });
  assert.deepEqual(decideNotification({ ...base, tabHidden: true, soundOn: false, desktopOn: false }), { sound: false, desktop: false });
});

test("nothing alerts for the chat I am looking at, my own messages, or muted chats", () => {
  assert.deepEqual(decideNotification({ ...base, viewingChat: true }), { sound: false, desktop: false });
  assert.deepEqual(decideNotification({ ...base, fromMe: true, tabHidden: true }), { sound: false, desktop: false });
  assert.deepEqual(decideNotification({ ...base, muted: true, tabHidden: true }), { sound: false, desktop: false });
});

test("tab title counts unread messages of chats that are not muted", () => {
  const convs = [{ _id: "a" }, { _id: "b", muted: true }, { _id: "c" }];
  assert.equal(unreadTotal(convs, { a: 2, b: 5, c: 1, zzz: 9 }), 3);
  assert.equal(unreadTotal([], {}), 0);
  assert.equal(unreadTotal(undefined, undefined), 0);
  assert.equal(tabTitle(0), "PalsChat");
  assert.equal(tabTitle(3), "(3) PalsChat");
  assert.equal(tabTitle(250), "(99+) PalsChat");
  assert.equal(tabTitle("junk"), "PalsChat");
});

test("the list follows new messages only when it should", () => {
  assert.equal(isNearBottom(1000, 880, 100), true); // 20 px from the bottom
  assert.equal(isNearBottom(1000, 500, 100), false);
  assert.equal(shouldFollowNewMessage({ firstLoad: true, isMine: false, wasNearBottom: false }), true);
  assert.equal(shouldFollowNewMessage({ firstLoad: false, isMine: true, wasNearBottom: false }), true);
  assert.equal(shouldFollowNewMessage({ firstLoad: false, isMine: false, wasNearBottom: true }), true);
  assert.equal(shouldFollowNewMessage({ firstLoad: false, isMine: false, wasNearBottom: false }), false);
});
