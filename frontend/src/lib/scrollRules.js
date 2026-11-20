/**
 * Rules for the message list. Plain functions so they can be tested.
 */

/** Is the reader at (or very near) the bottom of the list? */
export const isNearBottom = (scrollHeight, scrollTop, clientHeight, threshold = 120) =>
  scrollHeight - scrollTop - clientHeight <= threshold;

/**
 * A new message arrived: should the list scroll down by itself?
 *   - when the chat has just been opened;
 *   - when I sent it;
 *   - when I was already at the bottom.
 * Otherwise the reader is reading older messages and must not be pulled
 * away; a "jump to latest" button is shown instead.
 */
export const shouldFollowNewMessage = ({ firstLoad, isMine, wasNearBottom }) =>
  Boolean(firstLoad || isMine || wasNearBottom);
