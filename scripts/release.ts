/**
 * Cut a tag and tell everyone who pins it, in one action.
 *
 * **Because the two came apart.** `v0.31.0`, `v0.32.0` and `v0.32.1` were
 * tagged and pushed, and `client-claude` found out three tags later by checking
 * its own pin. The rule was already written down — `CLAUDE.md` lists "a
 * contract changed" first among the things worth mailing — and the recipient
 * list was still assembled from memory each time, so one of the three was
 * dropped without anything noticing.
 *
 * A promise not to forget is not a check. This makes the broadcast a step of
 * the release rather than something remembered after it.
 *
 * ## What it refuses
 *
 * - a dirty tree — the tag would name a commit that is not what was tested
 * - a tag that already exists — re-tagging moves a name somebody has pinned
 * - a `package.json` version that does not match the tag — nine tags ran with
 *   `0.23.0` frozen in that field, and a manifest naming a version it is not is
 *   one more thing a reader has to already know is false
 * - a mailer that is not answering: the tag is pushed only after every message
 *   is delivered, so a release is never half-announced. A tag with no
 *   broadcast is the failure this exists to stop; a broadcast with no tag is
 *   noise that the next run corrects.
 */

const MAILBOX = process.env.AGENT_MESH_MAILBOX_URL ?? "http://localhost:3300";
const FROM = "platform-claude";
/** Everyone who pins this package. Adding a consumer means adding them here. */
const PINS = ["client-claude", "fe-codex", "agent-mesh-local-pm"] as const;

async function run(cmd: string[]): Promise<string> {
  const p = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([
    new Response(p.stdout).text(),
    new Response(p.stderr).text(),
    p.exited,
  ]);
  if (code !== 0) throw new Error(`${cmd.join(" ")} exited ${code}\n${err || out}`);
  return out.trim();
}

async function main(): Promise<void> {
  const tag = process.argv[2];
  const body = process.argv.slice(3).join(" ");
  if (!tag || !body) {
    console.error("usage: bun scripts/release.ts v0.34.0 'what moved, and what it costs to ignore'");
    process.exit(2);
  }

  const dirty = await run(["git", "status", "--porcelain"]);
  if (dirty) {
    console.error(`refusing to tag a dirty tree — the tag would name something that was not tested:\n${dirty}`);
    process.exit(2);
  }

  const tags = (await run(["git", "tag", "--list"])).split("\n");
  if (tags.includes(tag)) {
    console.error(`${tag} already exists. A tag somebody has pinned must not move.`);
    process.exit(2);
  }

  const version = (JSON.parse(await Bun.file("package.json").text()) as { version: string }).version;
  if (`v${version}` !== tag) {
    console.error(`package.json says ${version} and the tag says ${tag}. Bump the field first.`);
    process.exit(2);
  }

  // Every message before the tag. A delivery that fails leaves nothing pinned.
  for (const to of PINS) {
    const res = await fetch(`${MAILBOX}/api/mail`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ from: FROM, to, body: `[contracts ${tag}] ${body}` }),
    });
    if (!res.ok) {
      console.error(`${to} was not told (${res.status}). Nothing tagged — fix the mailer and run again.`);
      process.exit(1);
    }
    console.log(`told ${to}`);
  }

  await run(["git", "tag", tag]);
  await run(["git", "push", "origin", "main", "--tags"]);
  console.log(`${tag} pushed, and ${PINS.length} consumers told.`);
}

await main();
