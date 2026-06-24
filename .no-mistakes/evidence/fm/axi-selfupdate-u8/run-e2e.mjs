import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const evidenceDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(evidenceDir, "../../../..");
const viteNode = resolve(repoRoot, "packages/axi-sdk-js/node_modules/.bin/vite-node");
const cli = resolve(evidenceDir, "demo-tool/bin/demo-axi");
const transcriptPath = resolve(evidenceDir, "e2e-transcript.txt");

const cases = [
  {
    title: "bare --help advertises the SDK-owned update command",
    display: "demo-axi --help",
    args: ["--help"],
    env: {},
    expect: ["usage: demo-axi <command>", "\"built-in\":", "update --check"],
    reject: [],
  },
  {
    title: "update --help shows the built-in reference",
    display: "demo-axi update --help",
    args: ["update", "--help"],
    env: {},
    expect: ["command: update", "description:", "\"--check\":", "examples[2]:"],
    reject: [],
  },
  {
    title: "update --check reports current vs latest without installing",
    display: "DEMO_AXI_LATEST=0.2.0 demo-axi update --check",
    args: ["update", "--check"],
    env: { DEMO_AXI_LATEST: "0.2.0" },
    expect: [
      "package: @no-mistakes/demo-axi-update",
      "current: 0.1.0",
      "latest: 0.2.0",
      "available: true",
      "Run `demo-axi update` to upgrade",
    ],
    reject: ["running:"],
  },
  {
    title: "update --dry-run is accepted as the check alias",
    display: "DEMO_AXI_LATEST=0.2.0 demo-axi update --dry-run",
    args: ["update", "--dry-run"],
    env: { DEMO_AXI_LATEST: "0.2.0" },
    expect: ["current: 0.1.0", "latest: 0.2.0", "available: true"],
    reject: ["running:"],
  },
  {
    title: "unknown install method prints the manual command instead of guessing",
    display: "DEMO_AXI_LATEST=0.2.0 demo-axi update",
    args: ["update"],
    env: { DEMO_AXI_LATEST: "0.2.0" },
    expect: [
      "action: manual",
      "reason: Could not determine how this tool was installed",
      "run: npm install -g @no-mistakes/demo-axi-update@latest",
    ],
    reject: ["running:"],
  },
  {
    title: "already-latest update exits cleanly without installing",
    display: "DEMO_AXI_LATEST=0.1.0 demo-axi update",
    args: ["update"],
    env: { DEMO_AXI_LATEST: "0.1.0" },
    expect: [
      "update: @no-mistakes/demo-axi-update is already on the latest version (0.1.0)",
    ],
    reject: ["running:"],
  },
  {
    title: "a tool-owned update command suppresses the built-in help footer",
    display: "DEMO_AXI_OVERRIDE_UPDATE=1 demo-axi --help",
    args: ["--help"],
    env: { DEMO_AXI_OVERRIDE_UPDATE: "1" },
    expect: ["usage: demo-axi <command>"],
    reject: ["\"built-in\":", "update --check"],
  },
  {
    title: "a tool-owned update command receives update dispatch",
    display: "DEMO_AXI_OVERRIDE_UPDATE=1 demo-axi update",
    args: ["update"],
    env: { DEMO_AXI_OVERRIDE_UPDATE: "1" },
    expect: ["update: tool-owned update handler"],
    reject: ["current:", "latest:", "running:"],
  },
];

const transcript = [
  "# AXI SDK built-in update end-to-end transcript",
  "",
  "Fixture package intentionally does not pass packageName and does not register an update command unless DEMO_AXI_OVERRIDE_UPDATE=1.",
  "The fixture is executed through vite-node so the transcript exercises packages/axi-sdk-js/src directly, with argv[1] normalized to the fixture entrypoint.",
  "",
];

for (const testCase of cases) {
  const env = { ...process.env, ...testCase.env };
  const { stdout, stderr } = await execFileAsync(viteNode, [cli, ...testCase.args], {
    cwd: repoRoot,
    env,
  });

  for (const expected of testCase.expect) {
    assert.match(stdout, new RegExp(escapeRegExp(expected)), testCase.title);
  }
  for (const rejected of testCase.reject) {
    assert.doesNotMatch(stdout + stderr, new RegExp(escapeRegExp(rejected)), testCase.title);
  }

  transcript.push(`## ${testCase.title}`);
  transcript.push(`$ ${testCase.display}`);
  transcript.push(`# executed as: ${relative(repoRoot, viteNode)} ${relative(repoRoot, cli)} ${testCase.args.join(" ")}`.trim());
  transcript.push("");
  transcript.push("stdout:");
  transcript.push(stdout.trimEnd() || "<empty>");
  transcript.push("");
  transcript.push("stderr:");
  transcript.push(stderr.trimEnd() || "<empty>");
  transcript.push("");
}

await import("node:fs/promises").then(({ writeFile }) =>
  writeFile(transcriptPath, `${transcript.join("\n")}\n`, "utf8"),
);

console.log(relative(repoRoot, transcriptPath));

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
