

from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

REPO_ROOT = Path(__file__).resolve().parents[2]
MEASUREMENTS_CSV = REPO_ROOT / "results" / "normalized" / "measurements.csv"
USABILITY_CSV = REPO_ROOT / "results" / "raw" / "usability.csv"
PLOTS_ROOT = REPO_ROOT / "results" / "plots"

VARIANT_ORDER = ["baseline", "mcp", "mcp_llm", "third_party_mcp_llm", "llm_only"]
FIGSIZE = (9, 5)
DPI = 150

class SkipPlot(Exception):
    pass

def _to_bool01(series: pd.Series) -> pd.Series:
    return series.map({"true": 1.0, "false": 0.0, True: 1.0, False: 0.0})

def load_measurements() -> pd.DataFrame:
    if not MEASUREMENTS_CSV.exists():
        raise SystemExit(
            "[BLAD] Brak %s -- najpierw: npm run normalize" % MEASUREMENTS_CSV.as_posix()
        )
    df = pd.read_csv(MEASUREMENTS_CSV, dtype=str, keep_default_na=False)
    for column in ["latencyMs", "promptTokens", "outputTokens", "totalTokens",
                   "argumentCorrectness", "resultIntegrationScore", "numberOfToolCalls",
                   "unnecessaryToolCalls"]:
        df[column] = pd.to_numeric(df[column], errors="coerce")
    for column in ["success", "toolCallRequested", "toolCallSuccess",
                   "toolSelectionCorrect", "finalAnswerValidJson"]:
        df[column] = _to_bool01(df[column])
    return df

def load_usability() -> pd.DataFrame:
    if not USABILITY_CSV.exists():
        raise SkipPlot("brak results/raw/usability.csv")
    df = pd.read_csv(USABILITY_CSV)
    return df

def _ordered_variants(df: pd.DataFrame) -> list[str]:
    present = df["variant"].unique().tolist()
    return [v for v in VARIANT_ORDER if v in present] + sorted(set(present) - set(VARIANT_ORDER))

def _bar(ax, labels, values, counts=None, fmt="%.0f"):
    positions = np.arange(len(labels))
    bars = ax.bar(positions, values, color="#4878CF")
    ax.set_xticks(positions)
    ax.set_xticklabels(labels, rotation=20, ha="right")
    for index, bar in enumerate(bars):
        annotation = fmt % bar.get_height()
        if counts is not None:
            annotation += "\n(n=%d)" % counts[index]
        ax.annotate(annotation, (bar.get_x() + bar.get_width() / 2, bar.get_height()),
                    ha="center", va="bottom", fontsize=8)
    return bars

def _save(fig, out_dir: Path, name: str) -> str:
    fig.tight_layout()
    file_path = out_dir / ("%s.png" % name)
    fig.savefig(file_path, dpi=DPI)
    plt.close(fig)
    return file_path.name

def _require(df: pd.DataFrame, reason: str) -> pd.DataFrame:
    if df.empty:
        raise SkipPlot(reason)
    return df

def plot_latency_avg_by_variant(df, out_dir):
    data = _require(df.dropna(subset=["latencyMs"]), "brak latencyMs")
    variants = _ordered_variants(data)
    grouped = data.groupby("variant")["latencyMs"]
    means = [grouped.mean()[v] for v in variants]
    counts = [int(grouped.count()[v]) for v in variants]
    fig, ax = plt.subplots(figsize=FIGSIZE)
    _bar(ax, variants, means, counts)
    ax.set_yscale("log")
    ax.set_ylabel("Avg latency [ms] (log)")
    ax.set_title("Average end-to-end latency by variant")
    return _save(fig, out_dir, "latency_avg_by_variant"), "n=%d" % len(data)

def plot_latency_p95_p99_by_variant(df, out_dir):
    data = _require(df.dropna(subset=["latencyMs"]), "brak latencyMs")
    variants = _ordered_variants(data)
    p95 = [data[data["variant"] == v]["latencyMs"].quantile(0.95) for v in variants]
    p99 = [data[data["variant"] == v]["latencyMs"].quantile(0.99) for v in variants]
    positions = np.arange(len(variants))
    fig, ax = plt.subplots(figsize=FIGSIZE)
    ax.bar(positions - 0.2, p95, width=0.4, label="p95", color="#4878CF")
    ax.bar(positions + 0.2, p99, width=0.4, label="p99", color="#D65F5F")
    ax.set_xticks(positions)
    ax.set_xticklabels(variants, rotation=20, ha="right")
    ax.set_yscale("log")
    ax.set_ylabel("Latency percentile [ms] (log)")
    ax.set_title("Latency p95 / p99 by variant")
    ax.legend()
    return _save(fig, out_dir, "latency_p95_p99_by_variant"), None

def plot_latency_boxplot_by_variant(df, out_dir):
    data = _require(df.dropna(subset=["latencyMs"]), "brak latencyMs")
    variants = _ordered_variants(data)
    series = [data[data["variant"] == v]["latencyMs"].values for v in variants]
    fig, ax = plt.subplots(figsize=FIGSIZE)
    ax.boxplot(series, tick_labels=variants, showfliers=True)
    ax.set_yscale("log")
    ax.set_ylabel("Latency [ms] (log)")
    ax.set_title("Latency distribution by variant")
    plt.setp(ax.get_xticklabels(), rotation=20, ha="right")
    return _save(fig, out_dir, "latency_boxplot_by_variant"), None

def plot_latency_avg_by_category(df, out_dir):
    data = _require(df.dropna(subset=["latencyMs"]), "brak latencyMs")
    grouped = data.groupby("category")["latencyMs"]
    labels = sorted(grouped.groups.keys())
    fig, ax = plt.subplots(figsize=FIGSIZE)
    _bar(ax, labels, [grouped.mean()[c] for c in labels], [int(grouped.count()[c]) for c in labels])
    ax.set_yscale("log")
    ax.set_ylabel("Avg latency [ms] (log)")
    ax.set_title("Average latency by scenario category (all variants)")
    return _save(fig, out_dir, "latency_avg_by_category"), None

def plot_latency_avg_by_server(df, out_dir):
    data = _require(df[(df["serverName"] != "") & df["latencyMs"].notna()],
                    "brak rekordow z serverName")
    grouped = data.groupby("serverName")["latencyMs"]
    labels = sorted(grouped.groups.keys())
    fig, ax = plt.subplots(figsize=FIGSIZE)
    _bar(ax, labels, [grouped.mean()[s] for s in labels], [int(grouped.count()[s]) for s in labels])
    ax.set_yscale("log")
    ax.set_ylabel("Avg latency [ms] (log)")
    ax.set_title("Average latency by MCP server (mcp + LLM variants)")
    return _save(fig, out_dir, "latency_avg_by_server"), None

def _overhead(df, base_variant, over_variant):
    base = df[(df["variant"] == base_variant) & df["latencyMs"].notna()]
    over = df[(df["variant"] == over_variant) & df["latencyMs"].notna()]
    common = sorted(set(base["scenarioId"]) & set(over["scenarioId"]))
    if not common:
        raise SkipPlot("brak wspolnych scenariuszy %s i %s" % (base_variant, over_variant))
    rows = []
    for scenario in common:
        base_avg = base[base["scenarioId"] == scenario]["latencyMs"].mean()
        over_avg = over[over["scenarioId"] == scenario]["latencyMs"].mean()
        rows.append((scenario, over_avg - base_avg, over_avg / base_avg if base_avg else np.nan))
    return rows

def plot_mcp_overhead_vs_baseline(df, out_dir):
    rows = _overhead(df, "baseline", "mcp")
    labels = [r[0] for r in rows]
    fig, ax = plt.subplots(figsize=FIGSIZE)
    _bar(ax, labels, [r[1] for r in rows], fmt="%.1f")
    for index, row in enumerate(rows):
        ax.annotate("x%.1f" % row[2], (index, 0), ha="center", va="top", fontsize=8, color="#555555")
    ax.set_ylabel("avg(mcp) - avg(baseline) [ms]")
    ax.set_title("MCP latency overhead vs baseline (per scenario; xN = ratio)")
    return _save(fig, out_dir, "mcp_overhead_vs_baseline"), "%d scenariuszy" % len(rows)

def plot_mcp_llm_overhead_vs_mcp(df, out_dir):
    rows = _overhead(df, "mcp", "mcp_llm")
    labels = [r[0] for r in rows]
    fig, ax = plt.subplots(figsize=FIGSIZE)
    _bar(ax, labels, [r[1] for r in rows], fmt="%.0f")
    ax.set_ylabel("avg(mcp_llm) - avg(mcp) [ms]")
    ax.set_title("MCP+LLM latency overhead vs MCP-only (per scenario)")
    return _save(fig, out_dir, "mcp_llm_overhead_vs_mcp"), "%d scenariuszy" % len(rows)

def plot_token_usage_by_variant(df, out_dir):
    data = _require(df.dropna(subset=["promptTokens"]), "brak danych tokenowych")
    variants = _ordered_variants(data)
    prompt_means = [data[data["variant"] == v]["promptTokens"].mean() for v in variants]
    output_means = [data[data["variant"] == v]["outputTokens"].mean() for v in variants]
    positions = np.arange(len(variants))
    fig, ax = plt.subplots(figsize=FIGSIZE)
    ax.bar(positions, prompt_means, width=0.6, label="prompt", color="#4878CF")
    ax.bar(positions, output_means, width=0.6, bottom=prompt_means, label="output", color="#EE854A")
    ax.set_xticks(positions)
    ax.set_xticklabels(variants, rotation=20, ha="right")
    ax.set_ylabel("Avg tokens per iteration")
    ax.set_title("Token usage by variant (prompt + output)")
    ax.legend()
    return _save(fig, out_dir, "token_usage_by_variant"), None

def plot_token_overhead_vs_llm_only(df, out_dir):
    llm_only = df[(df["variant"] == "llm_only") & df["totalTokens"].notna()]
    with_tools = df[df["variant"].isin(["mcp_llm", "third_party_mcp_llm"]) & df["totalTokens"].notna()]
    common = sorted(set(llm_only["scenarioId"]) & set(with_tools["scenarioId"]))
    if not common:
        raise SkipPlot("brak wspolnych scenariuszy llm_only i mcp_llm z tokenami")
    labels, values = [], []
    for scenario in common:
        base = llm_only[llm_only["scenarioId"] == scenario]["totalTokens"].mean()
        over = with_tools[with_tools["scenarioId"] == scenario]["totalTokens"].mean()
        labels.append(scenario)
        values.append(over - base)
    fig, ax = plt.subplots(figsize=FIGSIZE)
    _bar(ax, labels, values, fmt="%.0f")
    ax.set_ylabel("tokens(mcp_llm) - tokens(llm_only)")
    ax.set_title("Token overhead of MCP tool calling vs LLM-only (per scenario)")
    return _save(fig, out_dir, "token_overhead_vs_llm_only"), "%d scenariuszy" % len(labels)

def _rate_by_server(df, column, requested_only=False):
    data = df[(df["serverName"] != "") & df[column].notna()]
    if requested_only:
        data = data[data["toolCallRequested"] == 1.0]
    if data.empty:
        raise SkipPlot("brak danych %s per serwer" % column)
    grouped = data.groupby("serverName")[column]
    labels = sorted(grouped.groups.keys())
    return labels, [grouped.mean()[s] for s in labels], [int(grouped.count()[s]) for s in labels]

def _rate_plot(df, out_dir, column, name, title, requested_only=False):
    labels, means, counts = _rate_by_server(df, column, requested_only)
    fig, ax = plt.subplots(figsize=FIGSIZE)
    _bar(ax, labels, means, counts, fmt="%.2f")
    ax.set_ylim(0, 1.15)
    ax.set_ylabel(column)
    ax.set_title(title)
    return _save(fig, out_dir, name), None

def plot_tool_selection_accuracy(df, out_dir):
    return _rate_plot(df, out_dir, "toolSelectionCorrect", "tool_selection_accuracy",
                      "Tool selection accuracy by server (LLM variants)")

def plot_tool_success_rate(df, out_dir):
    return _rate_plot(df, out_dir, "toolCallSuccess", "tool_success_rate",
                      "Tool call success rate by server (among requested calls)",
                      requested_only=True)

def plot_argument_correctness(df, out_dir):
    return _rate_plot(df, out_dir, "argumentCorrectness", "argument_correctness",
                      "Argument correctness by server (1 / 0.5 / 0; null excluded)")

def plot_result_integration_score(df, out_dir):
    return _rate_plot(df, out_dir, "resultIntegrationScore", "result_integration_score",
                      "Result integration score by server (heuristic, 0-1)")

def plot_error_code_distribution(df, out_dir):
    errors = df[df["errorCode"] != ""]
    if errors.empty:
        raise SkipPlot("brak rekordow z errorCode")
    counts = errors.groupby("errorCode").size().sort_values(ascending=False)
    fig, ax = plt.subplots(figsize=FIGSIZE)
    _bar(ax, counts.index.tolist(), counts.values.tolist())
    ax.set_ylabel("Occurrences")
    ax.set_title("Error code distribution (all variants)")
    return _save(fig, out_dir, "error_code_distribution"), "%d kodow" % len(counts)

def plot_measurements_count_by_variant(df, out_dir):
    variants = _ordered_variants(df)
    counts = [int((df["variant"] == v).sum()) for v in variants]
    fig, ax = plt.subplots(figsize=FIGSIZE)
    _bar(ax, variants, counts)
    ax.set_ylabel("Measurements")
    ax.set_title("Measurement count by variant (normalized set)")
    return _save(fig, out_dir, "measurements_count_by_variant"), "%d rekordow" % len(df)

LIKERT_COLUMNS = ["documentationClarityScore", "toolListClarityScore", "debuggabilityScore",
                  "scenarioAdditionEaseScore", "agentImplementationDifficultyScore",
                  "maintainabilityScore"]

def plot_usability_score_by_server(df, out_dir, usability):
    data = usability.sort_values("server")
    labels = data["server"].tolist()
    means = data[LIKERT_COLUMNS].mean(axis=1).tolist()
    colors = ["#4878CF" if kind == "own" else "#EE854A" for kind in data["serverKind"]]
    fig, ax = plt.subplots(figsize=FIGSIZE)
    positions = np.arange(len(labels))
    bars = ax.bar(positions, means, color=colors)
    ax.set_xticks(positions)
    ax.set_xticklabels(labels, rotation=20, ha="right")
    for bar in bars:
        ax.annotate("%.1f" % bar.get_height(), (bar.get_x() + bar.get_width() / 2, bar.get_height()),
                    ha="center", va="bottom", fontsize=8)
    ax.set_ylim(0, 5.4)
    ax.set_ylabel("Mean of 6 Likert scores (1-5)")
    ax.set_title("Usability score by server (blue = own, orange = third-party)")
    return _save(fig, out_dir, "usability_score_by_server"), "%d serwerow" % len(labels)

def plot_time_to_first_success_by_server(df, out_dir, usability):
    data = usability.sort_values("server")
    labels = data["server"].tolist()
    colors = ["#4878CF" if kind == "own" else "#EE854A" for kind in data["serverKind"]]
    fig, ax = plt.subplots(figsize=FIGSIZE)
    positions = np.arange(len(labels))
    bars = ax.bar(positions, data["timeToFirstSuccessfulRun"].tolist(), color=colors)
    ax.set_xticks(positions)
    ax.set_xticklabels(labels, rotation=20, ha="right")
    for bar in bars:
        ax.annotate("%.0f" % bar.get_height(), (bar.get_x() + bar.get_width() / 2, bar.get_height()),
                    ha="center", va="bottom", fontsize=8)
    ax.set_ylabel("Time to first successful tool call [min]")
    ax.set_title("Time to first success by server (blue = own, orange = third-party)")
    return _save(fig, out_dir, "time_to_first_success_by_server"), None

def plot_own_vs_third_party_comparison(df, out_dir):
    llm = df[df["variant"].isin(["mcp_llm", "third_party_mcp_llm"]) & (df["serverKind"] != "")]
    categories = sorted(set(llm[llm["serverKind"] == "own"]["category"])
                        & set(llm[llm["serverKind"] == "third_party"]["category"]))
    if not categories:
        raise SkipPlot("brak kategorii z danymi own ORAZ third_party")
    own_rates = [llm[(llm["category"] == c) & (llm["serverKind"] == "own")]["success"].mean()
                 for c in categories]
    tp_rates = [llm[(llm["category"] == c) & (llm["serverKind"] == "third_party")]["success"].mean()
                for c in categories]
    positions = np.arange(len(categories))
    fig, ax = plt.subplots(figsize=FIGSIZE)
    ax.bar(positions - 0.2, own_rates, width=0.4, label="own", color="#4878CF")
    ax.bar(positions + 0.2, tp_rates, width=0.4, label="third_party", color="#EE854A")
    ax.set_xticks(positions)
    ax.set_xticklabels(categories)
    ax.set_ylim(0, 1.15)
    ax.set_ylabel("Success rate (LLM variants)")
    ax.set_title("Own vs third-party servers: success rate per category")
    ax.legend()
    return _save(fig, out_dir, "own_vs_third_party_comparison"), "kategorie: %s" % ", ".join(categories)

def plot_controlled_sql_vs_minimal_sql(df, out_dir):
    servers = ["sql-controlled", "sql-minimal"]
    data = df[df["serverName"].isin(servers) & df["latencyMs"].notna()]
    common = sorted(set(data[data["serverName"] == servers[0]]["scenarioId"])
                    & set(data[data["serverName"] == servers[1]]["scenarioId"]))
    if not common:
        raise SkipPlot("brak wspolnych scenariuszy sql-controlled i sql-minimal")
    positions = np.arange(len(common))
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(12, 5))
    for offset, server, color in ((-0.2, servers[0], "#4878CF"), (0.2, servers[1], "#D65F5F")):
        subset = data[data["serverName"] == server]
        lat = [subset[subset["scenarioId"] == s]["latencyMs"].mean() for s in common]
        suc = [subset[subset["scenarioId"] == s]["success"].mean() for s in common]
        ax1.bar(positions + offset, lat, width=0.4, label=server, color=color)
        ax2.bar(positions + offset, suc, width=0.4, label=server, color=color)
    for ax, ylabel, title in ((ax1, "Avg latency [ms]", "Latency"),
                              (ax2, "Success rate", "Success rate")):
        ax.set_xticks(positions)
        ax.set_xticklabels(common, rotation=30, ha="right")
        ax.set_ylabel(ylabel)
        ax.set_title(title)
        ax.legend()
    ax2.set_ylim(0, 1.15)
    fig.suptitle("Controlled SQL vs minimal SQL (common scenarios, all variants)")
    return _save(fig, out_dir, "controlled_sql_vs_minimal_sql"), "%d scenariuszy" % len(common)

PLOTS = [
    ("latency_avg_by_variant", plot_latency_avg_by_variant, False),
    ("latency_p95_p99_by_variant", plot_latency_p95_p99_by_variant, False),
    ("latency_boxplot_by_variant", plot_latency_boxplot_by_variant, False),
    ("latency_avg_by_category", plot_latency_avg_by_category, False),
    ("latency_avg_by_server", plot_latency_avg_by_server, False),
    ("mcp_overhead_vs_baseline", plot_mcp_overhead_vs_baseline, False),
    ("mcp_llm_overhead_vs_mcp", plot_mcp_llm_overhead_vs_mcp, False),
    ("token_usage_by_variant", plot_token_usage_by_variant, False),
    ("token_overhead_vs_llm_only", plot_token_overhead_vs_llm_only, False),
    ("tool_selection_accuracy", plot_tool_selection_accuracy, False),
    ("tool_success_rate", plot_tool_success_rate, False),
    ("argument_correctness", plot_argument_correctness, False),
    ("result_integration_score", plot_result_integration_score, False),
    ("error_code_distribution", plot_error_code_distribution, False),
    ("measurements_count_by_variant", plot_measurements_count_by_variant, False),
    ("usability_score_by_server", plot_usability_score_by_server, True),
    ("time_to_first_success_by_server", plot_time_to_first_success_by_server, True),
    ("own_vs_third_party_comparison", plot_own_vs_third_party_comparison, False),
    ("controlled_sql_vs_minimal_sql", plot_controlled_sql_vs_minimal_sql, False),
]

def main() -> int:
    df = load_measurements()
    run_id = datetime.now(timezone.utc).strftime("plots-%Y-%m-%dT%H-%M-%SZ")
    out_dir = PLOTS_ROOT / run_id
    out_dir.mkdir(parents=True, exist_ok=True)

    try:
        usability = load_usability()
    except SkipPlot as exc:
        usability = None
        usability_reason = str(exc)

    generated, skipped = [], []
    for name, plot_fn, needs_usability in PLOTS:
        try:
            if needs_usability:
                if usability is None:
                    raise SkipPlot(usability_reason)
                file_name, note = plot_fn(df, out_dir, usability)
            else:
                file_name, note = plot_fn(df, out_dir)
            generated.append({"name": name, "file": file_name, "note": note})
            print("[OK]   %s" % name)
        except SkipPlot as exc:
            skipped.append({"name": name, "reason": str(exc)})
            print("[SKIP] %s -- %s" % (name, exc))
        except Exception as exc:
            skipped.append({"name": name, "reason": "BLAD: %s" % exc})
            print("[ERR]  %s -- %s" % (name, exc))

    manifest = {
        "runId": run_id,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "inputs": {
            "measurements": MEASUREMENTS_CSV.relative_to(REPO_ROOT).as_posix(),
            "measurementRows": int(len(df)),
            "rowsByVariant": {v: int((df["variant"] == v).sum()) for v in _ordered_variants(df)},
            "usability": USABILITY_CSV.relative_to(REPO_ROOT).as_posix() if usability is not None else None,
        },
        "generated": generated,
        "skipped": skipped,
    }
    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    print("\nWygenerowano %d/%d wykresow -> %s" % (len(generated), len(PLOTS),
                                                   out_dir.relative_to(REPO_ROOT).as_posix()))
    if skipped:
        print("Pominieto %d (powody w manifest.json)." % len(skipped))
    return 0

if __name__ == "__main__":
    if "--campaign" in sys.argv:
        from campaign_plots import main as campaign_main
        sys.exit(campaign_main())
    if "--legacy" not in sys.argv:
        sys.exit("Specify --campaign ID for the canonical 20 figures; --legacy explicitly selects the historical 19-figure registry.")
    sys.argv.remove("--legacy")
    sys.exit(main())
