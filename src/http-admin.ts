/**
 * Refusal codes the platform's **REST admin surface** answers with, and the
 * one vocabulary a `200` from it carries.
 *
 * These are not JSON-RPC `error.data.code`: nothing on the mesh wire carries
 * them, and a client that only speaks to the hub never sees one. They travel in
 * HTTP bodies to an operator console, which is a different codebase from the
 * one that emits them — and that is the whole reason they are here.
 *
 * `PROVISION_ERROR` (§ 10.1) is the same shape and has been in this package
 * since before the console existed; it is the precedent this follows rather
 * than an exception it breaks.
 *
 * **Why they were not here until now.** D-740 measured the question in
 * 2026-08 and answered "no tag": no repository read any of them as a string,
 * the console classified by status alone, and a vocabulary nobody reads buys
 * ceremony. What changed is not one repository branching on a code — it is that
 * the platform's admin surface grew five more of them in one cycle (T-026's
 * tenant routes), so the list is now long enough that the console *choosing* to
 * read one is a question of when. Naming them costs a constant; discovering
 * them one refusal at a time costs an operator.
 *
 * Each entry says the route, the status, and whether a retry can succeed. A
 * caller that cannot tell permanent from transient either retries forever or
 * discards a refusal that would have cleared.
 */
export const HTTP_ADMIN_ERROR = {
  /** `POST /api/v1/admin/agent-types`, the name is taken. 409. Permanent. */
  TYPE_EXISTS: "TYPE_EXISTS",
  /**
   * `DELETE /api/v1/admin/agent-types/{type}`, agents still declare it. 409.
   *
   * Transient in the only sense that matters: it clears when the agents that
   * name the type are gone, which is somebody's work rather than a retry.
   */
  TYPE_IN_USE: "TYPE_IN_USE",
  /**
   * `GET /api/v1/admin/chat-audits/agents`, the audit store did not answer.
   * 503. **Transient** — who appears in the audit is unknown, not empty, and
   * the distinction is the point of the code (D-736).
   */
  AUDIT_AGENTS_UNAVAILABLE: "AUDIT_AGENTS_UNAVAILABLE",
  /**
   * Any content read whose access record could not be written (§ 11.0.1). 503.
   * **Transient.** The read is refused *because* the record failed: a content
   * read that is not recorded is the one thing this surface must not do, so it
   * fails closed and says so.
   */
  AUDIT_READ_UNRECORDABLE: "AUDIT_READ_UNRECORDABLE",
  /**
   * `DELETE /api/v1/admin/grants`, the last account holding `role.grant`. 409.
   * Permanent while it is the last one: revoking it leaves a deployment where
   * nobody can grant anything, including the grant that would undo this.
   */
  LAST_GRANTOR: "LAST_GRANTOR",
  /**
   * `DELETE /api/v1/admin/grants`, the subject is an administrator account
   * (D-746). 409. Permanent.
   */
  PROTECTED_ACCOUNT: "PROTECTED_ACCOUNT",
  /**
   * The `/api/v1/admin/tenants` routes, from a session that is not a platform
   * administrator. 403. Permanent for that session.
   *
   * The role rather than a capability, because the capability vocabulary has no
   * `tenant.manage` — the twelve names in `capabilities.ts` are the whole of
   * it, and inventing a thirteenth in an implementation is how a vocabulary
   * stops being a contract.
   */
  PLATFORM_ADMIN_ONLY: "PLATFORM_ADMIN_ONLY",
  /**
   * `POST /api/v1/admin/tenants`, the id is taken — **including by a
   * soft-deleted tenant**. 409. Permanent.
   *
   * A deleted tenant's id stays taken because traffic rows and accounts still
   * name it, and handing it to somebody else would attribute those rows to
   * them. The `error` string says which of the two it is; the code does not,
   * because a caller does the same thing either way.
   */
  TENANT_EXISTS: "TENANT_EXISTS",
  /**
   * `DELETE /api/v1/admin/tenants/{id}` for the seeded `default` tenant. 409.
   * Permanent. Every row that was never given a tenant points at it.
   */
  DEFAULT_TENANT: "DEFAULT_TENANT",
  /**
   * `POST /api/v1/admin/users` naming a tenant the actor does not administer.
   * 403. Permanent for that actor.
   */
  TENANT_NOT_YOURS: "TENANT_NOT_YOURS",
  /**
   * `POST /api/v1/admin/users` naming a tenant that does not exist. 400 — the
   * request is malformed rather than refused, and the two carry different
   * advice: a caller that reads this as a refusal asks an operator for
   * permission it already has.
   */
  NO_SUCH_TENANT: "NO_SUCH_TENANT",
} as const;

export type HttpAdminErrorCode = (typeof HTTP_ADMIN_ERROR)[keyof typeof HTTP_ADMIN_ERROR];

/**
 * Why a grant in `GET /api/v1/admin/grants` cannot be revoked (D-746).
 *
 * A field of a `200`, not a refusal: the matrix lists every grant with
 * `revocable` and, when it is false, one of these. The console draws the
 * control disabled and says which rule holds it, so an operator is not left
 * clicking a button that answers `409`.
 *
 * **Lower case, and deliberately not the refusal code.** The `409` a revoke
 * attempt earns is `LAST_GRANTOR` or `PROTECTED_ACCOUNT`; these are the same
 * two rules read from the list rather than from an attempt. Spelling them
 * identically would invite code that switches on one and is handed the other.
 */
export const IMMUTABLE_REASON = {
  /** Revoking it would leave nobody holding `role.grant`. */
  LAST_GRANTOR: "last_grantor",
  /** The subject is an administrator account. */
  PROTECTED_ACCOUNT: "protected_account",
} as const;

export type ImmutableReason = (typeof IMMUTABLE_REASON)[keyof typeof IMMUTABLE_REASON];
