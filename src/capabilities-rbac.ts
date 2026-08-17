/**
 * What a person is allowed to do (SPEC § 11).
 *
 * **Names, not roles.** A role is a bundle someone chose; a capability is the
 * thing a route needs. The set is expected to grow — platform operator, tenant
 * admin, group manager, agent manager, and more after those — and a design
 * that compares role strings inline gets one of them wrong on the fifth
 * addition. Routes ask for a capability over a scope; roles become rows.
 *
 * Scope is `*` for the whole tenant, or a group id, or a single identity.
 * A grant of `*` implies every narrower scope; a grant of one identity implies
 * nothing else.
 */

export const CAPABILITY = {
  /** Decide a proposed key (§ 10.2). The agent operator's own agents. */
  KEY_APPROVE: "key.approve",
  /** Destroy an identity (§ 9.3). Irreversible, and the name is never reusable. */
  AGENT_TEARDOWN: "agent.teardown",
  /** Create an identity and claim the name. */
  AGENT_PROVISION: "agent.provision",
  /** Move agents between groups; create and delete groups. */
  GROUP_MANAGE: "group.manage",
  /** Grant and revoke capabilities to others inside this tenant. */
  ROLE_GRANT: "role.grant",

  /**
   * Read the audit trail **without message content** — who, whom, when, how
   * much, what failed.
   *
   * The platform operator has this and not the one below. That is the whole
   * shape of § 11's privacy boundary, and it is the same line
   * `GET /api/v1/admin/inbox` already draws by reporting depth and withholding
   * bodies: seeing that someone has mail is a different authorisation question
   * from reading it.
   */
  AUDIT_READ_METADATA: "audit.read.metadata",
  /**
   * Read message bodies in the audit trail.
   *
   * Every use is itself recorded (§ 8.9.5). A tenant admin holding this is
   * defensible; holding it without the record is not, and the difference is
   * the only thing that makes it acceptable at all.
   */
  AUDIT_READ_CONTENT: "audit.read.content",
  /** Mailbox depth per identity. No bodies, ever, on any route it gates. */
  MAILBOX_READ_DEPTH: "mailbox.read.depth",
  /**
   * How much traffic a tenant received (§ 11.4).
   *
   * **Its own capability rather than folded into `audit.read.metadata`**, which
   * would have been the smaller change and the wrong one. The audit trail
   * answers *who did what*; this answers *how much arrived*. Somebody watching
   * capacity or billing has no need of the first, and somebody reviewing the
   * trail has no need of the second — and one capability answering both
   * questions is the shape § 11 exists to undo.
   *
   * It also starts held by nobody, which a reused capability could not: every
   * `audit.read.metadata` holder would have gained traffic figures the moment
   * the route appeared. Widening later is one `POST /api/v1/admin/grants`;
   * narrowing is taking something back from people who have already seen it.
   */
  TENANT_READ_STATS: "tenant.read.stats",
  /**
   * Where each identity has been observed connecting from (§ 8.11).
   *
   * Its own capability rather than folded into `audit.read.metadata`: this is
   * a network fact about a participant's hosts, and an operator who should see
   * queue depth or an audit trail is not automatically one who should learn
   * where every agent runs.
   */
  SOURCE_READ: "source.read",
} as const;

export type Capability = (typeof CAPABILITY)[keyof typeof CAPABILITY];

/** Every capability, for validating a grant before it is written. */
export const ALL_CAPABILITIES: ReadonlyArray<Capability> = Object.values(CAPABILITY);

/**
 * The scope that means "everything in this tenant".
 *
 * Spelled out rather than an empty string: a bug that produces `""` should not
 * silently become the widest possible grant.
 */
export const SCOPE_TENANT = "*" as const;

/**
 * What `admin` meant before § 11 existed.
 *
 * Deployments seeded before capabilities need to keep working, so the old role
 * becomes this grant set rather than a string still compared somewhere. It
 * deliberately **excludes nothing** — it is what `admin` could already do, and
 * narrowing it here would be a silent permission change dressed as a refactor.
 */
export const LEGACY_ADMIN_CAPABILITIES: ReadonlyArray<Capability> = ALL_CAPABILITIES;
