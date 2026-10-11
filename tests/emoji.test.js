import test from "node:test";
import assert from "node:assert/strict";
import { EMOJI_DATA, EMOJI_CATEGORIES, EMOJI_PALETTE, emojiFromIcon, validListIcon, searchEmoji, emojiVariants, rememberEmoji } from "../src/emoji.js";

test("pinned Unicode palette covers qualified sequences, flags and joined families", () => {
  assert.equal(EMOJI_DATA.length, 3944);
  assert.equal(EMOJI_CATEGORIES.length, 8);
  assert.deepEqual(EMOJI_PALETTE.slice(0, 5).map(([emoji]) => emoji), ["😀", "😃", "😄", "😁", "😆"]);
  for (const emoji of ["🍉", "👍🏽", "🇬🇧", "👩‍👩‍👦", "🏴󠁧󠁢󠁥󠁮󠁧󠁿"]) assert.equal(emojiFromIcon(`emoji:${emoji}`), emoji);
  for (const invalid of ["emoji:", "emoji:hello", "emoji:🍉🍉", "emoji:<svg>", "emoji:https://example.com", null]) assert.equal(validListIcon(invalid), false);
  assert.equal(validListIcon("list"), true);
  assert.equal(validListIcon("legacy-icon"), true);
});

test("search and variants retain exact Unicode sequences and names", () => {
  assert.deepEqual(searchEmoji("watermelon").map(([emoji]) => emoji), ["🍉"]);
  assert.ok(searchEmoji("united kingdom").some(([emoji]) => emoji === "🇬🇧"));
  assert.equal(searchEmoji("query-with-no-match-123").length, 0);
  assert.equal(searchEmoji(" ").length, 0);
  assert.deepEqual(emojiVariants("👍").map(([emoji]) => emoji), ["👍", "👍🏻", "👍🏼", "👍🏽", "👍🏾", "👍🏿"]);
});

test("recent choices are bounded, deduplicated and cannot contain injected text", () => {
  assert.deepEqual(rememberEmoji(["😀", "🍉", "bad", "🍉"], "🍉"), ["🍉", "😀"]);
  assert.equal(rememberEmoji(EMOJI_PALETTE.map(([emoji]) => emoji), "🍉").length, 30);
});
