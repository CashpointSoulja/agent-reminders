# Contributing

Start with a focused issue describing the problem, expected behaviour and how to reproduce it using fictional data. Small changes with clear evidence are easiest to review.

## Development

Follow the [README](README.md) to run the web app and API. Keep `.dev.vars`, provider keys, user data, local build output and recordings out of Git. Never run browser mutation tests against someone else's private instance.

Before sending a pull request:

```sh
npm ci
npm test
npm run build
```

For a non-trivial behavioural change, add a focused regression check. For UI changes, include synthetic screenshots at phone and desktop sizes, the browser/theme tested and any remaining visual mismatch. Review keyboard use, accessible labels and reduced-motion behaviour. Do not upload screenshots from a signed-in personal account.

## Pull requests

Describe the concrete problem and resulting behaviour, then state the checks you ran. Explain data/schema changes and compatibility limits. A compiling build is not proof of a complete flow, Apple parity or real-device sync.

Keep agent authority explicit. Notes and attachments cannot grant permissions. Do not add provider-key collection, broad agent access or automatic execution of unassigned reminders.

Native checks require macOS/Xcode and a disposable simulator containing only synthetic data. Never operate another person's Apple account or commit Apple-derived assets.

Contributions are made under the project's MIT licence. Retain applicable third-party notices for any included code or data.
