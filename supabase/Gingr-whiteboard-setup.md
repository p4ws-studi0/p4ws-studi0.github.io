# Gingr Digital Whiteboard

`hq-gingr-whiteboard` is a read-only Supabase Edge Function used by the HQ Digital Whiteboard page. It calls Gingr's `GET /api/v1/back_of_house` endpoint from the server, verifies the signed-in HQ user, and requires an active `hq_tour_staff` approval for every request. Keep gateway JWT verification enabled.

## Configuration

Set **`GINGR_API_KEY`** in the Paws Supabase project's **Edge Functions → Secrets**. Use a valid Gingr user API key that can read reservation types and the digital whiteboard. Do not put the key in HTML, browser JavaScript, a committed file, or a browser request URL.

Optional server settings:

| Secret | Default | Purpose |
| --- | --- | --- |
| `GINGR_SUBDOMAIN` | `pawspet` | Subdomain only, without a URL or `.gingrapp.com` |
| `GINGR_LOCATION_ID` | `1` | Paws Pet Resort & Spa - Cheshire |
| `GINGR_TYPE_IDS` | Automatic | Comma-separated IDs (`1,2,5`) or JSON array (`[1,2,5]`) to restrict included reservation types |
| `HQ_ORIGIN` | `https://hq.pawspet.com` | Permitted HQ browser origin |

`SUPABASE_URL` and `SUPABASE_ANON_KEY` are provided by the Edge Functions runtime. The function does not require a service-role key. If `GINGR_TYPE_IDS` is unset, it discovers reservation types from Gingr's read-only `reservation_types` endpoint, validates their IDs, and caches those IDs for five minutes. It always sends explicit `type_ids[]` values to `back_of_house`. A malformed or empty discovery result is an error, not a request for unrestricted data.

Deploy the function directory with the `supabase/config.toml` entry. No database migration or new staff enrollment is needed.

## Browser contract

Call `supabaseClient.functions.invoke('hq-gingr-whiteboard', {body: {full_day: true}})` for today, or pass `{mins_future: 60}` for Gingr's previous/next 60-minute window. The default empty body means today. Minutes must be an integer from 1 through 1440; `full_day: true` takes precedence. Authenticated GET requests with the equivalent query parameters are also supported. Callers cannot change location, reservation types, host, or credentials.

Success returns:

```json
{
  "checking_in": [],
  "checking_out": [],
  "updated_at": "2026-10-13T13:00:00.000Z",
  "full_day": true,
  "mins_future": null,
  "timezone": "America/New_York",
  "gingr_url": "https://pawspet.gingrapp.com"
}
```

Rows contain only the documented Digital Whiteboard fields. Numeric IDs remain strings; timestamps, status ID and belongings count become numbers or `null`. Text fields are bounded. Unknown fields are omitted. A malformed response, unknown type, duplicate reservation within a column, missing column, excessive body size or excess row count fails the request instead of silently dropping records. The same reservation can appear once in each column for a same-day arrival and departure.

Upstream snapshots are shared for 15 seconds per time window to limit duplicate requests. Staff authorization is always checked before returning a cached snapshot. `updated_at` is the actual fetch time, including when a cached result is returned. All HTTP responses use `private, no-store`. The browser should mark a retained snapshot as stale when refreshing fails and clear it on sign-out or changes to the requested time window.

Errors have the shape `{"error":{"code":"CONNECTION_REQUIRED"}}`. Codes are `AUTH_REQUIRED`, `ACCESS_DENIED`, `AUTH_UNAVAILABLE`, `CONNECTION_REQUIRED`, `GINGR_UNAVAILABLE`, `RATE_LIMITED`, `INVALID_REQUEST`, and `METHOD_NOT_ALLOWED`. A 401/403 from Gingr maps to `CONNECTION_REQUIRED`; rate limits return a bounded `Retry-After`. Logs contain only allowlisted diagnostic reason codes, never credentials, request URLs, provider bodies, or customer records.

## Verification

Run `node --test tests/gingr-whiteboard.test.cjs`. These tests use synthetic data and mocked providers. After deployment and setting the secret, verify the signed-in page with a real HQ account: today, an around-now window, a service filter, a refresh, and an empty result. An invalid key must show a connection state, not claim there are no arrivals or departures.

Reference: [Gingr API Functions](https://support.gingrapp.com/hc/en-us/articles/25722122517517-Gingr-API-Functions-Reference), sections `back_of_house`, `reservation_types`, and `get_locations`.
