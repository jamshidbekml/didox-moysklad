# MoySklad ↔ Didox Integration (MVP)

A Node.js/TypeScript server that implements a MoySklad solution per [Vendor API 1.0](https://dev.moysklad.ru/doc/api/vendor/1.0/). This MVP covers the lifecycle skeleton: activation, deactivation, JWT auth in both directions, a settings iframe, and per-account state. **Didox API calls are intentionally not wired up yet** — this is the foundation you build them on.

## What works in this MVP

- ✅ Activation handler (`PUT /apps/{appId}/{accountId}`) — handles `Install`, `Resume`, `TariffChanged`, `Autoprolongation`
- ✅ Deactivation handler (`DELETE /apps/{appId}/{accountId}`) — handles `Uninstall`, `Suspend`
- ✅ Status check (`GET /apps/{appId}/{accountId}`)
- ✅ JWT verification of incoming MoySklad requests (HS256, with replay protection via `jti` cache)
- ✅ JWT signing of outgoing requests to MoySklad Vendor API
- ✅ Main iframe with locale-aware UI (ru/en)
- ✅ Bootstrap endpoint that resolves `contextKey` → MoySklad user context
- ✅ Settings save that transitions `SettingsRequired` → `Activated` via callback
- ✅ Idempotent installation upsert (safe for Retry)
- ✅ Structured logging with `pino`

## What's deliberately left as `TODO` for the next pass

- ⏳ Persistent storage (currently in-memory `Map`)
- ⏳ Encryption-at-rest for `access_token` and Didox credentials
- ⏳ Webhook registration on activation
- ⏳ Custom attribute creation on `demand` / `invoiceOut` (`didoxId`, `didoxStatus`)
- ⏳ Custom button to send a document to Didox
- ⏳ Widget showing Didox status inside the document card
- ⏳ Async button handler + `POST /apps/{appId}/button/complete` notifications
- ⏳ Actual Didox API client (you'll need to share Didox docs)

## Project layout

```
src/
├── config/index.ts            env var loading + validation
├── middleware/auth.ts         JWT verification middleware
├── routes/
│   ├── vendor.ts              PUT/DELETE/GET /apps/:appId/:accountId
│   └── settings.ts            /settings/iframe + /settings/bootstrap + /settings/save
├── services/
│   ├── jwt.ts                 sign + verify JWT (with jti replay cache)
│   ├── moysklad.ts            Vendor API client + JsonApiClient
│   └── store.ts               in-memory installation store
├── types/vendor.ts            request/response types
├── utils/logger.ts            pino logger
└── index.ts                   express app entry
descriptor.xml                 paste this into Личный кабинет разработчика
```

## Setup

1. **Install:**
   ```bash
   npm install
   ```

2. **Configure:** Copy `.env.example` to `.env` and fill in:
   - `PUBLIC_BASE_URL` — your server's public HTTPS URL (e.g. `https://didox.yourcompany.uz`)
   - `MOYSKLAD_APP_ID`, `MOYSKLAD_APP_UID`, `MOYSKLAD_SECRET_KEY` — from your draft in Личный кабинет разработчика → Учётные данные решения

3. **Run in dev mode:**
   ```bash
   npm run dev
   ```

4. **Run in production:**
   ```bash
   npm run build
   npm start
   ```

5. **Expose to MoySklad:**
   - Set `PUBLIC_BASE_URL` to your public HTTPS URL (use Cloudflare Tunnel, ngrok, or a real domain for local testing — MoySklad requires HTTPS)
   - Update `descriptor.xml` so both `iframes/iframe[@type='main']/@sourceUrl` and `vendorApi/endpointBase` point to it
   - Paste the descriptor into Личный кабинет разработчика → ваше решение → редактирование

6. **Install on your developer account** and you should see the settings iframe.

## How a request flows through the system

### Installation
1. User clicks **Установить** in the catalog.
2. MoySklad sends `PUT https://your-server/api/moysklad/vendor/1.0/apps/{appId}/{accountId}` with `cause=Install` and an `access_token`.
3. Our middleware verifies the JWT signature, checks `jti` for replay, attaches the payload.
4. `vendorRouter` upserts the installation, stores the token, and returns `{ status: "SettingsRequired" }`.
5. MoySklad shows our iframe; user clicks **Открыть** and the browser loads `/settings/iframe?contextKey=...`.
6. The iframe calls `/settings/bootstrap`, which calls MoySklad's `POST /context/{contextKey}` to identify the user.
7. User fills the form, presses Save. `/settings/save` validates again via `contextKey`, persists settings.
8. We call MoySklad's `PUT /apps/{appId}/{accountId}/status` with `{ status: "Activated" }`. Done.

### Uninstallation
1. User clicks **Удалить**.
2. MoySklad sends `DELETE https://your-server/api/moysklad/vendor/1.0/apps/{appId}/{accountId}` with `cause=Uninstall`.
3. By the time this fires, the access_token is already revoked on MoySklad's side.
4. We mark the installation `Deactivated` (keeping the row for a retention period in production).

### JWT in/out

**Incoming (MoySklad → us):** `Authorization: Bearer <jwt>` with payload `{ iat, exp, jti }`. We verify HS256 with `secretKey`, check expiry, and ensure `jti` hasn't been seen. The `jti` cache lives in process memory — for multi-instance deployments, move to Redis.

**Outgoing (us → MoySklad):** Every call to `apps-api.moysklad.ru/api/vendor/1.0/*` carries a freshly-signed JWT with `{ sub: appUid, iat, exp, jti }`. Tokens are one-shot — Axios interceptors generate a new one per request.

## Security notes

- **`secretKey` is the single most sensitive value.** Anyone with it can forge both directions of Vendor API traffic. Keep it out of git, rotate via Личный кабинет if it leaks.
- **Access tokens are per-account, indefinite lifetime, and revoked on Uninstall/Suspend.** Treat them like passwords. The MVP keeps them in memory; production should encrypt them at rest.
- **`contextKey` lives 5 minutes** and is bound to a single user session inside MoySklad. Always re-resolve it via `POST /context/{contextKey}` before performing any state mutation — do not trust client-side claims.
- **Don't return 4xx on transient failures.** MoySklad treats 4xx as permanent failure and marks the install `ActivationFailed`. Return 503 for retriable issues so the Retry mechanism kicks in.

## Next steps to extend toward full Didox integration

1. **Swap the in-memory store for Postgres.** Add migrations, encrypt `access_token` and `didoxToken`.
2. **On activation, create webhooks** for `demand` / `invoiceout` events using the granted `access_token`.
3. **On activation, create custom attributes** on those entity types (`didoxId`, `didoxStatus`, `didoxError`) via JSON API metadata endpoints.
4. **Add a custom button** in the descriptor under `<buttons>` for `document.demand.edit` titled "Отправить в Didox". Implement the button handler at `POST /api/moysklad/vendor/1.0/apps/:appId/:accountId/button` with `async: true`.
5. **Add a widget** under `<widgets>` for `document.demand.edit` that displays current Didox status by reading the custom attribute.
6. **Add a Didox client service.** Map MoySklad fields:
   - Seller → `myCompany` + its `mod__requisites__uz` (INN/OKED/vatPayerRegCode)
   - Buyer → counterparty `mod__requisites__uz` (INN/PINFL/OKED)
   - Lines → demand positions, IKPU from product's `mod__tasnif__uz.ikpu`, VAT from `vat`/`vatEnabled`
7. **On Didox submission success**, write the Didox document ID + status back to MoySklad as custom attributes and call `POST /apps/{appId}/button/complete` to notify the user.

## Useful references

- [Vendor API 1.0](https://dev.moysklad.ru/doc/api/vendor/1.0/)
- [JSON API 1.2](https://dev.moysklad.ru/doc/api/remap/1.2/)
- [Official PHP demo](https://github.com/moysklad/php-dummyapp-marketplace-1.0)
- [JS Widget SDK](https://github.com/moysklad/js-widget-sdk)
