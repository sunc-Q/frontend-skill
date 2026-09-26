# Current user and site profile

Use this example for Qoder login plus a website-owned profile. It edits site data, not Qoder account information. First establish the [trusted Function ingress](functions.md#site-access-and-visitor-identity) and [database authorization](database.md#identity-and-coordination). This example does not provision permissions, implement Supabase Auth or prove database isolation.

## Assemble in the existing project

- Copy `assets/user-context/auth.mjs` and `profile.mjs` to `functions/`.
- Copy `assets/user-context/profile-index.ts` to `functions/index.ts` and `assets/database-function/adapter.mjs` to `functions/adapter.mjs`.
- Copy `assets/database-react/UserProfile.tsx` to `src/App.tsx` and its sibling `api.ts` to `src/api.ts`. Adapt copy and layout to the site language. Keep existing project structure when integrating into an existing page.

The database shape is `app.profiles (user_id text PRIMARY KEY, display_name text NOT NULL)`. Use the [reviewed migration and test-scope workflow](database-migration.md#choose-access-before-creating-a-plan); this shape alone does not authorize anonymous grants or establish isolation.

Use this single assembled flow as the starting point for user-owned records: keep one deployed Function entry, trusted user lookup, bounded body reader, scoped query and persisted-row response. Adapt the fields and UI to the requested product. Keep fixtures in `dev/` instead of maintaining separate production and database handler copies. Shared member lists are a separate read action: explicitly define who can see them, return only requested display fields, paginate, and update the page's visibility copy.

The browser calls `?action=profile`: GET returns the current Qoder account and optional site profile; POST validates and saves a display name using the server-derived user ID. The returned persisted row refreshes the form. The UI preserves input on failed writes, distinguishes login from forbidden access, and automatically reads back an uncertain write result without replaying the mutation. Treat HTTP 5xx responses without an explicit rejection as unknown, including JSON Gateway errors; an explicit `write_rejected` remains a rejection even with HTTP 503, and 401/403 retain the login/access flow. A matching value confirms current state, not exclusive ownership of a concurrent operation. If that read fails, Save stays disabled until Reload succeeds; preserve this behavior when translating copy or adapting the example. Upsert is last-write-wins for this one preference; use version/CAS for features requiring edit-conflict detection. No generic object ID or owner input is accepted as authority.

For identity only, copy `assets/user-context/index.ts` and `auth.mjs` instead, call `?action=me`, and omit database setup. Neither entry point is a router to merge wholesale: integrate its actions into the site's single Function.

## Local exercise

Copy `assets/user-preview/server.mjs` into `dev/user-preview/`, outside the published directories. Run:

```sh
node dev/user-preview/server.mjs functions/profile.mjs 8000
```

Proxy `/functions/v1/app` through the existing frontend development server as described in [Functions](functions.md). In the browser open `/functions/v1/app?fixture=A` on the frontend origin, return to the page and Reload. Repeat with `B`, `anonymous`, and `error`. Fixtures are in-memory and disappear on restart; the server discards caller-supplied identity headers. Production endpoints have no fixture switch.

Check A saves and reloads its profile, B sees only B's profile, a submitted `user_id` cannot change ownership, anonymous requests return 401, invalid context returns 403, and failed writes preserve input. These checks establish application behavior only. Hosted acceptance also needs real Gateway login, two real users, and provider/alternate-ingress/database bypass rejection before claiming private data isolation. Concurrent updates to an existing row do not test the first-insert uniqueness race; exercise that branch with a focused local regression test if a new real identity is unavailable, and report the remaining live coverage accurately.

For shared member lists, use the paginated list handler in [Database access](database.md#query-and-mutation-patterns). Return a continuation and expose Load more instead of silently truncating at a fixed total. Relative timestamps should advance from a fixed clock offset captured when data arrives; test elapsed time without refreshing the data.
