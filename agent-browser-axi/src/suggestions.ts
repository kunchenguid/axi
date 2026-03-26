import { extractRefs, isInputType } from './snapshot.js';

export interface SuggestionContext {
  command: string;
  url?: string;
  snapshot?: string;
}

export function getSuggestions(ctx: SuggestionContext): string[] {
  // Commands without auto-snapshot — suggest viewing page state
  if (ctx.command === 'wait' || ctx.command === 'eval') {
    return ['Run `agent-browser-axi snapshot` to see current page state'];
  }

  const refs = ctx.snapshot ? extractRefs(ctx.snapshot) : [];
  const links = refs.filter((r) => r.type === 'link');
  const buttons = refs.filter((r) => r.type === 'button');
  const inputs = refs.filter((r) => isInputType(r.type));
  const lines: string[] = [];

  // After filling a field, suggest submitting
  if (ctx.command === 'fill') {
    const submitBtn = buttons.find((r) =>
      /submit|search|go|send|login|sign|ok/i.test(r.label),
    );
    if (submitBtn) {
      lines.push(
        `Run \`agent-browser-axi click @${submitBtn.ref}\` to click "${submitBtn.label}"`,
      );
    } else {
      lines.push('Run `agent-browser-axi press Enter` to submit the form');
    }
  }

  // Suggest filling inputs (unless we just filled one)
  if (inputs.length > 0 && ctx.command !== 'fill') {
    const inp = inputs[0];
    const label = inp.label ? `the "${inp.label}" field` : 'the input field';
    lines.push(
      `Run \`agent-browser-axi fill @${inp.ref} "text"\` to fill ${label}`,
    );
  }

  // Suggest clicking buttons
  if (buttons.length > 0 && lines.length < 2) {
    const btn = ctx.command === 'fill'
      ? buttons.find((r) => !/submit|search|go|send|login|sign|ok/i.test(r.label)) ?? buttons[0]
      : buttons[0];
    if (btn && !lines.some((l) => l.includes(`@${btn.ref}`))) {
      const label = btn.label ? `"${btn.label}" ` : '';
      lines.push(
        `Run \`agent-browser-axi click @${btn.ref}\` to click the ${label}button`,
      );
    }
  }

  // Suggest clicking links
  if (links.length > 0 && lines.length < 2) {
    const link = links[0];
    lines.push(
      `Run \`agent-browser-axi click @${link.ref}\` to click the "${link.label}" link`,
    );
  }

  // Suggest scrolling if page has many elements
  if (refs.length > 5 && lines.length < 3) {
    lines.push('Run `agent-browser-axi scroll down` to scroll down');
  }

  return lines.slice(0, 3);
}
