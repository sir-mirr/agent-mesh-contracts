/**
 * Attachment storage keys (SPEC § 15.2).
 *
 * A key is `<sha256>[.<ext>]` — the digest, carrying the original file
 * extension when there was one. The extension is retained because the download
 * route infers `Content-Type` from it.
 *
 * Deduplication is therefore per **(digest, extension)**, not per digest: the
 * same bytes arriving under two different extensions are stored twice. That is
 * existing platform behaviour rather than a regression, but it is why the hub
 * derives the key and returns it — two implementations of one normalisation
 * rule are two chances to disagree, and a disagreement splits one blob into
 * two. Clients send `name` to `mesh.audit.prepare_blobs` and use the
 * `blob_key` that comes back.
 *
 * This module exists so both sides can be tested against the same rule, not so
 * both sides can apply it independently.
 */

/** Matches a produced key. Extensions are lowercased on the way in. */
export const BLOB_KEY_RE = /^[0-9a-f]{64}(?:\.[a-z0-9]{1,16})?$/;

/**
 * Matches a key the download route accepts, which is more permissive than what
 * it produces: legacy uploads carried mixed-case extensions.
 */
export const BLOB_KEY_ACCEPT_RE = /^[0-9a-f]{64}(?:\.[a-zA-Z0-9]{1,16})?$/;

const SHA256_HEX_RE = /^[0-9a-f]{64}$/;
const UNSAFE_NAME_CHARS = /[^a-zA-Z0-9._-]/g;
const TRAILING_EXTENSION = /(\.[a-zA-Z0-9]{1,16})$/;

/**
 * Extract the storage extension from a client-supplied filename, or `""` when
 * there is none usable.
 *
 * The steps match what `POST /api/v1/upload` has always done, so both upload
 * routes land in one namespace:
 *
 *   1. replace anything outside `[a-zA-Z0-9._-]` with `_`
 *   2. take a trailing `.{1,16}` alphanumeric suffix, if present
 *   3. lowercase it
 */
export function normalizeExtension(filename: string): string {
  const safe = filename.replace(UNSAFE_NAME_CHARS, "_");
  const match = safe.match(TRAILING_EXTENSION);
  return match ? match[1]!.toLowerCase() : "";
}

/**
 * Derive the storage key. **The hub is authoritative** — a client calls this to
 * test its understanding, not to decide where bytes land.
 */
export function deriveBlobKey(sha256: string, filename?: string): string {
  const digest = sha256.toLowerCase();
  if (!SHA256_HEX_RE.test(digest)) {
    throw new Error(`blob-key: sha256 must be 64 lowercase hex characters, got "${sha256}"`);
  }
  const ext = filename ? normalizeExtension(filename) : "";
  return `${digest}${ext}`;
}

/** Split a key back into its digest and extension. */
export function parseBlobKey(key: string): { sha256: string; extension: string } | null {
  if (!BLOB_KEY_ACCEPT_RE.test(key)) return null;
  const dot = key.indexOf(".");
  return dot === -1
    ? { sha256: key, extension: "" }
    : { sha256: key.slice(0, dot), extension: key.slice(dot).toLowerCase() };
}
