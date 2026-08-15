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

/** Who wrote the record, as opposed to whose activity it describes. */
export interface RecordedBy {
  kind: "hub" | "adapter";
  identity: string;
}

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
