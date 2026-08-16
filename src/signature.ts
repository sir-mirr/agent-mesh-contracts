/**
 * Request and upload signing preimages (SPEC § 8.1, § 9.1).
 *
 * A signature covers a domain-separated, length-prefixed encoding. Signing the
 * `params` bytes alone would leave `method`, `nonce` and `iat` unauthenticated,
 * so a captured signature could be replayed with a fresh nonce or reused
 * against a different method that accepts the same parameter shape.
 *
 * The length prefixes are what make the encoding unambiguous: no concatenation
 * of one field's content can imitate another. The domain separator is what
 * keeps a signature minted for one purpose from being replayed into another —
 * which is why the request and upload constructions use different ones.
 *
 * This module deliberately contains no cryptography. It builds the bytes both
 * sides must agree on; signing and verification belong to the caller.
 */

const RPC_DOMAIN = "agent-mesh/sig/v1";
const UPLOAD_DOMAIN = "agent-mesh/upload/v1";
const REST_DOMAIN = "agent-mesh/rest/v1";

const encoder = new TextEncoder();

/** `uint32be(byteLength(x)) ‖ x`. */
function lengthPrefixed(value: Uint8Array): Uint8Array {
  const out = new Uint8Array(4 + value.length);
  new DataView(out.buffer).setUint32(0, value.length, false);
  out.set(value, 4);
  return out;
}

function utf8(value: string): Uint8Array {
  return encoder.encode(value);
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  let total = 0;
  for (const part of parts) total += part.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/**
 * `iat` enters the preimage as its decimal string with no leading zeros, so
 * both sides encode the same integer identically.
 */
function decimal(value: number): string {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`signature: iat must be a non-negative integer, got ${value}`);
  }
  return String(value);
}

export interface RequestSignatureInput {
  /** JSON-RPC method name, e.g. `mesh.audit.append`. */
  method: string;
  /** Fingerprint of the signing key. */
  kid: string;
  nonce: string;
  /** Unix seconds. */
  iat: number;
  /**
   * The `params` bytes **exactly as they go on the wire**. Callers MUST retain
   * the serialised form they sent and re-send those bytes on retry: JSON has no
   * canonical byte form, so a preimage rebuilt from a re-serialised object can
   * differ from one built from the bytes actually transmitted.
   */
  rawParams: Uint8Array;
}

/** SPEC § 8.1 — the bytes a JSON-RPC request signature covers. */
export function requestSignaturePreimage(input: RequestSignatureInput): Uint8Array {
  return concat([
    utf8(RPC_DOMAIN),
    new Uint8Array([0x00]),
    lengthPrefixed(utf8(input.method)),
    lengthPrefixed(utf8(input.kid)),
    lengthPrefixed(utf8(input.nonce)),
    lengthPrefixed(utf8(decimal(input.iat))),
    lengthPrefixed(input.rawParams),
  ]);
}

export interface UploadSignatureInput {
  /** Nonce issued by `mesh.audit.prepare_blobs`. */
  nonce: string;
  /** Authoritative storage key returned by the hub — `<sha256>[.<ext>]`. */
  blobKey: string;
  /** Lowercase hex digest of the file bytes. */
  sha256: string;
  /** Byte length. */
  size: number;
}

/**
 * SPEC § 9.1 — the bytes a blob upload `Authorization` signature covers.
 *
 * `blobKey` is included so a grant cannot be redirected to a different key, and
 * `sha256`/`size` so a leaked signature authorises only the identical bytes —
 * which deduplicate to no effect, making replay harmless.
 */
export function uploadSignaturePreimage(input: UploadSignatureInput): Uint8Array {
  if (!Number.isInteger(input.size) || input.size < 0) {
    throw new Error(`signature: size must be a non-negative integer, got ${input.size}`);
  }
  return concat([
    utf8(UPLOAD_DOMAIN),
    new Uint8Array([0x00]),
    lengthPrefixed(utf8(input.nonce)),
    lengthPrefixed(utf8(input.blobKey)),
    lengthPrefixed(utf8(input.sha256)),
    lengthPrefixed(utf8(decimal(input.size))),
  ]);
}

/** The signature object carried as a sibling of `params` on every request. */
export interface RequestSignature {
  alg: "ed25519";
  /** Key fingerprint. */
  kid: string;
  nonce: string;
  iat: number;
  /** base64url. */
  value: string;
}

/** SPEC § 8.1 — `iat` must be within this many seconds of the hub's clock. */
export const SIGNATURE_FRESHNESS_WINDOW_SECONDS = 120;

/** SPEC § 9.1 — `Authorization` scheme for the blob upload. */
export const UPLOAD_AUTH_SCHEME = "AgentMeshSig";

/** SPEC § 8.9.2 — how long an upload grant stays valid. */
export const UPLOAD_NONCE_TTL_SECONDS = 900;

/**
 * Render the blob upload `Authorization` header value.
 *
 * The nonce travels in the header rather than the URL: query strings reach
 * access logs and proxy caches, and this one authorises a write.
 */
export function formatUploadAuthorization(params: {
  kid: string;
  nonce: string;
  /** base64url signature over `uploadSignaturePreimage`. */
  signature: string;
}): string {
  return `${UPLOAD_AUTH_SCHEME} kid="${params.kid}", nonce="${params.nonce}", sig="${params.signature}"`;
}

const AUTH_PARAM_RE = /([a-z]+)="([^"]*)"/g;

/** Parse a `AgentMeshSig` header. Returns null when the scheme does not match. */
export function parseUploadAuthorization(
  header: string,
): { kid: string; nonce: string; signature: string } | null {
  const trimmed = header.trim();
  if (!trimmed.startsWith(`${UPLOAD_AUTH_SCHEME} `)) return null;
  const params: Record<string, string> = {};
  for (const match of trimmed.slice(UPLOAD_AUTH_SCHEME.length).matchAll(AUTH_PARAM_RE)) {
    params[match[1]!] = match[2]!;
  }
  const { kid, nonce, sig } = params;
  if (!kid || !nonce || !sig) return null;
  return { kid, nonce, signature: sig };
}

/** SPEC § 9.2 — `Authorization` scheme for the signed REST surface. */
export const REST_AUTH_SCHEME = "AgentMeshSig";

export interface RestSignatureInput {
  /** Uppercase HTTP method — `GET`, `POST`, `DELETE`. */
  method: string;
  /**
   * Path **with its query string**, exactly as it goes on the wire.
   *
   * Signing the path without the query would leave `?peer=` and `?limit=`
   * unprotected on the one surface where they carry the request — an attacker
   * able to rewrite a query could redirect a history read at another peer while
   * the signature still verified.
   */
  path: string;
  kid: string;
  nonce: string;
  /** Unix seconds. */
  iat: number;
  /**
   * SHA-256 of the raw request body, lowercase hex; empty string when there is
   * no body.
   *
   * A digest rather than the bytes, because the body is read as a stream and a
   * preimage that required buffering it would put a size limit on signing
   * rather than on the route.
   */
  bodySha256: string;
}

/**
 * Preimage for a signed REST request (SPEC § 9.2).
 *
 * **Its own domain separator.** Three constructions now sign with the same key
 * — JSON-RPC (§ 8.1), blob upload (§ 9.1) and this — and two signatures that
 * could be replayed into each other's position are one signature. The
 * separators are what keep a captured `POST /api/v1/outbox` from being replayed
 * as an upload authorisation.
 *
 * Every field is length-prefixed for the reason § 8.1 gives: without it,
 * `path="/a/b"` with `nonce="c"` and `path="/a"` with `nonce="b/c"` produce the
 * same bytes, and a signature over one verifies the other.
 */
export function restSignaturePreimage(input: RestSignatureInput): Uint8Array {
  if (!Number.isInteger(input.iat) || input.iat < 0) {
    throw new Error(`signature: iat must be a non-negative integer, got ${input.iat}`);
  }
  return concat([
    utf8(REST_DOMAIN),
    new Uint8Array([0x00]),
    lengthPrefixed(utf8(input.method.toUpperCase())),
    lengthPrefixed(utf8(input.path)),
    lengthPrefixed(utf8(input.kid)),
    lengthPrefixed(utf8(input.nonce)),
    lengthPrefixed(utf8(decimal(input.iat))),
    lengthPrefixed(utf8(input.bodySha256)),
  ]);
}

/** Render the REST `Authorization` header value. */
export function formatRestAuthorization(params: {
  kid: string;
  nonce: string;
  iat: number;
  /** base64url signature over `restSignaturePreimage`. */
  signature: string;
}): string {
  return (
    `${REST_AUTH_SCHEME} kid="${params.kid}", nonce="${params.nonce}", ` +
    `iat="${params.iat}", sig="${params.signature}"`
  );
}

/**
 * Parse a REST `AgentMeshSig` header. Returns null when it is not one.
 *
 * Separate from `parseUploadAuthorization` despite the shared scheme name: this
 * one carries `iat`, because a REST request has no body field to put it in and
 * the freshness window needs it. A header missing `iat` is a blob-upload header
 * and is refused here rather than accepted with a default, which would place
 * every such request at the epoch and outside the window.
 */
export function parseRestAuthorization(
  header: string,
): { kid: string; nonce: string; iat: number; signature: string } | null {
  const trimmed = header.trim();
  if (!trimmed.startsWith(`${REST_AUTH_SCHEME} `)) return null;
  const params: Record<string, string> = {};
  for (const match of trimmed.slice(REST_AUTH_SCHEME.length).matchAll(AUTH_PARAM_RE)) {
    params[match[1]!] = match[2]!;
  }
  const { kid, nonce, iat, sig } = params;
  if (!kid || !nonce || !iat || !sig) return null;
  const seconds = Number(iat);
  if (!Number.isInteger(seconds) || seconds < 0) return null;
  return { kid, nonce, iat: seconds, signature: sig };
}
