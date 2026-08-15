/**
 * Signing keys and their fingerprints (SPEC § 10.1, § 10.2).
 *
 * A fingerprint is not an internal detail. It is the value a lane logs at
 * startup, the value the approval surface displays, and the value an operator
 * compares between the two before approving anything — SPEC § 10.2 is explicit
 * that without the comparison the approval attests to nothing. It is also what
 * rides `sig.kid` on every signed request.
 *
 * So it must be derived identically everywhere, which is why the hashing lives
 * here rather than being described in prose and implemented twice. `blob-key`
 * takes a digest its caller computed; this does not, because the rule that
 * matters is *what* gets hashed. A fingerprint taken over the base64 text
 * instead of the raw bytes is a perfectly good hash of the wrong thing, and the
 * two disagree silently — the operator compares two strings that were never
 * meant to match and reads the mismatch as a wrong key.
 */

import { createHash } from "node:crypto";

/** Ed25519 raw public key length. */
export const PUBLIC_KEY_BYTES = 32;

/** A raw Ed25519 public key, base64url-encoded without padding. */
export const PUBLIC_KEY_RE = /^[A-Za-z0-9_-]{43}$/;

/** A fingerprint this module produces. */
export const FINGERPRINT_RE = /^sha256:[A-Za-z0-9_-]{43}$/;

/**
 * Identity format (SPEC § 10.1). A letter or digit, then letters, digits and
 * hyphens.
 *
 * Kebab-case is recommended and is what every baseline identity uses, but it is
 * a convention rather than a constraint: 0.2 loosened this so a person can hold
 * an identity, since the logins people federate from permit uppercase.
 *
 * **Identities are compared case-sensitively.** `Codex` and `codex` are two
 * identities. An implementation that lowercases before comparing, caching or
 * keying will silently merge two participants.
 */
export const IDENTITY_RE = /^[A-Za-z0-9][A-Za-z0-9-]*$/;

function base64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

/**
 * Decode a base64url public key to its raw bytes, rejecting anything that is
 * not a well-formed Ed25519 key.
 *
 * The length check is not redundant with the regex: base64url decoding is
 * lenient about input that happens to decode to the wrong number of bytes, and
 * a 31-byte "key" would otherwise get a fingerprint and be stored.
 */
export function parsePublicKey(publicKey: string): Uint8Array {
  if (!PUBLIC_KEY_RE.test(publicKey)) {
    throw new Error(
      `key: public key must be 43 base64url characters (raw Ed25519, 32 bytes), got ${publicKey.length}`,
    );
  }
  const bytes = new Uint8Array(Buffer.from(publicKey, "base64url"));
  if (bytes.length !== PUBLIC_KEY_BYTES) {
    throw new Error(`key: public key decoded to ${bytes.length} bytes, expected ${PUBLIC_KEY_BYTES}`);
  }
  return bytes;
}

/**
 * `sha256:<base64url>` over the **raw key bytes**, never over its encoding.
 *
 * Algorithm-tagged so a later digest can be introduced without any stored
 * fingerprint becoming ambiguous, and base64url rather than hex so it is short
 * enough to compare by eye — the same reasoning, and the same shape, as an SSH
 * key fingerprint, which is what an operator doing the comparison already
 * knows how to read.
 *
 * Accepts the wire form or the raw bytes; both produce the same value, which is
 * the point.
 */
export function keyFingerprint(publicKey: string | Uint8Array): string {
  const bytes = typeof publicKey === "string" ? parsePublicKey(publicKey) : publicKey;
  if (bytes.length !== PUBLIC_KEY_BYTES) {
    throw new Error(`key: public key must be ${PUBLIC_KEY_BYTES} bytes, got ${bytes.length}`);
  }
  return `sha256:${base64url(new Uint8Array(createHash("sha256").update(bytes).digest()))}`;
}

/**
 * The state of a stored key row (SPEC § 10.2). Terminal states are `denied` and
 * `revoked`.
 *
 * **Not `KeyStatus` from `errors`**, which looks similar and answers a different
 * question: that one says why an identity has *no usable key* and so includes
 * `missing` and excludes `approved`. This one describes a row that exists. A
 * `-32014` carries the former; `agent_keys.status` holds the latter.
 */
export type AgentKeyStatus = "pending" | "approved" | "denied" | "revoked";

export const AGENT_KEY_STATUSES: readonly AgentKeyStatus[] = [
  "pending",
  "approved",
  "denied",
  "revoked",
];

/**
 * Why a key stopped being usable. This is not decoration: a routine `rotation`
 * says nothing about signatures made before it, while `compromise` casts doubt
 * on the whole window preceding it, and only the recorded reason lets a
 * verifier tell those apart afterwards.
 */
export type RevocationReason = "rotation" | "compromise" | "teardown" | "operator";
