# @agent-mesh/contracts

The executable half of the Agent Mesh wire contract: types, constants, and
fixtures that two implementations can be checked against.

`SPEC.md` in [agent-mesh-platform](https://github.com/sir-mirr/agent-mesh-platform)
is the normative description — it says what the protocol *is*. This repository
is what you can run: the same rules as code, plus the byte-level fixtures that
prove an implementation reads them the same way.

Targets **SPEC 0.2** (`agentMeshSpec` in `package.json`).

## Install

Delivered as an immutable Git tag. There is no registry publish, so no scope
ownership to settle and no token in CI — the repository is public.

```json
{
  "dependencies": {
    "@agent-mesh/contracts": "github:sir-mirr/agent-mesh-contracts#v0.2.0"
  }
}
```

The lockfile pins the commit the tag resolved to. Tags are protected and never
moved once published; a correction ships as a new tag.

## No build step

`exports` points at TypeScript source. Both consumers run Bun with TypeScript 7,
so there is nothing to compile, no `prepare` hook, and no `dist/` to keep in
sync with the source it came from.

```ts
import { requestSignaturePreimage, MESH_ERROR, deriveBlobKey } from "@agent-mesh/contracts";
import { REQUEST_SIGNATURE_FIXTURES } from "@agent-mesh/contracts/fixtures";
```

An implementation in another language reads `fixtures/` as data and ignores the
rest.

## What is here

| Module | Contents |
|--------|----------|
| `signature` | Request and upload signing preimages, freshness window, `AgentMeshSig` header |
| `blob-key` | `<sha256>[.<ext>]` derivation and the filename normalisation behind it |
| `audit` | Capability advertisement, event types, `event_id` format, append and prepare shapes |
| `attachment` | `AttachmentMeta` (§ 15.2), upload response shape, extraction from a message body |
| `errors` | Error codes, and how a client must classify each one |
| `envelope`, `tool-contract`, `capabilities`, `ownership`, `registry`, `history`, `action-proxy`, `hub` | Core mesh types |

## What is not

No database, filesystem, routing, authentication or outbox implementation.
Those belong to the hub and to the client, and each is free to build them
differently as long as the bytes agree.

`@agent-mesh/shared-attachments` — the lane-side pull-on-demand fetcher — is an
implementation of the § 15.4 contract, not the contract itself, and lives with
the lane components.

## Why fixtures rather than prose

The signing preimage is length-prefixed precisely so that field boundaries
cannot be misread. That property is worth nothing if two implementations
disagree about which bytes go in, and prose does not catch that — the fixtures
in this repository each carry a hand-computed length alongside the expected
hex, and both were wrong the first time they were written. The tests caught it.

Run them:

```bash
bun install
bun test
bun run typecheck
```

## Versioning

| Change | SemVer |
|--------|--------|
| Wording, internal edits, no contract change | patch |
| Optional field, compatible method or event added | minor |
| Required field changed, meaning changed, method removed | major |

Four version numbers exist and are deliberately independent:

- this package's SemVer,
- `agentMeshSpec` — the SPEC document version it targets,
- `capabilities.audit.version` — the audit protocol, negotiated at `mesh.connect`,
- `schema_version` — stamped on each stored audit event, and how a years-old
  record is read back.

## Changing the contract

1. Change SPEC in `agent-mesh-platform` first — it is the normative text.
2. Bring the schema and fixtures here into line.
3. Both implementations' CI passes against the change.
4. Tag.

## License

MIT © 2026 Sir-Mirr

## `@agent-mesh/contracts/schema`

Runtime validation schemas, behind a subpath so the index stays free of the
TypeBox import — most consumers encode and decode without validating, and should
not carry a validator to do it.

```ts
import { Value } from "@sinclair/typebox/value";
import { ProvisionAgentRequest } from "@agent-mesh/contracts/schema";

Value.Check(ProvisionAgentRequest, body);
```

TypeBox because a schema **is** a JSON Schema object at runtime, so
`JSON.stringify` hands a non-TypeScript implementation the same contract with
nothing compiled. This package ships source and has no build step; a library
needing a generation pass to emit JSON Schema would have introduced one.

The schemas validate **shape, not policy**. Whether a `type` exists, whether an
identity is taken, whether a key is approved — the hub answers those against its
own state. In particular `type` is a plain non-empty string and deliberately not
an enum: it is resolved against the `agent_types` table at runtime, and freezing
the seeded set here would reintroduce what removing the hardcoded enum fixed.

## Key fingerprints

`keyFingerprint()` produces `sha256:<base64url>` over the **raw 32 key bytes**.

This one is worth taking from here rather than reimplementing. A fingerprint is
what an operator compares between a lane's startup log and the approval surface,
and hashing the base64url text instead of the bytes it encodes produces a
perfectly well-formed fingerprint of the wrong thing. The two disagree in
silence, and the operator reads the mismatch as a wrong key. `KEY_FINGERPRINT_FIXTURES`
pins it.
