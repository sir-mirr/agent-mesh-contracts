/**
 * Audit ingestion contract (SPEC § 8.9).
 *
 * Channel traffic bypasses the hub for latency, so a runtime-adapter reports it
 * asynchronously from a durable outbox. Mesh traffic already flows through the
 * hub, so the hub records those events itself — an adapter reporting them would
 * mean both ends filing the same message.
 */

/** Advertised by the hub in the `mesh.connect` result. */
export interface AuditCapabilities {
  /** Protocol version: methods, params, error contract. Lives for the connection. */
  version: number;
  content_addressing: "sha256";
  max_blob_bytes: number;
  max_attachments_per_event: number;
  max_attachments_bytes_per_event: number;
  upload_timeout_seconds: number;
  max_inflight_appends: number;
  max_inflight_uploads: number;
}

/**
 * The limits this contract release describes. A hub MAY advertise different
 * numbers; a client MUST use what it is told. A hub that advertises nothing is
 * treated as incompatible — never as "assume these".
 */
export const AUDIT_CAPABILITY_DEFAULTS: AuditCapabilities = {
  version: 1,
  content_addressing: "sha256",
  max_blob_bytes: 104_857_600,
  max_attachments_per_event: 32,
  max_attachments_bytes_per_event: 268_435_456,
  upload_timeout_seconds: 180,
  max_inflight_appends: 4,
  max_inflight_uploads: 2,
};

/** Highest event schema this release can produce or validate. */
export const AUDIT_SCHEMA_VERSION = 1;

/**
 * `event_type` is an open namespace, not a closed enum, so a new channel
 * provider or action costs no protocol version. These are the types defined so
 * far; receivers MUST tolerate others.
 */
export const AUDIT_EVENT_TYPES = [
  "channel.inbound.received",
  "channel.inbound.rejected",
  "runtime.inbound.dispatched",
  "runtime.inbound.failed",
  "channel.outbound.requested",
  "channel.outbound.succeeded",
  "channel.outbound.failed",
  "channel.message.edited",
  "channel.message.deleted",
  "channel.reaction.requested",
  "channel.reaction.succeeded",
  "channel.reaction.failed",
  "mesh.message.sent",
  "mesh.message.delivered",
  "mesh.message.pending",
] as const;

/** `aud_` followed by a canonical lowercase UUIDv7. */
export const EVENT_ID_RE =
  /^aud_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function isValidEventId(value: string): boolean {
  return EVENT_ID_RE.test(value);
}

/** Diagnostic label only. Nothing in correctness depends on it. */
export const PRODUCER_ID_MAX_LENGTH = 64;

export interface AuditAttachmentRef {
  /** Authoritative key from `prepare_blobs`. */
  blob_key: string;
  sha256: string;
  /** Original filename, for display. */
  name: string;
  mime?: string;
  size: number;
}

export interface PrepareBlobsParams {
  event_id: string;
  blobs: Array<{ sha256: string; size: number; name: string }>;
}

export interface PrepareBlobsResult {
  blobs: Array<{
    sha256: string;
    /** Derived by the hub. Clients use this rather than computing their own. */
    blob_key: string;
    status: "present" | "missing";
    upload?: {
      method: "PUT";
      url: string;
      nonce: string;
      expires_at: string;
    };
  }>;
}

/**
 * What a client sends.
 *
 * `identity`, `recorded_by`, `attestation` and `payload_digest` are absent by
 * design: they are the record's trust metadata, and a field the client supplies
 * cannot attest to the client. The hub builds each from the authenticated
 * connection, the verified signature and the received bytes. A client that
 * sends them anyway has them ignored.
 */
export interface AuditAppendParams {
  schema_version: number;
  event_id: string;
  event_type: string;
  /** ISO-8601. */
  occurred_at: string;
  correlation_id?: string;
  causation_event_id?: string | null;
  producer_id?: string;
  [key: string]: unknown;
}

export interface AuditAppendResult {
  ok: true;
  committed: true;
  duplicate: boolean;
  event_id: string;
  /** As derived by the hub, not as sent. */
  identity: string;
  attachments_verified: number;
  stored_at: string;
}

/**
 * Who wrote the record, as opposed to whose activity it describes (§ 8.9.4).
 *
 * **Three recorders, not two.** The vocabulary was `"hub" | "adapter"` until
 * `test/audit.test.ts` in the platform read the route and found `http` on the
 * wire, written by every § 11.0.1 access record. The type had excluded a value
 * the server had been sending all along, so a reader narrowed on it met a third
 * kind and matched no branch.
 *
 * **`identity` is null exactly for the hub, and that is the point of the
 * union.** The hub records under its own authority and has no separate
 * reporting identity; filling one in invents a participant. Every other kind
 * names one, so a consumer branching on `kind` gets the nullability with it
 * rather than having to check twice.
 *
 * The stored column is still `recorded_by_id`. A storage name is not a wire
 * name, and renaming the column would rewrite audit history to fix a spelling.
 */
export type RecordedBy =
  /** § 8.9.4. The hub's own observation of routing it performed. */
  | { kind: "hub"; identity: null }
  /** `mesh.audit.append`. An adapter's report of its own activity. */
  | { kind: "adapter"; identity: string }
  /**
   * § 11.0.1. **A record that the audit log itself was read** — who saw what,
   * which is the most sensitive axis the trail has. `identity` is the reading
   * service's own name, `agent-mesh-http`, not the operator behind the session;
   * the operator is in `identity` on the event.
   *
   * Not another adapter. An adapter reports activity elsewhere; this reports
   * access to the record, and a consumer that folds the two together cannot
   * show an access log at all — which reads as nobody having looked.
   */
  | { kind: "http"; identity: string };

/**
 * The signature preserved with a stored event.
 *
 * `covers` is required because a later verifier has to know which bytes to
 * hash. A hub-produced mesh event's signature covers the original
 * `mesh.send` request, not the audit event body — so those bytes are retained
 * verbatim alongside it.
 */
export interface Attestation {
  signed_by: string;
  kid: string;
  alg: "ed25519";
  value: string;
  covers: "audit.params" | "mesh.send.params";
}
