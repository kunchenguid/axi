import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { parse } from "yaml";

import {
  htmlCatalogRows,
  htmlInline,
  markdownTableCell,
  mdCatalogTable,
} from "./generate-docs.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("catalog HTML escapes text and attribute values", () => {
  const html = htmlCatalogRows(
    [
      {
        name: '<img src=x onerror="alert(1)">',
        url: 'https://example.com/?q="&a=1',
        author: "<strong>Author</strong>",
        domain: "<script>alert(1)</script>",
        description:
          'Read [<img src=x onerror="alert(1)">](https://example.com/?q="&a=1).',
      },
    ],
    true,
  );

  assert.match(html, /href="https:\/\/example\.com\/\?q=&quot;&amp;a=1"/);
  assert.match(html, /&lt;img src=x onerror="alert\(1\)"&gt;/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<img|<script/);
});

test("catalog HTML rejects unsafe link protocols", () => {
  assert.throws(
    () =>
      htmlCatalogRows(
        [
          {
            name: "unsafe-axi",
            url: "javascript:alert(1)",
            domain: "Test",
            description: "Test entry",
          },
        ],
        false,
      ),
    /Unsupported link URL protocol: javascript:/,
  );
  assert.throws(
    () => htmlInline("[unsafe](data:text/html,alert(1))"),
    /Unsupported link URL protocol: data:/,
  );
});

test("catalog HTML supports Markdown link destinations with parentheses", () => {
  assert.equal(
    htmlInline(
      "See [Function](https://en.wikipedia.org/wiki/Function_(mathematics)).",
    ),
    'See <a href="https://en.wikipedia.org/wiki/Function_(mathematics)">Function</a>.',
  );
  assert.equal(
    htmlInline("See [escaped](https://example.com/a\\(b\\))."),
    'See <a href="https://example.com/a(b)">escaped</a>.',
  );
});

test("catalog Markdown tables preserve pipes and multiline cells", () => {
  const markdown = mdCatalogTable(
    [
      {
        name: "example|axi",
        url: "https://example.com/a|b",
        author: "Example|Author",
        domain: "Example\nDomain",
        description:
          "Uses `a|b`, [a|b](https://example.com/a|b), and an escaped \\|.",
      },
    ],
    true,
  );

  assert.match(
    markdown,
    /^\| \[`example\\\|axi`\]\(https:\/\/example\.com\/a\\\|b\) \| Example\\\|Author \| Example Domain \| Uses `a\\\|b`, \[a\\\|b\]\(https:\/\/example\.com\/a\\\|b\), and an escaped \\|\. \|$/m,
  );
  assert.equal(markdownTableCell("already escaped \\|"), "already escaped \\|");
});

test("community catalog lands porkbun-axi with coolify-style admission exception", () => {
  const catalog = parse(readFileSync(join(root, "catalog.yaml"), "utf8"));
  const porkbun = catalog.community.find(
    (entry) => entry.name === "porkbun-axi",
  );
  assert.ok(porkbun, "porkbun-axi must be present in catalog.community");
  assert.equal(porkbun.author, "ardaatahan");
  assert.equal(porkbun.domain, "Domains / Porkbun");
  assert.equal(porkbun.url, "https://github.com/ardaatahan/porkbun-axi");

  assert.equal(porkbun.admission.status, "exception");
  assert.equal(
    porkbun.admission.reviewed_revision,
    "394fb206ea58c6d0aaa33a0f24bd6f70f84f206e",
  );
  for (const command of ["dns create", "forwarding create", "glue create"]) {
    assert.match(
      porkbun.admission.exception,
      new RegExp(`\`${command}\``),
      `admission.exception must document ungated \`${command}\``,
    );
  }

  const markdown = mdCatalogTable([porkbun], true);
  assert.match(
    markdown,
    /\[`porkbun-axi`\]\(https:\/\/github\.com\/ardaatahan\/porkbun-axi\)/,
  );

  const html = htmlCatalogRows([porkbun], true);
  assert.match(html, /href="https:\/\/github\.com\/ardaatahan\/porkbun-axi"/);
  assert.match(html, /<code>porkbun-axi<\/code>/);
});

test("community catalog lands fal-axi as documented admission exception", () => {
  const catalog = parse(readFileSync(join(root, "catalog.yaml"), "utf8"));
  const fal = catalog.community.find((entry) => entry.name === "fal-axi");
  assert.ok(fal, "fal-axi must be present in catalog.community");
  assert.equal(fal.author, "ardaatahan");
  assert.equal(fal.domain, "Image / Video Generation");
  assert.equal(fal.url, "https://github.com/ardaatahan/fal-axi");

  assert.equal(fal.admission.status, "exception");
  assert.equal(
    fal.admission.reviewed_revision,
    "532c85a4afcf13cb76b9d7f352fe947182a3ccb8",
  );
  assert.ok(
    fal.admission.reviewed_components.includes("src/commands/home.ts"),
    "reviewed_components must include home.ts for version probing",
  );
  assert.ok(
    typeof fal.admission.exception === "string" &&
      fal.admission.exception.length > 0,
    "admission.exception must be present",
  );
  assert.match(
    fal.admission.exception,
    /UsageError to exit 1.*RuntimeError to exit 2/s,
    "exception must document inverted exit taxonomy",
  );
  assert.match(
    fal.admission.exception,
    /AXI principle 6/,
    "exception must cite AXI principle 6",
  );
  assert.match(
    fal.admission.exception,
    /`--version`/,
    "exception must document --version probing",
  );
  assert.match(
    fal.admission.exception,
    /`-v`\/`-V`/,
    "exception must document rejected short version flags",
  );
  assert.match(
    fal.admission.exception,
    /AXI principle 10/,
    "exception must cite AXI principle 10",
  );

  const confirmObs = fal.admission.source_observations.find((obs) =>
    obs.includes("--confirm"),
  );
  assert.ok(
    confirmObs,
    "source_observations must keep paid generate --confirm gates",
  );
  assert.match(
    confirmObs,
    /requireConfirmation\(\).*--confirm/s,
    "confirm observation must describe requireConfirmation/--confirm gating",
  );

  const markdown = mdCatalogTable([fal], true);
  assert.match(
    markdown,
    /\[`fal-axi`\]\(https:\/\/github\.com\/ardaatahan\/fal-axi\)/,
  );
  assert.match(markdown, /Image \/ Video Generation/);
  assert.match(markdown, /--confirm gates on paid generates/);

  const html = htmlCatalogRows([fal], true);
  assert.match(html, /href="https:\/\/github\.com\/ardaatahan\/fal-axi"/);
  assert.match(html, /<code>fal-axi<\/code>/);
  assert.match(html, /Image \/ Video Generation/);
  assert.match(html, /--confirm gates on paid generates/);
});

test("community catalog lands canva-axi as documented admission exception", () => {
  const catalog = parse(readFileSync(join(root, "catalog.yaml"), "utf8"));
  const canva = catalog.community.find((entry) => entry.name === "canva-axi");
  assert.ok(canva, "canva-axi must be present in catalog.community");
  assert.equal(canva.author, "ardaatahan");
  assert.equal(canva.domain, "Design / Canva");
  assert.equal(canva.url, "https://github.com/ardaatahan/canva-axi");

  assert.equal(canva.admission.status, "exception");
  assert.equal(
    canva.admission.reviewed_revision,
    "2ed9911e00172c735814d871c139346bd505f37a",
  );
  assert.ok(
    canva.admission.reviewed_components.includes("src/commands/home.ts"),
    "reviewed_components must include home.ts for version probing",
  );
  assert.ok(
    typeof canva.admission.exception === "string" &&
      canva.admission.exception.length > 0,
    "admission.exception must be present",
  );

  const markdown = mdCatalogTable([canva], true);
  assert.match(
    markdown,
    /\[`canva-axi`\]\(https:\/\/github\.com\/ardaatahan\/canva-axi\)/,
  );
  assert.match(markdown, /Design \/ Canva/);
  assert.match(markdown, /--confirm gates on mutating writes/);

  const html = htmlCatalogRows([canva], true);
  assert.match(html, /href="https:\/\/github\.com\/ardaatahan\/canva-axi"/);
  assert.match(html, /<code>canva-axi<\/code>/);
  assert.match(html, /Design \/ Canva/);
  assert.match(html, /--confirm gates on mutating writes/);
});
