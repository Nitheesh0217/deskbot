"""Diagnostic gate: converts DeskBot research run files (out/runs/*.json from the research harness: meta + compact trades) into the inputs of the
installed `backtest-expert` evaluator (tradermonty/claude-trading-skills, MIT) and prints its decision per book/window.
DIAGNOSTIC ONLY. It reads summary statistics, so it cannot see look-ahead, venue or data-quality problems, learning-rule censoring or a
contaminated holdout; and it never overrides frozen decision rules (SPEC_FROZEN.md). Standard library only, no network.
  python3 -I scripts/backtest_expert_gate.py --num-parameters 40 out/runs/BASE_BTC_A_*.json [more run files...]
Files of the same symbol are pooled into one window; trades are percent-of-start-equity (net $ / start equity)."""
import argparse, json, subprocess, sys, tempfile
from collections import defaultdict
from pathlib import Path
ap = argparse.ArgumentParser(); ap.add_argument("files", nargs="+"); ap.add_argument("--num-parameters", type=int, required=True)
ap.add_argument("--years-per-file", type=float, default=1.0); ap.add_argument("--slippage-tested", action="store_true", default=True)
a = ap.parse_args()
EVAL = Path(__file__).resolve().parent.parent / ".claude/skills/backtest-expert/scripts/evaluate_backtest.py"
by = defaultdict(list)
for f in a.files:
    j = json.load(open(f)); by[j["meta"]["sym"]].append(j)
out = {}
for sym, js in sorted(by.items()):
    tr = [t for j in js for t in j["trades"]]; eq0 = sum(j["meta"]["startEquity"] for j in js) / len(js)
    w = [t["n"] / eq0 * 100 for t in tr if t["n"] > 0]; l = [-t["n"] / eq0 * 100 for t in tr if t["n"] <= 0]
    if not w or not l:
        out[sym] = {"decision": "NOT_EVALUABLE", "why": "needs at least one winning and one losing trade"}; continue
    dd = max(j["meta"]["maxDD"] for j in js) * 100; years = max(1, round(a.years_per_file * len(js)))
    with tempfile.TemporaryDirectory() as d:
        cmd = [sys.executable, "-I", str(EVAL), "--total-trades", str(len(tr)), "--win-rate", f"{100 * len(w) / len(tr):.2f}", "--avg-win-pct", f"{sum(w) / len(w):.4f}", "--avg-loss-pct", f"{sum(l) / len(l):.4f}",
               "--max-drawdown-pct", f"{dd:.2f}", "--years-tested", str(years), "--num-parameters", str(a.num_parameters), "--output-dir", d] + (["--slippage-tested"] if a.slippage_tested else [])
        r = subprocess.run(cmd, capture_output=True, text=True); line = (r.stdout.strip().split("\n") or [""])[0]
        rep = next(iter(sorted(Path(d).glob("*.json"))), None); data = json.load(open(rep)) if rep else {}
    out[sym] = {"trades": len(tr), "years": years, "maxDDpct": round(dd, 1), "decision": data.get("decision", "NOT_EVALUABLE"), "quality_score": data.get("quality_score"), "blocking_reasons": data.get("blocking_reasons", []), "summary": line or r.stderr.strip()}
print(json.dumps({"tool": "backtest-expert evaluate_backtest.py (tradermonty, c9b84196)", "diagnostic_only": True, "results": out}, indent=1))
