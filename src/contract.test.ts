import { describe, expect, test } from "bun:test";

import {
  BLOB_KEY_FIXTURES,
  EVENT_ID_FIXTURES,
  REQUEST_SIGNATURE_FIXTURES,
  UPLOAD_AUTHORIZATION_FIXTURES,
  UPLOAD_SIGNATURE_FIXTURES,
  INTERVAL_ADVANCE_FIXTURES,
  SCHEDULE_SPEC_FIXTURES,
} from "../fixtures/index";
import { deriveBlobKey, normalizeExtension, parseBlobKey } from "./blob-key";
import { extractAttachmentsMeta } from "./attachment";
import { isValidEventId } from "./audit";
import { ERROR_CLASS, MESH_ERROR, RETIRED_ERROR_CODES } from "./errors";
import { MAILBOX_CAPABILITY_DEFAULTS, MAILBOX_ERROR, PROVISION_ERROR } from "./mailbox";
import { nextIntervalFire, parseDuration, parseScheduleSpec } from "./schedule";
import {
  formatUploadAuthorization,
  parseUploadAuthorization,
  requestSignaturePreimage,
  uploadSignaturePreimage,
} from "./signature";
import { createHash } from "node:crypto";
import { Value } from "@sinclair/typebox/value";
import { keyFingerprint, parsePublicKey, FINGERPRINT_RE, IDENTITY_RE } from "./key";
import {
  ProvisionAgentRequest, MeshMessageParams, MeshConnectParams,
  MeshSendParams, MeshReceiveParams, MeshReceiveResult,
} from "./schema/index";
import type { MeshSendIdempotency } from "./mailbox";
import { KEY_FINGERPRINT_FIXTURES } from "../fixtures/index";

const hex = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

describe("request signature preimage", () => {
  for (const f of REQUEST_SIGNATURE_FIXTURES) {
    test(f.name, () => {
      const preimage = requestSignaturePreimage({
        method: f.method,
        kid: f.kid,
        nonce: f.nonce,
        iat: f.iat,
        rawParams: new TextEncoder().encode(f.rawParams),
      });
      expect(preimage.length).toBe(f.preimageLength);
      expect(hex(preimage)).toBe(f.preimageHex);
    });
  }

  test("changing the method changes the preimage — a signature cannot be moved between methods", () => {
    const base = { kid: "k", nonce: "n", iat: 1, rawParams: new Uint8Array([0x7b, 0x7d]) };
    expect(hex(requestSignaturePreimage({ ...base, method: "mesh.send" })))
      .not.toBe(hex(requestSignaturePreimage({ ...base, method: "mesh.audit.append" })));
  });

  test("changing the nonce changes the preimage — a signature cannot be replayed with a fresh one", () => {
    const base = { method: "mesh.send", kid: "k", iat: 1, rawParams: new Uint8Array() };
    expect(hex(requestSignaturePreimage({ ...base, nonce: "a" })))
      .not.toBe(hex(requestSignaturePreimage({ ...base, nonce: "b" })));
  });

  test("field boundaries are unambiguous — no split of the same characters collides", () => {
    const raw = new Uint8Array();
    const left = requestSignaturePreimage({ method: "ab", kid: "c", nonce: "n", iat: 1, rawParams: raw });
    const right = requestSignaturePreimage({ method: "a", kid: "bc", nonce: "n", iat: 1, rawParams: raw });
    expect(hex(left)).not.toBe(hex(right));
  });

  test("rejects a non-integer iat rather than encoding it ambiguously", () => {
    expect(() =>
      requestSignaturePreimage({ method: "m", kid: "k", nonce: "n", iat: 1.5, rawParams: new Uint8Array() }),
    ).toThrow();
  });
});

describe("upload signature preimage", () => {
  for (const f of UPLOAD_SIGNATURE_FIXTURES) {
    test(f.name, () => {
      const preimage = uploadSignaturePreimage({
        nonce: f.nonce,
        blobKey: f.blobKey,
        sha256: f.sha256,
        size: f.size,
      });
      expect(preimage.length).toBe(f.preimageLength);
      expect(hex(preimage)).toBe(f.preimageHex);
    });
  }

  test("uses a different domain than the request preimage", () => {
    // Same trailing material must not produce the same bytes under both schemes.
    const upload = uploadSignaturePreimage({ nonce: "n", blobKey: "k", sha256: "s", size: 1 });
    const request = requestSignaturePreimage({
      method: "n", kid: "k", nonce: "s", iat: 1, rawParams: new Uint8Array(),
    });
    expect(hex(upload)).not.toBe(hex(request));
  });

  test("changing blob_key changes the preimage — a grant cannot be redirected", () => {
    const base = { nonce: "n", sha256: "s", size: 1 };
    expect(hex(uploadSignaturePreimage({ ...base, blobKey: "a" })))
      .not.toBe(hex(uploadSignaturePreimage({ ...base, blobKey: "b" })));
  });
});

describe("upload authorization header", () => {
  for (const f of UPLOAD_AUTHORIZATION_FIXTURES) {
    test(`formats and round-trips ${f.kid}`, () => {
      const header = formatUploadAuthorization({
        kid: f.kid, nonce: f.nonce, signature: f.signature,
      });
      expect(header).toBe(f.header);
      expect(parseUploadAuthorization(header)).toEqual({
        kid: f.kid, nonce: f.nonce, signature: f.signature,
      });
    });
  }

  test("rejects another scheme rather than parsing it loosely", () => {
    expect(parseUploadAuthorization('Bearer kid="a", nonce="b", sig="c"')).toBeNull();
  });

  test("rejects a header missing a parameter", () => {
    expect(parseUploadAuthorization('AgentMeshSig kid="a", nonce="b"')).toBeNull();
  });
});

describe("blob key derivation", () => {
  for (const f of BLOB_KEY_FIXTURES) {
    test(f.name, () => {
      expect(normalizeExtension(f.filename)).toBe(f.extension);
      expect(deriveBlobKey(f.sha256, f.filename)).toBe(f.expectedKey);
    });
  }

  test("same bytes under different extensions are different keys — dedup is per (digest, extension)", () => {
    const d = BLOB_KEY_FIXTURES[0]!.sha256;
    expect(deriveBlobKey(d, "a.bin")).not.toBe(deriveBlobKey(d, "a.dat"));
  });

  test("round-trips through parseBlobKey", () => {
    const d = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    expect(parseBlobKey(`${d}.pdf`)).toEqual({ sha256: d, extension: ".pdf" });
    expect(parseBlobKey(d)).toEqual({ sha256: d, extension: "" });
    expect(parseBlobKey("not-a-key")).toBeNull();
  });

  test("rejects a digest that is not 64 hex characters", () => {
    expect(() => deriveBlobKey("abc", "a.txt")).toThrow();
  });
});

describe("event id", () => {
  for (const f of EVENT_ID_FIXTURES) {
    test(`${f.value.slice(0, 24)}… ${f.valid ? "accepted" : "rejected"} — ${f.why}`, () => {
      expect(isValidEventId(f.value)).toBe(f.valid);
    });
  }
});

describe("error codes", () => {
  test("every classified code is one that exists", () => {
    const known = new Set<number>(Object.values(MESH_ERROR));
    for (const code of Object.keys(ERROR_CLASS)) {
      expect(known.has(Number(code))).toBe(true);
    }
  });

  test("retired codes are not reused", () => {
    const live = new Set<number>(Object.values(MESH_ERROR));
    for (const code of RETIRED_ERROR_CODES) {
      expect(live.has(code)).toBe(false);
    }
  });

  test("busy and storage-exhausted classify differently — one clears itself", () => {
    expect(ERROR_CLASS[MESH_ERROR.AUDIT_BUSY]).toBe("transient");
    expect(ERROR_CLASS[MESH_ERROR.AUDIT_STORAGE_EXHAUSTED]).toBe("transient-operator");
  });

  test("a conflicting event is permanent, a missing blob is not", () => {
    expect(ERROR_CLASS[MESH_ERROR.AUDIT_EVENT_CONFLICT]).toBe("permanent");
    expect(ERROR_CLASS[MESH_ERROR.AUDIT_MISSING_BLOBS]).toBe("transient");
  });
});

describe("attachment metadata", () => {
  test("extracts an attachments array from a parsed body", () => {
    const body = { attachments: [{ id: "abc", download_url: "https://h/api/v1/attachments/abc" }] };
    expect(extractAttachmentsMeta(body)).toHaveLength(1);
  });

  test("extracts from a JSON string — hub message content arrives flat", () => {
    const raw = JSON.stringify({ attachments: [{ id: "abc", download_url: "https://h/x" }] });
    expect(extractAttachmentsMeta(raw)).toHaveLength(1);
  });

  test("skips entries missing id or download_url rather than yielding a broken ref", () => {
    const body = { attachments: [{ id: "abc" }, { download_url: "https://h/x" }, { id: "ok", download_url: "https://h/ok" }] };
    expect(extractAttachmentsMeta(body)).toEqual([{ id: "ok", download_url: "https://h/ok" }]);
  });

  test("returns null for unparseable input, an empty array, or a non-object", () => {
    expect(extractAttachmentsMeta("{ not json")).toBeNull();
    expect(extractAttachmentsMeta({ attachments: [] })).toBeNull();
    expect(extractAttachmentsMeta(42)).toBeNull();
  });
});

describe("key fingerprints (SPEC § 10.2)", () => {
  test("match the fixtures byte for byte", () => {
    for (const f of KEY_FINGERPRINT_FIXTURES) {
      expect(keyFingerprint(f.publicKey)).toBe(f.fingerprint);
    }
  });

  test("the wire form and the raw bytes agree", () => {
    // The whole point of taking both: a caller holding one must not get a
    // different answer from a caller holding the other.
    for (const f of KEY_FINGERPRINT_FIXTURES) {
      expect(keyFingerprint(parsePublicKey(f.publicKey))).toBe(f.fingerprint);
    }
  });

  test("hashes the key bytes, not the text that encodes them", () => {
    // The failure this guards is silent: hashing the base64url string produces
    // a perfectly well-formed fingerprint of the wrong thing, and the operator
    // comparing two of them reads the mismatch as a wrong key.
    const f = KEY_FINGERPRINT_FIXTURES[0]!;
    const overTheText = `sha256:${Buffer.from(
      createHash("sha256").update(f.publicKey, "utf8").digest(),
    ).toString("base64url")}`;
    expect(overTheText).not.toBe(f.fingerprint);
  });

  test("distinct keys get distinct fingerprints", () => {
    const seen = new Set(KEY_FINGERPRINT_FIXTURES.map((f) => f.fingerprint));
    expect(seen.size).toBe(KEY_FINGERPRINT_FIXTURES.length);
  });

  test("rejects anything that is not a 32-byte key", () => {
    expect(() => parsePublicKey("too-short")).toThrow();
    expect(() => parsePublicKey("A".repeat(44))).toThrow();
    // Right length, wrong alphabet: + and / belong to base64, not base64url.
    expect(() => parsePublicKey(`${"+".repeat(1)}${"A".repeat(42)}`)).toThrow();
    expect(() => keyFingerprint(new Uint8Array(31))).toThrow();
  });

  test("produced fingerprints match the pattern implementations check against", () => {
    for (const f of KEY_FINGERPRINT_FIXTURES) {
      expect(FINGERPRINT_RE.test(f.fingerprint)).toBe(true);
    }
  });
});

describe("identity format (SPEC § 10.1)", () => {
  test("accepts the baseline identities and the logins people actually have", () => {
    for (const id of ["http-server", "self-reminder", "prod-codex1", "MixedCase", "0day", "a"]) {
      expect(IDENTITY_RE.test(id)).toBe(true);
    }
  });

  test("still rejects what it always did", () => {
    for (const id of ["", "-leading", "has_underscore", "has space", "has.dot", "@at"]) {
      expect(IDENTITY_RE.test(id)).toBe(false);
    }
  });

  test("is case-sensitive, which is the part that merges participants if missed", () => {
    expect("Codex").not.toBe("codex");
    expect(IDENTITY_RE.test("Codex") && IDENTITY_RE.test("codex")).toBe(true);
  });
});

describe("schemas (SPEC § 10.1)", () => {
  test("accept a well-formed provisioning request", () => {
    expect(Value.Check(ProvisionAgentRequest, {
      identity: "prod-codex1", type: "ai-codex",
      public_key: KEY_FINGERPRINT_FIXTURES[0]!.publicKey,
    })).toBe(true);
  });

  test("do not constrain `type` to the seeded set", () => {
    // § 10.3: the registry is data. A deployment carries types this package has
    // never heard of, and freezing them here would reintroduce the enum.
    expect(Value.Check(ProvisionAgentRequest, {
      identity: "invented", type: "ai-something-unreleased",
    })).toBe(true);
    expect(Value.Check(ProvisionAgentRequest, { identity: "no-type", type: "" })).toBe(false);
  });

  test("reject an identity the format rule rejects", () => {
    expect(Value.Check(ProvisionAgentRequest, { identity: "-leading", type: "service" })).toBe(false);
    expect(Value.Check(ProvisionAgentRequest, { identity: "MixedCase", type: "human" })).toBe(true);
  });

  test("reject a public key that is not a raw Ed25519 key", () => {
    expect(Value.Check(ProvisionAgentRequest, {
      identity: "a", type: "service", public_key: "short",
    })).toBe(false);
  });

  test("mesh.message carries sent_by, nullable", () => {
    const base = { id: "m", from: "a", to: "b", content: "x", reply_to: null, ts: "t" };
    expect(Value.Check(MeshMessageParams, { ...base, sent_by: "http-server" })).toBe(true);
    expect(Value.Check(MeshMessageParams, { ...base, sent_by: null })).toBe(true);
    expect(Value.Check(MeshMessageParams, base)).toBe(false);
  });

  test("mesh.connect stays open to unknown params, as § 8.1 requires", () => {
    expect(Value.Check(MeshConnectParams, {
      identity: "old-client", type: "ai-claude", description: "carried over",
    })).toBe(true);
  });
});

describe("mailbox transport (SPEC § 8.10)", () => {
  test("-32015 is not a retired code being reused", () => {
    // § 8.9.3 retires -32042 and forbids reuse: an old client meeting a new hub
    // must never read one meaning as another.
    expect(RETIRED_ERROR_CODES).not.toContain(MAILBOX_ERROR.SEND_CONFLICT);
  });

  test("-32015 does not collide with an existing code", () => {
    const existing = Object.values(MESH_ERROR);
    expect(existing).not.toContain(MAILBOX_ERROR.SEND_CONFLICT);
  });

  test("the lease outlives a plausible turn, and the dedup window outlives retries", () => {
    // A lease shorter than a turn hands a caller messages it is still working
    // on; a dedup window shorter than a retry schedule turns a retry into a
    // duplicate send. Both bounds are the point of the numbers.
    expect(MAILBOX_CAPABILITY_DEFAULTS.receive_lease_seconds).toBeGreaterThanOrEqual(60);
    expect(MAILBOX_CAPABILITY_DEFAULTS.send_dedup_window_seconds)
      .toBeGreaterThan(MAILBOX_CAPABILITY_DEFAULTS.receive_lease_seconds);
  });
});

/**
 * The schemas are canonical, so a member the hub accepts and the schema rejects
 * is a defect in the schema — a consumer validating with it refuses a request
 * that is valid on the wire, and does so silently.
 *
 * This has now happened once (`client_message_id` shipped in the interface and
 * not in the schema, under `additionalProperties: false`). These assert the
 * shapes agree rather than trusting that both were remembered.
 */
describe("schemas accept every member the protocol defines", () => {
  test("mesh.send takes an idempotency key", () => {
    expect(Value.Check(MeshSendParams, {
      to: "peer", content: "x", client_message_id: "cmid-1",
    })).toBe(true);
    expect(Value.Check(MeshSendParams, { to: "peer", content: "x", client_message_id: "" }))
      .toBe(false);
    expect(Value.Check(MeshSendParams, {
      to: "peer", content: "x", client_message_id: "k".repeat(129),
    })).toBe(false);
  });

  test("every optional member of MeshSendIdempotency appears in the schema", () => {
    // The interface and the schema are two statements of one shape. Whenever
    // they are edited apart, this is what notices.
    const declared: Array<keyof MeshSendIdempotency> = ["client_message_id"];
    const inSchema = Object.keys(MeshSendParams.properties);
    for (const member of declared) expect(inSchema).toContain(member);
  });

  test("mesh.receive params and result have schemas", () => {
    expect(Value.Check(MeshReceiveParams, {})).toBe(true);
    expect(Value.Check(MeshReceiveParams, { limit: 10, ack_ids: ["msg_a"] })).toBe(true);
    expect(Value.Check(MeshReceiveParams, { ack_ids: "msg_a" })).toBe(false);
    expect(Value.Check(MeshReceiveResult, {
      messages: [], remaining: 0, lease_seconds: 300,
    })).toBe(true);
  });

  test("a strict schema rejects an unknown member, which is why the above matter", () => {
    // additionalProperties: false is the right setting and the reason a missing
    // member is fatal rather than tolerated.
    expect(Value.Check(MeshSendParams, { to: "peer", content: "x", invented: 1 })).toBe(false);
  });
});

describe("create_only provisioning (SPEC § 10.1)", () => {
  test("the schema accepts it and it stays optional", () => {
    // Optional because the rotation and re-registration paths rely on update
    // semantics; making it default would break them silently.
    expect(Value.Check(ProvisionAgentRequest, { identity: "a", type: "service" })).toBe(true);
    expect(Value.Check(ProvisionAgentRequest, {
      identity: "a", type: "service", create_only: true,
    })).toBe(true);
    expect(Value.Check(ProvisionAgentRequest, {
      identity: "a", type: "service", create_only: "yes",
    })).toBe(false);
  });

  test("the refusal reasons are distinguishable without matching prose", () => {
    expect(PROVISION_ERROR.IDENTITY_EXISTS).not.toBe(PROVISION_ERROR.IDENTITY_DELETED);
  });
});

describe("reminder schedules", () => {
  for (const f of SCHEDULE_SPEC_FIXTURES) {
    test(`schedule_spec: ${f.name}`, () => {
      const result = parseScheduleSpec(f.type, f.spec, new Date("2026-04-18T09:00:00Z"));
      expect(result.ok).toBe(f.valid);
    });
  }

  for (const f of INTERVAL_ADVANCE_FIXTURES) {
    test(`interval advance: ${f.name}`, () => {
      const parsed = parseScheduleSpec("interval", JSON.stringify({ every: f.every }));
      if (!parsed.ok) throw new Error(parsed.reason);
      const next = nextIntervalFire(
        new Date(f.scheduledForIso),
        (parsed.schedule as { everyMs: number }).everyMs,
        new Date(f.firedAtIso),
      );
      expect(next.toISOString()).toBe(f.nextFireAtIso);
    });
  }

  test("every advance lands strictly in the future", () => {
    // The property behind the fixtures. A next fire at or before now is a row
    // that is due the instant it is written, which is a fire loop.
    for (const f of INTERVAL_ADVANCE_FIXTURES) {
      const parsed = parseScheduleSpec("interval", JSON.stringify({ every: f.every }));
      if (!parsed.ok) throw new Error(parsed.reason);
      const firedAt = new Date(f.firedAtIso);
      const next = nextIntervalFire(new Date(f.scheduledForIso), (parsed.schedule as { everyMs: number }).everyMs, firedAt);
      expect(next.getTime()).toBeGreaterThan(firedAt.getTime());
    }
  });

  test("a relative once resolves against the supplied clock, not the wall clock", () => {
    const now = new Date("2026-04-18T09:00:00Z");
    const result = parseScheduleSpec("once", '{"in":"2h"}', now);
    if (!result.ok) throw new Error(result.reason);
    expect((result.schedule as { at: Date }).at.toISOString()).toBe("2026-04-18T11:00:00.000Z");
  });

  test("an omitted tz means UTC rather than the daemon's local zone", () => {
    const result = parseScheduleSpec("cron", '{"cron":"0 9 * * *"}');
    if (!result.ok) throw new Error(result.reason);
    expect(result.schedule).toEqual({ type: "cron", cron: "0 9 * * *", tz: "UTC" });
  });

  test("a refusal names the field and never echoes the caller's value", () => {
    const result = parseScheduleSpec("interval", '{"every":"<script>alert(1)</script>"}');
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a refusal");
    expect(result.reason).not.toContain("script");
  });

  test("durations agree with the units they name", () => {
    expect(parseDuration("30s")).toBe(30_000);
    expect(parseDuration("5m")).toBe(300_000);
    expect(parseDuration("2h")).toBe(7_200_000);
    expect(parseDuration("1d")).toBe(86_400_000);
    expect(parseDuration("0s")).toBeNull();
  });

  test("nextIntervalFire refuses an interval that cannot advance", () => {
    expect(() => nextIntervalFire(new Date(), 0, new Date())).toThrow();
  });
});
