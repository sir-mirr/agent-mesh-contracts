/**
 * Cross-repository end-to-end scenarios (SPEC § 17).
 *
 * **Here rather than in either implementation**, for the same reason the error
 * codes are: two repositories have to agree on what the mesh does, and a
 * scenario that lives on one side is that side's opinion. Pinned by tag like
 * everything else, so "we both pass the same scenarios" is a checkable claim
 * rather than a shared belief.
 *
 * ## Executable, not prose
 *
 * The previous set was a list of English assertions — a checklist somebody read
 * before a release. A checklist cannot be replayed, so it was run when someone
 * remembered, and the things it described drifted.
 *
 * These are steps with a small verb set. Each side implements the verbs against
 * its own transport and the scenarios stay identical, which is the only way the
 * two runs are comparable.
 *
 * ## Every scenario cites its clause
 *
 * A scenario nobody can trace to the contract is a scenario asserting somebody's
 * memory. `clause` is required, and `why` says what breaks if the behaviour
 * regresses — the sentence a reader needs when the test fails in a year.
 */

/** The verbs both runners implement. Deliberately few. */
export type Step =
  /**
   * Register an identity. `key: true` generates one and remembers its
   * fingerprint; `reuseKeyOf` sends an *earlier* identity's public key, which
   * is the only way to express the collision § 10.1 refuses.
   */
  | { do: "provision"; identity: string; type: string; key?: boolean; reuseKeyOf?: string; extra?: Record<string, unknown>; expect?: ExpectHttp }
  /** Approve the key most recently proposed for `identity`. */
  | { do: "approve"; identity: string }
  /** Deny or revoke it. `reason` is required for a revoke (§ 10.2). */
  | { do: "revoke"; identity: string; reason: string }
  /** Open a signed socket and `mesh.connect`. */
  | { do: "connect"; identity: string; expect?: ExpectRpc }
  /** `mesh.send` over whichever transport the runner is exercising. */
  | { do: "send"; from: string; to: string; content: string; clientMessageId?: string; expect?: ExpectRpc }
  /** `mesh.receive` — leases a batch and settles the previous one. */
  | { do: "receive"; identity: string; ackPrevious?: boolean; expectCount?: number }
  /** A REST call, for the surfaces that are not JSON-RPC. */
  | { do: "http"; method: "GET" | "POST" | "DELETE"; path: string; as?: "admin" | "none"; body?: unknown; expect?: ExpectHttp }
  /** Let wall-clock time pass. Only for the scenarios about expiry. */
  | { do: "sleep"; seconds: number }
  /** Assert something about state the previous steps produced. */
  | { do: "expectStored"; what: "sourceRecorded" | "auditReadLogged" | "typeChangeRecorded"; identity: string };

/**
 * A mesh shaped differently from the default one.
 *
 * Only for behaviour a default deployment cannot show in test time — a lease
 * lapsing is the case that forced this. Stated on the scenario rather than
 * arranged by the runner because it is part of what the scenario *means*: "with
 * a two-second lease, an unacknowledged batch comes back" is the claim, and a
 * runner that quietly used thirty would be measuring something else.
 *
 * A scenario carrying this gets its own mesh and must therefore provision
 * everything it names.
 */
export interface MeshRequirement {
  receiveLeaseSeconds?: number;
}

export interface ExpectRpc {
  /** JSON-RPC error code, or `null` for success. */
  error?: number | null;
  /** `data.code`, when the scenario is about which refusal rather than that one happened. */
  dataCode?: string;
}

export interface ExpectHttp {
  status: number;
  /** Body `code` field, for the refusals that carry one. */
  code?: string;
  /**
   * Dotted paths into the body and the values they must hold.
   *
   * Deliberately not a full matcher language. A scenario that can assert
   * anything about a response becomes a second copy of the schema, and then the
   * list drifts from the contract it was meant to hold. This exists for one
   * shape: a route that *advertises* a number the rest of the mesh must obey.
   */
  body?: Record<string, string | number | boolean | null>;
}

export interface Scenario {
  id: string;
  /** The SPEC section this exists to hold. Required — see the module note. */
  clause: string;
  /** What breaks if it regresses. The sentence a reader needs a year from now. */
  why: string;
  /** A mesh this scenario needs shaped differently. Absent means the shared one. */
  mesh?: MeshRequirement;
  steps: Step[];
}

/**
 * The shared set.
 *
 * Ordered so a reader meets the mesh the way a deployment does: identities and
 * keys first, then delivery, then the refusals that only exist once there is
 * something to refuse.
 */
export const E2E_SCENARIOS: readonly Scenario[] = [
  {
    id: "E2E-KEY-001",
    clause: "§ 10.2",
    why: "A key that connects before an operator approved it means approval is decoration. The refusal has to name the state, or a lane cannot tell 'wait' from 'stop'.",
    steps: [
      { do: "provision", identity: "e2e-key", type: "ai-claude", key: true, expect: { status: 201 } },
      { do: "connect", identity: "e2e-key", expect: { error: -32014, dataCode: "KEY_NOT_APPROVED" } },
      { do: "approve", identity: "e2e-key" },
      { do: "connect", identity: "e2e-key", expect: { error: null } },
    ],
  },
  {
    id: "E2E-KEY-002",
    clause: "§ 10.1",
    why: "A public key already held by another identity used to be answered with that other holder's status — the caller was told `approved` while holding no key at all.",
    steps: [
      { do: "provision", identity: "e2e-owner", type: "ai-claude", key: true },
      { do: "provision", identity: "e2e-thief", type: "ai-claude", reuseKeyOf: "e2e-owner",
        expect: { status: 409, code: "KEY_HELD_BY_ANOTHER_IDENTITY" } },
    ],
  },
  {
    id: "E2E-REVOKE-001",
    clause: "§ 8.1, § 10.2",
    why: "Revocation that leaves an open socket receiving is not revocation. Key state is read per request, not cached at connect.",
    steps: [
      { do: "provision", identity: "e2e-revoked", type: "ai-claude", key: true },
      { do: "approve", identity: "e2e-revoked" },
      { do: "connect", identity: "e2e-revoked", expect: { error: null } },
      { do: "revoke", identity: "e2e-revoked", reason: "compromise" },
      { do: "send", from: "e2e-revoked", to: "e2e-owner", content: "after revocation",
        expect: { error: -32014 } },
    ],
  },
  {
    id: "E2E-SEND-001",
    clause: "§ 8.2",
    why: "The plain delivery path. If this breaks, everything else in this file is measuring a mesh that does not carry messages.",
    steps: [
      { do: "provision", identity: "e2e-a", type: "ai-claude", key: true },
      { do: "provision", identity: "e2e-b", type: "ai-claude", key: true },
      { do: "approve", identity: "e2e-a" },
      { do: "approve", identity: "e2e-b" },
      { do: "connect", identity: "e2e-a" },
      { do: "send", from: "e2e-a", to: "e2e-b", content: "안녕 🌐 mesh", expect: { error: null } },
      { do: "receive", identity: "e2e-b", expectCount: 1 },
    ],
  },
  {
    id: "E2E-SEND-002",
    clause: "§ 8.2",
    why: "Idempotency is what makes a retry safe after a response is lost. The same key with the same message must return the original result rather than deliver twice.",
    steps: [
      { do: "provision", identity: "e2e-idem", type: "ai-claude", key: true },
      { do: "approve", identity: "e2e-idem" },
      { do: "connect", identity: "e2e-idem" },
      { do: "send", from: "e2e-idem", to: "e2e-b", content: "once", clientMessageId: "cmid-1", expect: { error: null } },
      { do: "send", from: "e2e-idem", to: "e2e-b", content: "once", clientMessageId: "cmid-1", expect: { error: null } },
      { do: "send", from: "e2e-idem", to: "e2e-b", content: "different", clientMessageId: "cmid-1",
        expect: { error: -32015, dataCode: "SEND_CONFLICT" } },
    ],
  },
  {
    id: "E2E-RECEIVE-001",
    clause: "§ 8.10.1",
    why: "A leased batch is invisible until the lease lapses. Without that, two callers for one identity — a reconnect overlapping its predecessor — each get the same messages and both act on them.",
    steps: [
      { do: "provision", identity: "e2e-lease", type: "ai-claude", key: true },
      { do: "approve", identity: "e2e-lease" },
      { do: "send", from: "e2e-a", to: "e2e-lease", content: "unacked" },
      { do: "receive", identity: "e2e-lease", expectCount: 1 },
      // Immediately again. Nothing, because the batch is leased — **not**
      // because it was consumed. The first draft of this scenario expected the
      // message back here, which is the destructive-read model § 8.10.1
      // explicitly rejected; the run failed on correct behaviour.
      { do: "receive", identity: "e2e-lease", expectCount: 0 },
      { do: "receive", identity: "e2e-lease", ackPrevious: true, expectCount: 0 },
    ],
  },
  {
    id: "E2E-RECEIVE-002",
    clause: "§ 8.10.1",
    why: "The at-least-once promise itself. A batch nobody acknowledged comes back when its lease lapses, and one acknowledged does not — a run that only checks the first half passes on a mailbox that never forgets anything.",
    // Two seconds, because the default lease outlives any test that would wait
    // for it. The number is the scenario's, not the runner's — see MeshRequirement.
    mesh: { receiveLeaseSeconds: 2 },
    steps: [
      { do: "provision", identity: "e2e-lapse-src", type: "ai-claude", key: true },
      { do: "provision", identity: "e2e-lapse", type: "ai-claude", key: true },
      { do: "approve", identity: "e2e-lapse-src" },
      { do: "approve", identity: "e2e-lapse" },
      { do: "send", from: "e2e-lapse-src", to: "e2e-lapse", content: "will lapse" },
      { do: "receive", identity: "e2e-lapse", expectCount: 1 },
      { do: "sleep", seconds: 3 },
      // Back, unacknowledged. This is the half that makes the transport safe.
      { do: "receive", identity: "e2e-lapse", expectCount: 1 },
      { do: "receive", identity: "e2e-lapse", ackPrevious: true, expectCount: 0 },
      { do: "sleep", seconds: 3 },
      // And gone for good. Without this step the scenario passes on a mesh
      // whose ack does nothing at all.
      { do: "receive", identity: "e2e-lapse", expectCount: 0 },
    ],
  },
  {
    id: "E2E-CAP-001",
    clause: "§ 8.10.1, § 7",
    why: "A deployment that shortened its receive lease went on advertising the default, so every client sized its retry loop on a number the hub had stopped honouring. Nothing failed — ids are stable and messages came back — the caller simply polled on a cadence nobody asked for.",
    // The same two-second mesh. The point is that what the route says and what
    // the mesh does are one number; measuring that needs a deployment where the
    // configured value differs from the constant.
    mesh: { receiveLeaseSeconds: 2 },
    steps: [
      { do: "http", method: "GET", path: "/api/v1/capabilities", as: "none",
        expect: { status: 200, body: { "mailbox.receive_lease_seconds": 2 } } },
    ],
  },
  {
    id: "E2E-EGRESS-001",
    clause: "§ 12",
    why: "Deny by default, with `default` seeded to itself so an upgrade does not silence a mesh that never heard of groups. A group created can send nowhere until somebody says so.",
    steps: [
      { do: "http", method: "POST", path: "/api/v1/admin/groups", as: "admin",
        body: { group_id: "e2e-walled" }, expect: { status: 201 } },
      { do: "provision", identity: "e2e-walled-a", type: "ai-claude", key: true },
      { do: "provision", identity: "e2e-walled-b", type: "ai-claude", key: true },
      { do: "approve", identity: "e2e-walled-a" },
      { do: "http", method: "POST", path: "/api/v1/admin/groups/e2e-walled/members", as: "admin",
        body: { identity: "e2e-walled-a" }, expect: { status: 200 } },
      { do: "http", method: "POST", path: "/api/v1/admin/groups/e2e-walled/members", as: "admin",
        body: { identity: "e2e-walled-b" }, expect: { status: 200 } },
      { do: "send", from: "e2e-walled-a", to: "e2e-walled-b", content: "denied",
        expect: { error: -32018, dataCode: "EGRESS_DENIED" } },
      { do: "http", method: "POST", path: "/api/v1/admin/groups/e2e-walled/egress", as: "admin",
        body: { to_group: "e2e-walled" }, expect: { status: 201 } },
      { do: "send", from: "e2e-walled-a", to: "e2e-walled-b", content: "allowed", expect: { error: null } },
    ],
  },
  {
    id: "E2E-PROXY-001",
    clause: "§ 8.2",
    why: "`can_proxy` arriving on the unauthenticated provisioning route meant the entitlement check read a value its own subject had written.",
    steps: [
      { do: "http", method: "POST", path: "/api/v1/agents", as: "none",
        body: { identity: "e2e-self-proxy", type: "service", can_proxy: true },
        expect: { status: 403, code: "CAN_PROXY_NOT_SELF_GRANTED" } },
    ],
  },
  {
    id: "E2E-SOURCE-001",
    clause: "§ 8.11",
    why: "The observed source is the hub's own, recorded for every authenticated request. Nothing else in the attestation story is worth anything if this is not written.",
    steps: [
      { do: "provision", identity: "e2e-src", type: "ai-claude", key: true },
      { do: "approve", identity: "e2e-src" },
      { do: "connect", identity: "e2e-src" },
      { do: "expectStored", what: "sourceRecorded", identity: "e2e-src" },
    ],
  },
  {
    id: "E2E-AUDIT-001",
    clause: "§ 11.0, § 11.0.1",
    why: "The platform operator reads the trail and not the messages in it, and a content read leaves a trace. Without the trace, a tenant admin inside the tenant is the absence of a boundary rather than one.",
    steps: [
      { do: "http", method: "GET", path: "/api/v1/audit/events?limit=5", as: "admin", expect: { status: 200 } },
      { do: "expectStored", what: "auditReadLogged", identity: "admin" },
    ],
  },
  {
    id: "E2E-TYPE-001",
    clause: "§ 8.9.5",
    why: "`agents.type` is read at display time, so changing it re-labels every past audit event for that identity. Without the event the trail says it always was what it now is.",
    steps: [
      { do: "provision", identity: "e2e-mover", type: "ai-antigravity", key: true },
      { do: "provision", identity: "e2e-mover", type: "ai-claude", key: false, expect: { status: 200 } },
      { do: "expectStored", what: "typeChangeRecorded", identity: "e2e-mover" },
    ],
  },
] as const;
