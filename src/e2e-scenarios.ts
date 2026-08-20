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
 * ## Values a step cannot know in advance
 *
 * A message id is minted by the mesh. A fingerprint depends on key material the
 * runner generated. Neither can be written into scenario data, and until a step
 * could refer to one, every clause about *a particular message* — recall,
 * read-back of a key that was just proposed — was unstatable.
 *
 * `bind` captures a dotted path out of a step's response under a name;
 * `{{name}}` in **any string anywhere in a later step** is replaced by it —
 * walk the step and substitute, do not enumerate fields. Runners also pre-bind
 * `fingerprint:<identity>` whenever they generate a key, because that value
 * exists in the runner and in no response.
 *
 * **This said `path`, `body` or `expect.body` — three fields — and was wrong.**
 * `E2E-REPLY-001` puts `{{mailId}}` in `replyTo`, a fourth. A runner that
 * implemented the list sent the literal `{{mailId}}` to the mesh, which then
 * behaved correctly: no message has that id, so the send was not a reply, so it
 * routed as an ordinary send and got pushed. The scenario failed on a push
 * count, and **the failure pointed at the hub.** That is the expensive part —
 * not that a field was missed, but that missing it accused the wrong side.
 *
 * The runner that passed did so because it walked the whole step, which is to
 * say its implementation was wider than this sentence. Two copies of one fact,
 * and the narrower copy was the one another agent built against.
 *
 * So there is no list here to fall behind a verb set that keeps growing. A
 * name with no binding must throw wherever it appears; silently substituting
 * empty is how a `DELETE /api/v1/mailbox/out/` with a blank id becomes a `404`
 * a scenario reports as its expected refusal.
 *
 * **Substitution, not evaluation.** No arithmetic, no conditionals, no
 * comparison. The moment a scenario can compute, the list stops being a
 * statement about the contract and becomes a program that has to be debugged on
 * two implementations.
 *
 * ## Nothing is skipped
 *
 * Three scenarios used to assert a trace by reading the platform's SQLite —
 * an observed source recorded, a content read logged, a type change kept. Only
 * one of the two runners has a database, so the other skipped them, and § 17.3
 * made that legal.
 *
 * It was legal and it was a hole: those clauses were confirmed by exactly one
 * implementation while both reported green. They now assert through the
 * operator's own routes, which is the better question anyway — a trace written
 * to a table nobody can query is not serving the operator it exists for.
 *
 * The lesson generalises. A verb only one side can run is a clause only one
 * side holds, and the skip that makes it tolerable is what stops anybody
 * noticing.
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
  /**
   * Open a signed socket and `mesh.connect`.
   *
   * `expectDelivered` counts the `mesh.message` notifications the hub pushes
   * after the connect succeeds. It exists because that push is a *guarantee* a
   * lane depends on and nothing could state: a participant that only listens —
   * never calling `mesh.receive` — sees whatever accumulated while it was away
   * only if the hub replays it, and until now both sides took that on trust.
   */
  | {
      do: "connect";
      identity: string;
      expectDelivered?: number;
      hold?: boolean;
      expect?: ExpectRpc;
      /**
       * Sign with a key this scenario makes, having registered nothing.
       *
       * **A key is the caller's, registration is the hub's, and the schema tied
       * them together.** `provision` was the only way to obtain a signing key,
       * and provisioning *is* registration, so no scenario could say "a
       * correctly signed stranger" — which is the exact state § 8.1 answers
       * `-32011 IDENTITY_NOT_REGISTERED` to. The code was reachable in the hub
       * and unreachable in the contract, which reads from the outside as a dead
       * error code and would have been retired on that reading.
       *
       * `agent-mesh-client` found the gap while writing conformance scenarios:
       * their attempt to reach it by failing a `provision` gave `-32014`
       * instead, because a rejected provision can still leave the row.
       *
       * The key is generated locally and never sent to `POST /api/v1/agents`.
       */
      ephemeralKey?: boolean;
      /**
       * The WebSocket close code the hub is expected to send afterwards.
       *
       * The refusals in § 8.1 do not only answer — they close, with `1008`
       * policy violation, about ten milliseconds later. That second half was
       * unsayable, so a hub that answered `-32011` and then held the socket open
       * forever satisfied every scenario. The error is the message; the close is
       * the enforcement, and a contract that states one without the other pins
       * the cheaper half.
       */
      expectClose?: number;
    }
  /**
   * Close a socket a `connect` was holding.
   *
   * **Explicit, because absence has to be sayable.** The case § 8.2a exists for
   * is a reply to mail with the *recipient* live and the *sender* not, and a
   * runner that tidies up implicitly at the end of a scenario can never produce
   * that state in the middle. Cleanup at the end is still right, but as hygiene
   * rather than as an assertion — a socket left open changes presence for the
   * next scenario, and on a shared mesh that moves every delivered/pending
   * verdict after it.
   */
  | { do: "disconnect"; identity: string }
  /**
   * How many `mesh.message` pushes arrived **since the last check**.
   *
   * A held socket receives at any time, so "how many" means nothing without
   * "since when". Clearing the counter fixes the window; a cumulative count
   * would make every expectation depend on the steps above it, so inserting one
   * step would falsify everything below — the reason step numbers are kept out
   * of the platform's mutation manifest.
   */
  | { do: "expectPushed"; identity: string; count: number }
  /** `mesh.send` over whichever transport the runner is exercising. */
  | { do: "send"; from: string; to: string; content: string; replyTo?: string; clientMessageId?: string; expect?: ExpectRpc }
  /** `mesh.receive` — leases a batch and settles the previous one. */
  | { do: "receive"; identity: string; ackPrevious?: boolean; expectCount?: number; bind?: Record<string, string> }
  /** A REST call, for the surfaces that are not JSON-RPC. */
  | { do: "http"; method: "GET" | "POST" | "DELETE"; path: string; as?: Caller; body?: unknown; expect?: ExpectHttp; bind?: Record<string, string> }
  /** Let wall-clock time pass. Only for the scenarios about expiry. */
  | { do: "sleep"; seconds: number };

/**
 * Who makes an `http` call.
 *
 * `"none"` is a real case rather than an omission — § 9.2 has unauthenticated
 * routes and a scenario about one has to be able to say so. `"admin"` is the
 * operator session.
 *
 * `{ signedBy }` is a **signed non-admin** caller: an ordinary participant with
 * an approved key, signing a REST envelope. Without it the whole authenticated
 * REST surface was unreachable from a scenario — `/api/v1/mailbox/out` recall,
 * `/api/v1/mailbox/in`, anything under § 8.10.1 that is not JSON-RPC — so those
 * clauses were held by neither side's list while looking covered.
 */
export type Caller = "admin" | "none" | { signedBy: string };

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
   * list drifts from the contract it was meant to hold.
   *
   * **`null` means absent or null**, which is how a scenario says a filter
   * returned nothing. Without it, "this query matches no rows" was unstatable,
   * and a filter that stopped filtering could only be caught by what happened to
   * come back first — order-dependent, and therefore passing or failing on which
   * other scenarios had run. `client-claude` hit exactly that (mail #223): their
   * equivalent check passed against a runner that had stopped filtering
   * entirely, because on a solo mesh the row it wanted was the only one there.
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
    id: "E2E-KEY-003",
    clause: "§ 10.2",
    // Proposed by client-claude, who run the lane this protects (mail #198).
    why: "A lane re-registers on every restart with the key it already holds. If that knocked an approved key back to pending, every restart would need an operator, and the mesh would stop while nobody was watching.",
    steps: [
      { do: "provision", identity: "e2e-restart", type: "ai-claude", key: true, expect: { status: 201 } },
      { do: "approve", identity: "e2e-restart" },
      { do: "connect", identity: "e2e-restart", expect: { error: null } },
      // Naming itself. A restart presents the key it already has, and that is
      // what `reuseKeyOf` means with no third party involved.
      //
      // **Both halves, because they fail separately.** A mutation that returned
      // `pending` here while leaving the row approved was invisible to the
      // `connect` below — the lane would work, and a lane that reads the
      // response and waits for an operator would hang forever on a key it
      // already holds. That is the same trap E2E-KEY-004 is about, arriving
      // from the other direction.
      { do: "provision", identity: "e2e-restart", type: "ai-claude", reuseKeyOf: "e2e-restart",
        expect: {
          status: 200,
          body: { "key.status": "approved", "key.fingerprint": "{{fingerprint:e2e-restart}}" },
        } },
      { do: "connect", identity: "e2e-restart", expect: { error: null } },
    ],
  },
  {
    id: "E2E-KEY-004",
    clause: "§ 10.1, § 10.2",
    // Also client-claude's (mail #198), and the assertion they could not write.
    why: "The `key` object in a provisioning response is not evidence that this caller's key was recorded — a public key held by another identity answers with that holder's state. What a lane must trust is the read-back, and an unapproved key cannot sign for itself, so this route answers unauthenticated.",
    steps: [
      { do: "provision", identity: "e2e-readback", type: "ai-claude", key: true, expect: { status: 201 } },
      // The point of the scenario. `status: 200` alone passes against a route
      // returning an empty list, which is the shape this exists to refuse.
      { do: "http", method: "GET", path: "/api/v1/agents/e2e-readback/keys", as: "none",
        expect: {
          status: 200,
          body: {
            "keys.0.fingerprint": "{{fingerprint:e2e-readback}}",
            "keys.0.status": "pending",
          },
        } },
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
    id: "E2E-CONNECT-001",
    clause: "§ 8.1, § 8.10",
    // Asked for by client-claude (mail #234), whose lane is push-only: it waits
    // for `mesh.message` and never calls `mesh.receive`. Which side has to
    // drain decides whether they change nothing or take on lease semantics in
    // production, and the answer was implied rather than stated.
    why: "What arrived while an identity was away is pushed when it connects. A lane that only listens has no other way to see it, and a mesh that quietly required a drain call would strand every such participant with a full mailbox and no symptom.",
    steps: [
      { do: "provision", identity: "e2e-await-from", type: "ai-claude", key: true },
      { do: "provision", identity: "e2e-await-to", type: "ai-claude", key: true },
      { do: "approve", identity: "e2e-await-from" },
      { do: "approve", identity: "e2e-await-to" },
      // Sent while the recipient holds no socket at all.
      { do: "send", from: "e2e-await-from", to: "e2e-await-to", content: "waiting for you",
        expect: { error: null } },
      // No `receive` anywhere in this scenario. That is the point.
      { do: "connect", identity: "e2e-await-to", expect: { error: null }, expectDelivered: 1 },
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
    id: "E2E-RECALL-001",
    clause: "§ 8.10.1",
    // The clause client-claude could not state (mail #198): it needs a signed
    // non-admin caller and a message id minted by the mesh, and the vocabulary
    // had neither.
    why: "Recall withdraws a message the recipient has not taken yet, and stops once they have. A recall that still succeeded after hand-over would let a sender delete from someone else's mailbox, and the recipient has already acted on it.",
    steps: [
      { do: "provision", identity: "e2e-recall-from", type: "ai-claude", key: true },
      { do: "provision", identity: "e2e-recall-to", type: "ai-claude", key: true },
      { do: "approve", identity: "e2e-recall-from" },
      { do: "approve", identity: "e2e-recall-to" },
      { do: "send", from: "e2e-recall-from", to: "e2e-recall-to", content: "recall me",
        expect: { error: null } },
      { do: "send", from: "e2e-recall-from", to: "e2e-recall-to", content: "too late",
        expect: { error: null } },
      // Before hand-over. The sender still owns it.
      { do: "receive", identity: "e2e-recall-to", expectCount: 2, bind: { taken: "messages.1.id" } },
      // After. The recipient holds it, so the sender no longer decides.
      { do: "http", method: "DELETE", path: "/api/v1/mailbox/out/{{taken}}",
        as: { signedBy: "e2e-recall-from" }, expect: { status: 409 } },
      // And someone else's message is not theirs to withdraw either — a 404,
      // not a 403, because the sender is not entitled to learn it exists.
      { do: "http", method: "DELETE", path: "/api/v1/mailbox/out/{{taken}}",
        as: { signedBy: "e2e-recall-to" }, expect: { status: 404 } },
    ],
  },
  {
    id: "E2E-REPLY-001",
    clause: "§ 8.2a",
    // The clause that was checked by one implementation alone, which § 17.3 is
    // explicit is not enough.
    //
    // **The arrangement is the whole scenario, and the first draft had it
    // backwards.** § 8.2a only bites when the reply's *recipient* is live and
    // its *sender* is not — that is the moment a hub is tempted to push, and
    // the moment pushing puts half a thread on a socket somebody was briefly
    // holding. With the recipient absent instead, mail and mesh agree and a
    // broken rule passes: the first version arranged exactly that, and the
    // mutation went straight through it.
    why: "A reply to mail must not be pushed because the recipient happens to be holding a socket. One end present is exactly the case the mailbox exists for, and half a thread on a socket somebody was briefly holding is what pushing produces.",
    steps: [
      { do: "provision", identity: "e2e-reply-a", type: "ai-claude", key: true },
      { do: "provision", identity: "e2e-reply-b", type: "ai-claude", key: true },
      { do: "approve", identity: "e2e-reply-a" },
      { do: "approve", identity: "e2e-reply-b" },

      // `a` sends by mail — the socketless route, so the row records `mailbox`.
      { do: "http", method: "POST", path: "/api/v1/mailbox/out", as: { signedBy: "e2e-reply-a" },
        body: { to: "e2e-reply-b", content: "by mail" }, expect: { status: 200 },
        bind: { mailId: "id" } },
      { do: "receive", identity: "e2e-reply-b", expectCount: 1 },

      // Now the reply's recipient comes online, and its sender does not. This
      // is the only arrangement in which the rule and its absence differ.
      { do: "connect", identity: "e2e-reply-a", hold: true, expect: { error: null } },

      { do: "send", from: "e2e-reply-b", to: "e2e-reply-a", content: "answered",
        replyTo: "{{mailId}}", expect: { error: null } },

      // Nothing pushed, though `a` is right there holding a socket.
      { do: "expectPushed", identity: "e2e-reply-a", count: 0 },
      // And waiting in the mailbox, which is where the conversation was.
      { do: "receive", identity: "e2e-reply-a", expectCount: 1 },

      { do: "disconnect", identity: "e2e-reply-a" },
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
      { do: "http", method: "GET", path: "/api/v1/admin/agent-sources?identity=e2e-src", as: "admin",
        expect: { status: 200, body: { "sources.0.identity": "e2e-src" } } },
    ],
  },
  {
    id: "E2E-AUDIT-001",
    clause: "§ 11.0, § 11.0.1",
    why: "The platform operator reads the trail and not the messages in it, and a content read leaves a trace. Without the trace, a tenant admin inside the tenant is the absence of a boundary rather than one.",
    steps: [
      { do: "http", method: "GET", path: "/api/v1/audit/events?limit=5", as: "admin", expect: { status: 200 } },
      // The read above had to leave this behind. Asserted through the operator's
      // own route rather than against a table: a trace that exists in the store
      // but cannot be queried is not serving the operator it was written for,
      // and only one of the two runners can open the store at all.
      { do: "http", method: "GET",
        path: "/api/v1/audit/events?event_type=mesh.identity.audit_read&limit=1", as: "admin",
        expect: { status: 200, body: { "events.0.event_type": "mesh.identity.audit_read" } } },
      // And the same filter asked something that cannot match. **This is the
      // order-independent half.** The step above catches an ignored filter only
      // while some other event happens to sort first; on a mesh where this
      // scenario runs alone, its own read is the oldest row and the assertion
      // passes against a route that filters nothing.
      { do: "http", method: "GET",
        path: "/api/v1/audit/events?event_type=mesh.identity.no_such_event&limit=1", as: "admin",
        expect: { status: 200, body: { "events.0": null } } },
    ],
  },
  {
    id: "E2E-TYPE-001",
    clause: "§ 8.9.5",
    why: "`agents.type` is read at display time, so changing it re-labels every past audit event for that identity. Without the event the trail says it always was what it now is.",
    steps: [
      { do: "provision", identity: "e2e-mover", type: "ai-antigravity", key: true },
      { do: "provision", identity: "e2e-mover", type: "ai-claude", key: false, expect: { status: 200 } },
      { do: "http", method: "GET",
        path: "/api/v1/audit/events?identity=e2e-mover&event_type=mesh.identity.type_changed&limit=1",
        as: "admin",
        expect: { status: 200, body: { "events.0.event_type": "mesh.identity.type_changed" } } },
    ],
  },
  {
    id: "E2E-AUTH-OWNED-001",
    clause: "§ 11.3, § 9.2",
    why: "An operator route that stops requiring a session answers everyone. The refusal is the only part a caller without credentials can observe, so it is the only part a scenario on this side can hold — and a route that lost its gate looks identical to one that never had it until somebody without a session asks.",
    steps: [
      { do: "http", method: "GET", path: "/api/v1/admin/agents/owned", as: "none",
        expect: { status: 401, body: { "error": "Unauthorized" } } },
    ],
  },
  {
    id: "E2E-AUTH-OWNED-002",
    clause: "§ 11.3",
    why: "The other half of the pair. Without it the refusal above is satisfied by a route that refuses everyone, including the operator holding `key.approve` — which is a broken route reported as a working guard.",
    steps: [
      { do: "http", method: "GET", path: "/api/v1/admin/agents/owned", as: "admin",
        expect: { status: 200 } },
    ],
  },
  {
    id: "E2E-AUTH-GROUPS-001",
    clause: "§ 12, § 9.2",
    why: "An operator route that stops requiring a session answers everyone. The refusal is the only part a caller without credentials can observe, so it is the only part a scenario on this side can hold — and a route that lost its gate looks identical to one that never had it until somebody without a session asks.",
    steps: [
      { do: "http", method: "GET", path: "/api/v1/admin/groups", as: "none",
        expect: { status: 401, body: { "error": "Unauthorized" } } },
    ],
  },
  {
    id: "E2E-AUTH-GROUPS-002",
    clause: "§ 12",
    why: "The other half of the pair. Without it the refusal above is satisfied by a route that refuses everyone, including the operator holding `group.manage` — which is a broken route reported as a working guard.",
    steps: [
      { do: "http", method: "GET", path: "/api/v1/admin/groups", as: "admin",
        expect: { status: 200 } },
    ],
  },
  {
    id: "E2E-AUTH-PENDING-001",
    clause: "§ 10.2, § 9.2",
    why: "An operator route that stops requiring a session answers everyone. The refusal is the only part a caller without credentials can observe, so it is the only part a scenario on this side can hold — and a route that lost its gate looks identical to one that never had it until somebody without a session asks.",
    steps: [
      { do: "http", method: "GET", path: "/api/v1/admin/keys/pending", as: "none",
        expect: { status: 401, body: { "error": "Unauthorized" } } },
    ],
  },
  {
    id: "E2E-AUTH-PENDING-002",
    clause: "§ 10.2",
    why: "The other half of the pair. Without it the refusal above is satisfied by a route that refuses everyone, including the operator holding `key.approve` — which is a broken route reported as a working guard.",
    steps: [
      { do: "http", method: "GET", path: "/api/v1/admin/keys/pending", as: "admin",
        expect: { status: 200 } },
    ],
  },
  {
    id: "E2E-AUTH-TELEM-001",
    clause: "§ 11.0, § 9.2",
    why: "An operator route that stops requiring a session answers everyone. The refusal is the only part a caller without credentials can observe, so it is the only part a scenario on this side can hold — and a route that lost its gate looks identical to one that never had it until somebody without a session asks.",
    steps: [
      { do: "http", method: "GET", path: "/api/v1/admin/telemetry", as: "none",
        expect: { status: 401, body: { "error": "Unauthorized" } } },
    ],
  },
  {
    id: "E2E-AUTH-TELEM-002",
    clause: "§ 11.0",
    why: "The other half of the pair. Without it the refusal above is satisfied by a route that refuses everyone, including the operator holding `audit.read.metadata` — which is a broken route reported as a working guard.",
    steps: [
      { do: "http", method: "GET", path: "/api/v1/admin/telemetry", as: "admin",
        expect: { status: 200 } },
    ],
  },
  {
    id: "E2E-AUTH-TENANTS-001",
    clause: "§ 11.3, § 9.2",
    why: "An operator route that stops requiring a session answers everyone. The refusal is the only part a caller without credentials can observe, so it is the only part a scenario on this side can hold — and a route that lost its gate looks identical to one that never had it until somebody without a session asks.",
    steps: [
      { do: "http", method: "GET", path: "/api/v1/admin/tenants", as: "none",
        expect: { status: 401, body: { "error": "Unauthorized" } } },
    ],
  },
  {
    id: "E2E-AUTH-TENANTS-002",
    clause: "§ 11.3",
    why: "The other half of the pair. Without it the refusal above is satisfied by a route that refuses everyone, including the operator holding `tenant.read.stats` — which is a broken route reported as a working guard.",
    steps: [
      { do: "http", method: "GET", path: "/api/v1/admin/tenants", as: "admin",
        expect: { status: 200 } },
    ],
  },
  {
    id: "E2E-AUTH-GRANTS-001",
    clause: "§ 7, § 9.2",
    why: "An operator route that stops requiring a session answers everyone. The refusal is the only part a caller without credentials can observe, so it is the only part a scenario on this side can hold — and a route that lost its gate looks identical to one that never had it until somebody without a session asks.",
    steps: [
      { do: "http", method: "GET", path: "/api/v1/admin/grants", as: "none",
        expect: { status: 401, body: { "error": "Unauthorized" } } },
    ],
  },
  {
    id: "E2E-AUTH-GRANTS-002",
    clause: "§ 7",
    why: "The other half of the pair. Without it the refusal above is satisfied by a route that refuses everyone, including the operator holding `role.grant` — which is a broken route reported as a working guard.",
    steps: [
      { do: "http", method: "GET", path: "/api/v1/admin/grants", as: "admin",
        expect: { status: 200 } },
    ],
  },
  {
    id: "E2E-AUTH-SOURCES-001",
    clause: "§ 8.11, § 9.2",
    why: "An operator route that stops requiring a session answers everyone. The refusal is the only part a caller without credentials can observe, so it is the only part a scenario on this side can hold — and a route that lost its gate looks identical to one that never had it until somebody without a session asks.",
    steps: [
      { do: "http", method: "GET", path: "/api/v1/admin/agent-sources", as: "none",
        expect: { status: 401, body: { "error": "Unauthorized" } } },
    ],
  },
  {
    id: "E2E-AUTH-SOURCES-002",
    clause: "§ 8.11",
    why: "The other half of the pair. Without it the refusal above is satisfied by a route that refuses everyone, including the operator holding `source.read` — which is a broken route reported as a working guard.",
    steps: [
      { do: "http", method: "GET", path: "/api/v1/admin/agent-sources", as: "admin",
        expect: { status: 200 } },
    ],
  },
  {
    id: "E2E-AUTH-DEPTH-001",
    clause: "§ 8.10.1, § 9.2",
    why: "An operator route that stops requiring a session answers everyone. The refusal is the only part a caller without credentials can observe, so it is the only part a scenario on this side can hold — and a route that lost its gate looks identical to one that never had it until somebody without a session asks.",
    steps: [
      { do: "http", method: "GET", path: "/api/v1/admin/mailbox", as: "none",
        expect: { status: 401, body: { "error": "Unauthorized" } } },
    ],
  },
  {
    id: "E2E-AUTH-DEPTH-002",
    clause: "§ 8.10.1",
    why: "The other half of the pair. Without it the refusal above is satisfied by a route that refuses everyone, including the operator holding `mailbox.read.depth` — which is a broken route reported as a working guard.",
    steps: [
      { do: "http", method: "GET", path: "/api/v1/admin/mailbox", as: "admin",
        expect: { status: 200 } },
    ],
  },
  {
    id: "E2E-AUTH-TYPES-001",
    clause: "§ 8.9.5, § 9.2",
    why: "An operator route that stops requiring a session answers everyone. The refusal is the only part a caller without credentials can observe, so it is the only part a scenario on this side can hold — and a route that lost its gate looks identical to one that never had it until somebody without a session asks.",
    steps: [
      { do: "http", method: "GET", path: "/api/v1/admin/agent-types", as: "none",
        expect: { status: 401, body: { "error": "Unauthorized" } } },
    ],
  },
  {
    id: "E2E-AUTH-TYPES-002",
    clause: "§ 8.9.5",
    why: "The other half of the pair. Without it the refusal above is satisfied by a route that refuses everyone, including the operator holding `agent.provision` — which is a broken route reported as a working guard.",
    steps: [
      { do: "http", method: "GET", path: "/api/v1/admin/agent-types", as: "admin",
        expect: { status: 200 } },
    ],
  },
  {
    id: "E2E-AUTH-USERS-001",
    clause: "§ 7, § 9.2",
    why: "An operator route that stops requiring a session answers everyone. The refusal is the only part a caller without credentials can observe, so it is the only part a scenario on this side can hold — and a route that lost its gate looks identical to one that never had it until somebody without a session asks.",
    steps: [
      { do: "http", method: "GET", path: "/api/v1/admin/users", as: "none",
        expect: { status: 401, body: { "error": "Unauthorized" } } },
    ],
  },
  {
    id: "E2E-AUTH-USERS-002",
    clause: "§ 7",
    why: "The other half of the pair. Without it the refusal above is satisfied by a route that refuses everyone, including the operator holding `user.admit` — which is a broken route reported as a working guard.",
    steps: [
      { do: "http", method: "GET", path: "/api/v1/admin/users", as: "admin",
        expect: { status: 200 } },
    ],
  },
  {
    id: "E2E-AUTH-OWNERS-001",
    clause: "§ 8.11, § 9.2",
    why: "An operator route that stops requiring a session answers everyone. The holder-passes half for `agent.provision` is held by its sibling scenario on the same capability; this one holds the refusal, which is the only half a caller without credentials can observe.",
    steps: [
      { do: "http", method: "GET", path: "/api/v1/admin/agents/e2e-src/owners", as: "none",
        expect: { status: 401, body: { "error": "Unauthorized" } } },
    ],
  },
  {
    id: "E2E-AUTH-KEYONE-001",
    clause: "§ 10.2, § 9.2",
    why: "An operator route that stops requiring a session answers everyone. Key approval in particular: a route that approves keys without a session lets anyone admit an agent to the mesh. The holder-passes half for `key.approve` is held by its sibling scenario on the same capability; this one holds the refusal, which is the only half a caller without credentials can observe.",
    steps: [
      { do: "http", method: "GET", path: "/api/v1/admin/keys/e2e-src", as: "none",
        expect: { status: 401, body: { "error": "Unauthorized" } } },
    ],
  },
  {
    id: "E2E-AUTH-DEPTHONE-001",
    clause: "§ 8.10.1, § 9.2",
    why: "An operator route that stops requiring a session answers everyone. The holder-passes half for `mailbox.read.depth` is held by its sibling scenario on the same capability; this one holds the refusal, which is the only half a caller without credentials can observe.",
    steps: [
      { do: "http", method: "GET", path: "/api/v1/admin/mailbox/e2e-src", as: "none",
        expect: { status: 401, body: { "error": "Unauthorized" } } },
    ],
  },
  {
    id: "E2E-AUTH-CHATAUD-001",
    clause: "§ 11.0, § 9.2",
    why: "An operator route that stops requiring a session answers everyone. The holder-passes half for `audit.read.content` is held by its sibling scenario on the same capability; this one holds the refusal, which is the only half a caller without credentials can observe.",
    steps: [
      { do: "http", method: "GET", path: "/api/v1/admin/chat-audits", as: "none",
        expect: { status: 401, body: { "error": "Unauthorized" } } },
    ],
  },
  {
    id: "E2E-AUTH-AIUSAGE-001",
    clause: "§ 11.0, § 9.2",
    why: "An operator route that stops requiring a session answers everyone. The holder-passes half for `audit.read.metadata` is held by its sibling scenario on the same capability; this one holds the refusal, which is the only half a caller without credentials can observe.",
    steps: [
      { do: "http", method: "GET", path: "/api/v1/admin/ai-usage", as: "none",
        expect: { status: 401, body: { "error": "Unauthorized" } } },
    ],
  },
  {
    id: "E2E-AUTH-PENDLIST-001",
    clause: "§ 10.2, § 9.2",
    why: "An operator route that stops requiring a session answers everyone. Key approval in particular: a route that approves keys without a session lets anyone admit an agent to the mesh. The holder-passes half for `key.approve` is held by its sibling scenario on the same capability; this one holds the refusal, which is the only half a caller without credentials can observe.",
    steps: [
      { do: "http", method: "GET", path: "/api/v1/admin/pending", as: "none",
        expect: { status: 401, body: { "error": "Unauthorized" } } },
    ],
  },
  {
    id: "E2E-AUTH-GRPNEW-001",
    clause: "§ 12, § 9.2",
    why: "An operator route that stops requiring a session answers everyone. The holder-passes half for `group.manage` is held by its sibling scenario on the same capability; this one holds the refusal, which is the only half a caller without credentials can observe.",
    steps: [
      { do: "http", method: "POST", path: "/api/v1/admin/groups", as: "none", body: {},
        expect: { status: 401, body: { "error": "Unauthorized" } } },
    ],
  },
  {
    id: "E2E-AUTH-GRPMEM-001",
    clause: "§ 12, § 9.2",
    why: "An operator route that stops requiring a session answers everyone. The holder-passes half for `group.manage` is held by its sibling scenario on the same capability; this one holds the refusal, which is the only half a caller without credentials can observe.",
    steps: [
      { do: "http", method: "POST", path: "/api/v1/admin/groups/e2e-walled/members", as: "none", body: {},
        expect: { status: 401, body: { "error": "Unauthorized" } } },
    ],
  },
  {
    id: "E2E-AUTH-GRPEGR-001",
    clause: "§ 12, § 9.2",
    why: "An operator route that stops requiring a session answers everyone. The holder-passes half for `group.manage` is held by its sibling scenario on the same capability; this one holds the refusal, which is the only half a caller without credentials can observe.",
    steps: [
      { do: "http", method: "POST", path: "/api/v1/admin/groups/e2e-walled/egress", as: "none", body: {},
        expect: { status: 401, body: { "error": "Unauthorized" } } },
    ],
  },
  {
    id: "E2E-AUTH-GRANTNEW-001",
    clause: "§ 7, § 9.2",
    why: "An operator route that stops requiring a session answers everyone. The holder-passes half for `role.grant` is held by its sibling scenario on the same capability; this one holds the refusal, which is the only half a caller without credentials can observe.",
    steps: [
      { do: "http", method: "POST", path: "/api/v1/admin/grants", as: "none", body: {},
        expect: { status: 401, body: { "error": "Unauthorized" } } },
    ],
  },
  {
    id: "E2E-AUTH-USERNEW-001",
    clause: "§ 7, § 9.2",
    why: "An operator route that stops requiring a session answers everyone. The holder-passes half for `user.admit` is held by its sibling scenario on the same capability; this one holds the refusal, which is the only half a caller without credentials can observe.",
    steps: [
      { do: "http", method: "POST", path: "/api/v1/admin/users", as: "none", body: {},
        expect: { status: 401, body: { "error": "Unauthorized" } } },
    ],
  },
  {
    id: "E2E-AUTH-TYPENEW-001",
    clause: "§ 8.9.5, § 9.2",
    why: "An operator route that stops requiring a session answers everyone. The holder-passes half for `agent.provision` is held by its sibling scenario on the same capability; this one holds the refusal, which is the only half a caller without credentials can observe.",
    steps: [
      { do: "http", method: "POST", path: "/api/v1/admin/agent-types", as: "none", body: {},
        expect: { status: 401, body: { "error": "Unauthorized" } } },
    ],
  },
  {
    id: "E2E-AUTH-PROXY-001",
    clause: "§ 8.2, § 9.2",
    why: "An operator route that stops requiring a session answers everyone. The holder-passes half for `agent.provision` is held by its sibling scenario on the same capability; this one holds the refusal, which is the only half a caller without credentials can observe.",
    steps: [
      { do: "http", method: "POST", path: "/api/v1/admin/agents/e2e-src/can-proxy", as: "none", body: {},
        expect: { status: 401, body: { "error": "Unauthorized" } } },
    ],
  },
  {
    id: "E2E-AUTH-APPROVE-001",
    clause: "§ 10.2, § 9.2",
    why: "An operator route that stops requiring a session answers everyone. Key approval in particular: a route that approves keys without a session lets anyone admit an agent to the mesh. The holder-passes half for `key.approve` is held by its sibling scenario on the same capability; this one holds the refusal, which is the only half a caller without credentials can observe.",
    steps: [
      { do: "http", method: "POST", path: "/api/v1/admin/approve", as: "none", body: {},
        expect: { status: 401, body: { "error": "Unauthorized" } } },
    ],
  },
  {
    id: "E2E-AUTH-DENY-001",
    clause: "§ 10.2, § 9.2",
    why: "An operator route that stops requiring a session answers everyone. Key approval in particular: a route that approves keys without a session lets anyone admit an agent to the mesh. The holder-passes half for `key.approve` is held by its sibling scenario on the same capability; this one holds the refusal, which is the only half a caller without credentials can observe.",
    steps: [
      { do: "http", method: "POST", path: "/api/v1/admin/deny", as: "none", body: {},
        expect: { status: 401, body: { "error": "Unauthorized" } } },
    ],
  },
  {
    id: "E2E-AUTH-GRANTDEL-001",
    clause: "§ 7, § 9.2",
    why: "An operator route that stops requiring a session answers everyone. The holder-passes half for `role.grant` is held by its sibling scenario on the same capability; this one holds the refusal, which is the only half a caller without credentials can observe.",
    steps: [
      { do: "http", method: "DELETE", path: "/api/v1/admin/grants", as: "none",
        expect: { status: 401, body: { "error": "Unauthorized" } } },
    ],
  },
  {
    id: "E2E-AUTH-EGRDEL-001",
    clause: "§ 12, § 9.2",
    why: "An operator route that stops requiring a session answers everyone. The holder-passes half for `group.manage` is held by its sibling scenario on the same capability; this one holds the refusal, which is the only half a caller without credentials can observe.",
    steps: [
      { do: "http", method: "DELETE", path: "/api/v1/admin/groups/e2e-walled/egress/x", as: "none",
        expect: { status: 401, body: { "error": "Unauthorized" } } },
    ],
  },
  {
    id: "E2E-AUTH-TYPEDEL-001",
    clause: "§ 8.9.5, § 9.2",
    why: "An operator route that stops requiring a session answers everyone. The holder-passes half for `agent.provision` is held by its sibling scenario on the same capability; this one holds the refusal, which is the only half a caller without credentials can observe.",
    steps: [
      { do: "http", method: "DELETE", path: "/api/v1/admin/agent-types/ai-claude", as: "none",
        expect: { status: 401, body: { "error": "Unauthorized" } } },
    ],
  },
  {
    id: "E2E-LIMITS-001",
    clause: "§ 9.2",
    why: "An unauthenticated route is a decision, not an oversight, and the only way to keep it one is to say so. A deployment that put a session in front of this would break every client sizing its retry loop before it has a key — which is the moment it needs the numbers.",
    steps: [
      { do: "http", method: "GET", path: "/api/v1/limits", as: "none",
        expect: { status: 200, body: { "ok": true } } },
    ],
  },
  {
    id: "E2E-UNSIGNED-001",
    clause: "§ 8.1, § 9.2",
    why: "The authenticated REST surface has to refuse an unsigned caller, and the refusal has to be observable from outside. A hub that stopped verifying signatures on this route would pass every other scenario in this file, because every other scenario signs correctly.",
    steps: [
      { do: "http", method: "POST", path: "/api/v1/mailbox/out", as: "none",
        body: { to: "e2e-badparam", content: "no signature" },
        expect: { status: 401 } },
    ],
  },
  {
    id: "E2E-BADPARAM-001",
    clause: "§ 8.2",
    why: "A send with no recipient is malformed rather than refused, and the two carry different retry advice: a client that reads `400` as `403` asks an operator for a grant it already has. The mapping from JSON-RPC code to status is contract, not implementation detail.",
    steps: [
      { do: "provision", identity: "e2e-badparam", type: "ai-claude", key: true },
      { do: "approve", identity: "e2e-badparam" },
      { do: "http", method: "POST", path: "/api/v1/mailbox/out", as: { signedBy: "e2e-badparam" },
        body: { content: "no recipient" },
        expect: { status: 400 } },
    ],
  },
  {
    id: "E2E-HISTORY-001",
    clause: "§ 8.10.1",
    why: "History is the surface an operator reads after the fact, and an unsigned reader must not have it: the bodies are there. A route that answered anyone would leak every message in the mesh while every delivery scenario stayed green.",
    steps: [
      { do: "http", method: "GET", path: "/api/v1/mailbox/history", as: "none",
        expect: { status: 401 } },
    ],
  },
  {
    id: "E2E-METHOD-001",
    clause: "§ 9.2",
    why: "A route that answers the wrong method answers it with whatever the handler below does — a POST to a read route is a write nobody wrote. `405` is the only answer that leaves the caller able to fix the call.",
    steps: [
      { do: "http", method: "POST", path: "/api/v1/capabilities", as: "none", body: {},
        expect: { status: 405 } },
    ],
  },
  {
    id: "E2E-CAP-002",
    clause: "§ 7, § 11.0",
    why: "The audit limits a client sizes its batches on come from the same route as the mailbox window, and were left at the constant once while the value beside them was not. A client that batches on a limit the hub stopped honouring has every append refused at a size the route told it was fine.",
    steps: [
      { do: "http", method: "GET", path: "/api/v1/capabilities", as: "none",
        expect: { status: 200, body: { "audit.schema_version_max": 1 } } },
    ],
  },
  {
    id: "E2E-CAP-003",
    clause: "§ 8.10.1",
    why: "Dormancy is what turns a quiet participant into an absent one, and a client that reads a stale value keeps a socket it believes is live. It sits beside `receive_lease_seconds`, which was the one that drifted.",
    steps: [
      { do: "http", method: "GET", path: "/api/v1/capabilities", as: "none",
        expect: { status: 200, body: { "mailbox.dormancy_seconds": 10800 } } },
    ],
  },
  {
    id: "E2E-REVOKED-001",
    clause: "§ 10.2, § 8.1",
    why: "A revoked key must stop working immediately, not at the next restart. The refusal has to name the revocation rather than a generic failure, because a client told only `failed` retries and a client told `revoked` stops and asks a person.",
    steps: [
      { do: "provision", identity: "e2e-revoked-c", type: "ai-claude", key: true },
      { do: "approve", identity: "e2e-revoked-c" },
      { do: "connect", identity: "e2e-revoked-c", expect: { error: null } },
      { do: "revoke", identity: "e2e-revoked-c", reason: "e2e revocation" },
      { do: "connect", identity: "e2e-revoked-c", expect: { error: -32014, dataCode: "KEY_NOT_APPROVED" } },
    ],
  },
  {
    id: "E2E-NOKEY-001",
    clause: "§ 10.1, § 8.1",
    why: "An identity registered without a key is a name with nobody behind it. Connecting as one must be refused on the key rather than on the name, or an operator reading the refusal goes looking for a registration that is already there.",
    steps: [
      { do: "provision", identity: "e2e-keyless", type: "ai-claude", key: false },
      { do: "connect", identity: "e2e-keyless", expect: { error: -32014, dataCode: "KEY_NOT_APPROVED" } },
    ],
  },
  {
    id: "E2E-LIMIT-BATCH",
    clause: "§ 8.10.1, § 7",
    why: "A client that batches above what the hub honours has every oversized receive refused at a number the route told it was fine. The value is declared in the contract and reported by the route; a deployment that reports something else is telling clients to size on a number it will not honour.",
    steps: [
      { do: "http", method: "GET", path: "/api/v1/capabilities", as: "none",
        expect: { status: 200, body: { "mailbox.max_receive_batch": 200 } } },
    ],
  },
  {
    id: "E2E-LIMIT-DEDUP",
    clause: "§ 8.2, § 7",
    why: "The window a `client_message_id` is remembered for is what makes a retry safe. A sender that believes it is longer than it is turns a retry into a second message. The value is declared in the contract and reported by the route; a deployment that reports something else is telling clients to size on a number it will not honour.",
    steps: [
      { do: "http", method: "GET", path: "/api/v1/capabilities", as: "none",
        expect: { status: 200, body: { "mailbox.send_dedup_window_seconds": 86400 } } },
    ],
  },
  {
    id: "E2E-LIMIT-BLOB",
    clause: "§ 11.0, § 7",
    why: "An uploader sizing a part on a stale limit fails at the end of a long upload rather than before it starts. The value is declared in the contract and reported by the route; a deployment that reports something else is telling clients to size on a number it will not honour.",
    steps: [
      { do: "http", method: "GET", path: "/api/v1/capabilities", as: "none",
        expect: { status: 200, body: { "audit.max_blob_bytes": 104857600 } } },
    ],
  },
  {
    id: "E2E-LIMIT-ATTACH",
    clause: "§ 11.0, § 7",
    why: "An event assembled above the limit is refused after the blobs are already uploaded, which is the expensive order to find out in. The value is declared in the contract and reported by the route; a deployment that reports something else is telling clients to size on a number it will not honour.",
    steps: [
      { do: "http", method: "GET", path: "/api/v1/capabilities", as: "none",
        expect: { status: 200, body: { "audit.max_attachments_per_event": 32 } } },
    ],
  },
  {
    id: "E2E-LIMIT-ATTBYTE",
    clause: "§ 11.0, § 7",
    why: "Per-event total, distinct from per-blob: a caller under the blob limit on every part can still be over this one, and only this number says where. The value is declared in the contract and reported by the route; a deployment that reports something else is telling clients to size on a number it will not honour.",
    steps: [
      { do: "http", method: "GET", path: "/api/v1/capabilities", as: "none",
        expect: { status: 200, body: { "audit.max_attachments_bytes_per_event": 268435456 } } },
    ],
  },
  {
    id: "E2E-LIMIT-INFLIGHT",
    clause: "§ 11.0, § 7",
    why: "Concurrency the hub will accept. A client that opens more sees refusals it reads as failures rather than as backpressure. The value is declared in the contract and reported by the route; a deployment that reports something else is telling clients to size on a number it will not honour.",
    steps: [
      { do: "http", method: "GET", path: "/api/v1/capabilities", as: "none",
        expect: { status: 200, body: { "audit.max_inflight_appends": 4 } } },
    ],
  },
  {
    id: "E2E-LIMIT-UPTIME",
    clause: "§ 11.0, § 7",
    why: "How long a grant stays usable. A client that assumes longer uploads into a window that closed and cannot tell that from a network fault. The value is declared in the contract and reported by the route; a deployment that reports something else is telling clients to size on a number it will not honour.",
    steps: [
      { do: "http", method: "GET", path: "/api/v1/capabilities", as: "none",
        expect: { status: 200, body: { "audit.upload_timeout_seconds": 180 } } },
    ],
  },
  {
    id: "E2E-AUTH-CHATAUD-002",
    clause: "§ 11.0",
    why: "The holder-passes half for `audit.read.content`. Without it the refusal beside it is satisfied by a route that refuses the operator too, which is a broken route reported as a working guard.",
    steps: [
      { do: "http", method: "GET", path: "/api/v1/admin/chat-audits", as: "admin",
        expect: { status: 200 } },
    ],
  },
  {
    id: "E2E-AUTH-AIUSAGE-002",
    clause: "§ 11.0",
    why: "The holder-passes half for `audit.read.metadata`. Without it the refusal beside it is satisfied by a route that refuses the operator too, which is a broken route reported as a working guard.",
    steps: [
      { do: "http", method: "GET", path: "/api/v1/admin/ai-usage", as: "admin",
        expect: { status: 200 } },
    ],
  },
  {
    id: "E2E-AUTH-PENDLIST-002",
    clause: "§ 11.0",
    why: "The holder-passes half for `key.approve`. Without it the refusal beside it is satisfied by a route that refuses the operator too, which is a broken route reported as a working guard.",
    steps: [
      { do: "http", method: "GET", path: "/api/v1/admin/pending", as: "admin",
        expect: { status: 200 } },
    ],
  },
  {
    id: "E2E-AUDIT-002",
    clause: "§ 11.0",
    why: "A filter that stopped filtering can only be caught by a query that must match nothing. Asserting a row came back proves the route answers; asserting none did proves it answered the question that was asked.",
    steps: [
      { do: "http", method: "GET", path: "/api/v1/audit/events?identity=e2e-no-such-identity-at-all&limit=5", as: "admin",
        expect: { status: 200, body: { "events.0": null } } },
    ],
  },
  {
    id: "E2E-AUDIT-003",
    clause: "§ 11.0",
    why: "An event id that does not exist has to be a miss rather than an error: an operator paging through a trace hits ids that have aged out, and a `500` there reads as the audit surface being down.",
    steps: [
      { do: "http", method: "GET", path: "/api/v1/audit/events/evt_00000000000000000000000000000000", as: "admin",
        expect: { status: 404 } },
    ],
  },
  {
    id: "E2E-AUDIT-004",
    clause: "§ 11.0, § 9.2",
    why: "The audit trace carries who said what. A route that answered it without a session would publish every message in the mesh, and every delivery scenario would stay green while it did.",
    steps: [
      { do: "http", method: "GET", path: "/api/v1/audit/events?limit=1", as: "none",
        expect: { status: 401 } },
    ],
  },
  {
    id: "E2E-INBOX-001",
    clause: "§ 8.10.1, § 9.2",
    why: "Receiving leases a batch and hands over bodies. An unsigned caller that could do it would read another participant's mail, and the send side would look perfectly correct while it happened.",
    steps: [
      { do: "http", method: "POST", path: "/api/v1/mailbox/in", as: "none", body: {},
        expect: { status: 401 } },
    ],
  },
  {
    id: "E2E-RECALLAUTH-001",
    clause: "§ 8.10.1, § 9.2",
    why: "Recall deletes. Unsigned, it is a delete anyone can issue against any message id they can guess, and the sender it was taken from has no record that it happened.",
    steps: [
      { do: "http", method: "DELETE", path: "/api/v1/mailbox/out/msg_0000000000000000", as: "none",
        expect: { status: 401 } },
    ],
  },
  {
    id: "E2E-DEDUP-001",
    clause: "§ 8.2",
    why: "A sender that retries with the same `client_message_id` must not produce a second message. Without this the retry advice in every refusal is unsafe to follow, because following it duplicates.",
    steps: [
      { do: "provision", identity: "e2e-dedup-a", type: "ai-claude", key: true },
      { do: "approve", identity: "e2e-dedup-a" },
      { do: "provision", identity: "e2e-dedup-b", type: "ai-claude", key: true },
      { do: "approve", identity: "e2e-dedup-b" },
      { do: "send", from: "e2e-dedup-a", to: "e2e-dedup-b", content: "once", clientMessageId: "e2e-dedup-key", expect: { error: null } },
      { do: "send", from: "e2e-dedup-a", to: "e2e-dedup-b", content: "once", clientMessageId: "e2e-dedup-key", expect: { error: null } },
      { do: "receive", identity: "e2e-dedup-b", expectCount: 1 },
    ],
  },
  {
    id: "E2E-SELF-001",
    clause: "§ 8.2",
    why: "Addressing yourself is not a special case anybody wrote down, and both answers are defensible — what is not defensible is the two implementations differing, because a lane that talks to itself is how several runtimes poll for work.",
    steps: [
      { do: "provision", identity: "e2e-self", type: "ai-claude", key: true },
      { do: "approve", identity: "e2e-self" },
      { do: "send", from: "e2e-self", to: "e2e-self", content: "to me", expect: { error: null } },
      { do: "receive", identity: "e2e-self", expectCount: 1 },
    ],
  },
  {
    id: "E2E-PENDING-001",
    clause: "§ 8.2a",
    why: "Mail addressed to a participant with no live socket has to wait rather than fail. A hub that refused it would make every restart lose whatever was in flight, and the sender would read the refusal as the recipient being unknown.",
    steps: [
      { do: "provision", identity: "e2e-away-src", type: "ai-claude", key: true },
      { do: "approve", identity: "e2e-away-src" },
      { do: "provision", identity: "e2e-away", type: "ai-claude", key: true },
      { do: "approve", identity: "e2e-away" },
      { do: "send", from: "e2e-away-src", to: "e2e-away", content: "while you were out", expect: { error: null } },
      { do: "connect", identity: "e2e-away", expectDelivered: 1 },
    ],
  },
  {
    id: "E2E-AUTH-KEYSTREAM-001",
    clause: "§ 9.2",
    why: "A stream is a session held open; one that opens without a session keeps publishing after the operator who should have been refused walks away. The holder-passes half for `key.approve` is held by its sibling.",
    steps: [
      { do: "http", method: "GET", path: "/api/v1/admin/keys/stream", as: "none",
        expect: { status: 401, body: { "error": "Unauthorized" } } },
    ],
  },
  {
    id: "E2E-AUTH-BEHAVIOUR-001",
    clause: "§ 9.2",
    why: "An operator route that stops requiring a session answers everyone. The holder-passes half for `audit.read.metadata` is held by its sibling scenario.",
    steps: [
      { do: "http", method: "GET", path: "/api/v1/admin/telemetry/behaviour", as: "none",
        expect: { status: 401, body: { "error": "Unauthorized" } } },
    ],
  },
  {
    id: "E2E-AUTH-AUDAGENTS-001",
    clause: "§ 9.2",
    why: "An operator route that stops requiring a session answers everyone. The holder-passes half for `audit.read.content` is held by its sibling scenario.",
    steps: [
      { do: "http", method: "GET", path: "/api/v1/admin/chat-audits/agents", as: "none",
        expect: { status: 401, body: { "error": "Unauthorized" } } },
    ],
  },
  {
    id: "E2E-AUTH-AUDSTREAM-001",
    clause: "§ 9.2",
    why: "A stream is a session held open; one that opens without a session keeps publishing after the operator who should have been refused walks away. The holder-passes half for `audit.read.content` is held by its sibling.",
    steps: [
      { do: "http", method: "GET", path: "/api/v1/admin/chat-audits/stream", as: "none",
        expect: { status: 401, body: { "error": "Unauthorized" } } },
    ],
  },
  {
    id: "E2E-AUTH-USAGESTRM-001",
    clause: "§ 9.2",
    why: "An operator route that stops requiring a session answers everyone. The holder-passes half for `audit.read.metadata` is held by its sibling scenario.",
    steps: [
      { do: "http", method: "GET", path: "/api/v1/admin/ai-usage/stream", as: "none",
        expect: { status: 401, body: { "error": "Unauthorized" } } },
    ],
  },
  {
    id: "E2E-AUTH-PAIRCODE-001",
    clause: "§ 9.2",
    why: "An operator route that stops requiring a session answers everyone. The holder-passes half for `user.admit` is held by its sibling scenario.",
    steps: [
      { do: "http", method: "POST", path: "/api/v1/admin/pairing-codes", as: "none", body: {},
        expect: { status: 401, body: { "error": "Unauthorized" } } },
    ],
  },
  {
    id: "E2E-HEALTH-001",
    clause: "§ 9.2",
    why: "Health has to answer without credentials or nothing can watch the mesh from outside it. Putting a session in front of this is the change that makes an outage invisible to the thing meant to notice outages.",
    steps: [
      { do: "http", method: "GET", path: "/api/v1/health", as: "none",
        expect: { status: 200 } },
    ],
  },
  {
    id: "E2E-DENY-001",
    clause: "§ 10.2, § 8.1",
    why: "A denied key and a pending one are both `not approved`, and an agent told the wrong one either waits forever for a decision already made or asks again for one still open. The distinction is carried in `data`, which is why the refusal has to name it.",
    steps: [
      { do: "provision", identity: "e2e-denied", type: "ai-claude", key: true },
      { do: "revoke", identity: "e2e-denied", reason: "e2e denial" },
      { do: "connect", identity: "e2e-denied", expect: { error: -32014, dataCode: "KEY_NOT_APPROVED" } },
    ],
  },
  {
    id: "E2E-RECALLOWN-001",
    clause: "§ 8.10.1",
    why: "Recall is the sender's, not anyone's. A participant that could delete another's message would be able to erase what it was told, and the audit trace would be the only place the message ever existed.",
    steps: [
      { do: "provision", identity: "e2e-recall-other", type: "ai-claude", key: true },
      { do: "approve", identity: "e2e-recall-other" },
      { do: "http", method: "DELETE", path: "/api/v1/mailbox/out/msg_not_a_real_id", as: { signedBy: "e2e-recall-other" },
        expect: { status: 404 } },
    ],
  },
  {
    id: "E2E-PUSH-001",
    clause: "§ 8.2a",
    why: "A live socket must receive without asking, and the count has to be since the last check: a cumulative counter would make this pass on traffic another scenario sent, which is how a shared mesh turns an assertion into an accident. Held sockets do not outlive a scenario, so the whole sequence belongs in one.",
    steps: [
      { do: "provision", identity: "e2e-push-src", type: "ai-claude", key: true },
      { do: "approve", identity: "e2e-push-src" },
      { do: "provision", identity: "e2e-push-dst", type: "ai-claude", key: true },
      { do: "approve", identity: "e2e-push-dst" },
      { do: "connect", identity: "e2e-push-dst", hold: true },
      { do: "send", from: "e2e-push-src", to: "e2e-push-dst", content: "live", expect: { error: null } },
      { do: "expectPushed", identity: "e2e-push-dst", count: 1 },
      { do: "send", from: "e2e-push-src", to: "e2e-push-dst", content: "second", expect: { error: null } },
      { do: "expectPushed", identity: "e2e-push-dst", count: 1 },
      { do: "disconnect", identity: "e2e-push-dst" },
      { do: "send", from: "e2e-push-src", to: "e2e-push-dst", content: "third", expect: { error: null } },
      // One, not three. The two pushed while the socket was held were
      // **delivered**; only the one sent after it closed is waiting. A hub that
      // queued a copy of everything it pushed would answer three here, and the
      // recipient would read every live message twice.
      { do: "receive", identity: "e2e-push-dst", expectCount: 1 },
    ],
  },
  {
    id: "E2E-ACK-001",
    clause: "§ 8.10.1",
    why: "An unacknowledged batch comes back; an acknowledged one does not. A receive that settled nothing looks identical until the same message arrives twice, which is the failure a lane cannot recover from on its own.",
    steps: [
      { do: "provision", identity: "e2e-ack-src", type: "ai-claude", key: true },
      { do: "approve", identity: "e2e-ack-src" },
      { do: "provision", identity: "e2e-ack-dst", type: "ai-claude", key: true },
      { do: "approve", identity: "e2e-ack-dst" },
      { do: "send", from: "e2e-ack-src", to: "e2e-ack-dst", content: "settle me", expect: { error: null } },
      { do: "receive", identity: "e2e-ack-dst", expectCount: 1 },
      { do: "receive", identity: "e2e-ack-dst", ackPrevious: true, expectCount: 0 },
    ],
  },
  {
    id: "E2E-AUTH-MSGPOST-001",
    clause: "§ 9.2",
    why: "Posting a message through the operator surface without a session is sending as somebody else. Every delivery scenario would stay green while it happened, because the message that arrives is well-formed. The refusal is the only half a caller without credentials can observe.",
    steps: [
      { do: "http", method: "POST", path: "/api/v1/messages", as: "none", body: {},
        expect: { status: 401 } },
    ],
  },
  {
    id: "E2E-AUTH-FILES-001",
    clause: "§ 9.2",
    why: "Files are payloads that were attached to messages. A listing that answered anyone hands over the attachments without touching the mailbox the scenarios watch. The refusal is the only half a caller without credentials can observe.",
    steps: [
      { do: "http", method: "GET", path: "/api/v1/files", as: "none",
        expect: { status: 401 } },
    ],
  },
  {
    id: "E2E-AUTH-EVENTS-001",
    clause: "§ 9.2",
    why: "A per-agent event stream is that agent's history. Unauthenticated it is every agent's history to anyone who can guess a name, and names are not secret. The refusal is the only half a caller without credentials can observe.",
    steps: [
      { do: "http", method: "GET", path: "/api/v1/events/e2e-src", as: "none",
        expect: { status: 401 } },
    ],
  },
  {
    id: "E2E-AUTH-UPLOAD-001",
    clause: "§ 9.2",
    why: "An upload route open to anyone is storage anyone can fill, and the first symptom is the audit spool refusing appends for a reason that points at the wrong subsystem. The refusal is the only half a caller without credentials can observe.",
    steps: [
      { do: "http", method: "POST", path: "/api/v1/upload", as: "none", body: {},
        expect: { status: 401 } },
    ],
  },
  {
    id: "E2E-VAPID-001",
    clause: "§ 9.2",
    why: "The push public key has to be readable before a client has any credentials, because subscribing is what a client does on its way to having them. A session in front of it is the change that makes push impossible to set up.",
    steps: [
      { do: "http", method: "GET", path: "/api/v1/push/vapid-key", as: "none",
        expect: { status: 200 } },
    ],
  },
  {
    id: "E2E-AUTH-AGENTDEL-001",
    clause: "§ 9.2",
    why: "Removing an agent unauthenticated is how an identity disappears with nobody to ask. The mesh keeps working, which is why nothing else would notice. The refusal is the only half a caller without credentials can observe.",
    steps: [
      { do: "http", method: "DELETE", path: "/api/v1/admin/agents/e2e-src", as: "none",
        expect: { status: 401 } },
    ],
  },
  {
    id: "E2E-AUTH-SUBSCRIBE-001",
    clause: "§ 9.2",
    why: "A subscription without a session sends somebody else's notifications to an endpoint the subscriber chose. The refusal is the only half a caller without credentials can observe.",
    steps: [
      { do: "http", method: "POST", path: "/api/v1/push/subscribe", as: "none", body: {},
        expect: { status: 401 } },
    ],
  },
  {
    id: "E2E-AUTH-TYPEDEL-002",
    clause: "§ 8.9.5",
    why: "The holder-passes half for `agent.provision` on a delete: a guard that refuses the operator too is a broken route reported as a working one. The type here does not exist, so the answer is a miss rather than a removal — which is what makes it safe to assert on a shared mesh.",
    steps: [
      // `200` with `action: "not-found"`, not `404`. Deleting a type that is
      // not there is not an error — the operator asked for it to be gone and it
      // is — and the body says which of the two happened. A scenario asserting
      // `404` here would be asserting a refusal the mesh deliberately does not
      // make.
      { do: "http", method: "DELETE", path: "/api/v1/admin/agent-types/e2e-no-such-type", as: "admin",
        expect: { status: 200, body: { "action": "not-found" } } },
    ],
  },
  {
    id: "E2E-AUTH-KEYONE-002",
    clause: "§ 10.2",
    why: "The holder-passes half for `key.approve` on a single-identity read. Asking about an identity that was provisioned earlier in this run proves the route answers rather than refuses, without depending on approval state another scenario owns.",
    steps: [
      { do: "provision", identity: "e2e-keyread", type: "ai-claude", key: true },
      { do: "http", method: "GET", path: "/api/v1/admin/keys/e2e-keyread", as: "admin",
        expect: { status: 200 } },
    ],
  },
  {
    id: "E2E-AUTH-DEPTHONE-002",
    clause: "§ 8.10.1",
    why: "The holder-passes half for `mailbox.read.depth` on one identity. Depth is what an operator reads when a lane looks stuck; a route that refused them would make the stuck lane invisible at exactly the moment it matters.",
    steps: [
      { do: "http", method: "GET", path: "/api/v1/admin/mailbox/e2e-keyread", as: "admin",
        expect: { status: 200 } },
    ],
  },
  {
    id: "E2E-AUTH-BEHAVIOUR-002",
    clause: "§ 11.0",
    why: "The holder-passes half. A refusal on its own is satisfied by a route that refuses the operator too — measuring absence without measuring presence lets an implementation that gives nobody anything pass both.",
    steps: [
      { do: "http", method: "GET", path: "/api/v1/admin/telemetry/behaviour", as: "admin",
        expect: { status: 200 } },
    ],
  },
  {
    id: "E2E-AUTH-AUDAGENTS-002",
    clause: "§ 11.0",
    why: "The holder-passes half. A refusal on its own is satisfied by a route that refuses the operator too — measuring absence without measuring presence lets an implementation that gives nobody anything pass both.",
    steps: [
      { do: "http", method: "GET", path: "/api/v1/admin/chat-audits/agents", as: "admin",
        expect: { status: 200 } },
    ],
  },
  {
    id: "E2E-AUTH-OWNERS-002",
    clause: "§ 8.11",
    why: "The holder-passes half. A refusal on its own is satisfied by a route that refuses the operator too — measuring absence without measuring presence lets an implementation that gives nobody anything pass both.",
    steps: [
      { do: "http", method: "GET", path: "/api/v1/admin/agents/e2e-keyread/owners", as: "admin",
        expect: { status: 200 } },
    ],
  },
  {
    id: "E2E-INCUMBENT-001",
    clause: "§ 8.1",
    why: "Two sockets for one identity is a split brain: both would be pushed to, and each would answer as the same agent. The incumbent is kept rather than replaced, so a contender that reconnects during a network blip cannot take a live agent's place — and the refusal has to name which of the two survived.",
    steps: [
      { do: "provision", identity: "e2e-incumbent", type: "ai-claude", key: true },
      { do: "approve", identity: "e2e-incumbent" },
      { do: "connect", identity: "e2e-incumbent", hold: true, expect: { error: null } },
      { do: "connect", identity: "e2e-incumbent", expect: { error: -32010 } },
    ],
  },
  {
    id: "E2E-STOREFWD-001",
    clause: "§ 3",
    why: "The mesh is store-and-forward: mail addressed to a name with nobody behind it waits rather than failing. A hub that refused it would lose everything sent to an agent between its registration and its first connect, and the sender would read the refusal as a wrong address.",
    steps: [
      { do: "provision", identity: "e2e-fwd-src", type: "ai-claude", key: true },
      { do: "approve", identity: "e2e-fwd-src" },
      { do: "send", from: "e2e-fwd-src", to: "e2e-nobody-registered", content: "waiting for you", expect: { error: null } },
    ],
  },
  {
    id: "E2E-CONSOLE-001",
    clause: "§ 9.1",
    why: "The two surfaces answer the same request differently on purpose, and the difference is the contract. The mesh queues for a name it has never seen; the console refuses, because it decides from its own table who its users may address. A deployment that made them agree would either lose store-and-forward or let the console send into the void.",
    steps: [
      { do: "http", method: "POST", path: "/api/v1/messages", as: "admin",
        body: { to: "e2e-nobody-registered", text: "console says no" },
        expect: { status: 404 } },
    ],
  },
  {
    id: "E2E-REPLYHINT-001",
    clause: "§ 8.2",
    why: "replyTo is a hint and is not validated: an id naming no message the hub holds travels with the send rather than failing it. Validating would mean reading somebody else's mailbox history on every send — a read this contract does not give the sender and a cost it does not ask of the hub. The neighbour it is confused with runs the other way: an unknown recipient waits, an unknown replyTo goes along.",
    steps: [
      { do: "provision", identity: "e2e-hint-a", type: "ai-claude", key: true },
      { do: "approve", identity: "e2e-hint-a" },
      { do: "provision", identity: "e2e-hint-b", type: "ai-claude", key: true },
      { do: "approve", identity: "e2e-hint-b" },
      { do: "send", from: "e2e-hint-a", to: "e2e-hint-b", content: "answering nothing",
        replyTo: "msg_0000000000000000", expect: { error: null } },
      { do: "receive", identity: "e2e-hint-b", expectCount: 1 },
    ],
  },
  {
    id: "E2E-UPSERT-001",
    clause: "§ 10.1",
    why: "Registering a name that is already there updates it rather than refusing: an agent restarting with a fresh key must be able to propose it without an operator first removing the old row. The refusal that does exist is a different door — a second live socket — and conflating the two makes a restart look like an intrusion.",
    steps: [
      { do: "provision", identity: "e2e-upsert", type: "ai-claude", key: true },
      { do: "provision", identity: "e2e-upsert", type: "ai-claude", key: true,
        expect: { status: 200, body: { "action": "updated" } } },
    ],
  },
  {
    id: "E2E-HISTORY-002",
    clause: "§ 8.10.1",
    why: "The holder-passes half. A refusal on its own is satisfied by a route that refuses the signed participant too — history is what a lane reads to recover after a restart, and a route that answered nobody would make every restart look like an empty mailbox.",
    steps: [
      { do: "provision", identity: "e2e-hist", type: "ai-claude", key: true },
      { do: "approve", identity: "e2e-hist" },
      // `peer` is required: history is a conversation, not a firehose, and the
      // route says so rather than defaulting to everything this identity can see.
      { do: "http", method: "GET", path: "/api/v1/mailbox/history?peer=e2e-hist", as: { signedBy: "e2e-hist" },
        expect: { status: 200 } },
    ],
  },
  {
    id: "E2E-INBOX-002",
    clause: "§ 8.10.1",
    why: "The holder-passes half for receiving over REST. Measuring only the refusal lets a hub that leases nothing to anyone pass: the unsigned caller is refused, the signed one gets an empty answer, and both look correct until a lane never receives.",
    steps: [
      { do: "http", method: "POST", path: "/api/v1/mailbox/in", as: { signedBy: "e2e-hist" }, body: {},
        expect: { status: 200 } },
    ],
  },
  {
    id: "E2E-AUTH-AGENTDEL-002",
    clause: "§ 8.9.5",
    why: "The holder-passes half for removing an agent. The name here was never registered, so the answer is a miss rather than a removal — which is what makes it safe to assert on a mesh other scenarios share, and still proves the operator is let through.",
    steps: [
      // `200` with `action: "not-found"`, the same shape the agent-type delete
      // answers. Removing something that is not there is not an error — the
      // operator asked for it to be gone and it is — and the body says which of
      // the two happened.
      { do: "http", method: "DELETE", path: "/api/v1/admin/agents/e2e-never-existed", as: "admin",
        expect: { status: 200, body: { "action": "not-found" } } },
    ],
  },
  {
    id: "E2E-AUTH-EGRDEL-002",
    clause: "§ 12",
    why: "The holder-passes half for withdrawing an egress rule. Withdrawing one that is not there is a miss, so the assertion does not depend on a rule another scenario owns, and the operator still has to get past the gate to learn that.",
    steps: [
      { do: "http", method: "DELETE", path: "/api/v1/admin/groups/e2e-no-group/egress/e2e-no-target", as: "admin",
        expect: { status: 404 } },
    ],
  },
  {
    id: "E2E-AUTH-KEYSTREAM-002",
    clause: "§ 10.2",
    why: "The holder-passes half for the pending-keys read. The stream beside it cannot be asserted from here — it never closes — so this holds the same capability through the route that answers and returns.",
    steps: [
      { do: "http", method: "GET", path: "/api/v1/admin/keys/pending", as: "admin",
        expect: { status: 200 } },
    ],
  },
  {
    id: "E2E-AUTH-KEYSTREAM-002",
    clause: "§ 11.0",
    why: "The holder-passes half for a stream. A stream that refuses everyone looks exactly like one that refuses strangers until an operator opens it, and the operator is the only party who would notice — usually while something else is already going wrong. Asserted on the status, because a stream has no end to read to.",
    steps: [
      { do: "http", method: "GET", path: "/api/v1/admin/keys/stream", as: "admin",
        expect: { status: 200 } },
    ],
  },
  {
    id: "E2E-AUTH-AUDSTREAM-002",
    clause: "§ 11.0",
    why: "The holder-passes half for a stream. A stream that refuses everyone looks exactly like one that refuses strangers until an operator opens it, and the operator is the only party who would notice — usually while something else is already going wrong. Asserted on the status, because a stream has no end to read to.",
    steps: [
      { do: "http", method: "GET", path: "/api/v1/admin/chat-audits/stream", as: "admin",
        expect: { status: 200 } },
    ],
  },
  {
    id: "E2E-AUTH-USAGESTRM-002",
    clause: "§ 11.0",
    why: "The holder-passes half for a stream. A stream that refuses everyone looks exactly like one that refuses strangers until an operator opens it, and the operator is the only party who would notice — usually while something else is already going wrong. Asserted on the status, because a stream has no end to read to.",
    steps: [
      { do: "http", method: "GET", path: "/api/v1/admin/ai-usage/stream", as: "admin",
        expect: { status: 200 } },
    ],
  },
] as const;
