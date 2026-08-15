/**
 * Runtime validation schemas.
 *
 * Behind a subpath — `@agent-mesh/contracts/schema` — so the index stays free
 * of the TypeBox import. Most consumers of this package encode and decode
 * without validating anything, and they should not carry a validator to do it.
 *
 * TypeBox rather than a zod-style library for one reason that matters here: a
 * TypeBox schema **is** a JSON Schema object at runtime, so `JSON.stringify`
 * hands a non-TypeScript implementation the same contract with nothing
 * compiled. This package ships TypeScript source and has no build step; a
 * library needing a generation pass to emit JSON Schema would have introduced
 * one.
 *
 * These validate **shape, not policy**. Whether a `type` exists, whether an
 * identity is already taken, whether a key is approved — those are the hub's
 * to answer against its own state, and a schema that also answered them would
 * be a second copy going stale from the first.
 */

import { Type, type Static } from "@sinclair/typebox";

import { IDENTITY_RE, PUBLIC_KEY_RE } from "../key";

/**
 * SPEC § 10.1. Case-sensitive; kebab-case is recommended, not required.
 *
 * The pattern is sourced from `key.ts` rather than restated, so loosening it
 * once cannot leave a validator enforcing the old rule — which is precisely
 * what happened when 0.2 admitted `human` and the identity rule had to change.
 */
const Identity = Type.String({
  pattern: IDENTITY_RE.source,
  description: "Mesh identity. Case-sensitive (SPEC § 10.1).",
});

/** Raw Ed25519, base64url, unpadded. */
const PublicKey = Type.String({
  pattern: PUBLIC_KEY_RE.source,
  description: "Raw Ed25519 public key, base64url, 43 characters.",
});

const MeshMessageBody = Type.Object(
  {
    id: Type.String(),
    from: Identity,
    to: Identity,
    sent_by: Type.Union([Identity, Type.Null()]),
    content: Type.String(),
    reply_to: Type.Union([Type.String(), Type.Null()]),
    ts: Type.String(),
  },
  { additionalProperties: true },
);

/**
 * `POST /api/v1/agents` (SPEC § 10.1).
 *
 * `type` is a plain non-empty string, deliberately **not** an enum. It is
 * resolved against the `agent_types` table at runtime (§ 10.3), and freezing
 * the seeded set into a schema would reintroduce exactly what removing the
 * hardcoded enum fixed: adding a runtime would need a new contract release
 * before anyone could register under it. A deployment may carry types this
 * package has never heard of. Validate the shape; let the hub validate the
 * value.
 */
export const ProvisionAgentRequest = Type.Object(
  {
    identity: Identity,
    type: Type.String({
      minLength: 1,
      description: "Resolved against agent_types at runtime (SPEC § 10.3), not against this schema.",
    }),
    description: Type.Optional(
      Type.Union([Type.String({ maxLength: 256 }), Type.Null()]),
    ),
    public_key: Type.Optional(PublicKey),
    /**
     * Refuse rather than update if the identity already exists (§ 10.1).
     *
     * Onboarding a new participant must never take over an existing one. The
     * route upserts by default, so a check followed by a provision has a window
     * in which someone else's identity is adopted and their pending key
     * replaced — and the taker sees a success.
     *
     * Default false, which keeps the rotation and re-registration paths that
     * rely on update semantics working unchanged.
     */
    create_only: Type.Optional(Type.Boolean()),
  },
  {
    additionalProperties: false,
    $id: "agent-mesh/ProvisionAgentRequest",
    description: "POST /api/v1/agents — SPEC § 10.1.",
  },
);
export type ProvisionAgentRequest = Static<typeof ProvisionAgentRequest>;

/** `POST /api/v1/agents` success body, `200` and `201` alike (SPEC § 10.1). */
export const ProvisionAgentResponse = Type.Object(
  {
    ok: Type.Literal(true),
    identity: Identity,
    type: Type.String(),
    description: Type.Union([Type.String(), Type.Null()]),
    created_at: Type.Union([Type.String(), Type.Null()]),
    action: Type.Union([Type.Literal("inserted"), Type.Literal("updated")]),
    /** Present when the request carried `public_key` (SPEC § 10.2). */
    key: Type.Optional(
      Type.Object({
        fingerprint: Type.String(),
        status: Type.Union([
          Type.Literal("pending"),
          Type.Literal("approved"),
          Type.Literal("denied"),
          Type.Literal("revoked"),
        ]),
      }),
    ),
  },
  { $id: "agent-mesh/ProvisionAgentResponse" },
);
export type ProvisionAgentResponse = Static<typeof ProvisionAgentResponse>;

/**
 * The `sig` member of a signed JSON-RPC request (SPEC § 8.1).
 *
 * A sibling of `method` and `params`, not a member of `params`: JSON-RPC has no
 * header slot, and `params` belongs to each method's own schema.
 */
export const RequestSignature = Type.Object(
  {
    alg: Type.Literal("ed25519"),
    kid: Type.String({ minLength: 1, description: "Fingerprint of the signing key." }),
    nonce: Type.String({ minLength: 1 }),
    iat: Type.Integer({ minimum: 0, description: "Unix seconds." }),
    value: Type.String({ minLength: 1, description: "base64url." }),
  },
  { additionalProperties: false, $id: "agent-mesh/RequestSignature" },
);
export type RequestSignature = Static<typeof RequestSignature>;

/** `mesh.connect` params (SPEC § 8.1). */
export const MeshConnectParams = Type.Object(
  {
    identity: Identity,
    proxy_for: Type.Optional(Type.Array(Identity)),
  },
  {
    // Open on purpose: § 8.1 requires the hub to ignore unknown params rather
    // than fail, so older clients that grew `type` and `description` onto
    // `mesh.register` still connect.
    additionalProperties: true,
    $id: "agent-mesh/MeshConnectParams",
  },
);
export type MeshConnectParams = Static<typeof MeshConnectParams>;

/** `mesh.send` params (SPEC § 8.2). */
export const MeshSendParams = Type.Object(
  {
    to: Identity,
    content: Type.String(),
    reply_to: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    /**
     * Sender override. Constrained by entitlement at 0.2 — it exists for
     * participants who hold no key of their own and so cannot sign for
     * themselves.
     */
    from: Type.Optional(Identity),
    /**
     * Idempotency key, unique per sending identity (§ 8.2).
     *
     * Omitted from this schema when the transport shipped, which made the
     * schema reject a request the hub accepts. `additionalProperties: false` is
     * right for catching typos and unforgiving of a field added in one place
     * and not the other — so a member added to the protocol has to arrive here
     * in the same change.
     */
    client_message_id: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
  },
  { additionalProperties: false, $id: "agent-mesh/MeshSendParams" },
);
export type MeshSendParams = Static<typeof MeshSendParams>;

/**
 * `mesh.receive` params (SPEC § 8.10.1).
 *
 * `ack_ids` settles the previous batch as part of fetching the next. Ids the
 * caller does not hold are ignored by the hub rather than refused, so the
 * schema does not constrain their shape beyond being strings.
 */
export const MeshReceiveParams = Type.Object(
  {
    limit: Type.Optional(Type.Integer({ minimum: 1 })),
    ack_ids: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
  },
  { additionalProperties: false, $id: "agent-mesh/MeshReceiveParams" },
);
export type MeshReceiveParams = Static<typeof MeshReceiveParams>;

/** `mesh.receive` result (SPEC § 8.10.1). */
export const MeshReceiveResult = Type.Object(
  {
    messages: Type.Array(MeshMessageBody),
    remaining: Type.Integer({ minimum: 0 }),
    lease_seconds: Type.Integer({ minimum: 1 }),
  },
  { additionalProperties: true, $id: "agent-mesh/MeshReceiveResult" },
);
export type MeshReceiveResult = Static<typeof MeshReceiveResult>;

/**
 * `mesh.message` (SPEC § 8.8.1).
 *
 * `sent_by` is hub-derived and is the identity that actually transmitted the
 * envelope. It equals `from` unless a proxy overrode it, and is null only for
 * messages stored before the hub recorded it. Treating `from` as the
 * authenticated origin is wrong whenever the two differ.
 */
export const MeshMessageParams = Type.Object(
  { ...MeshMessageBody.properties },
  { additionalProperties: true, $id: "agent-mesh/MeshMessageParams" },
);
export type MeshMessageParams = Static<typeof MeshMessageParams>;
