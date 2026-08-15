/**
 * Cross-implementation fixtures.
 *
 * These exist so two implementations can be shown to agree on bytes rather
 * than agreeing on prose. Every value here is a hex or literal constant, not a
 * call into the encoder it is meant to check — a fixture that computes its own
 * expectation proves nothing.
 *
 * A non-TypeScript implementation reads these as data.
 */

export interface RequestSignatureFixture {
  name: string;
  method: string;
  kid: string;
  nonce: string;
  iat: number;
  /** UTF-8 source of the raw params bytes. */
  rawParams: string;
  /** Expected preimage, lowercase hex. */
  preimageHex: string;
  preimageLength: number;
}

export const REQUEST_SIGNATURE_FIXTURES: readonly RequestSignatureFixture[] = [
  {
    name: "empty params object",
    method: "mesh.audit.append",
    kid: "kid1",
    nonce: "n1",
    iat: 1786780800,
    rawParams: "{}",
    preimageHex:
      "6167656e742d6d6573682f7369672f763100000000116d6573682e61756469742e617070656e64" +
      "000000046b696431000000026e310000000a31373836373830383030000000027b7d",
    preimageLength: 73,
  },
  {
    name: "multi-byte UTF-8 in params — length prefixes count bytes, not characters",
    method: "mesh.send",
    kid: "kid1",
    nonce: "n1",
    iat: 1786780800,
    // "한" is three bytes in UTF-8; a preimage built on character counts breaks here.
    rawParams: '{"content":"한"}',
    // 17 + 1 + (4+9) + (4+4) + (4+2) + (4+10) + (4+17) = 80.
    // The params field is 17 bytes, not 15: "한" occupies three of them.
    preimageHex:
      "6167656e742d6d6573682f7369672f763100000000096d6573682e73656e64000000046b696431" +
      "000000026e310000000a3137383637383038303000000011" +
      "7b22636f6e74656e74223a22ed959c227d",
    preimageLength: 80,
  },
];

export interface UploadSignatureFixture {
  name: string;
  nonce: string;
  blobKey: string;
  sha256: string;
  size: number;
  preimageHex: string;
  preimageLength: number;
}

export const UPLOAD_SIGNATURE_FIXTURES: readonly UploadSignatureFixture[] = [
  {
    name: "pdf attachment",
    nonce: "upload-nonce-1",
    blobKey: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef.pdf",
    sha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    size: 2458211,
    // 20 + 1 + (4+14) + (4+68) + (4+64) + (4+7) = 190.
    // blob_key is 68 bytes — the digest plus ".pdf" — while sha256 is 64.
    preimageHex:
      "6167656e742d6d6573682f75706c6f61642f7631000000000e75706c6f61642d6e6f6e63652d31" +
      "0000004430313233343536373839616263646566303132333435363738396162636465663031323334" +
      "3536373839616263646566303132333435363738396162636465662e70646600000040" +
      "3031323334353637383961626364656630313233343536373839616263646566303132333435363738" +
      "39616263646566303132333435363738396162636465660000000732343538323131",
    preimageLength: 190,
  },
];

export interface BlobKeyFixture {
  name: string;
  filename: string;
  sha256: string;
  /** Expected extension, `""` when none is usable. */
  extension: string;
  expectedKey: string;
}

const D = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

export const BLOB_KEY_FIXTURES: readonly BlobKeyFixture[] = [
  { name: "lowercased", filename: "Report.PDF", sha256: D, extension: ".pdf", expectedKey: `${D}.pdf` },
  { name: "no extension", filename: "README", sha256: D, extension: "", expectedKey: D },
  { name: "dotfile is not an extension carrier", filename: ".gitignore", sha256: D, extension: ".gitignore", expectedKey: `${D}.gitignore` },
  { name: "multiple dots — only the last suffix counts", filename: "archive.tar.gz", sha256: D, extension: ".gz", expectedKey: `${D}.gz` },
  { name: "unsafe characters are replaced before the suffix is read", filename: "my file (1).PNG", sha256: D, extension: ".png", expectedKey: `${D}.png` },
  { name: "suffix longer than 16 is not an extension", filename: `x.${"a".repeat(17)}`, sha256: D, extension: "", expectedKey: D },
  { name: "non-alphanumeric suffix is not an extension", filename: "backup.tar-gz", sha256: D, extension: "", expectedKey: D },
  { name: "uppercase digest is normalised", filename: "a.txt", sha256: D.toUpperCase(), extension: ".txt", expectedKey: `${D}.txt` },
];

export interface EventIdFixture {
  value: string;
  valid: boolean;
  why: string;
}

export const EVENT_ID_FIXTURES: readonly EventIdFixture[] = [
  { value: "aud_0198b1f8-7d5a-7a12-9f42-7b6c86f54e31", valid: true, why: "canonical UUIDv7" },
  { value: "0198b1f8-7d5a-7a12-9f42-7b6c86f54e31", valid: false, why: "missing aud_ prefix" },
  { value: "aud_0198B1F8-7D5A-7A12-9F42-7B6C86F54E31", valid: false, why: "uppercase" },
  { value: "aud_0198b1f8-7d5a-4a12-9f42-7b6c86f54e31", valid: false, why: "version nibble 4, not 7" },
  { value: "aud_0198b1f8-7d5a-7a12-1f42-7b6c86f54e31", valid: false, why: "variant nibble outside 8-b" },
  { value: "aud_0198b1f87d5a7a129f427b6c86f54e31", valid: false, why: "hyphens stripped" },
];

export interface UploadAuthorizationFixture {
  kid: string;
  nonce: string;
  signature: string;
  header: string;
}

export const UPLOAD_AUTHORIZATION_FIXTURES: readonly UploadAuthorizationFixture[] = [
  {
    kid: "fp1",
    nonce: "upload-nonce-1",
    signature: "c2ln",
    header: 'AgentMeshSig kid="fp1", nonce="upload-nonce-1", sig="c2ln"',
  },
];

/**
 * Key fingerprints (SPEC § 10.2).
 *
 * The fingerprint is what an operator compares between a lane's startup log and
 * the approval surface, so the two implementations producing it must agree
 * exactly. These were computed independently of `keyFingerprint` — a fixture
 * that calls the encoder it checks proves only that the encoder is
 * deterministic.
 *
 * They pin the part that is easy to get wrong and impossible to notice: the
 * digest is over the **raw 32 key bytes**, not over the base64url text. Hashing
 * the encoding produces a perfectly good fingerprint of the wrong thing, and
 * the two disagree in silence.
 */
export interface KeyFingerprintFixture {
  name: string;
  /** Raw Ed25519 public key, base64url, unpadded. */
  publicKey: string;
  /** Expected `sha256:<base64url>` fingerprint. */
  fingerprint: string;
}

export const KEY_FINGERPRINT_FIXTURES: readonly KeyFingerprintFixture[] = [
  {
    name: "all-zero key",
    publicKey: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    fingerprint: "sha256:Zmh6rfhivXdsj8GLjp-OIAiXFIVu4jOzkCpZHQ1fKSU",
  },
  {
    name: "all-0xff key — exercises the base64url alphabet, - and _ rather than + and /",
    publicKey: "__________________________________________8",
    fingerprint: "sha256:r5YTdg9yY1-9tEpaCmPDnxKvMPlQpu5clxvhiOicQFE",
  },
  {
    name: "0..31 ramp",
    publicKey: "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8",
    fingerprint: "sha256:Yw3NKWbEM2aRElRIu7JbT_QSpJxzLbLIq8G4WBvXEN0",
  },
];
