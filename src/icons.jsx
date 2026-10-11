import React from "react";
import { pickerIcons } from "./picker-icons.js";
import { emojiFromIcon } from "./emoji";
export default function Icon({
  name = "list",
  size = 20,
  color = "currentColor",
  nativePicker = false,
}) {
  const emoji = emojiFromIcon(name);
  if (emoji) return <span aria-hidden="true" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0, width: size, height: size, fontSize: size, lineHeight: 1, fontFamily: '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif' }}>{emoji}</span>;
  const paths = {
    list: (
      <>
        <path d="M9 6h11M9 12h11M9 18h11" />
        <circle cx="4" cy="6" r="1" />
        <circle cx="4" cy="12" r="1" />
        <circle cx="4" cy="18" r="1" />
      </>
    ),
    today: (
      <>
        <rect x="3" y="5" width="18" height="16" rx="3" />
        <path d="M7 3v4M17 3v4M3 10h18" />
        <text
          x="12"
          y="18"
          textAnchor="middle"
          fontSize="8"
          fill={color}
          stroke="none"
        >
          {new Date().getDate()}
        </text>
      </>
    ),
    scheduled: (
      <>
        <rect x="3" y="4" width="18" height="17" rx="3" />
        <path d="M7 2v4M17 2v4M3 9h18" />
        <path d="M7 13h1m4 0h1m4 0h1M7 17h1m4 0h1m4 0h1" />
      </>
    ),
    flag: <path d="M5 21V4c5-4 9 4 15 0v10c-6 4-10-4-15 0" />,
    inbox: <path d="M3 14 7 5h10l4 9v6H3Zm0 0h5l2 3h4l2-3h5" />,
    check: <path d="m5 12 4 4L19 6" />,
    plus: <path d="M12 4v16M4 12h16" />,
    search: (
      <>
        <circle cx="10" cy="10" r="7" />
        <path d="m15 15 6 6" />
      </>
    ),
    info: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 10v7M12 6v1" />
      </>
    ),
    share: (
      <>
        <path d="M8 9H5v12h14V9h-3M12 15V2m-4 4 4-4 4 4" />
      </>
    ),
    back: <path d="m15 4-8 8 8 8" />,
    more: (
      <>
        <circle cx="4" cy="12" r="1" />
        <circle cx="12" cy="12" r="1" />
        <circle cx="20" cy="12" r="1" />
      </>
    ),
    board: (
      <>
        <rect x="3" y="4" width="7" height="16" rx="2" />
        <rect x="14" y="4" width="7" height="16" rx="2" />
      </>
    ),
    briefcase: (
      <>
        <rect x="3" y="7" width="18" height="14" rx="3" />
        <path d="M8 7V3h8v4M3 12h18M10 12v3h4v-3" />
      </>
    ),
    person: (
      <>
        <circle cx="12" cy="7" r="4" />
        <path d="M4 21v-2a8 8 0 0 1 16 0v2" />
      </>
    ),
    cart: (
      <>
        <path d="M2 3h3l3 13h11l3-10H6" />
        <circle cx="9" cy="21" r="1" />
        <circle cx="19" cy="21" r="1" />
      </>
    ),
    urgent: (
      <>
        <path d="m12 2 10 19H2Z" />
        <path d="M12 8v6m0 3v1" />
      </>
    ),
    trash: (
      <>
        <path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7" />
      </>
    ),
  };
  const PickerIcon = pickerIcons[name];
  if (PickerIcon && (nativePicker || !paths[name]))
    return <PickerIcon size={size} color={color} strokeWidth={1.7} aria-hidden="true" style={{flexShrink: 0}} />;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name] || paths.list}
    </svg>
  );
}
