# oracle-axi catalog admission review

Review target: `thatdudealso/oracle-axi` at source revision `4f4d3da6cfd1578d871fa3e23389264e3faf93ff` (repository `HEAD` on 2026-07-21).

## Provenance

- Source repository: https://github.com/thatdudealso/oracle-axi
- Pinned entrypoint: `bin/oracle-axi.js`
- Package metadata: `package.json`, version `0.1.0`, binary `oracle-axi: ./bin/oracle-axi.js`
- No Git tag was advertised by `git ls-remote`; `npm view oracle-axi` returned registry `E404`. No released package exists, so released-package execution is not applicable.

## Source inspection and observations

The pinned entrypoint defines `home`, `services`, and `discover` handlers, validates command-specific flags before dependency calls, emits structured stdout, and adds actionable `help` commands. Representative source executions at the pinned revision produced:

```text
$ curl -fsSL https://raw.githubusercontent.com/thatdudealso/oracle-axi/4f4d3da6cfd1578d871fa3e23389264e3faf93ff/bin/oracle-axi.js | node -
targets_count: 0
targets: 0 Oracle targets detected in this workspace
help[3]:
  Run `oracle-axi doctor` to check Oracle readiness
  Run `oracle-axi discover --full` to inspect project Oracle targets
  Run `oracle-axi recommend --goal local-dev` to choose an Oracle path

$ curl -fsSL https://raw.githubusercontent.com/thatdudealso/oracle-axi/4f4d3da6cfd1578d871fa3e23389264e3faf93ff/bin/oracle-axi.js | node - services --capability querying
count: 1 of 12 Oracle domains
services[1]{capability,domain,use}:
  querying,"capped-reads|write-guards|result-truncation",run safe SQL with default read-only behavior
help[1]:
  Run `oracle-axi recommend --goal <inspect|create|schema|query|export|import|roles|performance|maintenance|plsql|cloud|local-dev>` for workflow paths

$ curl -fsSL https://raw.githubusercontent.com/thatdudealso/oracle-axi/4f4d3da6cfd1578d871fa3e23389264e3faf93ff/bin/oracle-axi.js | node - discover --bogus
error: unknown flag --bogus for `discover`
help[1]:
  valid flags for `discover`: --connect, --cwd, --fields, --full, --help, --password, --service, --tns-admin, --user, --wallet
```

The source paths inspected for these observations are `main`, `parseArgs`, `home`, `services`, `discover`, `formatHelp`, and `usageError` in `bin/oracle-axi.js`.

Verdict: source inspection supports the proposed community catalog admission for the described AXI-facing behavior. This review does not claim released-package behavior because no release was available at the pinned review time.
