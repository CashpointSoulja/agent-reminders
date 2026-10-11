import data from "./emoji-data.js";

export const EMOJI_CATEGORIES = [
  "Smileys & People", "Animals & Nature", "Food & Drink", "Activity",
  "Travel & Places", "Objects", "Symbols", "Flags",
];
export const EMOJI_DATA = data;
const known = new Set(data.map(([emoji]) => emoji));
const withoutTone = (emoji) => emoji.replace(/[\u{1f3fb}-\u{1f3ff}]/gu, "");
// Only these first nine columns were observed directly in the iOS 26.5 audit.
const nativeSmileys = [
  "😀", "😃", "😄", "😁", "😆", "🥹", "😅", "😂", "🤣", "🥲",
  "☺️", "😊", "😇", "🙂", "🙃", "😉", "😌", "😍", "🥰", "😘",
  "😗", "😙", "😚", "😋", "😛", "😝", "😜", "🤪", "🤨", "🧐",
  "🤓", "😎", "🥸", "🤩", "🥳", "🙂‍↕️", "😏", "😒", "🙂‍↔️", "😞",
  "😔", "😟", "😕", "🙁", "☹️",
];
const nativeOrder = new Map(nativeSmileys.map((emoji, index) => [emoji, index]));
export const EMOJI_PALETTE = data.filter(([emoji]) => withoutTone(emoji) === emoji)
  .sort((a, b) => (nativeOrder.get(a[0]) ?? 9999) - (nativeOrder.get(b[0]) ?? 9999));

export function emojiFromIcon(icon) {
  const emoji = typeof icon === "string" && icon.startsWith("emoji:") ? icon.slice(6) : "";
  return known.has(emoji) ? emoji : "";
}
export function validListIcon(icon) {
  return typeof icon === "string" && icon.trim().length > 0 &&
    (!icon.startsWith("emoji:") || Boolean(emojiFromIcon(icon)));
}
export function searchEmoji(query) {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return data.filter(([emoji, name]) => words.every((word) =>
    emoji.includes(word) || name.toLowerCase().includes(word)));
}
export function emojiVariants(emoji) {
  const base = withoutTone(emoji);
  return data.filter(([value]) => withoutTone(value) === base);
}
export function rememberEmoji(recents, emoji) {
  return [...new Set([emoji, ...recents])].filter((value) => known.has(value)).slice(0, 30);
}
