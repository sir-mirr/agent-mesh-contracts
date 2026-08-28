/**
 * What `POST /api/v1/admin/agents/{identity}/teardown` answers (SPEC § 9.3).
 *
 * **A soft delete.** `deleted_at` is set, every key of the identity is revoked,
 * and messages are left alone — hard deletion would make every past signature
 * permanently unverifiable, which is the property signing exists for, and would
 * let a later registration inherit the previous holder's history.
 *
 * All three actions are success. The route is idempotent, so a caller that
 * retries after a lost response gets the same answer with a different action,
 * and **a screen that treats anything but `soft-deleted` as a failure will
 * report a completed teardown as broken.**
 *
 * ## Why these live here
 *
 * The platform has had them since teardown was written, in
 * `packages/store/src/teardown.ts`, and the console carried a second copy with
 * a comment saying it was temporary "until teardown is published from the
 * contracts package". Two copies of a three-literal union is two chances for
 * one of them to gain a fourth member — and the copy that did not would go on
 * compiling, narrowing what the console can see rather than failing.
 */

/**
 * What the teardown did.
 *
 * - `soft-deleted` — this call set `deleted_at` and revoked the keys.
 * - `already-deleted` — the identity was already torn down. Not an error.
 * - `not-found` — no such identity. Also not an error: a teardown of something
 *   that is not there has the outcome the caller asked for.
 */
export type TeardownAction = "soft-deleted" | "already-deleted" | "not-found";

/** The `200` body. */
export interface TeardownResponse {
  ok: true;
  identity: string;
  action: TeardownAction;
  /**
   * When the identity was torn down, in RFC 3339.
   *
   * **Absent for `not-found`**, and absent is not the same as `null`: the route
   * omits the key entirely when there is no row to have a timestamp, while a
   * row whose `deleted_at` is null sends `null`. A reader that defaults the
   * missing key to "now" invents a deletion time, which is the shape `I-062`
   * had.
   */
  deleted_at?: string | null;
}

/** The refusal body, for a malformed identity (400) or a store error (500). */
export interface TeardownRefusal {
  ok: false;
  error: string;
}
