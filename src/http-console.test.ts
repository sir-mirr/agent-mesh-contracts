/**
 * The fixtures and the route table have to agree, or neither is evidence.
 *
 * These types describe answers a server sends. Nothing here can reach that
 * server, so what a test in this package can honestly check is narrower than
 * "the contract is right": it can check that the two artefacts a consumer reads
 * — the route table and the recorded bodies — say the same thing, and that the
 * fields this project has already asked for and not received stay absent.
 *
 * The part no test here can do is confirm the bodies still look like this. That
 * is `test/console-contract.test.ts` in the platform repository, which has the
 * routes.
 */
import { describe, expect, test } from "bun:test";

import { CONSOLE_RESPONSE_FIXTURES } from "../fixtures/index";
import { CONSOLE_FIELDS_THAT_DO_NOT_EXIST, CONSOLE_READ_ROUTES } from "./http-console";

describe("the console read routes", () => {
  test("the table and the fixtures cover the same paths", () => {
    // Either one growing without the other is how a route ends up described in
    // one place and demonstrated in neither.
    const table = CONSOLE_READ_ROUTES.map((r) => r.path).sort();
    const fixtures = CONSOLE_RESPONSE_FIXTURES.map((f) => f.path).sort();
    expect(fixtures).toEqual(table);
    expect(new Set(table).size, "a path is listed twice").toBe(table.length);
  });

  test("each fixture carries the envelope its route declares", () => {
    for (const fixture of CONSOLE_RESPONSE_FIXTURES) {
      const route = CONSOLE_READ_ROUTES.find((r) => r.path === fixture.path);
      expect(route, `${fixture.path} is not in the route table`).toBeDefined();
      expect(fixture.envelope, `${fixture.path} envelope`).toBe(route!.envelope);
      expect(fixture.listKey, `${fixture.path} list key`).toBe(route!.listKey);
      // The envelope is the thing a reader guesses wrong: three of these
      // answer `ok`, one answers `status`, and two answer neither.
      expect("ok" in fixture.body, `${fixture.path} ok`).toBe(route!.envelope === "ok");
      expect("status" in fixture.body, `${fixture.path} status`).toBe(route!.envelope === "status");
    }
  });

  test("the list key holds an array, and only where the route has one", () => {
    for (const fixture of CONSOLE_RESPONSE_FIXTURES) {
      if (fixture.listKey === null) {
        expect(
          Object.values(fixture.body).some(Array.isArray),
          `${fixture.path} answers a single object but its fixture has an array`,
        ).toBe(false);
        continue;
      }
      expect(Array.isArray(fixture.body[fixture.listKey]), `${fixture.path}.${fixture.listKey}`).toBe(true);
      expect((fixture.body[fixture.listKey] as unknown[]).length, `${fixture.path} lists nothing`).toBeGreaterThan(0);
    }
  });

  test("no fixture carries a field its route has never sent", () => {
    // The point of the whole file. `apiClient<any>` answered `undefined` for
    // each of these and the screen drew the undefined as calm.
    for (const fixture of CONSOLE_RESPONSE_FIXTURES) {
      expect(fixture.neverSent.length, `${fixture.path} names nothing it does not send`).toBeGreaterThan(0);
      const rows = fixture.listKey ? (fixture.body[fixture.listKey] as Record<string, unknown>[]) : [];
      for (const field of fixture.neverSent) {
        expect(field in fixture.body, `${fixture.path} body carries '${field}'`).toBe(false);
        for (const row of rows) {
          expect(field in row, `a ${fixture.path} row carries '${field}'`).toBe(false);
        }
      }
    }
  });

  test("every field the project asked for and did not get is on a real route, with a real replacement", () => {
    for (const wrong of CONSOLE_FIELDS_THAT_DO_NOT_EXIST) {
      const fixture = CONSOLE_RESPONSE_FIXTURES.find((f) => f.path === wrong.path);
      expect(fixture, `${wrong.path} is not a route this package describes`).toBeDefined();
      expect(
        fixture!.neverSent.includes(wrong.asked),
        `${wrong.path} does not list '${wrong.asked}' among the names it never sends`,
      ).toBe(true);
      // The replacement has to be somewhere a reader can reach it: the body, or
      // a row of the list. A pointer to a field that is also absent is worse
      // than no pointer — it reads as checked.
      const rows = fixture!.listKey ? (fixture!.body[fixture!.listKey] as Record<string, unknown>[]) : [];
      const reachable = wrong.instead in fixture!.body || rows.some((row) => wrong.instead in row);
      expect(reachable, `'${wrong.instead}' is not on ${wrong.path} either`).toBe(true);
    }
  });

  test("the agent row has no status, which is the one this list is asked for most", () => {
    // Named on its own rather than left to the loop above. § 9.1 says the route
    // has no `status` because whether silence means `inactive` is an operating
    // policy — and a screen that invents one draws every agent as online.
    const agents = CONSOLE_RESPONSE_FIXTURES.find((f) => f.path === "/api/v1/agents")!;
    const row = (agents.body.agents as Record<string, unknown>[])[0]!;
    expect("status" in row).toBe(false);
    expect("last_seen_at" in row).toBe(true);
    expect(row.last_seen_at, "null means no presence record, not offline").toBeNull();
  });
});
