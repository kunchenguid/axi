# Documentation generation workflow evidence

An end-to-end contributor simulation added a temporary entry to `catalog.yaml`, ran the documented regeneration command, and confirmed that the new entry appeared in both public documentation surfaces.
The temporary entry was then removed and the documentation regenerated again, restoring the target checkout.

```text
$ pnpm run docs:gen
wrote README.md
wrote docs/index.html

$ rg -n -C 1 'e2e-docs-validation-axi|Temporary catalog entry used only' README.md docs/index.html
README.md:131:| [`e2e-docs-validation-axi`](https://example.com/e2e-docs-validation-axi) | Automated validation | Test fixture | Temporary catalog entry used only to validate documentation generation. |
docs/index.html:576:                    <a href="https://example.com/e2e-docs-validation-axi"
docs/index.html:577:                      ><code>e2e-docs-validation-axi</code></a
docs/index.html:583:                    Temporary catalog entry used only to validate documentation
docs/index.html:584:                    generation.

$ pnpm run docs:check
docs:check ok - generated regions match their sources
```

The drift guard also rejected a hand-edited generated README row and reported the contributor recovery command:

```text
$ pnpm run docs:check
error: README.md is out of sync with catalog.yaml/principles.yaml
help: run `pnpm run docs:gen` and commit the result
exit_code: 1
```

It independently rejected renamed canonical principle headings in both the AXI skill and the site narrative:

```text
error: .agents/skills/axi/SKILL.md: no "## 1. Token-efficient output..." section heading
exit_code: 1

error: docs/index.html: no prose <h4> for principle 1 titled "Token-efficient output"
exit_code: 1
```

The generated catalog surfaces retained their original public rows after the source-of-truth migration:

```text
README catalog tables: byte-identical to base (2 tables)
docs/index.html catalog rows: byte-identical to base (official and community)
```
