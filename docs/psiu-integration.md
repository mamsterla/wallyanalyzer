# PSIU Browser Controller Integration

`docs/API.pdf` is required contract evidence. This scaffold does not invent PSIU routes, authentication, or payload schemas.

## Browser boundary

The React application runs on a user machine. During local development, it calls the co-located local Node proxy through the same origin; that proxy calls the configured PSIU on the user's LAN. The proxy is Compose-local, not an AWS service. AWS receives sample metadata and uploads only through an explicitly approved future flow.

## Local-LAN security posture

PSIU is a portable appliance on a private, unroutable DHCP LAN. It is not an Internet-facing service and must not receive public port forwarding, public DNS, or cloud proxy exposure. Treat that network boundary as primary deployment protection.

CORS is browser interoperability, not Internet exposure: it permits the local browser application to read PSIU responses. HTTPS is defense in depth and becomes necessary if a browser loads the controller from an HTTPS origin; it is not an account-compromise concern for a private LAN-only milestone. Raise PSIU security concerns prominently only when a design could expose the user's Wally account, credentials, recordings, or AWS resources.

Required firmware/browser capabilities:

- CORS allow-list for local development and deployed UI origin, including `Authorization` and required custom headers.
- Preflight support for controller methods.
- HTTPS support is planned for broader deployment compatibility; trusted local HTTP remains acceptable while PSIU is LAN-only.

### Current firmware evidence

`GET /status` exposes live recorder counters. On the verified PSIU, `pages_written × 2,048 words/page × 2 bytes/word` exactly matched completed `/wav` `data_bytes`; use this as the current-capture byte count.

A local device check returned `GET http://psiu.local/status` with no `Access-Control-Allow-*` headers. `OPTIONS http://psiu.local/api/sampling`, with origin `http://localhost:8081` and requested `authorization,content-type` headers, returned `403` with no CORS headers. The browser cannot call PSIU directly, but the local same-origin Compose proxy supports capture until firmware handles this CORS flow.

Required response behavior:

- Return `Access-Control-Allow-Origin: http://localhost:8081` for local development; use explicit deployed origins later. This controls browser access only and does not make PSIU Internet-reachable.
- Return `Access-Control-Allow-Methods: GET, POST, OPTIONS`.
- Return `Access-Control-Allow-Headers: Authorization, Content-Type`.
- Answer unauthenticated `OPTIONS` preflight requests without device side effects. Keep authentication enforcement on actual `POST` requests.
- If a cookie-based PSIU session is later used, return `Access-Control-Allow-Credentials: true` and use an explicit origin.

- Device version/capabilities endpoint for safe client feature detection.
- Stable sampling/run status model and explicit error codes.
- Browser-safe authentication pattern. Avoid long-lived device secrets stored in local storage.

## Implementation sequence

1. Extract and version PSIU endpoint, request, response, and error contracts from `API.pdf` against actual firmware.
2. Add a typed adapter in `app-ui/src/features/controller/psiuClient.ts`; one method/test per device endpoint.
3. Add device discovery/onboarding UI with user-confirmed base URL, TLS warning, connection test, and capability display.
4. Implement capture controls, progress/retry/cancel, local file validation, and metadata selection.
5. Request an authenticated signed upload from `/v1/samples/uploads`; upload directly to S3; call sample completion endpoint after checksum verification.
6. Test CORS and hardware workflow in a real LAN browser matrix before public release.

## Production local bridge design

The production controller uses a customer-local bridge rather than browser-to-PSIU direct requests. This avoids HTTPS mixed-content failures while preserving the LAN-only PSIU boundary.

- The bridge binds only to loopback and exposes only fixed `/uid`, `/status`, `/capture`, and `/wav` routes. It never proxies arbitrary URLs and never accepts a cloud-initiated connection.
- The bridge allows requests only from the explicit production UI origin and approved local-development origin. It handles required preflight requests without forwarding them to the PSIU.
- First use requires **one-time local pairing**: the customer enters the PSIU device authorization into the bridge setup. The bridge stores it in the operating system credential store; it never sends, logs, or copies this value to Wally, AWS, browser storage, source control, or application configuration.
- The browser receives only PSIU status and WAV bytes through the bridge. After the user selects reports, it obtains a tenant-scoped presigned S3 upload intent from the Wally API, transfers the WAV bytes to private S3, verifies completion, and queues reports. The PSIU never receives AWS credentials or S3 URLs.
- The existing Compose-local proxy remains a development harness only. It must not retrieve a shared PSIU credential from AWS Secrets Manager for customer production use.

## Controller interaction contract

1. Start capture through the bridge and poll bridge status while the PSIU records.
2. Stop capture through the bridge; retrieve the completed WAV only after the user chooses **Process this sample**.
3. The dialog offers report selection or **Discard**. Discard clears local capture state and returns to ready; it does not upload bytes.
4. Processing creates the authenticated upload intent, streams the completed WAV bridge-to-browser-to-S3, completes verification, and atomically queues the selected reports.
5. The home activity queue shows queued, running, completed, and failed report status. No manual browser WAV selection is available.

## Inventory lifecycle

- **Hard delete** is limited to unused test inventory: a PSIU with no assignment, upload-batch, or sample history. This permits clean re-enrollment of its serial number and UID.
- **Unavailable** preserves the unit, assignment history, samples, upload batches, and audit record. It closes any active assignment and permanently blocks enable, assignment, and new upload intents.
- An already-issued S3 presigned PUT URL cannot be revoked. Completion locks and rechecks enabled status, the active owner assignment, and capture UID; a newly unavailable or unassigned unit is rejected and marked failed. New uploads carry an `unaccepted` object tag. Known rejected objects are deleted best-effort; late writes from an issued URL retain that tag and S3 expires them within one day. Only a verified accepted completion retags an object as `accepted`, so accepted raw samples are not selected by the expiration rule. The app task is scoped to `raw/*` objects only.

## Safety constraints

- Do not guess endpoints from a PDF filename or proxy arbitrary device URLs through AWS.
- Do not expose PSIU through public routing, cloud proxies, or public DNS.
- Keep PSIU credentials, recordings, and local discovery data out of AWS unless an explicitly approved upload flow requires them.
- Do not expose AWS credentials to browser or PSIU.
- Preserve raw recordings and device/firmware version as analysis provenance.
