/**
 * Cross-implementation fixtures.
 *
 * These exist so two implementations can be shown to agree on bytes rather
 * than agreeing on prose. Every value here is a hex or literal constant, not a
 * call into the encoder it is meant to check — a fixture that computes its own
 * expectation proves nothing.
 *
 * A non-TypeScript implementation reads these as data.
 */

export interface RequestSignatureFixture {
  name: string;
  method: string;
  kid: string;
  nonce: string;
  iat: number;
  /** UTF-8 source of the raw params bytes. */
  rawParams: string;
  /** Expected preimage, lowercase hex. */
  preimageHex: string;
  preimageLength: number;
}

export const REQUEST_SIGNATURE_FIXTURES: readonly RequestSignatureFixture[] = [
  {
    name: "empty params object",
    method: "mesh.audit.append",
    kid: "kid1",
    nonce: "n1",
    iat: 1786780800,
    rawParams: "{}",
    preimageHex:
      "6167656e742d6d6573682f7369672f763100000000116d6573682e61756469742e617070656e64" +
      "000000046b696431000000026e310000000a31373836373830383030000000027b7d",
    preimageLength: 73,
  },
  {
    name: "multi-byte UTF-8 in params — length prefixes count bytes, not characters",
    method: "mesh.send",
    kid: "kid1",
    nonce: "n1",
    iat: 1786780800,
    // "한" is three bytes in UTF-8; a preimage built on character counts breaks here.
    rawParams: '{"content":"한"}',
    // 17 + 1 + (4+9) + (4+4) + (4+2) + (4+10) + (4+17) = 80.
    // The params field is 17 bytes, not 15: "한" occupies three of them.
    preimageHex:
      "6167656e742d6d6573682f7369672f763100000000096d6573682e73656e64000000046b696431" +
      "000000026e310000000a3137383637383038303000000011" +
      "7b22636f6e74656e74223a22ed959c227d",
    preimageLength: 80,
  },
];

export interface UploadSignatureFixture {
  name: string;
  nonce: string;
  blobKey: string;
  sha256: string;
  size: number;
  preimageHex: string;
  preimageLength: number;
}

export const UPLOAD_SIGNATURE_FIXTURES: readonly UploadSignatureFixture[] = [
  {
    name: "pdf attachment",
    nonce: "upload-nonce-1",
    blobKey: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef.pdf",
    sha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    size: 2458211,
    // 20 + 1 + (4+14) + (4+68) + (4+64) + (4+7) = 190.
    // blob_key is 68 bytes — the digest plus ".pdf" — while sha256 is 64.
    preimageHex:
      "6167656e742d6d6573682f75706c6f61642f7631000000000e75706c6f61642d6e6f6e63652d31" +
      "0000004430313233343536373839616263646566303132333435363738396162636465663031323334" +
      "3536373839616263646566303132333435363738396162636465662e70646600000040" +
      "3031323334353637383961626364656630313233343536373839616263646566303132333435363738" +
      "39616263646566303132333435363738396162636465660000000732343538323131",
    preimageLength: 190,
  },
];

export interface BlobKeyFixture {
  name: string;
  filename: string;
  sha256: string;
  /** Expected extension, `""` when none is usable. */
  extension: string;
  expectedKey: string;
}

const D = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

export const BLOB_KEY_FIXTURES: readonly BlobKeyFixture[] = [
  { name: "lowercased", filename: "Report.PDF", sha256: D, extension: ".pdf", expectedKey: `${D}.pdf` },
  { name: "no extension", filename: "README", sha256: D, extension: "", expectedKey: D },
  { name: "dotfile is not an extension carrier", filename: ".gitignore", sha256: D, extension: ".gitignore", expectedKey: `${D}.gitignore` },
  { name: "multiple dots — only the last suffix counts", filename: "archive.tar.gz", sha256: D, extension: ".gz", expectedKey: `${D}.gz` },
  { name: "unsafe characters are replaced before the suffix is read", filename: "my file (1).PNG", sha256: D, extension: ".png", expectedKey: `${D}.png` },
  { name: "suffix longer than 16 is not an extension", filename: `x.${"a".repeat(17)}`, sha256: D, extension: "", expectedKey: D },
  { name: "non-alphanumeric suffix is not an extension", filename: "backup.tar-gz", sha256: D, extension: "", expectedKey: D },
  { name: "uppercase digest is normalised", filename: "a.txt", sha256: D.toUpperCase(), extension: ".txt", expectedKey: `${D}.txt` },
];

export interface EventIdFixture {
  value: string;
  valid: boolean;
  why: string;
}

export const EVENT_ID_FIXTURES: readonly EventIdFixture[] = [
  { value: "aud_0198b1f8-7d5a-7a12-9f42-7b6c86f54e31", valid: true, why: "canonical UUIDv7" },
  { value: "0198b1f8-7d5a-7a12-9f42-7b6c86f54e31", valid: false, why: "missing aud_ prefix" },
  { value: "aud_0198B1F8-7D5A-7A12-9F42-7B6C86F54E31", valid: false, why: "uppercase" },
  { value: "aud_0198b1f8-7d5a-4a12-9f42-7b6c86f54e31", valid: false, why: "version nibble 4, not 7" },
  { value: "aud_0198b1f8-7d5a-7a12-1f42-7b6c86f54e31", valid: false, why: "variant nibble outside 8-b" },
  { value: "aud_0198b1f87d5a7a129f427b6c86f54e31", valid: false, why: "hyphens stripped" },
];

export interface UploadAuthorizationFixture {
  kid: string;
  nonce: string;
  signature: string;
  header: string;
}

export const UPLOAD_AUTHORIZATION_FIXTURES: readonly UploadAuthorizationFixture[] = [
  {
    kid: "fp1",
    nonce: "upload-nonce-1",
    signature: "c2ln",
    header: 'AgentMeshSig kid="fp1", nonce="upload-nonce-1", sig="c2ln"',
  },
];

/**
 * Key fingerprints (SPEC § 10.2).
 *
 * The fingerprint is what an operator compares between a lane's startup log and
 * the approval surface, so the two implementations producing it must agree
 * exactly. These were computed independently of `keyFingerprint` — a fixture
 * that calls the encoder it checks proves only that the encoder is
 * deterministic.
 *
 * They pin the part that is easy to get wrong and impossible to notice: the
 * digest is over the **raw 32 key bytes**, not over the base64url text. Hashing
 * the encoding produces a perfectly good fingerprint of the wrong thing, and
 * the two disagree in silence.
 */
export interface KeyFingerprintFixture {
  name: string;
  /** Raw Ed25519 public key, base64url, unpadded. */
  publicKey: string;
  /** Expected `sha256:<base64url>` fingerprint. */
  fingerprint: string;
}

export const KEY_FINGERPRINT_FIXTURES: readonly KeyFingerprintFixture[] = [
  {
    name: "all-zero key",
    publicKey: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    fingerprint: "sha256:Zmh6rfhivXdsj8GLjp-OIAiXFIVu4jOzkCpZHQ1fKSU",
  },
  {
    name: "all-0xff key — exercises the base64url alphabet, - and _ rather than + and /",
    publicKey: "__________________________________________8",
    fingerprint: "sha256:r5YTdg9yY1-9tEpaCmPDnxKvMPlQpu5clxvhiOicQFE",
  },
  {
    name: "0..31 ramp",
    publicKey: "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8",
    fingerprint: "sha256:Yw3NKWbEM2aRElRIu7JbT_QSpJxzLbLIq8G4WBvXEN0",
  },
];

/**
 * Reminder schedule fixtures (SPEC § 3.3, § 8.5).
 *
 * `nextFireAtIso` is the value the *daemon* writes after a fire — the part a
 * caller cannot observe until the second fire, which is why getting it wrong
 * stays invisible for one interval and then produces a reminder on a cadence
 * nobody asked for.
 *
 * The alignment cases are the ones that matter. A late fire must not move the
 * schedule off its grid, and a fire that lands exactly on its slot must not
 * resolve to that same slot again — that is a reminder that fires in a loop.
 */
export interface IntervalAdvanceFixture {
  name: string;
  /** The slot the reminder was due for, ISO-8601. */
  scheduledForIso: string;
  /** `schedule_spec.every`. */
  every: string;
  /** When the daemon actually fired it, ISO-8601. */
  firedAtIso: string;
  /** Expected next slot, ISO-8601. */
  nextFireAtIso: string;
}

export const INTERVAL_ADVANCE_FIXTURES: readonly IntervalAdvanceFixture[] = [
  {
    name: "on-time fire advances exactly one interval",
    scheduledForIso: "2026-04-18T09:00:00.000Z",
    every: "15m",
    firedAtIso: "2026-04-18T09:00:00.000Z",
    nextFireAtIso: "2026-04-18T09:15:00.000Z",
  },
  {
    name: "slightly late fire keeps the original grid",
    scheduledForIso: "2026-04-18T09:00:00.000Z",
    every: "15m",
    firedAtIso: "2026-04-18T09:02:37.000Z",
    nextFireAtIso: "2026-04-18T09:15:00.000Z",
  },
  {
    name: "an outage produces one catch-up fire, not one per missed slot",
    scheduledForIso: "2026-04-18T09:00:00.000Z",
    every: "15m",
    firedAtIso: "2026-04-18T11:07:00.000Z",
    nextFireAtIso: "2026-04-18T11:15:00.000Z",
  },
  {
    name: "a fire landing exactly on a later slot still moves forward",
    scheduledForIso: "2026-04-18T09:00:00.000Z",
    every: "15m",
    firedAtIso: "2026-04-18T10:00:00.000Z",
    nextFireAtIso: "2026-04-18T10:15:00.000Z",
  },
  {
    name: "daily interval crosses a date boundary",
    scheduledForIso: "2026-04-18T23:30:00.000Z",
    every: "1d",
    firedAtIso: "2026-04-18T23:30:04.000Z",
    nextFireAtIso: "2026-04-19T23:30:00.000Z",
  },
  {
    name: "a clock that went backwards still yields a future slot",
    scheduledForIso: "2026-04-18T09:00:00.000Z",
    every: "30s",
    firedAtIso: "2026-04-18T08:59:50.000Z",
    nextFireAtIso: "2026-04-18T09:00:30.000Z",
  },
];

/** `(type, schedule_spec)` pairs and whether § 8.5 admits them. */
export interface ScheduleSpecFixture {
  name: string;
  type: string;
  spec: string;
  valid: boolean;
}

export const SCHEDULE_SPEC_FIXTURES: readonly ScheduleSpecFixture[] = [
  { name: "relative once", type: "once", spec: '{"in":"30s"}', valid: true },
  { name: "absolute once", type: "once", spec: '{"at":"2026-04-18T09:00:00Z"}', valid: true },
  { name: "interval", type: "interval", spec: '{"every":"15m"}', valid: true },
  { name: "cron with a zone", type: "cron", spec: '{"cron":"0 9 * * *","tz":"Asia/Seoul"}', valid: true },
  { name: "cron without a zone defaults to UTC", type: "cron", spec: '{"cron":"0 9 * * *"}', valid: true },

  { name: "unknown type", type: "weekly", spec: '{"every":"7d"}', valid: false },
  { name: "once with neither in nor at", type: "once", spec: "{}", valid: false },
  { name: "interval without every", type: "interval", spec: '{"in":"15m"}', valid: false },
  { name: "cron without cron", type: "cron", spec: '{"tz":"UTC"}', valid: false },
  { name: "zero duration would fire in a loop", type: "interval", spec: '{"every":"0s"}', valid: false },
  { name: "negative duration", type: "interval", spec: '{"every":"-5m"}', valid: false },
  { name: "fractional duration", type: "interval", spec: '{"every":"1.5h"}', valid: false },
  { name: "unit that depends on when you ask", type: "interval", spec: '{"every":"1mo"}', valid: false },
  { name: "bare number with no unit", type: "interval", spec: '{"every":"300"}', valid: false },
  { name: "duration as a number rather than a string", type: "interval", spec: '{"every":300}', valid: false },
  { name: "spec is not an object", type: "interval", spec: '"15m"', valid: false },
  { name: "spec is not JSON at all", type: "interval", spec: "15m", valid: false },
  { name: "spec is a JSON array", type: "interval", spec: '["15m"]', valid: false },
  { name: "unparseable absolute time", type: "once", spec: '{"at":"tomorrow"}', valid: false },
];

/**
 * Signed REST requests (SPEC § 9.2).
 *
 * A third construction signing with the same key, so the separator is the
 * whole of what keeps a captured `POST /api/v1/outbox` from being replayed as
 * an upload authorisation. These pin the bytes; agreeing on the scheme name
 * proves nothing.
 *
 * Two cases carry the reasoning. The query string is inside the preimage — an
 * attacker able to rewrite `?peer=` could otherwise redirect a history read
 * while the signature still verified. And the multi-byte path is here because
 * the length prefixes count **bytes**: an implementation that counted
 * characters produces a different preimage for exactly the paths a Korean or
 * Japanese deployment would use, and nowhere else.
 */
export interface RestSignatureFixture {
  name: string;
  method: string;
  path: string;
  kid: string;
  nonce: string;
  iat: number;
  /** Lowercase hex, or `""` for a request with no body. */
  bodySha256: string;
  preimageHex: string;
  preimageLength: number;
}

export const REST_SIGNATURE_FIXTURES: readonly RestSignatureFixture[] = [
  {
    name: "GET with no body",
    method: "GET",
    path: "/api/v1/outbox",
    kid: "kid1",
    nonce: "n1",
    iat: 1786780800,
    bodySha256: "",
    preimageHex:
      "6167656e742d6d6573682f726573742f763100000000034745540000000e2f6170692f76312f" +
      "6f7574626f78000000046b696431000000026e310000000a3137383637383038303000000000",
    preimageLength: 76,
  },
  {
    name: "POST with a body digest",
    method: "POST",
    path: "/api/v1/outbox",
    kid: "kid1",
    nonce: "n2",
    iat: 1786780800,
    bodySha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    preimageHex:
      "6167656e742d6d6573682f726573742f76310000000004504f53540000000e2f6170692f7631" +
      "2f6f7574626f78000000046b696431000000026e320000000a313738363738303830300000004065336230633434323938666331633134396166626634633839393666623932343237616534316534363439623933346361343935393931623738353262383535",
    preimageLength: 141,
  },
  {
    name: "query string is covered",
    method: "GET",
    path: "/api/v1/inbox/history?peer=b&limit=10",
    kid: "kid1",
    nonce: "n3",
    iat: 1786780800,
    bodySha256: "",
    preimageHex:
      "6167656e742d6d6573682f726573742f76310000000003474554000000252f6170692f76312f" +
      "696e626f782f686973746f72793f706565723d62266c696d69743d3130000000046b696431000000026e330000000a3137383637383038303000000000",
    preimageLength: 99,
  },
  {
    name: "lowercase method is normalised",
    method: "get",
    path: "/api/v1/outbox",
    kid: "kid1",
    nonce: "n1",
    iat: 1786780800,
    bodySha256: "",
    preimageHex:
      "6167656e742d6d6573682f726573742f763100000000034745540000000e2f6170692f76312f" +
      "6f7574626f78000000046b696431000000026e310000000a3137383637383038303000000000",
    preimageLength: 76,
  },
  {
    name: "multi-byte path — prefixes count bytes",
    method: "DELETE",
    path: "/api/v1/outbox/메시지",
    kid: "kid1",
    nonce: "n4",
    iat: 1786780800,
    bodySha256: "",
    preimageHex:
      "6167656e742d6d6573682f726573742f7631000000000644454c455445000000182f6170692f" +
      "76312f6f7574626f782feba994ec8b9ceca780000000046b696431000000026e340000000a3137383637383038303000000000",
    preimageLength: 89,
  },
];

/**
 * One example body per console read route (`src/http-console.ts`).
 *
 * **These are recorded answers, not constructed ones.** Every field name and
 * every null below was read off `packages/http/src/main.ts` in the platform
 * repository; the values are small and invented, the *shape* is not. A fixture
 * built by calling the code it checks proves nothing, and a fixture built from
 * the type checks only that somebody wrote the type twice.
 *
 * A non-TypeScript implementation reads these as data to answer one question:
 * given this path, which key holds the list, and which field names exist.
 */
export interface ConsoleResponseFixture {
  path: string;
  /** As declared in `CONSOLE_READ_ROUTES`. */
  envelope: "ok" | "bare" | "status";
  /** The key holding the list, or `null` for a route that answers a single object. */
  listKey: string | null;
  /** Field names a reader has asked for that this route has never sent. */
  neverSent: readonly string[];
  body: Record<string, unknown>;
}

export const CONSOLE_RESPONSE_FIXTURES: readonly ConsoleResponseFixture[] = [
  {
    path: "/api/v1/agents",
    envelope: "bare",
    listKey: "agents",
    neverSent: ["status", "identity"],
    body: {
      agents: [
        {
          id: "lane-a",
          name: "lane-a",
          description: null,
          channel: "native",
          type: "agent",
          created_at: "2026-08-01T00:00:00Z",
          last_seen_at: null,
          fingerprint: null,
          tenant: "default",
        },
      ],
    },
  },
  {
    path: "/api/v1/admin/keys/pending",
    envelope: "ok",
    listKey: "keys",
    neverSent: ["pending"],
    body: {
      ok: true,
      keys: [
        {
          fingerprint: "sha256:0f1e2d",
          identity: "lane-a",
          public_key: "ed25519:AAAA",
          proposed_at: "2026-08-01T00:00:00Z",
        },
      ],
    },
  },
  {
    path: "/api/v1/admin/pending",
    envelope: "bare",
    listKey: "users",
    neverSent: ["pending", "ok"],
    body: {
      users: [
        {
          github_login: "someone",
          github_id: 1,
          requested_at: "2026-08-01T00:00:00Z",
          status: "pending",
        },
      ],
    },
  },
  {
    path: "/api/v1/admin/mailbox",
    envelope: "ok",
    listKey: "mailboxes",
    neverSent: ["depth"],
    body: {
      ok: true,
      mailboxes: [{ identity: "lane-a", pending: 2, leased: 1, oldest: "2026-08-01T00:00:00Z" }],
      total_queued: 2,
    },
  },
  {
    path: "/api/v1/audit/events",
    envelope: "ok",
    listKey: "events",
    neverSent: ["cursor", "total"],
    body: {
      ok: true,
      events: [
        {
          event_id: "01J0000000000000000000000A",
          schema_version: 1,
          event_type: "mesh.message.sent",
          occurred_at: "2026-08-01T00:00:00Z",
          correlation_id: null,
          causation_event_id: null,
          producer_id: null,
          identity: "lane-a",
          // `id`, not `identity` — see `RestAuditRecordedBy`.
          recorded_by: { kind: "hub", id: "hub" },
          payload: {},
          payload_digest: "0".repeat(64),
          integrity: { digest_matches: true },
          attestation: null,
          stored_at: "2026-08-01T00:00:01Z",
          attachments: [],
        },
      ],
      next_cursor: null,
    },
  },
  {
    path: "/api/v1/admin/groups",
    envelope: "ok",
    listKey: "groups",
    neverSent: ["name", "member_count"],
    body: {
      ok: true,
      tenant: "default",
      groups: [
        {
          tenant: "default",
          group_id: "default",
          description: null,
          created_at: "2026-08-01T00:00:00Z",
          created_by: "system",
          members: ["lane-a"],
        },
      ],
      egress: [
        {
          tenant: "default",
          from_group: "default",
          to_group: "default",
          granted_by: "system",
          granted_at: "2026-08-01T00:00:00Z",
        },
      ],
    },
  },
  {
    path: "/api/v1/health",
    envelope: "status",
    listKey: null,
    neverSent: ["ok"],
    body: {
      status: "ok",
      version: "0.2.0",
      agent_count: 1,
      uptime: 0,
      sign_in: { local: true, github: false },
    },
  },
  {
    path: "/api/v1/admin/telemetry/behaviour",
    envelope: "ok",
    listKey: null,
    neverSent: ["status"],
    body: {
      ok: true,
      counting_since: null,
      pending_keys: { value: 0 },
      pending_users: { value: 0 },
      oldest_pending_user_ms: { value: null, unavailable: "the hub did not answer" },
      oldest_pending_ms: { value: null, unavailable: "the hub did not answer" },
      signature_refusals: { value: null, unavailable: "the hub did not answer" },
      rate_limited: { value: null, unavailable: "the hub did not answer" },
      egress_refusals: { value: null, unavailable: "the hub did not answer" },
      accepted: { value: null, unavailable: "the hub did not answer" },
    },
  },
];
