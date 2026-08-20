# Conformance scenarios — what exists, what is missing, and what earns a place

`src/e2e-scenarios.ts` is where conformance scenarios live. The client runner
reads them; it does not hold any of its own. That is why the count sat at 18
while both sides believed the other could raise it: **a scenario added anywhere
but here is not a scenario the other implementation runs.**

## Where the 18 sit today

Measured by `clause`, against `SPEC.md` in `agent-mesh-platform`:

```
§ 8   hub JSON-RPC          11    send, ack, reminders, delivery
§ 10  bootstrap             4     provisioning, key approval
§ 11  identity/authorization 2
§ 12  groups                1
```

## Where they do not sit

Every section below has **zero** scenarios. This is the list to draw from, and
the reason the count is far from 100 without inventing anything:

```
§ 3   baseline contract          what every implementation must answer at all
§ 4   lanes (add-on)             the second transport, and what it may not change
§ 5   runtime-adapter            the interface a host implements
§ 6   channel-driver             the interface a transport implements
§ 7   core types                 shapes crossing the wire, and their refusals
§ 9   **HTTP REST contract**     the entire surface the admin console speaks to
§ 13  versioning                 what a client may assume from a version string
§ 14  rate limiting              the refusal that protects the mesh from a caller
§ 15  attachments pull-on-demand blob authorisation and expiry
```

**§ 9 is the largest hole and the most expensive one.** It is the section
`agent-mesh-platform`'s http server implements end to end — sessions, the agent
listing, admission, groups, grants, audit reads, the mailbox — and no conformance
scenario touches it. Its routes are also the ones that change most often, so the
part of the system with the highest churn has the least contract coverage.

## What earns a scenario its place

A scenario that passes tells you nothing on its own. Every one added here must
come with a mutation in the implementation it is meant to hold, and that mutation
must turn **that scenario** red:

```
add the scenario           it passes
break the behaviour        that scenario fails, by name
restore                    it passes again
```

If breaking the behaviour leaves it green, the scenario does not pass through the
code it claims to cover, and 100 of those are 100 things that run without
asserting anything. `agent-mesh-platform` keeps this discipline in
`scripts/mutation-check.ts`, whose manifest holds one mutation per checker for
the same reason.

Two failure modes that have already cost time here, both worth avoiding by
construction:

- **An anchor that matches nothing, or matches twice.** A mutation whose target
  string is gone measures nothing; one that appears twice measures whichever line
  came first, which is a verdict about a line nobody chose.
- **A one-sided assertion.** "A stranger must not appear" is satisfied by a route
  that returns nothing to anybody. Where a scenario asserts an absence, it must
  assert the matching presence in the same breath.

## Identifiers

`E2E-<AREA>-<NNN>`, three digits, area from the section it holds:
`KEY`, `SEND`, `ACK`, `GROUP`, `AUTH`, `REST`, `RATE`, `BLOB`, `LANE`, `TYPE`,
`VERSION`. Numbers are not reused when a scenario is retired — a retired id in a
log should not resolve to a different scenario later.

## Ownership

`agent-mesh-client` authors: the runner's schema is theirs and they measured
which files a seeded fault does and does not reach. `agent-mesh-platform` owns
this repository, reviews, and cuts the tag. Both pin the tag and run.

Adding scenarios does not extend the capability vocabulary. § 11's twelve names
are settled; a scenario exercises them, it does not add to them.
