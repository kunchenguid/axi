import { describe, expect, it } from "vitest";
import { AxiError } from "../src/errors.js";
import { checkFlags, type AxiFlags } from "../src/flags.js";

const flags: AxiFlags = {
  limit: { type: "string" },
  offset: { type: "string" },
  full: { type: "boolean" },
  recursive: { type: "boolean", short: "r" },
  name: { type: "string", short: "n" },
  label: { type: "string", multiple: true },
  page: { type: "string", default: "1" },
  transparency: { refuse: "Use --free or --busy" },
};

const validFlagsLine =
  "Valid flags for `search`: --full, --label, --limit, --name, --offset, --page, --recursive (--help always allowed)";

function check(args: string[], options = {}) {
  return checkFlags(args, flags, "search", { bin: "tool", ...options });
}

function failure(args: string[], options = {}): AxiError {
  try {
    check(args, options);
  } catch (error) {
    if (error instanceof AxiError) {
      return error;
    }
    throw error;
  }
  throw new Error(`expected ${JSON.stringify(args)} to be rejected`);
}

describe("checkFlags", () => {
  describe("errors", () => {
    it("refuses an unknown flag with the valid flags and help, in that order", () => {
      const error = failure(["--foo"]);

      expect(error.code).toBe("VALIDATION_ERROR");
      expect(error.message).toBe("Unknown flag --foo for `search`");
      expect(error.suggestions).toEqual([
        validFlagsLine,
        "Run `tool search --help` for usage",
      ]);
    });

    it("refuses an unknown short option the same way", () => {
      const error = failure(["-x"]);

      expect(error.message).toBe("Unknown flag -x for `search`");
      expect(error.suggestions).toEqual([
        validFlagsLine,
        "Run `tool search --help` for usage",
      ]);
    });

    it("puts the refuse hint first for a declared-but-refused flag", () => {
      for (const args of [
        ["--transparency", "transparent"],
        ["--transparency=transparent"],
        ["--transparency"],
      ]) {
        const error = failure(args);

        expect(error.code).toBe("VALIDATION_ERROR");
        expect(error.message).toBe("Unknown flag --transparency for `search`");
        expect(error.suggestions).toEqual([
          "Use --free or --busy",
          validFlagsLine,
          "Run `tool search --help` for usage",
        ]);
      }
    });

    it("does not list refused flags among the valid ones", () => {
      expect(failure(["--foo"]).suggestions[0]).not.toContain("transparency");
    });

    it("rejects a value flag with no value", () => {
      const error = failure(["--limit"]);

      expect(error.code).toBe("VALIDATION_ERROR");
      expect(error.message).toBe("Flag --limit for `search` needs a value");
      expect(error.suggestions).toEqual([
        "Pass `--limit <value>`, or `--limit=<value>` when the value starts with a dash",
        "Run `tool search --help` for usage",
      ]);
    });

    it("rejects a value flag followed by another flag (Node calls it ambiguous)", () => {
      expect(failure(["--limit", "--full"]).message).toBe(
        "Flag --limit for `search` needs a value",
      );
      expect(failure(["--offset", "-5"]).message).toBe(
        "Flag --offset for `search` needs a value",
      );
    });

    it("rejects a boolean flag given a value", () => {
      const error = failure(["--full=yes"]);

      expect(error.code).toBe("VALIDATION_ERROR");
      expect(error.message).toBe(
        "Flag --full for `search` does not take a value",
      );
      expect(error.suggestions).toEqual([
        "Pass `--full` on its own",
        "Run `tool search --help` for usage",
      ]);
    });

    it("names the long form when a boolean with a short alias is given a value", () => {
      expect(failure(["--recursive=true"]).message).toBe(
        "Flag --recursive for `search` does not take a value",
      );
    });

    it("says a command takes no flags when it declares none", () => {
      const error = (() => {
        try {
          checkFlags(["--foo"], {}, "doctor", { bin: "tool" });
        } catch (error) {
          return error as AxiError;
        }
        throw new Error("expected rejection");
      })();

      expect(error.suggestions).toEqual([
        "`doctor` takes no flags (--help always allowed)",
        "Run `tool doctor --help` for usage",
      ]);
    });

    it("uses the bin name in the help suggestion", () => {
      expect(failure(["--foo"], { bin: "gws-axi" }).suggestions.at(-1)).toBe(
        "Run `gws-axi search --help` for usage",
      );
    });

    it("accepts a nested command name verbatim", () => {
      const error = (() => {
        try {
          checkFlags(["--foo"], {}, "gmail search", { bin: "gws-axi" });
        } catch (error) {
          return error as AxiError;
        }
        throw new Error("expected rejection");
      })();

      expect(error.message).toBe("Unknown flag --foo for `gmail search`");
      expect(error.suggestions.at(-1)).toBe(
        "Run `gws-axi gmail search --help` for usage",
      );
    });
  });

  describe("normalization", () => {
    it("rewrites --flag=value into --flag value", () => {
      expect(check(["--limit=5", "x"]).args).toEqual(["--limit", "5", "x"]);
    });

    it("keeps an empty inline value", () => {
      expect(check(["--limit="]).args).toEqual(["--limit", ""]);
    });

    it("keeps equals signs inside a value", () => {
      expect(check(["--limit=a=b"]).args).toEqual(["--limit", "a=b"]);
    });

    it("rewrites --offset=-5 into --offset -5", () => {
      const result = check(["--offset=-5"]);

      expect(result.args).toEqual(["--offset", "-5"]);
      expect(result.parsed.values.offset).toBe("-5");
    });

    it("passes an inline value that starts with -- through as a value", () => {
      const result = check(["--limit=--foo"]);

      expect(result.args).toEqual(["--limit", "--foo"]);
      expect(result.parsed.values.limit).toBe("--foo");
    });

    it("expands a declared short alias to its long form", () => {
      expect(check(["-r", "pos"]).args).toEqual(["--recursive", "pos"]);
    });

    it("expands a short alias with an attached or separate value", () => {
      expect(check(["-n5"]).args).toEqual(["--name", "5"]);
      expect(check(["-n", "5"]).args).toEqual(["--name", "5"]);
    });

    it("expands grouped short aliases", () => {
      expect(check(["-rn5"]).args).toEqual(["--recursive", "--name", "5"]);
    });

    it("keeps a repeated multiple flag in order", () => {
      const result = check(["--label", "a", "--label=b"]);

      expect(result.args).toEqual(["--label", "a", "--label", "b"]);
      expect(result.parsed.values.label).toEqual(["a", "b"]);
    });

    it("keeps positionals, values, and flags in their original order", () => {
      expect(check(["pos1", "--limit", "5", "pos2", "--full"]).args).toEqual([
        "pos1",
        "--limit",
        "5",
        "pos2",
        "--full",
      ]);
    });

    it("treats a lone - as a positional", () => {
      const result = check(["-"]);

      expect(result.args).toEqual(["-"]);
      expect(result.parsed.positionals).toEqual(["-"]);
    });

    it("accepts a lone - as a flag value", () => {
      expect(check(["--limit", "-"]).args).toEqual(["--limit", "-"]);
    });

    it("passes everything after -- through unchecked and byte-identical", () => {
      const result = check([
        "a",
        "--limit=1",
        "--",
        "--bogus",
        "-x",
        "--limit=3",
        "--transparency",
        "--",
      ]);

      expect(result.args).toEqual([
        "a",
        "--limit",
        "1",
        "--",
        "--bogus",
        "-x",
        "--limit=3",
        "--transparency",
        "--",
      ]);
      expect(result.parsed.positionals).toEqual([
        "a",
        "--bogus",
        "-x",
        "--limit=3",
        "--transparency",
        "--",
      ]);
    });

    it("passes --help through", () => {
      const result = check(["--help"]);

      expect(result.args).toEqual(["--help"]);
      expect(result.parsed.values.help).toBe(true);
    });
  });

  describe("parsed", () => {
    it("returns values and positionals", () => {
      const result = check(["x", "--limit=5", "--full", "y"]);

      expect(result.parsed).toEqual({
        values: { limit: "5", full: true, page: "1" },
        positionals: ["x", "y"],
      });
    });

    it("applies defaults to parsed.values only, never to args", () => {
      const result = check(["x"]);

      expect(result.parsed.values.page).toBe("1");
      expect(result.args).toEqual(["x"]);
    });
  });

  describe("globalFlags", () => {
    it("accepts global flags on every declared command and lists them", () => {
      const result = check(["--account", "me@example.com", "x"], {
        globalFlags: { account: { type: "string" } },
      });

      expect(result.args).toEqual(["--account", "me@example.com", "x"]);
      expect(result.parsed.values.account).toBe("me@example.com");

      const error = failure(["--foo"], {
        globalFlags: { account: { type: "string" } },
      });
      expect(error.suggestions[0]).toBe(
        "Valid flags for `search`: --account, --full, --label, --limit, --name, --offset, --page, --recursive (--help always allowed)",
      );
    });

    it("lets the command's declaration win over a global on a name clash", () => {
      const globalFlags: AxiFlags = {
        account: { type: "string" },
        limit: { type: "boolean" },
      };

      // `limit` is a string on the command, so `--limit 5` is accepted.
      expect(check(["--limit", "5"], { globalFlags }).args).toEqual([
        "--limit",
        "5",
      ]);

      // A command can refuse a global outright.
      const noAccount: AxiFlags = {
        account: { refuse: "`doctor` checks every account; drop --account" },
      };
      const error = (() => {
        try {
          checkFlags(["--account", "x"], noAccount, "doctor", {
            bin: "tool",
            globalFlags,
          });
        } catch (error) {
          return error as AxiError;
        }
        throw new Error("expected rejection");
      })();
      expect(error.message).toBe("Unknown flag --account for `doctor`");
      expect(error.suggestions[0]).toBe(
        "`doctor` checks every account; drop --account",
      );
    });
  });
});
