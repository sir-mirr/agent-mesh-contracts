/**
 * What the seven read routes of the admin console answer (SPEC § 9.1, § 11).
 *
 * ## Why these are here rather than in the console
 *
 * Each of them was reached through `apiClient<any>`. `any` is not an absence of
 * a type — it is a type that agrees with every shape, including the ones the
 * server does not send, so a reader could ask for a field nobody emits and get
 * `undefined` at runtime with nothing said at build time. Three defects in this
 * repository's history had exactly that shape: a `status` field on the agent
 * list that the route has never carried, a `depth` on the mailbox summary that
 * made a queue of any size read as `0`, and a `pending` on the admission queue
 * that is the *other* queue's name one path segment away.
 *
 * Naming them here rather than in the console makes drift a type error on both
 * sides of the wire at once. A field the route stops sending stops compiling in
 * the screen that reads it, which is the only moment either half is cheap to
 * fix.
 *
 * ## These describe the answer, not the intent
 *
 * Every shape below was read off the running implementation
 * (`packages/http/src/main.ts`) and then checked against SPEC. Where the two
 * disagree the disagreement is written down in the doc comment rather than
 * resolved in favour of the server — a contract that quietly adopts whatever
 * the server does is a description, and there is already one of those.
 */

/**
 * One row of `GET /api/v1/agents`.
 *
 * **There is no `status`, deliberately** (SPEC § 9.1). Whether five minutes of
 * silence means `inactive` is an operating policy, not something the route
 * decides, and a `status` here would ship a judgement dressed as a measurement.
 * The console drew every agent as `ONLINE` for exactly as long as it invented
 * this field locally.
 *
 * **`last_seen_at: null` means no presence record**, not offline. A web account
 * that has never connected has none.
 *
 * `id` and not `identity`: this route sends the registry's primary key under
 * its own name. The console renames it on arrival, which is a mapping, not a
 * disagreement — but a reader of the raw body needs the server's name.
 */
export interface ConsoleAgentRow {
  id: string;
  name: string;
  description: string | null;
  channel: string;
  type: string;
  /**
   * When the registry row was written.
   *
   * **`string | null` here and `string` in the server's own row type.**
   * `agent_registry.created_at` is `DATETIME DEFAULT CURRENT_TIMESTAMP` with no
   * `NOT NULL`, so a row inserted with an explicit `NULL` has one, and the
   * route passes the column through untouched. `packages/http/src/db.ts`
   * declares it non-null anyway. The nullable reading is the one that cannot
   * invent a creation time, and inventing one is the defect `I-062` had.
   */
  created_at: string | null;
  last_seen_at: string | null;
  /** Of the approved key, when there is one. Absent is not "unverified" — it is absent. */
  fingerprint: string | null;
  /** § 11.4: every identity has one. `default` until somebody moves it, never `null`. */
  tenant: string;
}

/** The `200` body of `GET /api/v1/agents`. */
export interface ConsoleAgentListResponse {
  agents: ConsoleAgentRow[];
}

/**
 * One key proposal from `GET /api/v1/admin/keys/pending` (SPEC § 10.2).
 *
 * Narrower than the store's row on purpose: the route projects four fields and
 * does not send the rest of `agent_keys`.
 */
export interface ConsoleKeyProposal {
  fingerprint: string;
  identity: string;
  public_key: string;
  proposed_at: string;
}

/**
 * The `200` body of `GET /api/v1/admin/keys/pending`.
 *
 * **`keys`, not `pending`** (D-689). Two decision queues answer on this server
 * one path segment apart, and both used to say `pending`, so a caller holding a
 * response could not tell which question it had asked — and the wrong one
 * answers an honest empty array.
 */
export interface ConsoleKeyProposalsResponse {
  ok: true;
  keys: ConsoleKeyProposal[];
}

/**
 * One person waiting to be admitted, from `GET /api/v1/admin/pending` (SPEC § 11).
 *
 * The route sends the stored row as it is, so these are the table's columns.
 */
export interface ConsolePendingAdmission {
  github_login: string;
  github_id: number;
  /**
   * **Nullable, and the server's own row type says otherwise.**
   * `pending_approvals.requested_at` is `DATETIME DEFAULT CURRENT_TIMESTAMP`
   * with no `NOT NULL`; nothing in this repository inserts an explicit null, so
   * it is non-null in practice and unenforced in the schema. The same shape as
   * `created_at` on the agent row, and the same reason to keep the null: a
   * reader that defaults a missing timestamp invents a request time.
   */
  requested_at: string | null;
  /**
   * Always `pending` on this route — it is the `WHERE` clause, not a field with
   * a range. The column is nullable and the other values it takes (`approved`,
   * `denied`) are the ones that remove a row from this answer.
   */
  status: string;
}

/**
 * The `200` body of `GET /api/v1/admin/pending`.
 *
 * **`users`, and no `ok`.** The other half of D-689: this queue says who is
 * waiting to be admitted, the key queue says which keys are waiting to be
 * approved, and neither may answer under the shared name. The missing `ok` is
 * the server's, not an omission here — see the note on `ConsoleHealthResponse`
 * about which routes carry one.
 */
export interface ConsolePendingAdmissionsResponse {
  users: ConsolePendingAdmission[];
}

/** One identity's queue, from `GET /api/v1/admin/mailbox`. */
export interface ConsoleMailboxSummary {
  identity: string;
  /** Messages with `status = 'pending'` addressed to this identity. */
  pending: number;
  /** Of those, the ones currently under an unexpired lease. */
  leased: number;
  /** Timestamp of the oldest pending message, or `null` for an empty queue. */
  oldest: string | null;
}

/**
 * The `200` body of `GET /api/v1/admin/mailbox`.
 *
 * **`total_queued`, counted by the server, and there has never been a `depth`.**
 * The console summed the rows itself over a field with that name, so its
 * "messages queued" tile read `0` whether the mesh was idle or backed up — and
 * `0` is the answer that looks calm. The total is its own `count(*)` rather
 * than a sum of the grouped rows: the two agree only while nothing limits the
 * grouping.
 */
export interface ConsoleMailboxResponse {
  ok: true;
  mailboxes: ConsoleMailboxSummary[];
  total_queued: number;
}

/**
 * Who recorded an audit event, **as this route sends it**.
 *
 * **This is not `RecordedBy` from `./audit`, and the difference is not
 * cosmetic.** That interface says `{ kind: "hub" | "adapter"; identity: string }`;
 * the route sends `{ kind, id }`, `kind` is whatever string the column holds,
 * and `id` is nullable. A reader typed as `RecordedBy` compiles and then reads
 * `undefined` from `identity` on every event.
 *
 * Written down as a second type rather than reconciled here: which of the two
 * is right is a decision about the audit store, not about this response, and a
 * contract that renamed the field to match the other one would make the
 * disagreement compile instead of making it visible.
 */
export interface ConsoleAuditRecordedBy {
  kind: string;
  id: string | null;
}

/**
 * One event from `GET /api/v1/audit/events` (SPEC § 9.1).
 *
 * **`integrity.digest_matches` is recomputed on read**, over the bytes actually
 * stored — a digest read back beside the row it describes proves nothing.
 *
 * **`attestation !== null` means the event arrived signed. It does not mean
 * verified.** The hub verified at ingest; this route does not re-verify and
 * sometimes cannot, because a superseded key's row is deleted and an event
 * signed by a rotated key can never be checked again.
 *
 * `payload` is `null` when the stored JSON did not parse, and content is
 * stripped from it for a caller holding only `audit.read.metadata` — the same
 * type either way, which is the § 11 privacy boundary rather than a different
 * response.
 */
export interface ConsoleAuditEvent {
  event_id: string;
  schema_version: number;
  event_type: string;
  occurred_at: string;
  correlation_id: string | null;
  causation_event_id: string | null;
  producer_id: string | null;
  identity: string;
  recorded_by: ConsoleAuditRecordedBy;
  payload: unknown;
  payload_digest: string;
  integrity: { digest_matches: boolean };
  attestation: unknown;
  stored_at: string;
  attachments: ConsoleAuditAttachment[];
}

/**
 * One attachment row on an event.
 *
 * The four columns the route selects, and no `mime` — `AuditAttachmentRef` in
 * `./audit` carries one and this projection does not, so a reader of this
 * response has the reference without its type.
 */
export interface ConsoleAuditAttachment {
  blob_key: string;
  sha256: string;
  size: number;
  name: string | null;
}

/**
 * The `200` body of `GET /api/v1/audit/events` (SPEC § 9.1).
 *
 * `next_cursor` is `null` on the last page — not absent, so a reader cannot
 * mistake "no more" for "the server forgot to say".
 */
export interface ConsoleAuditEventsResponse {
  ok: true;
  events: ConsoleAuditEvent[];
  next_cursor: string | null;
}

/**
 * The `200` body of `GET /api/v1/admin/groups` (SPEC § 11.4).
 *
 * `tenant` is **the caller's** tenant, not a filter that was applied: a platform
 * administrator gets every tenant's groups in `groups` while `tenant` still
 * names their own. Deleted tenants are included, because their egress rules
 * still decide sends.
 */
export interface ConsoleGroupsResponse {
  ok: true;
  tenant: string;
  groups: ConsoleGroupRow[];
  egress: ConsoleEgressRow[];
}

/**
 * One group, with its members resolved.
 *
 * `group_id` is the name; there is no separate display name. `members` is the
 * identity list, and for the `default` group it includes identities nobody has
 * placed anywhere — being unplaced is what puts them there.
 */
export interface ConsoleGroupRow {
  tenant: string;
  group_id: string;
  description: string | null;
  created_at: string;
  created_by: string;
  members: string[];
}

/**
 * One egress rule: `from_group` may send to `to_group`.
 *
 * **`tenant` is added by the route**, not stored on the rule — the store keys
 * egress by tenant and returns the rest. A response carrying rules from more
 * than one tenant cannot be joined to its groups without it, and an older
 * tenant-scoped response that omitted it was unambiguous only because there was
 * one tenant in it.
 */
export interface ConsoleEgressRow {
  tenant: string;
  from_group: string;
  to_group: string;
  granted_by: string;
  granted_at: string;
}

/**
 * The `200` body of `GET /api/v1/health`.
 *
 * **No `ok`.** This route predates the envelope and answers `status: 'ok'`
 * instead; three of the seven routes here carry `ok: true`, two carry neither,
 * and that inconsistency is the server's. It is written down rather than
 * smoothed over, because a reader that assumes `ok` on this route reads
 * `undefined` and a reader that assumes `status` on the others does the same.
 *
 * `sign_in` says which sign-ins this deployment can actually complete (D-801).
 * Without it the sign-in screen cannot tell "nobody has asked to join" from
 * "nobody can" — the admission queue answers an empty list for both, and its
 * only writer is the GitHub callback.
 */
export interface ConsoleHealthResponse {
  status: string;
  version: string;
  /** Identities not soft-deleted (§ 9.3). A torn-down identity is not counted. */
  agent_count: number;
  /** Seconds since this process started. */
  uptime: number;
  sign_in: { local: boolean; github: boolean };
}

/**
 * One behaviour metric, from `GET /api/v1/admin/telemetry/behaviour`.
 *
 * **A number and a reason it is missing, never one standing in for the other.**
 * `value: null` with an `unavailable` string is a metric nobody could read; a
 * `0` in its place is a measurement that says the thing did not happen.
 */
export interface ConsoleMetric {
  value: number | null;
  unavailable?: string;
}

/**
 * The `200` body of `GET /api/v1/admin/telemetry/behaviour`.
 *
 * `counting_since` is `null` when the hub did not answer, and the three counts
 * it windows are `null` with it: a count without its window is not a metric.
 */
export interface ConsoleBehaviourResponse {
  ok: true;
  counting_since: string | null;
  pending_keys: ConsoleMetric;
  pending_users: ConsoleMetric;
  oldest_pending_user_ms: ConsoleMetric;
  oldest_pending_ms: ConsoleMetric;
  signature_refusals: ConsoleMetric;
  rate_limited: ConsoleMetric;
  egress_refusals: ConsoleMetric;
  accepted: ConsoleMetric;
}

/**
 * The seven routes, by path, with the envelope key a reader must not guess.
 *
 * Written as data so a non-TypeScript implementation can check the same thing,
 * and so a test can assert the list is the whole list rather than a sample
 * somebody stopped extending.
 */
export const CONSOLE_READ_ROUTES = [
  { path: "/api/v1/agents", listKey: "agents", envelope: "bare" },
  { path: "/api/v1/admin/keys/pending", listKey: "keys", envelope: "ok" },
  { path: "/api/v1/admin/pending", listKey: "users", envelope: "bare" },
  { path: "/api/v1/admin/mailbox", listKey: "mailboxes", envelope: "ok" },
  { path: "/api/v1/audit/events", listKey: "events", envelope: "ok" },
  { path: "/api/v1/admin/groups", listKey: "groups", envelope: "ok" },
  { path: "/api/v1/health", listKey: null, envelope: "status" },
  { path: "/api/v1/admin/telemetry/behaviour", listKey: null, envelope: "ok" },
] as const;

/** Envelope shapes in use. `bare` is an object with neither `ok` nor `status`. */
export type ConsoleEnvelope = (typeof CONSOLE_READ_ROUTES)[number]["envelope"];

/**
 * Names these routes have never sent, and what to read instead.
 *
 * Each entry is a field a reader in this project actually asked for, in a
 * commit, against a route that has never emitted it. They are listed rather
 * than remembered because every one of them failed silently: `any` gave back
 * `undefined`, and `undefined` drew as calm.
 */
export const CONSOLE_FIELDS_THAT_DO_NOT_EXIST = [
  { path: "/api/v1/agents", asked: "status", instead: "last_seen_at" },
  { path: "/api/v1/admin/mailbox", asked: "depth", instead: "total_queued" },
  { path: "/api/v1/admin/pending", asked: "pending", instead: "users" },
] as const;
