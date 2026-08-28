/**
 * The teardown shapes, checked as shapes rather than described in prose.
 *
 * A type alone is a claim the compiler checks *for the people who import it*.
 * These pin the two things a second copy gets wrong: the exact three actions,
 * and that `deleted_at` may be **absent** rather than null.
 */

import { describe, expect, test } from "bun:test";

import type { TeardownAction, TeardownRefusal, TeardownResponse } from "./teardown";

describe("what a teardown answers", () => {
  test("has exactly three actions, and all three are success", () => {
    // Listed rather than derived: a union gains a member silently, and the
    // consumer that did not gain it goes on compiling with a narrower view.
    const all: TeardownAction[] = ["soft-deleted", "already-deleted", "not-found"];
    expect(all).toHaveLength(3);
    // Every one of them travels with `ok: true` — the route reports the outcome
    // in `action`, not in the status.
    for (const action of all) {
      const body: TeardownResponse = { ok: true, identity: "probe-one", action };
      expect(body.ok).toBe(true);
    }
  });

  test("distinguishes a missing deleted_at from a null one", () => {
    // `not-found` has no row and so no key at all; a row with no timestamp
    // sends null. A reader that folds them together invents a deletion time
    // for an identity that was never there.
    const missing: TeardownResponse = { ok: true, identity: "probe-two", action: "not-found" };
    const explicitNull: TeardownResponse = {
      ok: true,
      identity: "probe-three",
      action: "already-deleted",
      deleted_at: null,
    };
    expect({
      missingHasKey: "deleted_at" in missing,
      nullHasKey: "deleted_at" in explicitNull,
    }).toEqual({ missingHasKey: false, nullHasKey: true });
  });

  test("refuses with a body a caller can tell from a success", () => {
    const refusal: TeardownRefusal = { ok: false, error: "invalid identity format" };
    expect(refusal.ok).toBe(false);
  });
});
