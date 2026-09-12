# Store submission

## Package

```sh
npm run package --workspace=@wally/psiu-bridge
```

Upload `extensions/psiu-bridge/wally-psiu-bridge.zip` to each store.

- Chrome Web Store signs and hosts the submitted package.
- Microsoft Edge Add-ons signs and hosts the submitted package.
- Do not distribute CRX files from the Wally site.

## Listing copy

**Name:** Wally PSIU Bridge

**Short description:** Securely connects Wally Analyzer in Chrome or Edge to your local Wally PSIU.

**Description:** Wally PSIU Bridge enables Wally Analyzer to read PSIU status, start and stop recordings, and retrieve a completed recording from `psiu.local`. It runs only on Wally Analyzer and permits only fixed PSIU commands. It does not provide arbitrary network proxy access.

## Permission justification

`http://psiu.local/*` is required to communicate with the user's local PSIU. The extension's content script runs only on Wally Analyzer and its service worker allows only UID, status, sampling control, and completed WAV retrieval.

## Required store assets

- `icons/icon-128.png` — listing icon.
- At least one Chrome and Edge store screenshot after the bridge is installed.
- Privacy policy URL and support contact.
- Store developer accounts for Wally Analytics / WAM Engineering.

## After publication

Replace the temporary browser-store search links in `app-ui/src/App.tsx` with the exact Chrome Web Store and Edge Add-ons listing URLs.
