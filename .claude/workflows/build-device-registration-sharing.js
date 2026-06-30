export const meta = {
  name: 'build-device-registration-sharing',
  description:
    'Build device-registration sharing across green-tea-proxy (Cloudflare worker) and green-tea (Electron client): no baked secret, per-device credentials, ownership + quotas.',
  whenToUse:
    'Run once to implement the device-registration sharing feature. Two per-repo pipelines run in parallel, each implement -> tests -> verify-and-fix, then a cross-repo consistency check.',
  phases: [
    { title: 'Implement' },
    { title: 'Tests' },
    { title: 'Verify' },
    { title: 'Consistency' }
  ]
}

// ---------------------------------------------------------------------------
// Shared design spec — the single source of truth handed verbatim to every
// agent so the two repos stay interface-compatible.
// ---------------------------------------------------------------------------
const SPEC = `
# Feature: device-registration sharing (no baked secret)

## Goal
Today the Green Tea "share" feature authenticates with ONE shared bearer token
(\`SHARE_PUBLISH_TOKEN\`) that the user pastes into Settings. Because green-tea is
a PUBLIC open-source repo, that token can never be baked into the app. Replace it
with **per-device registration**: on first use the client calls home, the worker
mints a unique per-device credential, and every publish/unpublish authenticates
as that device. No shared secret ships in the client.

This is decided and approved. Three locked decisions:
1. Anti-abuse v1 = IP rate-limit on /register + per-device share quota (NO Apple
   App Attest yet).
2. The legacy shared \`SHARE_PUBLISH_TOKEN\` STILL WORKS as an admin/self-host
   escape hatch (worker accepts EITHER a valid device credential OR the legacy
   token).
3. The client Settings -> Share UI loses both fields (token + base URL); device
   registration is automatic and the base URL is hardcoded.

## Repos (absolute paths)
- SERVER: /Users/marko.stankovic/Desktop/PROJECTS/GREEN TEA/green-tea-proxy
  The share worker lives in \`share/\` (entry \`share/src/index.ts\`). The proxy
  worker at \`src/index.ts\` and root \`wrangler.jsonc\` are OFF-LIMITS — do not edit.
- CLIENT: /Users/marko.stankovic/Desktop/PROJECTS/GREEN TEA/green-tea
  Electron app. Main-process share code in \`src/main/share/\`.

## Credential model
- The client holds a single opaque credential string: \`<deviceId>.<deviceSecret>\`.
  * deviceId    = base64url(16 random bytes)  (~22 chars, no padding)
  * deviceSecret= base64url(32 random bytes)  (~43 chars, no padding)
- Sent as \`Authorization: Bearer <deviceId>.<deviceSecret>\` on writes.
- The worker stores ONLY sha256-hex(deviceSecret) in D1 — never the raw secret.
- Registration response JSON shape (MUST match on both sides):
    { "deviceId": string, "deviceSecret": string }

## Worker auth resolution order (writes only; GET stays public)
1. If \`SHARE_PUBLISH_TOKEN\` is set AND the bearer constant-time-equals it ->
   auth = { kind: 'admin' }.
2. Else if the bearer contains a '.', split into id + secret; look up the device
   by id; require not-revoked AND constant-time-equal( sha256hex(secret),
   stored secret_hash ) -> auth = { kind: 'device', deviceId }.
3. Else -> 401 Unauthorized.

## D1 schema (binding name: DB)
\`\`\`sql
CREATE TABLE IF NOT EXISTS devices (
  id           TEXT PRIMARY KEY,
  secret_hash  TEXT NOT NULL,
  created_at   INTEGER NOT NULL,   -- epoch ms
  last_seen_at INTEGER,
  revoked      INTEGER NOT NULL DEFAULT 0,
  user_id      TEXT                -- nullable; reserved for claim-by-account later
);
CREATE TABLE IF NOT EXISTS shares (
  slug       TEXT PRIMARY KEY,
  device_id  TEXT NOT NULL,        -- owning device id, or 'admin' for legacy-token publishes
  type       TEXT NOT NULL,        -- 'note' | 'artifact'
  title      TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_shares_device ON shares (device_id);
CREATE TABLE IF NOT EXISTS register_rl (
  ip           TEXT PRIMARY KEY,
  count        INTEGER NOT NULL,
  window_start INTEGER NOT NULL    -- epoch ms of current fixed window
);
\`\`\`
Provide the schema both as \`share/schema.sql\` (for manual provisioning) AND as a
lazy idempotent \`ensureSchema(db)\` that runs the CREATE-TABLE-IF-NOT-EXISTS
statements once per isolate (guard with a module-level Promise so concurrent
requests await one init). Call ensureSchema at the top of the worker fetch before
any DB use — this self-heals so a missing manual migration never breaks prod, and
makes the test harness need no separate migration step. Run each DDL statement via
\`db.prepare(stmt).run()\` (NOT \`db.exec()\`, which splits multi-line statements).

## Constants
- MAX_SHARES_PER_DEVICE   = 200   (checked only on a NEW publish, not re-publish)
- REGISTER_WINDOW_MS      = 3600000 (1 hour, fixed window)
- REGISTER_MAX_PER_WINDOW = 30    (per cf-connecting-ip)

## Endpoints (share worker)
- POST /register   — NO auth. Rate-limited per IP (cf-connecting-ip; fall back to
  'unknown'). On limit -> 429. Else mint device, INSERT into devices, return 200
  { deviceId, deviceSecret }.
- POST /publish    — auth required (admin or device). On a re-publish (client
  supplies \`slug\`): if a shares row exists for that slug owned by a DIFFERENT
  device and caller is not admin -> 403. On a NEW publish: if the device already
  owns >= MAX_SHARES_PER_DEVICE -> 429. After the R2 write succeeds, upsert the
  shares row (slug, device_id=owner, type, title, timestamps). Owner is the
  caller's deviceId, or the literal 'admin' for admin-token publishes.
- GET /:slug, GET /:slug/<asset>, GET /robots.txt — PUBLIC, UNCHANGED behavior.
- DELETE /:slug    — auth required. If a shares row exists owned by a different
  device and caller is not admin -> return the branded 404 (do NOT reveal that
  the slug exists to a non-owner). Else delete the R2 objects AND the shares row.

## Hard constraints
- Keep the existing public GET share behavior, CSP/sandbox headers, slug alphabet,
  size caps, traversal guards, and re-publish prefix-wipe EXACTLY as they are.
- Match the existing share-worker code style: semicolons, single quotes, 2-space
  indent, \`import type { Env } from './index'\`.
- The R2 binding stays \`SHARES\`. Add \`DB: D1Database\` to the worker \`Env\`.
- Reuse the existing constant-time compare idea from \`share/src/auth.ts\`.

## Worker file plan
- share/src/crypto.ts  — randomBase64Url(nBytes), sha256Hex(s), timingSafeEqual(a,b).
- share/src/db.ts      — ensureSchema; device fns (insertDevice, getDevice,
  touchDevice); share-ownership fns (getShareOwner, upsertShare, deleteShareRow,
  countDeviceShares); rate-limit fn (checkRegisterRateLimit returns boolean ok).
- share/src/register.ts— POST /register handler (rate-limit + mint + insert).
- share/src/auth.ts    — REWRITE to \`authenticate(req, env): Promise<Auth | null>\`
  where Auth = { kind: 'admin' } | { kind: 'device'; deviceId: string }. Keep a
  constant-time compare. (The current sync \`authed()\` may be removed/replaced.)
- share/src/publish.ts — thread the resolved Auth through; enforce ownership +
  quota; upsert the shares row after a successful write.
- share/src/serve.ts   — \`unpublish\` gains the Auth + ownership check and deletes
  the shares row.
- share/src/index.ts   — add \`DB\` to Env; call ensureSchema(env.DB); route
  POST /register; replace the sync auth gate with \`await authenticate(req, env)\`
  for /publish and DELETE; pass the Auth into publish/unpublish.
- share/wrangler.jsonc — add a \`d1_databases\` binding:
    { "binding": "DB", "database_name": "greentea-shares-db", "database_id": "PLACEHOLDER_RUN_WRANGLER_D1_CREATE" }
  with a comment that the real database_id is filled in after \`wrangler d1 create\`.
- shared/contract.ts   — add \`export interface RegisterResponse { deviceId: string; deviceSecret: string }\`.

## Client (green-tea) file plan
Current relevant code (read these files yourself to confirm before editing):
- src/main/share/share-service.ts — has \`resolveToken(db)\` and \`resolveBaseUrl(db)\`:
    resolveToken: getSetting(db,'share.publishToken') || process.env.SHARE_PUBLISH_TOKEN || ''
    resolveBaseUrl: getSetting(db,'share.baseUrl') || process.env.SHARE_BASE_URL || DEFAULT_BASE_URL
  DEFAULT_BASE_URL = 'https://share.greentea.app'. resolveToken is called in
  publishShare, publishCanvasShare, unpublishShare, updateSharedVersion.
- src/main/secrets/index.ts — encrypted store: getSecret(db,key), setSecret(db,key,plaintext),
  deleteSecret(db,key) (safeStorage-backed). Use this for the device credential.
- src/renderer/src/hooks/useSettings.ts — Settings type + DEFAULTS + fetchSettings
  contain 'share.publishToken' and 'share.baseUrl' (lines ~30,52,80).
- src/renderer/src/components/settings/ShareTab.tsx — the token + base URL inputs.
- src/renderer/src/components/settings/SettingsDialog.tsx — renders <ShareTab
  settings={settings} updateSetting={updateSetting} /> at the 'share' tab.

Required client changes:
1. NEW src/main/share/device-credential.ts — \`getDeviceCredential(db, baseUrl):
   Promise<string>\`. Reads secret key 'share:deviceCredential' via getSecret; if
   present, returns it. Otherwise POSTs to \`<baseUrl>/register\` (trim trailing
   slashes), validates the { deviceId, deviceSecret } response, stores
   \`<deviceId>.<deviceSecret>\` via setSecret, and returns it. Memoize an in-flight
   registration Promise so concurrent publishes register only once. Throw a clear
   Error on network/HTTP failure. Add an \`export function clearCachedCredential()\`
   for tests.
2. share-service.ts: make \`resolveToken\` async ->
     if (process.env.SHARE_PUBLISH_TOKEN) return it (dev/self-host/admin override)
     else return getDeviceCredential(db, resolveBaseUrl(db)).
   resolveBaseUrl stays sync but drop the settings read:
     return process.env.SHARE_BASE_URL || DEFAULT_BASE_URL.
   Update the 4 call sites to \`await resolveToken(db)\`. In updateSharedVersion,
   wrap resolveToken in try/catch and return { status: 'no-token' } on failure
   (so a headless agent never crashes when offline). Keep the existing
   "token not configured" throw in publishShare/publishCanvasShare/unpublishShare
   as a defense if resolveToken returns empty.
3. useSettings.ts: REMOVE the 'share.publishToken' and 'share.baseUrl' keys from
   the Settings interface, DEFAULTS, and fetchSettings.
4. ShareTab.tsx: drop the secret inputs; make it an informational panel (props:
   none needed). Explain that publishing is automatic, links are public via an
   unguessable slug, and shares expire after 30 days of inactivity. Update
   SettingsDialog.tsx to render <ShareTab /> with no props.
5. Client code style: NO semicolons, single quotes, 100-char width, \`@renderer\`
   alias in renderer only.

## Out of scope (do NOT build): account login, multi-device sync, App Attest,
the claim-by-account flow. Leave \`devices.user_id\` present but unused.
`

const VERIFY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['green', 'summary'],
  properties: {
    green: { type: 'boolean', description: 'true only if typecheck AND tests pass' },
    summary: { type: 'string' },
    failures: { type: 'array', items: { type: 'string' } }
  }
}

const SERVER = {
  name: 'server',
  dir: '/Users/marko.stankovic/Desktop/PROJECTS/GREEN TEA/green-tea-proxy',
  impl: `Implement the SERVER half of the spec in the green-tea-proxy repo. Create/modify exactly the worker files listed under "Worker file plan" plus shared/contract.ts. Do NOT edit src/index.ts (proxy worker) or the root wrangler.jsonc. Read the existing share/src/*.ts first so your new code matches their style and reuses helpers (genSlug, mime, the constant-time compare). Keep every existing public-GET behavior, CSP, size cap, and traversal guard intact. Report which files you changed and the exact authenticate() / db.ts signatures you settled on.`,
  tests: `Add/extend the share worker's miniflare test suite under share/test/. Update share/wrangler.jsonc already has the D1 binding; update share/test/env.d.ts so the test Env carries DB, and update share/vitest.config.mts to provide a local D1 database for the DB binding (vitest-pool-workers d1; rely on the worker's lazy ensureSchema so no migration step is needed — but if a migration hook is cleaner, use it). Follow the existing harness rules in share/test/share.test.ts (isolatedStorage:false, unique random slugs, never assert empty-bucket). Cover: (a) POST /register returns 200 with deviceId+deviceSecret; (b) publishing with a freshly-registered device credential succeeds and the slug is then publicly GET-able; (c) a second device CANNOT overwrite (re-publish slug) or DELETE the first device's slug (expect 403 / branded 404); (d) the legacy admin token 'test-secret-token' still publishes and can overwrite/delete any slug; (e) /register rate-limit returns 429 after REGISTER_MAX_PER_WINDOW; (f) a device hitting MAX_SHARES_PER_DEVICE gets 429 on the next NEW publish (you may lower the cap via a small test-only seam or by seeding the shares table directly through env.DB). Keep the existing passing tests green.`,
  verify: `In ${'/Users/marko.stankovic/Desktop/PROJECTS/GREEN TEA/green-tea-proxy'} run the share worker test suite with \`npm test\` and type-check the share worker (e.g. \`npx tsc --noEmit -p share/tsconfig.json\`). If anything fails, fix the share worker source or tests and re-run until BOTH pass. NEVER weaken a security/ownership/auth check just to make a test pass — fix the real cause. Return { green, summary, failures }.`
}

const CLIENT = {
  name: 'client',
  dir: '/Users/marko.stankovic/Desktop/PROJECTS/GREEN TEA/green-tea',
  impl: `Implement the CLIENT half of the spec in the green-tea repo. Read src/main/share/share-service.ts, src/main/secrets/index.ts, src/shared/share-contract.ts, src/renderer/src/hooks/useSettings.ts, src/renderer/src/components/settings/ShareTab.tsx, and SettingsDialog.tsx first. Then: create src/main/share/device-credential.ts; rewire resolveToken/resolveBaseUrl and the 4 call sites in share-service.ts; add RegisterResponse to src/shared/share-contract.ts; strip the two share.* keys from useSettings.ts; convert ShareTab.tsx to an informational panel and update SettingsDialog.tsx to render it with no props. Match client code style (no semicolons, single quotes, 100 width). Report the files you changed and the device-credential.ts public signature.`,
  tests: `Update client tests for the new device-credential flow. src/main/share/share-service.test.ts currently calls setSetting(db,'share.publishToken','tok') to provide a token — that path is gone. Make those tests set process.env.SHARE_PUBLISH_TOKEN (the dev/admin override resolveToken now honors) and restore/delete it in afterEach, OR mock the device-credential module. Add a focused src/main/share/device-credential.test.ts that: (a) returns a stored credential without any network call when getSecret already has 'share:deviceCredential'; (b) on a cache+store miss, fetches <baseUrl>/register (mock global fetch), stores '<deviceId>.<deviceSecret>' via the secrets store, and returns it; (c) throws on a non-OK register response. Use the existing test-db helpers under src/main/database/__test__ and call clearCachedCredential() in beforeEach. Keep existing share-service tests meaningful (the update-only safety guarantees must still hold).`,
  verify: `In ${'/Users/marko.stankovic/Desktop/PROJECTS/GREEN TEA/green-tea'} run \`npm run typecheck\` and the share tests (\`npx vitest run src/main/share\`). If anything fails, fix the source or tests and re-run until BOTH pass. Do not weaken the update-only / no-token safety behavior of updateSharedVersion. Return { green, summary, failures }.`
}

// ---------------------------------------------------------------------------
// Per-target pipeline: implement -> tests -> verify-and-fix loop. The two
// targets (different repos, no shared files) run concurrently via pipeline().
// ---------------------------------------------------------------------------
async function verifyAndFix(target) {
  let last = null
  for (let attempt = 1; attempt <= 4; attempt++) {
    const v = await agent(
      `${SPEC}\n\n## Your job: VERIFY (${target.name}), attempt ${attempt}\n${target.verify}`,
      {
        label: `verify:${target.name}#${attempt}`,
        phase: 'Verify',
        effort: 'high',
        schema: VERIFY_SCHEMA
      }
    )
    last = v
    if (!v || v.green) break
    log(`verify:${target.name} attempt ${attempt} red — ${(v.failures || []).length} failure(s)`)
  }
  return { name: target.name, ...(last || { green: false, summary: 'no verify result' }) }
}

phase('Implement')
const results = await pipeline(
  [SERVER, CLIENT],
  (t) =>
    agent(`${SPEC}\n\n## Your job: IMPLEMENT (${t.name})\n${t.impl}`, {
      label: `impl:${t.name}`,
      phase: 'Implement',
      effort: 'high'
    }),
  (_impl, t) =>
    agent(`${SPEC}\n\n## Your job: WRITE TESTS (${t.name})\n${t.tests}`, {
      label: `tests:${t.name}`,
      phase: 'Tests',
      effort: 'high'
    }),
  (_tests, t) => verifyAndFix(t)
)

// ---------------------------------------------------------------------------
// Cross-repo consistency check (barrier-free: needs both verify results).
// ---------------------------------------------------------------------------
phase('Consistency')
const consistency = await agent(
  `${SPEC}\n\n## Your job: CROSS-REPO CONSISTENCY CHECK\nBoth repos have been implemented and verified independently. Confirm they actually interoperate, WITHOUT changing behavior unless you find a real mismatch:\n` +
    `1. The /register response shape { deviceId, deviceSecret } is identical in green-tea-proxy/shared/contract.ts and green-tea/src/shared/share-contract.ts, and the client builds the credential as '<deviceId>.<deviceSecret>' exactly how the worker splits it in authenticate().\n` +
    `2. The Authorization header format the client sends matches what the worker parses (Bearer, dot-separated).\n` +
    `3. The client's hardcoded base URL ('https://share.greentea.app') matches the worker route, and process.env overrides still work on both sides.\n` +
    `4. No baked secret remains in the green-tea client (grep for SHARE_PUBLISH_TOKEN literals / hardcoded tokens; env-var reads are fine).\n` +
    `If you find a concrete mismatch, fix the minimal thing and re-run the relevant repo's typecheck. Report a short findings list and whether the two halves are wire-compatible.`,
  { label: 'consistency', phase: 'Consistency', effort: 'high' }
)

return {
  verify: results.filter(Boolean),
  consistency,
  provisioning:
    'Manual steps the user must run with Cloudflare auth: (1) wrangler d1 create greentea-shares-db; (2) put the returned database_id into share/wrangler.jsonc; (3) wrangler d1 execute greentea-shares-db --remote --file share/schema.sql; (4) npm run deploy:share. The legacy SHARE_PUBLISH_TOKEN secret stays as the admin escape hatch.'
}
