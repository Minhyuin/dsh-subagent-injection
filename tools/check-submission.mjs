#!/usr/bin/env node
/**
 * Submission conformance check for dsh.so.
 *
 * Walks the acceptance gates dsh.so documents at https://www.dsh.so/zh/submit/ and
 * the L2/L3 structured-manifest requirements at https://www.dsh.so/zh/verification/
 * against the artifact that actually gets checked — the npm tarball of plugin/ —
 * so a broken submission is caught in CI instead of by the market's checker:
 *
 *   1. DSH compatibility signal  — a top-level `dsh` manifest, patch file included
 *   2. README with install instructions
 *   3. Open-source license with a recognizable SPDX identifier, file included
 *   4. Valid plugin id           — slug, equal to the repository name
 *   5. Scannable source          — JS in the tarball, no development-only files
 *   6. Security scan             — not checkable from here: vet grades it server-side.
 *                                  What *is* checkable locally is the structural half
 *                                  of that contract (a declared dsh.bundle.patch must
 *                                  exist, the entry must resolve, engines.node ≥ 22)
 *                                  plus the shape of what ships.
 *
 * The version arithmetic and the release path live in .github/scripts/release.sh and
 * .github/workflows/publish.yml; this file only inspects what would ship.
 *
 *   node tools/check-submission.mjs
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pluginDir = join(root, "plugin");

/** Every check records a verdict instead of throwing, so one run reports all of them. */
const checks = [];
let failed = 0;

function record(gate, name, ok, detail) {
  checks.push({ gate, name, ok, detail });
  if (!ok) failed += 1;
}

/** Human-readable one-liner for an arbitrary value inside a failure message. */
function show(value) {
  return JSON.stringify(value ?? null);
}

const manifest = JSON.parse(readFileSync(join(pluginDir, "package.json"), "utf8"));
const dsh = manifest.dsh;

// ------------------------------------------------- 1. the DSH compatibility signal
record("1 compatibility", "top-level `dsh` manifest", Boolean(dsh) && typeof dsh === "object", "package.json");

// vet R12: a declared-but-missing bundle patch is a high finding; a missing entry a medium one.
const patch = dsh?.bundle?.patch;
const patchPath = typeof patch === "string" ? patch : null;
record(
  "1 compatibility",
  "dsh.bundle.patch is a single path",
  patchPath !== null,
  patchPath ?? `expected a string, got ${show(JSON.stringify(patch))}`,
);
if (patchPath) {
  const patchFile = resolve(pluginDir, patchPath);
  const ships = statSync(patchFile, { throwIfNoEntry: false })?.isFile() ?? false;
  record("1 compatibility", "declared patch file exists", ships, patchPath);
  const entries = ships ? readFileSync(patchFile, "utf8") : "";
  record(
    "1 compatibility",
    "patch file inserts the entry the README documents",
    /id:\s*subagent-injection/.test(entries) && /dsh-subagent-injection/.test(entries),
    patchPath,
  );
}
record(
  "1 compatibility",
  "dsh.manifestVersion is the declared format `1`",
  dsh?.manifestVersion === 1,
  `manifestVersion=${show(JSON.stringify(dsh?.manifestVersion))}`,
);
record(
  "1 compatibility",
  "dsh.client.platform is web",
  dsh?.client?.platform === "web",
  `platform=${show(JSON.stringify(dsh?.client?.platform))}`,
);

// ---------------------------------------------------------------- 2. the READMEs
// The tarball README is the one a market entry and `npm view` show; the repo README
// is the one GitHub shows. Both must carry an install line (gate 2).
const installCommand = `dsh plugin --profile <你的 profile> add ${manifest.name}`;
record(
  "2 README",
  "tarball README carries the install command",
  readFileSync(join(pluginDir, "README.md"), "utf8").includes(installCommand),
  `plugin/README.md — ${installCommand}`,
);
record(
  "2 README",
  "repo README carries the install command",
  readFileSync(join(root, "README.md"), "utf8").includes("dsh plugin --profile"),
  "README.md",
);

// ------------------------------------------------------------------- 3. license
record(
  "3 license",
  "SPDX identifier",
  typeof manifest.license === "string" && /^[A-Za-z0-9.+-]+$/.test(manifest.license),
  `license=${show(manifest.license)}`,
);
const licenseName = ["LICENSE", "LICENSE.md", "LICENSE.txt"].find((name) =>
  existsSync(join(pluginDir, name)),
);
record("3 license", "license file sits next to plugin/package.json", Boolean(licenseName), licenseName ?? "none of LICENSE{, .md, .txt}");
if (licenseName) {
  const text = readFileSync(join(pluginDir, licenseName), "utf8");
  record(
    "3 license",
    "license file is the declared license",
    text.includes(manifest.license === "MIT" ? "MIT License" : manifest.license),
    licenseName,
  );
  record("3 license", "license file is in `files`", shipPatterns().includes(licenseName), licenseName);
  // The package ships its own copy so the tarball is self-describing; a copy that
  // stopped matching the repository LICENSE would be a wrong license claim.
  const rootCopy = join(root, licenseName);
  record(
    "3 license",
    "package copy matches the repository LICENSE",
    existsSync(rootCopy) && readFileSync(rootCopy, "utf8") === text,
    existsSync(rootCopy) ? `${licenseName} ≡ plugin/${licenseName}` : `no ${licenseName} at the repository root`,
  );
}

// ------------------------------------------------------------------- 4. the id
record("4 id", "package name is a valid slug", /^[a-z0-9]+(-[a-z0-9]+)*$/.test(manifest.name), manifest.name);
const repoName = new URL(manifest.repository.url).pathname
  .split("/")
  .filter(Boolean)
  .pop()
  ?.replace(/\.git$/, "");
record(
  "4 id",
  "repository name matches the package name",
  repoName === manifest.name,
  `repo=${show(repoName)} package=${show(manifest.name)}`,
);
record(
  "4 id",
  "repository topics (set on GitHub, not in the tarball)",
  true,
  "add at least one of `dsh-plugin` / `dsh-pack` — it auto-indexes the repo",
);

// ------------------------------------------------------- 5. declared dsh versions
const nodeEngine = manifest.engines?.node;
record("5 versions", "engines.node is declared", typeof nodeEngine === "string", `node=${show(nodeEngine)}`);
const nodeMajor = Number.parseInt(String(nodeEngine).match(/\d+/)?.[0] ?? "", 10);
// vet R12: engines.node below 22 is an info-grade finding.
record("5 versions", "engines.node floor is >= 22", Number.isFinite(nodeMajor) && nodeMajor >= 22, `node=${show(nodeEngine)}`);

const dshEngine = manifest.engines?.dsh;
const nestedDshEngine = manifest.dsh?.engines?.dsh;
// L3.2 asks for a declared DSH version requirement; `engines.dsh` is the field the
// official package-manifest docs define, and one market consumer reads the nested
// `dsh.engines.dsh` shape instead (dsh-market issue #577), so ship both.
record("5 versions", "engines.dsh declares a range", typeof dshEngine === "string" && dshEngine.length > 0, `engines.dsh=${show(dshEngine)}`);
record("5 versions", "dsh.engines.dsh repeats it", nestedDshEngine === dshEngine, `dsh.engines.dsh=${show(nestedDshEngine)}`);

const entry = entryCandidates(manifest).find((candidate) => existsSync(resolve(pluginDir, candidate)));
record("5 versions", "declared entry file exists", Boolean(entry), entry ?? `none of ${entryCandidates(manifest).join(", ")}`);

/** Entry candidates from exports["."] / main / a root index.js, in resolution order. */
function entryCandidates(item) {
  const main = item.exports?.["."] ?? item.main;
  const mainPath = typeof main === "string" ? main : main?.default;
  return [...(mainPath ? [mainPath] : []), "index.js"];
}

// ---------------------------------------------------------- 6. what actually ships
const patterns = shipPatterns();
const pack = npmPack();
if (pack === null) {
  record("6 tarball", "npm pack succeeds", false, "npm pack --dry-run failed; see stderr above");
} else {
  const paths = pack.files.map((file) => file.path);
  record("6 tarball", "npm pack succeeds", true, `${paths.length} entries, ${pack.entryCount} files`);

  const missing = patterns
    .filter((pattern) => !pattern.includes("*"))
    .filter((pattern) => !paths.includes(pattern));
  record("6 tarball", "every declared file ships", missing.length === 0, missing.join(", ") || patterns.join(", "));

  const undeclared = paths.filter((path) => path !== "package.json" && !patterns.some((pattern) => glob(pattern).test(path)));
  record("6 tarball", "nothing beyond `files` + package.json ships", undeclared.length === 0, undeclared.join(", ") || "none");

  const source = paths.filter((path) => /\.(js|mjs|cjs|ts)$/.test(path));
  record("6 tarball", "ships scannable source", source.length > 0, source.join(", "));

  // The dev-only halves must never reach a consumer: they are the files a security
  // review would otherwise have to read (tools/test-client.mjs evaluates a bundle
  // with `new Function`, which vet grades R2/high outside a test file).
  const devOnly = paths.filter((path) => /^(tools|scripts|test|tests|src)\//.test(path));
  record("6 tarball", "no development-only files", devOnly.length === 0, devOnly.join(", ") || "none");
}

/** The `files` entries of the shipped manifest, with directory entries expanded to a subtree glob. */
function shipPatterns() {
  return (manifest.files ?? []).map((pattern) => {
    if (/[*?]/.test(pattern)) return pattern;
    const absolute = resolve(pluginDir, pattern);
    return statSync(absolute, { throwIfNoEntry: false })?.isDirectory() ? `${pattern}/**` : pattern;
  });
}

/** `npm pack --dry-run --json` run from a scratch cwd, so no .tgz is left behind. */
function npmPack() {
  const scratch = mkdtempSync(join(tmpdir(), "dsh-submission-"));
  try {
    // Windows has no `npm` executable on PATH — only the `npm.cmd` shim — so the
    // command goes through a shell there. The argv below is a fixed literal.
    const out = execFileSync(process.platform === "win32" ? "npm.cmd" : "npm", ["pack", "--dry-run", "--json"], {
      cwd: pluginDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
      env: { ...process.env, npm_config_cache: join(scratch, "cache") },
    });
    return JSON.parse(out)[0] ?? null;
  } catch (error) {
    process.stderr.write(`${error.stderr ?? error.message}\n`);
    return null;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** Minimal glob → RegExp: `**` spans directories, `*` stays inside one segment. */
function glob(pattern) {
  const source = pattern
    .split("/")
    .map((segment) =>
      segment === "**"
        ? ".*"
        : segment.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]"),
    )
    .join("/");
  return new RegExp(`^${source}$`);
}

// ------------------------------------------------------------------------ report
for (const gate of [...new Set(checks.map((check) => check.gate))]) {
  process.stdout.write(`\n${gate}\n`);
  for (const check of checks.filter((item) => item.gate === gate)) {
    process.stdout.write(`  ${check.ok ? "ok  " : "FAIL"} ${check.name} — ${check.detail}\n`);
  }
}
process.stdout.write(`\n${checks.length - failed}/${checks.length} checks passed\n`);
process.stdout.write(
  "\nThe security scan itself is graded server-side when you submit; paste the repository URL or the\n" +
    "npm package name at https://www.dsh.so/zh/submit/ for the authoritative verdict.\n",
);
process.exit(failed === 0 ? 0 : 1);
