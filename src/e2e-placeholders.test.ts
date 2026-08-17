/**
 * Every `{{name}}` in the scenario data resolves, and it resolves in the only
 * way a runner can be asked to find it: by walking the whole step.
 *
 * ## What happened without this
 *
 * The module note used to say substitution applied to a step's `path`, `body`
 * or `expect.body` — a list of three. `E2E-REPLY-001` puts `{{mailId}}` in
 * `replyTo`, which is a fourth. A runner built from the list sent the literal
 * `{{mailId}}` to the mesh; the mesh, correctly, found no message with that id,
 * so the send was not a reply, so it routed as an ordinary send and was pushed.
 * The scenario failed on a push count.
 *
 * **The failure pointed at the hub.** That is the part worth a test: not that a
 * field was missed, but that missing it produced a red run accusing the wrong
 * repository. The other runner passed the whole time, because its
 * implementation walked everything and was therefore wider than the sentence
 * describing it.
 *
 * ## Why the check walks rather than enumerates
 *
 * A list of fields here would be a third copy of the same fact, drifting behind
 * the verb set exactly as the first two did. The walk below has no list in it,
 * so a verb added tomorrow with a new string field is covered the day it lands
 * and nobody has to remember this file exists.
 *
 * ## What it cannot catch
 *
 * It cannot tell whether a *runner* substitutes everywhere — that lives in two
 * other repositories. It catches the half that belongs here: a name used before
 * anything binds it, a name nothing binds at all, and a binding nobody reads.
 * The first is what a typo looks like; the last is what a deleted step leaves
 * behind.
 */

import { describe, expect, test } from "bun:test";
import { E2E_SCENARIOS, type Scenario, type Step } from "./e2e-scenarios";

const PLACEHOLDER = /\{\{([^}]+)\}\}/g;

/** Every `{{name}}` in any string anywhere under `value`. No field list. */
function referencesIn(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") {
    for (const m of value.matchAll(PLACEHOLDER)) out.push(m[1]!);
    return out;
  }
  if (Array.isArray(value)) {
    for (const v of value) referencesIn(v, out);
    return out;
  }
  if (value && typeof value === "object") {
    for (const v of Object.values(value)) referencesIn(v, out);
  }
  return out;
}

/**
 * `fingerprint:<identity>` is pre-bound by every runner when it generates that
 * identity's key — the value exists in the runner and in no response, so no
 * step can bind it and its absence here is not a defect.
 */
const isPreBound = (name: string) => name.startsWith("fingerprint:");

const bindsOf = (step: Step): string[] =>
  Object.keys((step as { bind?: Record<string, string> }).bind ?? {});

describe("every reference resolves", () => {
  // One test per scenario: a failure names the scenario without the reader
  // having to count steps, and one broken scenario does not hide the others.
  for (const scenario of E2E_SCENARIOS) {
    test(`${scenario.id} binds every name it uses, before using it`, () => {
      const bound = new Set<string>();
      scenario.steps.forEach((step, i) => {
        for (const name of referencesIn(step)) {
          if (isPreBound(name)) continue;
          expect(
            bound.has(name),
            `${scenario.id} step ${i} (${step.do}) uses {{${name}}}, which nothing bound before it`,
          ).toBe(true);
        }
        // After, not before: a step cannot refer to what it is itself binding,
        // because the value does not exist until the response comes back.
        for (const name of bindsOf(step)) bound.add(name);
      });
    });
  }
});

describe("the set as a whole", () => {
  test("no binding goes unread", () => {
    // A `bind` nobody reads is either a leftover from a deleted step or the
    // other half of a typo — and a typo shows up here *and* above, which is how
    // you tell the two apart.
    const unread: string[] = [];
    for (const scenario of E2E_SCENARIOS) {
      const used = new Set(scenario.steps.flatMap((s) => referencesIn(s)));
      for (const step of scenario.steps) {
        for (const name of bindsOf(step)) {
          if (!used.has(name)) unread.push(`${scenario.id}: {{${name}}}`);
        }
      }
    }
    expect(unread, `bound and never used: ${unread.join(", ")}`).toEqual([]);
  });

  test("the walk reaches a field no enumeration would have listed", () => {
    // The regression itself, stated as data rather than as prose. `replyTo` is
    // the field the old three-item list missed; if a rewrite ever narrows the
    // walk back to `path`/`body`/`expect.body`, this is what says so.
    const reply = E2E_SCENARIOS.find((s: Scenario) => s.id === "E2E-REPLY-001");
    expect(reply, "E2E-REPLY-001 is gone — this check was written around it").toBeDefined();

    const inReplyTo = reply!.steps.filter(
      (s) => typeof (s as { replyTo?: unknown }).replyTo === "string"
        && (s as { replyTo: string }).replyTo.includes("{{"),
    );
    expect(inReplyTo.length).toBeGreaterThan(0);

    // And it is genuinely outside path/body/expect.body — otherwise this test
    // would pass under the narrow walk too, which is the failure shape it exists
    // to prevent.
    const narrow = (step: Step) =>
      referencesIn([
        (step as { path?: unknown }).path,
        (step as { body?: unknown }).body,
        (step as { expect?: { body?: unknown } }).expect?.body,
      ]);
    for (const step of inReplyTo) {
      expect(
        referencesIn(step).length,
        "a narrow walk finds as much as the full one here — the case is no longer covered",
      ).toBeGreaterThan(narrow(step).length);
    }
  });
});
