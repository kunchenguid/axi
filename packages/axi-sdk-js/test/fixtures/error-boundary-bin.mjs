import { AxiError, runAxiCli } from "../../src/index.ts";

const [phase, errorKind, view] = process.argv.slice(2);

function fixtureError() {
  if (errorKind === "axi") {
    return new AxiError("Invalid fixture request", "VALIDATION_ERROR", [
      "Run `fixture --help`",
    ]);
  }

  return new Error("Dependency exploded");
}

await runAxiCli({
  description: "Fixture CLI",
  argv: view === "command" ? ["issue", "list"] : [],
  topLevelHelp: "fixture help",
  initialize:
    phase === "initialize"
      ? () => {
          throw fixtureError();
        }
      : phase === "initialize-async"
        ? async () => {
            throw fixtureError();
          }
        : undefined,
  resolveContext:
    phase === "resolveContext"
      ? async () => {
          throw fixtureError();
        }
      : undefined,
  home: async () => ({ home: "ok" }),
  commands: {
    issue: async () => ({ issues: [] }),
  },
});
