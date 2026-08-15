/**
 * Reminder schedules (SPEC § 3.3, § 8.5).
 *
 * `mesh.schedule_reminder` carries a `type` and an opaque `schedule_spec`
 * string. The type decides how the daemon advances the row after each fire, and
 * the spec is what it advances *by* — so the two have to be read the same way
 * on both sides or a reminder scheduled by a client fires on a cadence the
 * client never asked for.
 *
 * This module is that shared reading. It lives in contracts rather than in the
 * daemon because the caller has to resolve `next_fire_at` before it can send
 * the request, which means the caller is already parsing the spec: § 8.5 puts
 * the first fire time on the wire and leaves subsequent ones to the daemon. Two
 * independent parsers for one grammar is two chances to disagree about what
 * `"1d"` means, and the disagreement only shows up on the second fire.
 *
 * ### The forms
 *
 * | `type`     | `schedule_spec`                              | Repeats |
 * |------------|----------------------------------------------|---------|
 * | `once`     | `{"in":"30s"}` or `{"at":"2026-04-18T09:00:00Z"}` | no  |
 * | `interval` | `{"every":"15m"}`                            | yes     |
 * | `cron`     | `{"cron":"0 9 * * *","tz":"Asia/Seoul"}`     | yes     |
 *
 * `once` accepts both § 3.3 forms because both resolve to a single absolute
 * time and the daemon never has to advance them; which one the caller used is
 * kept only so `mesh.list_reminders` can show what was asked for.
 */

/** The three reminder types § 8.5 admits. */
export const REMINDER_TYPES = ["once", "interval", "cron"] as const;
export type ReminderType = (typeof REMINDER_TYPES)[number];

export function isReminderType(value: unknown): value is ReminderType {
  return typeof value === "string" && (REMINDER_TYPES as readonly string[]).includes(value);
}

/**
 * `<positive integer><s|m|h|d>` — the § 3.3 duration grammar.
 *
 * Deliberately small. Months and years are not here because their length
 * depends on when you ask, and a reminder that drifts by three days depending
 * on the month it was scheduled in is a bug report nobody can reproduce. `cron`
 * covers calendar-aligned repetition, which is what those units are usually
 * reaching for.
 */
export const DURATION_RE = /^([1-9][0-9]*)(s|m|h|d)$/;

const UNIT_MS: Record<string, number> = {
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

/** Milliseconds for a duration like `"30s"`, or `null` if it is not one. */
export function parseDuration(value: string): number | null {
  const match = DURATION_RE.exec(value);
  if (!match) return null;
  return Number(match[1]) * UNIT_MS[match[2]!]!;
}

export interface OnceSchedule {
  type: "once";
  /** Absolute fire time, resolved from whichever form was supplied. */
  at: Date;
}

export interface IntervalSchedule {
  type: "interval";
  /** Gap between fires, in milliseconds. Always > 0. */
  everyMs: number;
}

export interface CronSchedule {
  type: "cron";
  cron: string;
  /** IANA zone. Defaults to `UTC`, which is what an omitted `tz` means. */
  tz: string;
}

export type ParsedSchedule = OnceSchedule | IntervalSchedule | CronSchedule;

export type ScheduleParseResult =
  | { ok: true; schedule: ParsedSchedule }
  | { ok: false; reason: string };

/**
 * Read a `schedule_spec` against its declared `type`.
 *
 * Returns a reason rather than throwing: every caller of this is deciding
 * whether to refuse a request, and the reason is what goes in the error message
 * (SPEC § 8.5 `-32602`). The reason names the field, never the value — a spec
 * is caller-supplied and echoing it back into a log is how caller-controlled
 * text ends up in an operator's terminal.
 *
 * `now` is injected so a relative `{"in":...}` resolves against the caller's
 * clock at the moment of the request rather than at parse time.
 */
export function parseScheduleSpec(
  type: string,
  spec: string,
  now: Date = new Date(),
): ScheduleParseResult {
  if (!isReminderType(type)) {
    return { ok: false, reason: `type must be one of ${REMINDER_TYPES.join(", ")}` };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(spec);
  } catch {
    return { ok: false, reason: "schedule_spec must be a JSON object" };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, reason: "schedule_spec must be a JSON object" };
  }
  const obj = parsed as Record<string, unknown>;

  switch (type) {
    case "once": {
      if (typeof obj.in === "string") {
        const ms = parseDuration(obj.in);
        if (ms === null) return { ok: false, reason: `"in" must match ${DURATION_RE.source}` };
        return { ok: true, schedule: { type: "once", at: new Date(now.getTime() + ms) } };
      }
      if (typeof obj.at === "string") {
        const at = new Date(obj.at);
        if (Number.isNaN(at.getTime())) return { ok: false, reason: `"at" must be an ISO-8601 instant` };
        return { ok: true, schedule: { type: "once", at } };
      }
      return { ok: false, reason: `a "once" schedule_spec needs "in" or "at"` };
    }

    case "interval": {
      if (typeof obj.every !== "string") {
        return { ok: false, reason: `an "interval" schedule_spec needs "every"` };
      }
      const everyMs = parseDuration(obj.every);
      if (everyMs === null) return { ok: false, reason: `"every" must match ${DURATION_RE.source}` };
      return { ok: true, schedule: { type: "interval", everyMs } };
    }

    case "cron": {
      if (typeof obj.cron !== "string" || obj.cron.trim() === "") {
        return { ok: false, reason: `a "cron" schedule_spec needs "cron"` };
      }
      if (obj.tz !== undefined && typeof obj.tz !== "string") {
        return { ok: false, reason: `"tz" must be an IANA zone name` };
      }
      // The expression itself is not validated here. Parsing cron needs a cron
      // library, and putting one in contracts would push it onto every consumer
      // of this package — most of which never schedule anything. The daemon
      // validates it when it advances, and § 8.5 already marks a row `dead` on
      // a spec it cannot parse.
      return { ok: true, schedule: { type: "cron", cron: obj.cron, tz: (obj.tz as string) ?? "UTC" } };
    }
  }
}

/**
 * The next fire time for an interval reminder.
 *
 * Aligned to the original schedule rather than to now: a reminder set for
 * `:00` on a 15-minute interval stays on `:00 :15 :30 :45` even if the daemon
 * was down for an hour and fired it late. Advancing by `everyMs` from the
 * moment of the late fire would walk the schedule off its grid permanently, and
 * every outage would move it again.
 *
 * The result is always strictly after `now`, so an outage produces one catch-up
 * fire and then resumes — not one fire per missed slot. Replaying every missed
 * slot is the operator-approved path in § 8.5's overdue handling, not something
 * that should happen by default at 3am after a long weekend.
 */
export function nextIntervalFire(scheduledFor: Date, everyMs: number, now: Date): Date {
  if (!(everyMs > 0)) throw new Error("schedule: interval must be greater than zero");
  const elapsed = now.getTime() - scheduledFor.getTime();
  // `floor + 1` rather than `ceil`: when the fire lands exactly on its slot,
  // `ceil` returns that same slot and the reminder would fire in a tight loop.
  const steps = elapsed < 0 ? 1 : Math.floor(elapsed / everyMs) + 1;
  return new Date(scheduledFor.getTime() + steps * everyMs);
}
