import { encode } from "@toon-format/toon";
import { CdpError, callTool, ensureBridge, stopBridge } from "./client.js";
import { countRefs, extractTitle } from "./snapshot.js";
import { getSuggestions } from "./suggestions.js";

const HELP = `usage: chrome-devtools-axi <command> [args]
commands[12]:
  open <url>, snapshot, click @<uid>, fill @<uid> <text>, type <text>,
  press <key>, scroll <dir>, back, wait <ms|text>, eval <js>, start, stop
`;

function renderHelp(lines: string[]): string {
  if (lines.length === 0) return "";
  const indented = lines.map((l) => `  ${l}`).join("\n");
  return `help[${lines.length}]:\n${indented}`;
}

function renderError(message: string, code: string, suggestions: string[] = []): string {
  const blocks = [encode({ error: message, code })];
  if (suggestions.length > 0) {
    blocks.push(renderHelp(suggestions));
  }
  return blocks.join("\n");
}

function renderOutput(blocks: string[]): string {
  return blocks.filter(Boolean).join("\n");
}

/**
 * Parse snapshot from an includeSnapshot response.
 * The response contains a "## Latest page snapshot" section.
 */
function parseSnapshotFromResponse(response: string): string | null {
  const marker = "## Latest page snapshot";
  const idx = response.indexOf(marker);
  if (idx === -1) return null;
  const after = response.slice(idx + marker.length);
  // The snapshot follows after the header line, possibly with a blank line
  const trimmed = after.replace(/^\s*\n/, "");
  // Snapshot ends at the next ## heading or end of text
  const nextHeading = trimmed.indexOf("\n## ");
  return nextHeading === -1 ? trimmed.trimEnd() : trimmed.slice(0, nextHeading).trimEnd();
}

/** Format page metadata (TOON) + raw snapshot + suggestions. */
function formatPageOutput(snapshot: string, command: string, url?: string): string {
  const title = extractTitle(snapshot);
  const refs = countRefs(snapshot);

  const blocks: string[] = [];

  // Page metadata as TOON
  const page: Record<string, unknown> = {};
  if (title) page.title = title;
  if (url) page.url = url;
  page.refs = refs;
  blocks.push(encode({ page }));

  // Raw snapshot (not TOON-encoded — already token-efficient tree format)
  blocks.push(`snapshot:\n${snapshot.trimEnd()}`);

  // Contextual suggestions
  const suggestions = getSuggestions({ command, url, snapshot });
  if (suggestions.length > 0) {
    blocks.push(renderHelp(suggestions));
  }

  return renderOutput(blocks);
}

/** Strip the `## Latest page snapshot` header that chrome-devtools-mcp prepends. */
function stripSnapshotHeader(text: string): string {
  return text.replace(/^##\s+Latest page snapshot\s*\n/, "");
}

/** Strip leading @ from uid ref. */
function parseUid(arg: string): string {
  return arg.startsWith("@") ? arg.slice(1) : arg;
}

/**
 * Call a tool with includeSnapshot:true and extract the snapshot.
 * Falls back to a separate take_snapshot() if parsing fails.
 */
async function callWithSnapshot(
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  const result = await callTool(name, { ...args, includeSnapshot: true });
  const snapshot = parseSnapshotFromResponse(result);
  if (snapshot && snapshot.length > 0) return stripSnapshotHeader(snapshot);
  // Fallback: take snapshot separately
  return stripSnapshotHeader(await callTool("take_snapshot"));
}

const SCROLL_FUNCTIONS: Record<string, string> = {
  up: "window.scrollBy(0, -500)",
  down: "window.scrollBy(0, 500)",
  top: "window.scrollTo(0, 0)",
  bottom: "window.scrollTo(0, document.body.scrollHeight)",
};

async function handleOpen(args: string[]): Promise<string> {
  const url = args[0];
  if (!url) {
    throw new CdpError("Missing URL", "VALIDATION_ERROR", [
      "Run `chrome-devtools-axi open https://example.com` to navigate to a page",
    ]);
  }

  await callTool("navigate_page", { type: "url", url });
  const snapshot = stripSnapshotHeader(await callTool("take_snapshot"));
  return formatPageOutput(snapshot, "open", url);
}

async function handleSnapshot(): Promise<string> {
  const snapshot = stripSnapshotHeader(await callTool("take_snapshot"));
  return formatPageOutput(snapshot, "snapshot");
}

async function handleClick(args: string[]): Promise<string> {
  const uid = args[0];
  if (!uid) {
    throw new CdpError("Missing element ref", "VALIDATION_ERROR", [
      "Run `chrome-devtools-axi click @<uid>` — get uid from snapshot",
    ]);
  }

  const snapshot = await callWithSnapshot("click", { uid: parseUid(uid) });
  return formatPageOutput(snapshot, "click");
}

async function handleFill(args: string[]): Promise<string> {
  const uid = args[0];
  const value = args.slice(1).join(" ");
  if (!uid) {
    throw new CdpError("Missing element ref", "VALIDATION_ERROR", [
      'Run `chrome-devtools-axi fill @<uid> "text"` — get uid from snapshot',
    ]);
  }
  if (!value) {
    throw new CdpError("Missing fill text", "VALIDATION_ERROR", [
      'Run `chrome-devtools-axi fill @<uid> "text"` to fill the field',
    ]);
  }

  const snapshot = await callWithSnapshot("fill", { uid: parseUid(uid), value });
  return formatPageOutput(snapshot, "fill");
}

async function handlePress(args: string[]): Promise<string> {
  const key = args[0];
  if (!key) {
    throw new CdpError("Missing key name", "VALIDATION_ERROR", [
      "Run `chrome-devtools-axi press Enter` to press a key",
    ]);
  }

  const snapshot = await callWithSnapshot("press_key", { key });
  return formatPageOutput(snapshot, "press");
}

async function handleType(args: string[]): Promise<string> {
  const text = args.join(" ");
  if (!text) {
    throw new CdpError("Missing text", "VALIDATION_ERROR", [
      'Run `chrome-devtools-axi type "hello"` to type text',
    ]);
  }

  await callTool("type_text", { text });
  const snapshot = stripSnapshotHeader(await callTool("take_snapshot"));
  return formatPageOutput(snapshot, "type");
}

async function handleScroll(args: string[]): Promise<string> {
  const dir = (args[0] ?? "down").toLowerCase();
  const fn = SCROLL_FUNCTIONS[dir];
  if (!fn) {
    throw new CdpError(`Unknown scroll direction: ${dir}`, "VALIDATION_ERROR", [
      "Run `chrome-devtools-axi scroll down` — directions: up, down, top, bottom",
    ]);
  }

  await callTool("evaluate_script", { function: fn });
  const snapshot = stripSnapshotHeader(await callTool("take_snapshot"));
  return formatPageOutput(snapshot, "scroll");
}

async function handleBack(): Promise<string> {
  await callTool("navigate_page", { type: "back" });
  const snapshot = stripSnapshotHeader(await callTool("take_snapshot"));
  return formatPageOutput(snapshot, "back");
}

async function handleWait(args: string[]): Promise<string> {
  const target = args[0];
  if (!target) {
    throw new CdpError("Missing wait target (milliseconds or text)", "VALIDATION_ERROR", [
      "Run `chrome-devtools-axi wait 2000` to wait 2 seconds",
      'Run `chrome-devtools-axi wait "Submit"` to wait for text to appear',
    ]);
  }

  const isNumeric = /^\d+$/.test(target);
  if (isNumeric) {
    await callTool("evaluate_script", {
      function: `new Promise(r => setTimeout(r, ${target}))`,
    });
  } else {
    await callTool("wait_for", { text: [target] });
  }

  const blocks: string[] = [];
  blocks.push(encode({ waited: target }));
  const suggestions = getSuggestions({ command: "wait" });
  if (suggestions.length > 0) blocks.push(renderHelp(suggestions));
  return renderOutput(blocks);
}

async function handleEval(args: string[]): Promise<string> {
  const js = args.join(" ");
  if (!js) {
    throw new CdpError("Missing JavaScript expression", "VALIDATION_ERROR", [
      'Run `chrome-devtools-axi eval "document.title"` to evaluate JavaScript',
    ]);
  }

  const output = await callTool("evaluate_script", { function: js });

  const blocks: string[] = [];
  blocks.push(encode({ result: output.trim() }));
  const suggestions = getSuggestions({ command: "eval" });
  if (suggestions.length > 0) blocks.push(renderHelp(suggestions));
  return renderOutput(blocks);
}

async function handleStart(): Promise<string> {
  const port = await ensureBridge();
  return encode({ status: "ready", port });
}

async function handleStop(): Promise<string> {
  await stopBridge();
  return encode({ status: "stopped" });
}

export async function main(argv: string[]): Promise<void> {
  const args = [...argv];

  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(HELP);
    return;
  }

  const command = args[0] ?? "";
  const commandArgs = args.slice(1);

  try {
    let output: string;

    switch (command) {
      case "open":
        output = await handleOpen(commandArgs);
        break;
      case "snapshot":
        output = await handleSnapshot();
        break;
      case "click":
        output = await handleClick(commandArgs);
        break;
      case "fill":
        output = await handleFill(commandArgs);
        break;
      case "type":
        output = await handleType(commandArgs);
        break;
      case "press":
        output = await handlePress(commandArgs);
        break;
      case "scroll":
        output = await handleScroll(commandArgs);
        break;
      case "back":
        output = await handleBack();
        break;
      case "wait":
        output = await handleWait(commandArgs);
        break;
      case "eval":
        output = await handleEval(commandArgs);
        break;
      case "start":
        output = await handleStart();
        break;
      case "stop":
        output = await handleStop();
        break;
      case "":
        // No command = show current page state
        output = await handleSnapshot();
        break;
      default:
        process.stdout.write(
          renderError(`Unknown command: ${command}`, "UNKNOWN", [
            "Run `chrome-devtools-axi --help` to see available commands",
          ]) + "\n",
        );
        process.exitCode = 1;
        return;
    }

    process.stdout.write(output + "\n");
  } catch (err) {
    if (err instanceof CdpError) {
      process.stdout.write(renderError(err.message, err.code, err.suggestions) + "\n");
    } else {
      const message = err instanceof Error ? err.message : String(err);
      process.stdout.write(renderError(message, "UNKNOWN") + "\n");
    }
    process.exitCode = 1;
  }
}
