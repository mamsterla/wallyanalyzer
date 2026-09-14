# Wally PSIU Bridge

Chrome/Edge Manifest V3 extension that transports fixed PSIU commands from Wally Analyzer to `http://psiu.local`. It is not a proxy and never accepts arbitrary LAN URLs.

## Commands

- `GET /uid`
- `GET /status`
- `POST /api/inputsel` with `{ "xlr": boolean }`
- `POST /api/sampling` with `{ "running": boolean }`
- `GET /audio.wav`

The extension runs only on `https://wally-analytics.app` and local development origins. The page communicates with its injected content script; the service worker has the sole LAN host permission.

## Local installation

```sh
npm run build --workspace=@wally/psiu-bridge
```

1. Open `chrome://extensions` or `edge://extensions`.
2. Enable **Developer mode**.
3. Select **Load unpacked**.
4. Select `extensions/psiu-bridge/dist`.
5. Open or reload Wally Analyzer.

## Distribution

Production distribution must use the Chrome Web Store and Edge Add-ons channels. Do not deploy the Wally UI transport switch until the extension is available to every intended desktop user.
