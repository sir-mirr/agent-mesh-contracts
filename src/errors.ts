/**
 * JSON-RPC error codes (SPEC § 8, § 8.9.3).
 *
 * The classification matters more than the numbers. A client that cannot tell
 * a transient failure from a permanent one either retries something that will
 * never succeed — forever, since there is no retry ceiling — or discards audit
 * material over a hiccup.
 */

import { MAILBOX_ERROR } from "./mailbox";

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
 * The band this contract allocates from (SPEC § 8).
 *
 * JSON-RPC 2.0 leaves `-32099 … -32000` for implementation-defined server
 * errors. Agent Mesh takes the lower half and never assigns above it, so a
 * protocol layered beside the mesh — a lane's driver-to-adapter control plane,
 * a deployment's own tooling — can use `-32099 … -32050` and stay safe from
 * anything released here.
 *
 * The hazard this closes is not a clash that fails loudly. Both halves of a
 * lane speak JSON-RPC and the vocabularies meet inside one process; an error
 * object is an error object, so a shared number does not error, it
 * **reclassifies**. `-32043` is `AUDIT_BUSY` and therefore retried without an
 * attempt ceiling — a neighbour that had assigned `-32043` to a permanently
 * malformed payload would see that payload retried forever the first time the
 * two paths were joined.
 */
export const MESH_ERROR_RANGE = { min: -32049, max: -32000 } as const;

/**
 * JSON-RPC 2.0's own predefined codes, which this contract **reuses rather than
 * allocates**. `INVALID_PARAMS` appears in `MESH_ERROR` for convenience and is
 * `-32602` because JSON-RPC says so, not because the mesh assigned it — so it
 * sits outside the reserved band and cannot collide with anyone, since every
 * JSON-RPC implementation already means the same thing by it.
 */
export const JSON_RPC_PREDEFINED = [-32700, -32600, -32601, -32602, -32603] as const;

/** Whether a code falls in the band this contract allocates from. */
export function isMeshErrorCode(code: number): boolean {
  return Number.isInteger(code) && code >= MESH_ERROR_RANGE.min && code <= MESH_ERROR_RANGE.max;
}

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
  /**
   * An established socket still holds the identity (§ 8.1) and a contender
   * never evicts one.
   *
   * **Not the same condition as `409 IDENTITY_EXISTS`**, which says the *name*
   * is taken and to choose another (§ 10.1). This says the name is yours and
   * something else is currently connected under it — most often your own
   * previous process, whose socket has not finished closing.
   *
   * That race is why this is not permanent. A daemon restarting faster than its
   * old socket closes would, under `permanent`, give up for good on a condition
   * that resolves by itself in seconds. The heartbeat bounds the worst case:
   * a peer that stops answering is dropped within two sweeps (§ 3.1), so an
   * abandoned socket can no longer hold an identity indefinitely — which is
   * what made `permanent` defensible before that existed and wrong now.
   *
   * `transient-operator` rather than `transient` because the *other* cause —
   * two deployments genuinely sharing one identity — never resolves on its own,
   * and a client that only says "retrying" for that misleads whoever reads it.
   */
  [MESH_ERROR.DUPLICATE_IDENTITY]: "transient-operator",
  /**
   * Nothing has provisioned this identity (§ 10.1), or it was torn down. A
   * client cannot fix either by trying again; both clear when someone acts.
   * `data.code` distinguishes the deleted case, which never clears at all.
   */
  [MESH_ERROR.IDENTITY_NOT_REGISTERED]: "transient-operator",
  [MESH_ERROR.SIGNATURE_INVALID]: "permanent",
  [MESH_ERROR.NOT_ENTITLED]: "permanent",
  [MESH_ERROR.KEY_NOT_APPROVED]: "wait-approval",
  [MESH_ERROR.AUDIT_MISSING_BLOBS]: "transient",
  [MESH_ERROR.AUDIT_EVENT_CONFLICT]: "permanent",
  [MESH_ERROR.AUDIT_BUSY]: "transient",
  [MESH_ERROR.AUDIT_STORAGE_EXHAUSTED]: "transient-operator",
  [MESH_ERROR.INVALID_PARAMS]: "permanent",
  [MESH_ERROR.SERVER_ERROR]: "permanent",
  /**
   * One `client_message_id`, two different messages (§ 8.2, which states this
   * classification outright). The key already means something else; a retry
   * carries the same contradiction and is refused identically.
   */
  [MAILBOX_ERROR.SEND_CONFLICT]: "permanent",
  // Permanent, not transient: a retry from the same network fails identically.
  // Classing it transient would make a lane loop against a refusal only an
  // operator can lift.
  [MAILBOX_ERROR.SOURCE_CHANGED]: "permanent",
  // A retry changes nothing; only an operator adding a rule does.
  [MAILBOX_ERROR.EGRESS_DENIED]: "permanent",
};

/**
 * The class for a code, with the answer for an unknown one stated by the caller.
 *
 * `unknown` is required on purpose. Indexing `ERROR_CLASS` directly leaves an
 * unrecognised code as `undefined`, and every natural way to absorb that —
 * `?? "transient"`, or an `if/else` whose else-branch happens to be the retry
 * path — makes a silent default load-bearing. That is what happened when the
 * hub began emitting `-32000` and this table had no entry.
 *
 * The fix is not a better default here, because there is no default that is
 * right everywhere:
 *
 * - On the **audit outbox**, `"transient"` is the safer miss. A wrong retry is
 *   bounded by the caller's backoff ceiling and shows up as a rising attempt
 *   count; a wrong dead-letter has no ceiling and no automatic recovery, and
 *   during a version skew it would quarantine every event in the window.
 * - On a **connect or send** path with no outbox behind it, `"permanent"` is
 *   the safer miss: there is nothing to drain later, and retrying an
 *   unrecognised refusal is a loop against a condition the client cannot act on.
 *
 * So the contract declines to choose and makes each call site say which it is.
 * The parameter is also greppable, which a `??` buried in an expression is not.
 */
export function errorClass(code: number, unknown: ErrorClass): ErrorClass {
  return ERROR_CLASS[code] ?? unknown;
}

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
  /**
   * `-32017`. A dormant identity sent from a network it has not been seen on
   * (§ 8.11.2). An operator reviews it; the lane cannot clear this itself.
   */
  SOURCE_CHANGED: "SOURCE_CHANGED",
  /** `-32018`. No egress rule from the sender's group to the recipient's (§ 12). */
  EGRESS_DENIED: "EGRESS_DENIED",
  /**
   * `429`. Too many requests (§ 14). Carries `retry_after` in whole seconds.
   *
   * Transient by construction — the bucket refills — which is the one case
   * where a client looping is correct, provided it honours `retry_after`.
   */
  RATE_LIMITED: "RATE_LIMITED",
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
  /**
   * `403` on the hub's `DELETE /api/agents/{identity}` (§ 9.3).
   *
   * Not a JSON-RPC error: teardown is a REST route, and this is the `code` in
   * its refusal body. It is here because the vocabulary is what a client
   * switches on, and a caller that has to string-match the prose instead is
   * one prose edit away from breaking.
   */
  TEARDOWN_REQUIRES_ADMIN: "TEARDOWN_REQUIRES_ADMIN",
  /**
   * `409` on `DELETE /api/v1/outbox/{id}` (§ 9.2).
   *
   * The recipient was handed the message between the sender listing it as
   * recallable and asking to recall it. The listing is a hint; the delete
   * re-decides, and this is it deciding against.
   */
  ALREADY_DELIVERED: "ALREADY_DELIVERED",
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
