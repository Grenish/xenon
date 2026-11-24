import { afterEach, describe, expect, test } from "bun:test";
import * as ui from "../../src/cli/ui";

const ESC = "\u001B[";

afterEach(() => ui.setColor(false));

describe("CLI terminal UI", () => {
  test("plain output has no escape codes", () => {
    ui.setColor(false);
    const out = [
      ui.intro("init", "1.2.3"),
      ui.answer("Database", "PGlite", "detected"),
      ...ui.fileRows([{ path: "a.ts", action: "created" }]),
      ...ui.steps(["Run `npm run dev`"]),
      ui.success("Done"),
      ui.failure("Broken", "Try again"),
    ].join("\n");
    expect(out).not.toContain(ESC);
    expect(out).toContain("Xenon");
    expect(out).toContain("v1.2.3");
    expect(out).toContain("Run `npm run dev`");
  });

  test("color output highlights code spans and drops their backticks", () => {
    ui.setColor(true);
    const [line] = ui.steps(["Run `npm run dev`"]);
    expect(line).toContain(ESC);
    expect(line).not.toContain("`");
    expect(ui.visibleLength(line!)).toBe("    1  Run npm run dev".length);
  });

  test("file rows align and describe each action", () => {
    ui.setColor(false);
    const rows = ui.fileRows([
      { path: "xenon.config.ts", action: "created" },
      { path: ".gitignore", action: "updated" },
      { path: "next.config.ts", action: "skipped" },
    ]);
    expect(rows[0]).toMatch(/\+ xenon\.config\.ts {2}created$/);
    expect(rows[1]).toMatch(/~ \.gitignore {7}updated$/);
    expect(rows[2]).toMatch(/next\.config\.ts {3}unchanged$/);
    expect(ui.fileRows([{ path: "a.ts", action: "created" }], { dryRun: true })[0]).toContain("would create");
    expect(ui.fileRows([{ path: "a.ts", action: "created" }], { verbs: false })[0]).toBe("    + a.ts");
  });

  test("help aligns option descriptions in one column", () => {
    ui.setColor(false);
    const help = ui.formatHelp({
      title: "CLI",
      version: "1.0.0",
      description: "Does things.",
      usage: ["tool run"],
      options: [["-y, --yes", "Skip prompts"], ["    --dry-run", "Preview"]],
      examples: ["tool run --yes"],
    });
    const columns = help.split("\n").filter((l) => l.includes("Skip prompts") || l.includes("Preview")).map((l) => l.search(/Skip|Preview/));
    expect(new Set(columns).size).toBe(1);
    expect(help).toContain("$ tool run --yes");
  });

  test("durations", () => {
    expect(ui.formatDuration(420)).toBe("420ms");
    expect(ui.formatDuration(4810)).toBe("4.8s");
  });
});
