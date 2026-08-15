/**
 * Attachment metadata (SPEC § 15.2).
 *
 * Carried in a message body's `attachments` array and returned by
 * `POST /api/v1/upload`. The upload response is itself a valid metadata object,
 * so a client can attach it to a message unchanged.
 *
 * The fetcher that turns this into a local file — streaming, sha256
 * verification, atomic rename into a lane cache — is an implementation of
 * SPEC § 15.4 and lives with the lane components. This is only the shape.
 */

export interface AttachmentMeta {
  /**
   * Storage key. `<sha256>[.<ext>]` for anything uploaded since 0.1; the
   * pre-hash `<ts>-<safe-name>` form is still accepted for download.
   * Opaque to receivers — treat it as a token, never parse it for meaning.
   */
  id: string;
  /** Original client-supplied filename, for display. */
  name?: string;
  /** @deprecated Legacy alias of `name`. Read `name` first and fall back only if absent. */
  filename?: string;
  /** Best-effort. Receivers tolerate absence and fall back to `application/octet-stream`. */
  mime?: string;
  size?: number;
  /** Lowercase hex digest. Fetchers verify against it when present. */
  sha256?: string;
  /** Absolute URL resolving to `GET /api/v1/attachments/<id>` on the core VM. */
  download_url: string;
}

/**
 * `POST /api/v1/upload` returns a metadata object plus the time it landed.
 * `file_path` and `filename` may accompany it for legacy single-host clients;
 * new consumers read `id`, `download_url` and `name` only.
 */
export interface UploadResponse extends AttachmentMeta {
  name: string;
  mime: string;
  size: number;
  sha256: string;
  /** ISO-8601 UTC. */
  uploaded_at: string;
}

/**
 * Pull a SPEC § 15.2 attachments array out of a message body, or `null` when
 * there is not one. Accepts a parsed object or the JSON string of one, because
 * hub message content is a flat string that may or may not have been parsed
 * yet by the time a caller wants to look.
 */
export function extractAttachmentsMeta(body: unknown): AttachmentMeta[] | null {
  let parsed: unknown = body;
  if (typeof body === "string") {
    try {
      parsed = JSON.parse(body);
    } catch {
      return null;
    }
  }
  if (!parsed || typeof parsed !== "object") return null;

  const candidates = (parsed as { attachments?: unknown }).attachments;
  if (!Array.isArray(candidates)) return null;

  const out: AttachmentMeta[] = [];
  for (const item of candidates) {
    if (
      item &&
      typeof item === "object" &&
      typeof (item as AttachmentMeta).id === "string" &&
      typeof (item as AttachmentMeta).download_url === "string"
    ) {
      out.push(item as AttachmentMeta);
    }
  }
  return out.length > 0 ? out : null;
}
