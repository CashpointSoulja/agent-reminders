# Third-party notices

The [MIT project licence](LICENSE) covers independently authored project code. The following data and installed dependencies retain their own licences.

## Unicode emoji data

`src/emoji-data.js` contains Unicode Emoji 17.0 names and sequences. Copyright © 1991–2026 Unicode, Inc. The [Unicode License v3](docs/licenses/UNICODE-LICENSE.txt) is included in full.

## IANA time zones

`src/time-zone-data.js` contains canonical zone names and locations derived from the public-domain IANA time-zone database [`zone.tab`](https://github.com/eggert/tz/blob/main/zone.tab). The local catalogue is a fallback, not Apple's complete city picker.

## Material design reference

The independently written CSS uses blur, saturation, edge highlights and shadow techniques informed by [rdev/liquid-glass-react](https://github.com/rdev/liquid-glass-react), an MIT project by Max Rovensky. Its React package is not bundled. This app does not claim the same refraction implementation or native optical rendering.

## Dependencies

Picker glyphs use [Lucide](https://lucide.dev), licensed under ISC. Some icons derive from Feather and retain its MIT notice. The [complete installed Lucide/Feather licence](docs/licenses/LUCIDE-LICENSE.txt) is included unchanged.

Expo, React, React DOM, React Native and React Native Web are installed through npm. Playwright and Wrangler are development tools. Their own licence files and transitive dependency notices are distributed with the installed packages; exact resolved versions are recorded in `package-lock.json`.

Operating-system fonts and emoji are requested by family name and rendered by the user's platform. No Apple binaries, fonts, screenshots or extracted native glyph assets are included in this public source snapshot.
