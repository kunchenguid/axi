import { encode } from '@toon-format/toon';
import { AbError, abExec } from './ab.js';
import { countRefs, extractTitle } from './snapshot.js';
import { getSuggestions } from './suggestions.js';

const HELP = `usage: agent-browser-axi <command> [args] [flags]
commands[11]:
  open <url>, snapshot, click @<ref>, fill @<ref> <text>, type <text>,
  press <key>, scroll <dir>, back, wait <ms|selector>, eval <js>, (none)=snapshot
flags[3]:
  --selector <css>, --depth <n>, --interactive
`;

function renderHelp(lines: string[]): string {
  if (lines.length === 0) return '';
  const indented = lines.map((l) => `  ${l}`).join('\n');
  return `help[${lines.length}]:\n${indented}`;
}

function renderError(message: string, code: string, suggestions: string[] = []): string {
  const blocks = [encode({ error: message, code })];
  if (suggestions.length > 0) {
    blocks.push(renderHelp(suggestions));
  }
  return blocks.join('\n');
}

function renderOutput(blocks: string[]): string {
  return blocks.filter(Boolean).join('\n');
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

async function handleOpen(args: string[]): Promise<string> {
  const url = args[0];
  if (!url) {
    throw new AbError('Missing URL', 'VALIDATION_ERROR', [
      'Run `agent-browser-axi open https://example.com` to navigate to a page',
    ]);
  }

  await abExec(['navigate', url]);
  const snapshot = await abExec(['snapshot']);
  return formatPageOutput(snapshot, 'open', url);
}

async function handleSnapshot(args: string[]): Promise<string> {
  const abArgs = ['snapshot'];

  // Pass through snapshot-specific flags
  for (let i = 0; i < args.length; i++) {
    if ((args[i] === '--selector' || args[i] === '--depth') && i + 1 < args.length) {
      abArgs.push(args[i], args[i + 1]);
      i++;
    } else if (args[i] === '--interactive') {
      abArgs.push('--interactive');
    }
  }

  const snapshot = await abExec(abArgs);
  return formatPageOutput(snapshot, 'snapshot');
}

async function handleActionWithSnapshot(
  command: string,
  abArgs: string[],
): Promise<string> {
  await abExec(abArgs);
  const snapshot = await abExec(['snapshot']);
  return formatPageOutput(snapshot, command);
}

async function handleWait(args: string[]): Promise<string> {
  const target = args[0];
  if (!target) {
    throw new AbError('Missing wait target (milliseconds or CSS selector)', 'VALIDATION_ERROR', [
      'Run `agent-browser-axi wait 2000` to wait 2 seconds',
      'Run `agent-browser-axi wait ".my-element"` to wait for an element',
    ]);
  }

  await abExec(['wait', target]);

  const blocks: string[] = [];
  blocks.push(encode({ waited: target }));
  const suggestions = getSuggestions({ command: 'wait' });
  if (suggestions.length > 0) blocks.push(renderHelp(suggestions));
  return renderOutput(blocks);
}

async function handleEval(args: string[]): Promise<string> {
  const js = args.join(' ');
  if (!js) {
    throw new AbError('Missing JavaScript expression', 'VALIDATION_ERROR', [
      'Run `agent-browser-axi eval "document.title"` to evaluate JavaScript',
    ]);
  }

  const output = await abExec(['eval', js]);

  const blocks: string[] = [];
  blocks.push(encode({ result: output.trim() }));
  const suggestions = getSuggestions({ command: 'eval' });
  if (suggestions.length > 0) blocks.push(renderHelp(suggestions));
  return renderOutput(blocks);
}

export async function main(argv: string[]): Promise<void> {
  const args = [...argv];

  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(HELP);
    return;
  }

  const command = args[0] ?? '';
  const commandArgs = args.slice(1);

  try {
    let output: string;

    switch (command) {
      case 'open':
        output = await handleOpen(commandArgs);
        break;
      case 'snapshot':
        output = await handleSnapshot(commandArgs);
        break;
      case 'click':
        output = await handleActionWithSnapshot('click', ['click', ...commandArgs]);
        break;
      case 'fill':
        output = await handleActionWithSnapshot('fill', ['fill', ...commandArgs]);
        break;
      case 'type':
        output = await handleActionWithSnapshot('type', ['type', ...commandArgs]);
        break;
      case 'press':
        output = await handleActionWithSnapshot('press', ['press', ...commandArgs]);
        break;
      case 'scroll':
        output = await handleActionWithSnapshot('scroll', ['scroll', ...commandArgs]);
        break;
      case 'back':
        output = await handleActionWithSnapshot('back', ['back']);
        break;
      case 'wait':
        output = await handleWait(commandArgs);
        break;
      case 'eval':
        output = await handleEval(commandArgs);
        break;
      case '':
        // No command = show current page state
        output = await handleSnapshot([]);
        break;
      default:
        process.stdout.write(
          renderError(`Unknown command: ${command}`, 'UNKNOWN', [
            'Run `agent-browser-axi --help` to see available commands',
          ]) + '\n',
        );
        process.exitCode = 1;
        return;
    }

    process.stdout.write(output + '\n');
  } catch (err) {
    if (err instanceof AbError) {
      process.stdout.write(renderError(err.message, err.code, err.suggestions) + '\n');
    } else {
      const message = err instanceof Error ? err.message : String(err);
      process.stdout.write(renderError(message, 'UNKNOWN') + '\n');
    }
    process.exitCode = 1;
  }
}
