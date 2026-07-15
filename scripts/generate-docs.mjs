#!/usr/bin/env node
// Renders catalog.yaml and principles.yaml into the marked regions of
// README.md and docs/index.html, then verifies the AXI skill and the site's
// per-principle prose still carry the canonical principle titles.
//
//   node scripts/generate-docs.mjs          # rewrite the generated regions
//   node scripts/generate-docs.mjs --check  # exit 1 if committed files drift

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import prettier from "prettier";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const checkMode = process.argv.includes("--check");

const catalog = parse(readFileSync(join(root, "catalog.yaml"), "utf8"));
const principles = parse(readFileSync(join(root, "principles.yaml"), "utf8"));

// --- inline renderers ------------------------------------------------------
// Source strings are markdown: `code` spans and [text](url) links.

const mdInline = (text) => text;
const safeUrlProtocols = new Set(["http:", "https:"]);

export function markdownTableCell(value) {
  return value
    .replace(/\s*\r?\n\s*/g, " ")
    .replace(/(^|[^\\])((?:\\\\)*)\|/g, "$1$2\\|");
}

function safeUrl(value) {
  if (typeof value !== "string") {
    throw new Error("Link URLs must be strings");
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Invalid link URL: ${value}`);
  }
  if (!safeUrlProtocols.has(url.protocol)) {
    throw new Error(`Unsupported link URL protocol: ${url.protocol}`);
  }
  return value;
}

function escapeHtmlText(text) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeHtmlAttribute(text) {
  return escapeHtmlText(text)
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function htmlText(text) {
  return escapeHtmlText(text)
    .replace(/"([^"]*)"/g, "&ldquo;$1&rdquo;")
    .replaceAll("–", "&ndash;")
    .replaceAll("—", "&mdash;");
}

function markdownLinkAt(text, start) {
  if (text[start] !== "[") return;

  let labelDepth = 1;
  let labelEnd = start + 1;
  while (labelEnd < text.length && labelDepth > 0) {
    if (text[labelEnd] === "\\") {
      labelEnd += 2;
      continue;
    }
    if (text[labelEnd] === "[") labelDepth += 1;
    if (text[labelEnd] === "]") labelDepth -= 1;
    labelEnd += 1;
  }
  if (labelDepth !== 0 || text[labelEnd] !== "(") return;

  const destinationStart = labelEnd + 1;
  let destinationEnd = destinationStart;
  let destinationDepth = 1;
  while (destinationEnd < text.length && destinationDepth > 0) {
    if (text[destinationEnd] === "\\") {
      destinationEnd += 2;
      continue;
    }
    if (text[destinationEnd] === "(") destinationDepth += 1;
    if (text[destinationEnd] === ")") destinationDepth -= 1;
    destinationEnd += 1;
  }
  if (destinationDepth !== 0 || destinationEnd === destinationStart + 1) {
    return;
  }

  return {
    end: destinationEnd,
    label: text.slice(start + 1, labelEnd - 1),
    destination: text
      .slice(destinationStart, destinationEnd - 1)
      .replace(/\\([()])/g, "$1"),
  };
}

export function htmlInline(text) {
  let html = "";
  let plainStart = 0;
  let index = 0;

  while (index < text.length) {
    if (text[index] === "`") {
      const codeEnd = text.indexOf("`", index + 1);
      if (codeEnd > index + 1) {
        html += htmlText(text.slice(plainStart, index));
        html += `<code>${htmlText(text.slice(index + 1, codeEnd))}</code>`;
        index = codeEnd + 1;
        plainStart = index;
        continue;
      }
    }

    const link = markdownLinkAt(text, index);
    if (link) {
      html += htmlText(text.slice(plainStart, index));
      html += `<a href="${escapeHtmlAttribute(safeUrl(link.destination))}">${htmlInline(link.label)}</a>`;
      index = link.end;
      plainStart = index;
      continue;
    }

    index += 1;
  }

  return html + htmlText(text.slice(plainStart));
}

// --- region renderers ------------------------------------------------------

function mdPrinciplesTable() {
  const rows = principles.map(
    (p) =>
      `| ${p.number} | **${markdownTableCell(p.title)}** | ${markdownTableCell(mdInline(p.summary))} |`,
  );
  return ["| # | Principle | Summary |", "| --- | --- | --- |", ...rows].join(
    "\n",
  );
}

export function mdCatalogTable(entries, withAuthor) {
  const header = withAuthor
    ? ["| AXI | Author | Domain | What it does |", "| --- | --- | --- | --- |"]
    : ["| AXI | Domain | What it does |", "| --- | --- | --- |"];
  const rows = entries.map((e) => {
    const cells = [`[\`${e.name}\`](${safeUrl(e.url)})`];
    if (withAuthor) cells.push(e.author);
    cells.push(e.domain, mdInline(e.description));
    return `| ${cells.map(markdownTableCell).join(" | ")} |`;
  });
  return [...header, ...rows].join("\n");
}

function htmlPrinciplesList() {
  return principles
    .map(
      (p) =>
        `<li><strong>${htmlInline(p.title)}</strong> &mdash; ${htmlInline(p.summary)}</li>`,
    )
    .join("\n");
}

export function htmlCatalogRows(entries, withAuthor) {
  return entries
    .map((e) => {
      const cells = [
        `<td><a href="${escapeHtmlAttribute(safeUrl(e.url))}"><code>${escapeHtmlText(e.name)}</code></a></td>`,
        ...(withAuthor ? [`<td>${htmlInline(e.author)}</td>`] : []),
        `<td>${htmlInline(e.domain)}</td>`,
        `<td>${htmlInline(e.description)}</td>`,
      ];
      return `<tr>\n${cells.join("\n")}\n</tr>`;
    })
    .join("\n");
}

// --- splicing --------------------------------------------------------------

function splice(content, region, replacement, file) {
  const start = `<!-- generated:${region}:start -->`;
  const end = `<!-- generated:${region}:end -->`;
  const startIdx = content.indexOf(start);
  const endIdx = content.indexOf(end);
  if (startIdx === -1 || endIdx === -1) {
    throw new Error(`Missing ${start} / ${end} markers in ${file}`);
  }
  return (
    content.slice(0, startIdx + start.length) +
    "\n" +
    replacement +
    "\n" +
    content.slice(endIdx)
  );
}

async function renderFile(relPath, regions) {
  const path = join(root, relPath);
  const before = readFileSync(path, "utf8");
  let after = before;
  for (const [region, replacement] of Object.entries(regions)) {
    after = splice(after, region, replacement, relPath);
  }
  const config = await prettier.resolveConfig(path);
  after = await prettier.format(after, { ...config, filepath: path });
  return { path, relPath, before, after };
}

// --- title consistency checks ----------------------------------------------
// The AXI skill owns the full spec of each principle and the site's prose
// sections expand on them; both must keep headings aligned with the canonical
// titles in principles.yaml.

function checkTitles(siteHtml) {
  const errors = [];
  const skill = readFileSync(join(root, ".agents/skills/axi/SKILL.md"), "utf8");
  const flatHtml = siteHtml.replace(/\s+/g, " ");
  for (const p of principles) {
    const heading = new RegExp(`^## ${p.number}\\. ${escapeRe(p.title)}`, "m");
    if (!heading.test(skill)) {
      errors.push(
        `.agents/skills/axi/SKILL.md: no "## ${p.number}. ${p.title}..." section heading`,
      );
    }
    const h4 = `${p.number}.</span> ${htmlInline(p.title)}`;
    if (!flatHtml.includes(h4)) {
      errors.push(
        `docs/index.html: no prose <h4> for principle ${p.number} titled "${p.title}"`,
      );
    }
  }
  return errors;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// --- main -------------------------------------------------------------------

async function main() {
  const results = [
    await renderFile("README.md", {
      principles: mdPrinciplesTable(),
      "catalog-official": mdCatalogTable(catalog.official, false),
      "catalog-community": mdCatalogTable(catalog.community, true),
    }),
    await renderFile("docs/index.html", {
      principles: htmlPrinciplesList(),
      "catalog-official": htmlCatalogRows(catalog.official, false),
      "catalog-community": htmlCatalogRows(catalog.community, true),
    }),
  ];

  const titleErrors = checkTitles(
    results.find((r) => r.relPath === "docs/index.html").after,
  );
  if (titleErrors.length > 0) {
    for (const e of titleErrors) console.error(`error: ${e}`);
    process.exitCode = 1;
    return;
  }

  const stale = results.filter((r) => r.before !== r.after);
  if (checkMode) {
    if (stale.length > 0) {
      for (const r of stale) {
        console.error(
          `error: ${r.relPath} is out of sync with catalog.yaml/principles.yaml`,
        );
      }
      console.error("help: run `pnpm run docs:gen` and commit the result");
      process.exitCode = 1;
      return;
    }
    console.log("docs:check ok — generated regions match their sources");
    return;
  }
  for (const r of stale) {
    writeFileSync(r.path, r.after);
    console.log(`wrote ${r.relPath}`);
  }
  if (stale.length === 0) console.log("generated regions already up to date");
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await main();
}
