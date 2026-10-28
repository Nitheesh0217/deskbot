import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

const py = (args: string[]) => spawnSync("python3", ["-I", ...args], { encoding: "utf8" });
const T0 = 1_700_000_000_000 - (1_700_000_000_000 % 300_000);
const bar = (i: number, o = 100, h = 101, l = 99, c = 100.5, v = 10) => [T0 + i * 300_000, o, h, l, c, v].join(",");
const csv = (rows: string[]) => { const d = mkdtempSync(join(tmpdir(), "scrub-")); const f = join(d, "k.csv"); writeFileSync(f, rows.join("\n") + "\n"); return f; };
const status = (out: string) => Object.fromEntries(Object.entries(JSON.parse(out).checks as Record<string, { status: string }>).map(([k, v]) => [k, v.status]));

test("data_scrub passes a clean 24x7 file and fails each seeded defect independently", () => {
  const clean = Array.from({ length: 80 }, (_, i) => bar(i));
  const ok = py(["scripts/data_scrub.py", csv(clean)]); assert.equal(ok.status, 0, ok.stdout); assert.ok(Object.values(status(ok.stdout)).every((s) => s === "PASS"));
  const cases: [string, string[], string][] = [
    ["gap", [...clean.slice(0, 40), ...clean.slice(42)], "no_gaps_24x7"],
    ["duplicate timestamp", [...clean, clean[10]], "timestamps_unique_monotonic"],
    ["bad OHLC (high below close)", clean.map((r, i) => (i === 30 ? bar(30, 100, 100.2, 99, 100.9) : r)), "ohlc_integrity"],
    ["stale zero-volume flat bar", clean.map((r, i) => (i === 20 ? bar(20, 100, 100, 100, 100, 0) : r)), "no_stale_synthetic_bars"],
    ["25% return outlier", clean.map((r, i) => (i >= 50 ? bar(i, 126, 127, 125, 126) : r)), "no_return_outliers_over_20pct"],
    ["misaligned timestamp", clean.map((r, i) => (i === 5 ? r.replace(String(T0 + 5 * 300_000), String(T0 + 5 * 300_000 + 1000)) : r)), "timestamps_aligned_to_timeframe"],
  ];
  for (const [name, rows, check] of cases) { const r = py(["scripts/data_scrub.py", csv(rows)]); assert.equal(r.status, 1, `${name} must fail`); assert.equal(status(r.stdout)[check], "FAIL", `${name} -> ${check}`); }
});

function runFile(sym: string, trades: { n: number }[], maxDD = 0.2) {
  const d = mkdtempSync(join(tmpdir(), "run-")), f = join(d, `${sym}.json`);
  writeFileSync(f, JSON.stringify({ meta: { sym, startEquity: 350, maxDD }, trades })); return f;
}
const mkTrades = (n: number, win: number, loss: number, winRate: number) => Array.from({ length: n }, (_, i) => ({ n: i / n < winRate ? win : -loss }));

test("backtest_expert_gate: negative expectancy and a short test window are blocked; the wrapper never invents a pass", () => {
  const bad = py(["scripts/backtest_expert_gate.py", "--num-parameters", "10", runFile("BTC", mkTrades(100, 5, 5, 0.35))]);
  assert.equal(bad.status, 0, bad.stderr); const r = JSON.parse(bad.stdout); assert.equal(r.diagnostic_only, true);
  assert.equal(r.results.BTC.decision, "REJECT"); assert.ok(r.results.BTC.blocking_reasons.includes("negative_expectancy")); assert.ok(r.results.BTC.blocking_reasons.includes("short_test_period"));
  const few = JSON.parse(py(["scripts/backtest_expert_gate.py", "--num-parameters", "10", runFile("BTC", mkTrades(12, 5, 5, 0.5))]).stdout);
  assert.equal(few.results.BTC.decision, "NOT_EVALUABLE", "fewer than 30 trades");
  const onlyWins = JSON.parse(py(["scripts/backtest_expert_gate.py", "--num-parameters", "10", runFile("BTC", mkTrades(50, 5, 5, 1))]).stdout);
  assert.equal(onlyWins.results.BTC.decision, "NOT_EVALUABLE");
});

test("installed third-party skills: pinned, licensed, no network or credentials, and the one script is unchanged and standard-library only", () => {
  const dir = ".claude/skills", skills = ["backtest-expert", "backtest-review", "data-scrub", "strategy-critique", "risk-report"];
  for (const s of skills) { for (const f of ["SKILL.md", "LICENSE", "UPSTREAM.txt"]) assert.ok(existsSync(join(dir, s, f)), `${s}/${f}`); assert.match(readFileSync(join(dir, s, "UPSTREAM.txt"), "utf8"), /[0-9a-f]{40}/, "pinned commit"); assert.match(readFileSync(join(dir, s, "LICENSE"), "utf8"), /MIT License/); }
  const text = skills.map((s) => readFileSync(join(dir, s, "SKILL.md"), "utf8")).join("\n");
  assert.ok(!/allowed-tools/i.test(text) && !/\b(curl|wget)\b/.test(text), "no tool grants or downloads in the skill prompts");
  const script = readFileSync(join(dir, "backtest-expert/scripts/evaluate_backtest.py"), "utf8");
  assert.equal(createHash("sha256").update(script).digest("hex"), "cffb9ae1e2a619c9722af38dbf5d831cb04bef961f295695796f992309b79e06", "evaluate_backtest.py matches the audited upstream file");
  const imports = [...script.matchAll(/^(?:from|import)\s+([A-Za-z_][\w.]*)/gm)].map((m) => m[1].split(".")[0]);
  assert.deepEqual([...new Set(imports)].sort(), ["__future__", "argparse", "datetime", "decimal", "json", "math", "pathlib", "sys"], "standard library only");
  assert.deepEqual(readdirSync(join(dir, "backtest-expert/scripts")), ["evaluate_backtest.py"]);
});
