/**
 * The socketless transport (SPEC § 8.10).
 *
 * A participant driven by an application rather than a daemon is awake only
 * while it is answering. It cannot hold a socket and has nowhere to be pushed
 * to, so it sends when awake and drains its inbox when it next is.
 *
 * Two contracts make that safe, and both exist because a turn can end between
 * any two things.
 *
 * **Delivery is at-least-once, acknowledged on the next call.** A destructive
 * read loses whatever the caller did not survive to persist; a separate
 * acknowledgement costs a round trip and opens a window in which a message
 * arriving between read and ack is cleared by an ack that predates it. Carrying
 * the previous batch's ids on the next fetch has neither: one call, one
 * transaction, and anything unacknowledged comes back.
 *
 * The cost is duplicates, which is why `id` is stable and clients deduplicate
 * on it. That is the right way round — a duplicate is visible and cheap, a loss
 * is neither.
 *
 * **Sends are idempotent by `client_message_id`.** The hub can commit a message
 * and then fail to deliver the response, at which point a retry is
 * indistinguishable from a new send. Only the client can tell them apart, so
 * only the client can supply the key.
 */

/** What a hub advertises about its mailbox surface, in `mesh.connect`. */
export interface MailboxCapabilities {
  /** Protocol version for the transport: methods, params, error contract. */
  version: number;
  /** Largest `limit` accepted by `mesh.receive`. */
  max_receive_batch: number;
  /**
   * How long a delivered-but-unacknowledged batch stays invisible before it is
   * offered again.
   *
   * The tension is a turn that dies mid-batch. Too short and a slow caller is
   * handed the same messages while still working on them; too long and a caller
   * that crashed waits that long before anything is re-offered. Both are
   * survivable because ids are stable, so the setting is a comfort question
   * rather than a correctness one.
   */
  receive_lease_seconds: number;
  /** How long a `client_message_id` is remembered for deduplication. */
  send_dedup_window_seconds: number;
}

export const MAILBOX_CAPABILITY_DEFAULTS: MailboxCapabilities = {
  version: 1,
  max_receive_batch: 200,
  receive_lease_seconds: 300,
  // Comfortably longer than any retry a client should still be attempting, and
  // short enough that the table does not become a permanent record of every
  // message ever sent.
  send_dedup_window_seconds: 86_400,
};

/** `mesh.receive` params (SPEC § 8.10.1). */
export interface MeshReceiveParams {
  limit?: number;
  /**
   * Ids from the previous batch, acknowledged as part of this call.
   *
   * Ids the caller does not hold are ignored rather than refused: a caller
   * retrying an ambiguous receive re-sends the same acknowledgements, and
   * failing that retry would strand the batch it is trying to settle.
   */
  ack_ids?: string[];
}

/** `mesh.send` params gain one optional member (SPEC § 8.2). */
export interface MeshSendIdempotency {
  /**
   * Caller-chosen, unique per sending identity.
   *
   * Retrying with the same key and the same message returns the original
   * result. Reusing it for a *different* message is a permanent error — the key
   * is how the hub tells a retry from a new send, so a key that means two
   * things means neither.
   */
  client_message_id?: string;
}

/**
 * Machine-readable reasons `POST /api/v1/agents` refuses (SPEC § 10.1).
 *
 * A caller onboarding a lane has to tell "this name is taken" from "your
 * request was malformed" without matching on prose.
 */
export const PROVISION_ERROR = {
  /** `create_only` and the identity already exists. 409. Permanent. */
  IDENTITY_EXISTS: "IDENTITY_EXISTS",
  /** The identity was torn down and cannot be re-registered (§ 9.3). 409. Permanent. */
  IDENTITY_DELETED: "IDENTITY_DELETED",
  /**
   * `public_key` is already on record under a different identity. 409.
   * Permanent for that key; the caller must supply one of its own.
   *
   * `agent_keys` is keyed on the fingerprint alone, so without this the INSERT
   * silently does nothing and the response reports the *other* holder's
   * status — a caller is told `approved` while having no key at all, and an
   * identity of a `requires_key` type exists that can never connect.
   *
   * The response does not name the holder. Doing so would make provisioning a
   * fingerprint-to-identity lookup readable by anyone who can reach the port.
   */
  KEY_HELD_BY_ANOTHER_IDENTITY: "KEY_HELD_BY_ANOTHER_IDENTITY",
} as const;

export type ProvisionErrorCode = (typeof PROVISION_ERROR)[keyof typeof PROVISION_ERROR];

export const MAILBOX_ERROR = {
  /** Same `client_message_id`, different message. Permanent — do not retry. */
  SEND_CONFLICT: -32015,
} as const;

/**
 * The REST surface's own version (SPEC § 9.2).
 *
 * Separate from `MailboxCapabilities.version` because they move for different
 * reasons: that one versions the transport — methods, params, error codes —
 * and this one versions the route table. A client that gated the transport on
 * a route-table bump would refuse a hub that had only gained a route, which is
 * the conflation § 13 exists to prevent.
 */
export interface SurfaceCapabilities {
  version: number;
  /**
   * How this deployment learns a peer's address (SPEC § 8.11).
   *
   * `socket` — the kernel's view of the peer. Evidence.
   * `forwarded` — taken from `X-Forwarded-For`, believed only from a
   * configured trusted proxy. Evidence **only if** the hub is unreachable
   * except through that proxy, which nothing inside the hub can verify.
   *
   * Reported because a control that is configured off is indistinguishable
   * from one that is on until somebody asks.
   */
  observed_source: "socket" | "forwarded";
}

/**
 * | Version | Route table |
 * |---------|-------------|
 * | `1`     | § 9.2 and § 9.2.1 as first built |
 * | `2`     | `GET /api/v1/agents/{identity}/keys` reports the registered `type` |
 * | `3`     | `POST /api/v1/agents` refuses a `public_key` held by another identity |
 * | `4`     | `capabilities.surface.observed_source` reports how a peer's address is learned |
 *
 * The bump exists because **the alternative is inferring a version from a
 * missing field, and absence is ambiguous.** A hub too old to report `type`
 * omits it; a hub that reports it answers `null` for an identity registered
 * through `mesh.register`, which never wrote one. A client probing for absence
 * cannot tell those apart, and the one it guesses wrong is the one where it
 * silently stops checking.
 *
 * Read from `GET /api/v1/capabilities`, which is unsigned and served by the
 * running process — so it answers for the deployment rather than for whatever
 * a source tree claims. `agentMeshSpec` cannot do this job: it versions the
 * whole document at minor granularity (§ 13), so it does not move for a field.
 */
export const SURFACE_CAPABILITY_DEFAULTS: SurfaceCapabilities = {
  version: 4,
  // Overridden per deployment; this is the safe default, not a guess about
  // where the hub is running.
  observed_source: "socket",
};

/** `GET /api/v1/capabilities` — what a deployment actually enforces (§ 9.2). */
export interface DeploymentCapabilities {
  mailbox: MailboxCapabilities;
  surface: SurfaceCapabilities;
  /** Shaped by `AUDIT_CAPABILITY_DEFAULTS`; repeated here for socketless
   *  callers, which never see the `mesh.connect` result that carries it. */
  audit: Record<string, unknown>;
}
