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
};

/** Why an identity has no usable key. Carried in `-32014` as `data.key_status`. */
export type KeyStatus = "missing" | "pending" | "denied" | "revoked";

export const KEY_STATUSES: readonly KeyStatus[] = ["missing", "pending", "denied", "revoked"];
