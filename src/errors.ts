/**
 * JSON-RPC error codes (SPEC § 8, § 8.9.3).
 *
 * The classification matters more than the numbers. A client that cannot tell
 * a transient failure from a permanent one either retries something that will
 * never succeed — forever, since there is no retry ceiling — or discards audit
 * material over a hiccup.
 */

export const MESH_ERROR = {
  /** An established owner still holds this identity; the incumbent is never evicted. */
  DUPLICATE_IDENTITY: -32010,
  /** No live `agents` row, or the row is soft-deleted. */
  IDENTITY_NOT_REGISTERED: -32011,
  /** Absent, malformed, stale, replayed, or not verifiable against the approved key. */
  SIGNATURE_INVALID: -32012,
  /** `from` is neither the connected identity nor an entitled `proxy_for` entry. */
  NOT_ENTITLED: -32013,
  /** The identity's type requires a key (§ 10.3) and it has no approved one. */
  KEY_NOT_APPROVED: -32014,

  /** Referenced blobs are not stored yet; `data.missing_sha256[]`. */
  AUDIT_MISSING_BLOBS: -32040,
  /** Same `event_id`, different payload digest. Indicates a producer bug. */
  AUDIT_EVENT_CONFLICT: -32041,
  /** Hub is shedding load; `data.retry_after_ms`. Clears on its own. */
  AUDIT_BUSY: -32043,
  /** Audit storage is full. Transient, but only an operator can clear it. */
  AUDIT_STORAGE_EXHAUSTED: -32044,
  /**
   * The audit store refused a write for a reason the hub could not classify
   * (SPEC § 8.9.3) — a constraint violation, a schema mismatch, a defect in
   * the handler. `data.code` is `"AUDIT_APPEND_FAILED"`.
   *
   * **Permanent**, and that is the whole point of it existing. Every one of
   * those causes fails identically on the next attempt, so reporting them as
   * `AUDIT_BUSY` — which § 8.9.3 retries "with backoff and jitter and no
   * maximum attempt count" — produces exactly the unbounded retry the
   * transient/permanent split was introduced to prevent, and parks the event
   * in an outbox nobody reads instead of a local failure record someone does.
   *
   * JSON-RPC's generic server-error code rather than a new one in the audit
   * range: an unclassified failure is not an audit condition a client can
   * reason about, and giving it a specific code would invite specific
   * handling of something whose only honest description is "this hub broke".
   */
  SERVER_ERROR: -32000,

  INVALID_PARAMS: -32602,
} as const;

export type MeshErrorCode = (typeof MESH_ERROR)[keyof typeof MESH_ERROR];

/**
 * `-32042` was `AUDIT_SEQUENCE_CONFLICT`. Sequence numbers were removed; the
 * code is burned rather than recycled, so an old client meeting a new hub can
 * never mistake one meaning for another.
 */
export const RETIRED_ERROR_CODES = [-32042] as const;

/**
 * How a client must treat a failure.
 *
 * - `transient` — retry with backoff and jitter, no attempt ceiling.
 * - `transient-operator` — retry, but far more slowly, and say plainly that
 *   someone has to intervene. Distinct from `transient` because a client that
 *   reports "busy, retrying" for a full disk misleads whoever reads it.
 * - `wait-approval` — a human must approve or restore a key. Never hot-loop.
 * - `permanent` — will never be accepted. Stop retrying, quarantine the payload
 *   and its blobs locally, and alert. **Not** silent deletion: destroying audit
 *   material to handle an audit error is the wrong instinct.
 */
export type ErrorClass = "transient" | "transient-operator" | "wait-approval" | "permanent";

export const ERROR_CLASS: Record<number, ErrorClass> = {
  [MESH_ERROR.SIGNATURE_INVALID]: "permanent",
  [MESH_ERROR.NOT_ENTITLED]: "permanent",
  [MESH_ERROR.KEY_NOT_APPROVED]: "wait-approval",
  [MESH_ERROR.AUDIT_MISSING_BLOBS]: "transient",
  [MESH_ERROR.AUDIT_EVENT_CONFLICT]: "permanent",
  [MESH_ERROR.AUDIT_BUSY]: "transient",
  [MESH_ERROR.AUDIT_STORAGE_EXHAUSTED]: "transient-operator",
  [MESH_ERROR.INVALID_PARAMS]: "permanent",
  [MESH_ERROR.SERVER_ERROR]: "permanent",
};

/** Why an identity has no usable key. Carried in `-32014` as `data.key_status`. */
export type KeyStatus = "missing" | "pending" | "denied" | "revoked";

export const KEY_STATUSES: readonly KeyStatus[] = ["missing", "pending", "denied", "revoked"];

/**
 * The discriminator in `error.data.code`.
 *
 * **Not a second spelling of the JSON-RPC code.** Several conditions share one
 * numeric code — `-32000` is returned by the dispatcher's last-resort guard, by
 * a `mesh.send` that could not persist, by a reminder store failure, and by an
 * audit append that failed for an unclassified reason. The number carries the
 * retry policy (see `ERROR_CLASS`); this string carries *which* condition it
 * was.
 *
 * So a client uses both, for different questions:
 *
 * ```ts
 * if (ERROR_CLASS[err.code] === "permanent") drop(event)   // what to do
 * if (err.data?.code === "AUDIT_APPEND_FAILED") ...        // what happened
 * ```
 *
 * Branching on the number alone cannot tell an audit failure from a routing
 * one; branching on the string alone loses the retry policy. Aliasing a name
 * like `AUDIT_APPEND_FAILED` onto `-32000` would collapse the two and make a
 * failed `mesh.send` read as an audit error.
 */
export const ERROR_DATA_CODE = {
  /** `-32010`. An established owner still holds the identity (§ 8.1). */
  DUPLICATE_IDENTITY: "DUPLICATE_IDENTITY",
  /** `-32011`. Provision it first (§ 10.1). */
  IDENTITY_NOT_REGISTERED: "IDENTITY_NOT_REGISTERED",
  /** `-32014`. `data.key_status` says why (§ 10.2). */
  KEY_NOT_APPROVED: "KEY_NOT_APPROVED",
  /** `-32015`. One `client_message_id`, two different messages (§ 8.2). */
  SEND_CONFLICT: "SEND_CONFLICT",
  /** `-32040`. `data.missing_sha256[]` (§ 8.9.3). */
  AUDIT_MISSING_BLOBS: "AUDIT_MISSING_BLOBS",
  /** `-32041`. Same `event_id`, different payload (§ 8.9.3). */
  AUDIT_EVENT_CONFLICT: "AUDIT_EVENT_CONFLICT",
  /** `-32043`. `data.retry_after_ms` (§ 8.9.3). */
  AUDIT_BUSY: "AUDIT_BUSY",
  /** `-32044`. Needs an operator, not a retry (§ 15.6). */
  AUDIT_STORAGE_EXHAUSTED: "AUDIT_STORAGE_EXHAUSTED",
  /**
   * `-32000`. The audit store refused the write for a reason the hub could
   * not classify (§ 8.9.3). Permanent — see `ERROR_CLASS`.
   */
  AUDIT_APPEND_FAILED: "AUDIT_APPEND_FAILED",
} as const;

export type ErrorDataCode = (typeof ERROR_DATA_CODE)[keyof typeof ERROR_DATA_CODE];

/**
 * Narrow an error body's `data.code` to the vocabulary above.
 *
 * `Object.hasOwn`, not `in`: `in` walks the prototype chain, so a hub — or
 * anything impersonating one — sending `data.code: "toString"` would be
 * accepted as a valid code and handed to a caller's switch.
 */
export function errorDataCode(error: unknown): ErrorDataCode | null {
  const code = (error as { data?: { code?: unknown } } | null | undefined)?.data?.code;
  if (typeof code !== "string") return null;
  // Widened for the lookup: `hasOwn` is typed against the literal key union,
  // and the whole job here is deciding whether an arbitrary string is one.
  const known: Record<string, string> = ERROR_DATA_CODE;
  return Object.hasOwn(known, code) ? (code as ErrorDataCode) : null;
}
