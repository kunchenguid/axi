import { tryFastPath } from "../../src/fast-path.ts";

const argv = process.argv.slice(2);

if (!tryFastPath(argv, { version: "9.9.9" })) {
  const { runAxiCli } = await import("../../src/cli.ts");
  process.stdout.write("loaded-heavy-graph\n");
  await runAxiCli({
    description: "Fixture CLI",
    version: "9.9.9",
    topLevelHelp: "fixture help",
    hooks: false,
    argv,
    home: async () => "home output",
    commands: {
      issue: async () => "issue output",
    },
  });
}
