# Browser and server build modes

`npm start` and `npm run build:demo` select the browser-local app. `npm run start:server` and `npm run build` select the protected server app. These are separate entry modes, not a runtime switch inside a deployed page.

Expo inlines `EXPO_PUBLIC_*` values in production bundles. With the installed Expo toolchain, exporting the server mode immediately after the demo mode reused the cached demo entry even though the command set `EXPO_PUBLIC_DEMO_MODE=0`. Clearing the bundler cache produces the correct entry. All four start/build scripts now pass `--clear`, including after changes to the public Google client ID.

When testing both builds, keep their output directories separate:

```sh
npm run build -- --output-dir work/build-mode/server
npm run build:demo -- --output-dir work/build-mode/demo
```

Inspect the actual registered root component or load each export in a fresh browser context. A bundle containing both the demo text and sign-in text does not prove its mode: Expo includes both imported modules. The demo should open the local Reminders interface; the server mode should perform its protected-session flow.

Mode-switch verification executed each generated entry module with isolated dependency markers: the server export registered `ServerApp`, then the demo export registered `DemoApp`. The frozen static artifact was left untouched. Cache clearing adds a rebuild on startup/export; existing browser data and server data are preserved.
