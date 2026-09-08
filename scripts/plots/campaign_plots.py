
import argparse
import json
from pathlib import Path
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import pandas as pd
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
NAMES = ["latency_avg_by_variant", "latency_p95_p99_by_variant", "latency_boxplot_by_variant",
         "latency_avg_by_category", "latency_avg_by_server", "mcp_overhead_vs_baseline",
         "mcp_llm_overhead_vs_mcp", "token_usage_by_variant", "token_overhead_vs_llm_only",
         "tool_selection_accuracy", "tool_success_rate", "argument_correctness", "result_integration_score",
         "error_code_distribution", "measurements_count_by_variant", "usability_score_by_server",
         "time_to_first_success_by_server", "own_vs_third_party_comparison", "controlled_sql_vs_minimal_sql",
         "contract_security_profile"]

class Missing(Exception): pass
def bars(values, title, ylabel, output, name):
    values = values.dropna()
    if values.empty: raise Missing("No assessed observations for this comparison")
    fig, ax = plt.subplots(figsize=(max(9, min(24, len(values) * .65)), 6))
    ax.bar(range(len(values)), values.to_numpy(), color="#345e89")
    ax.set_xticks(range(len(values)), [str(x) for x in values.index], rotation=60, ha="right", fontsize=8)
    ax.set_title(title); ax.set_ylabel(ylabel)
    fig.tight_layout(); fig.savefig(output / (name + ".png"), dpi=150); plt.close(fig)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--campaign", required=True); parser.add_argument("--out")
    args = parser.parse_args()
    if not args.campaign.replace("-", "").replace("_", "").isalnum(): raise SystemExit("Invalid campaign ID")
    input_file = ROOT / "results/normalized" / args.campaign / "measurements.csv"
    output = Path(args.out) if args.out else ROOT / "results/plots" / args.campaign
    output.mkdir(parents=True, exist_ok=True)
    raw = pd.read_csv(input_file, keep_default_na=False)
    if set(raw.campaignId) != {args.campaign} or set(raw.measurementVersion) != {2}: raise SystemExit("Mixed campaign or instrumentation versions")
    labels = raw.externalLabels.map(lambda x: json.loads(x) if x else {})
    scores = raw.externalScores.map(lambda x: json.loads(x) if x else {})
    for column in ["catalogMode", "schemaMode", "modelDigest"]: raw[column] = labels.map(lambda x: x.get(column, ""))
    raw["firstPromptTokens"] = scores.map(lambda x: x.get("firstPromptTokens", np.nan))
    digests = {x for x in raw.modelDigest if x}
    if len(digests) > 1: raise SystemExit("Multiple model digests: select separate campaigns")
    raw["cell"] = raw.serverName + " / " + raw.variant + " / " + raw.scenarioId + " / " + raw.catalogMode
    numeric = ["latencyMs", "promptTokens", "outputTokens", "totalTokens", "schemaValidCalls", "schemaEvaluatedCalls",
               "selectionCorrectCalls", "selectionEvaluatedCalls", "successfulToolCalls", "attemptedToolCalls",
               "semanticCorrectCalls", "semanticEvaluatedCalls", "stateChangingToolsCount", "schemaValidatedArgsRatio",
               "allowListedResourcesCount", "constraintViolationsCount"]
    for column in numeric: raw[column] = pd.to_numeric(raw[column], errors="coerce")
    for column in ["taskSuccess", "finalAnswerCorrect"]:
        raw[column] = raw[column].map({True: 1., False: 0., "true": 1., "false": 0., "True": 1., "False": 0.})
    data = raw[~raw.scenarioId.str.startswith("SEC-")].copy()
    llm = data[data.variant.isin(["mcp_llm", "third_party_mcp_llm"])].copy()
    llm["arm"] = llm.serverName + " / " + llm.catalogMode
    generated, skipped, denominators = [], [], {}
    for name in NAMES:
        try:
            note = "Descriptive pilot/campaign cells; no pooled server/catalog latency comparisons"
            if name.startswith("latency_"):
                if name == "latency_p95_p99_by_variant":
                    tails = data.groupby("cell").latencyMs.quantile([.95,.99]).unstack()
                    fig, ax = plt.subplots(figsize=(max(10,min(24,len(tails)*.65)),6))
                    x = np.arange(len(tails)); ax.bar(x-.2,tails[.95],.4,label="p95"); ax.bar(x+.2,tails[.99],.4,label="p99")
                    ax.set_xticks(x,tails.index,rotation=60,ha="right",fontsize=8); ax.set_ylabel("Latency [ms]")
                    ax.set_title("Empirical tail latency per cell; pilot estimates are imprecise");ax.legend()
                    fig.tight_layout();fig.savefig(output/(name+".png"),dpi=150);plt.close(fig)
                    generated.append({"name":name,"file":name+".png","note":"Empirical p95 and p99; small-cell tail estimates are imprecise."});continue
                elif name == "latency_boxplot_by_variant":
                    groups = [(key, g.latencyMs.dropna()) for key, g in data.groupby("cell") if g.latencyMs.notna().any()]
                    if not groups: raise Missing("No latency data")
                    fig, ax = plt.subplots(figsize=(max(10, min(24, len(groups)*.6)), 6))
                    ax.boxplot([g for _,g in groups], tick_labels=[key for key,_ in groups]); ax.tick_params(axis="x", rotation=90, labelsize=7)
                    ax.set_ylabel("Latency [ms]"); ax.set_title("Latency per scenario / server / variant / catalog")
                    fig.tight_layout(); fig.savefig(output/(name+".png"),dpi=150); plt.close(fig); generated.append({"name":name,"file":name+".png","note":note}); continue
                else: values = data.groupby("cell").latencyMs.mean()
                bars(values, name.replace("_", " ")+" (separate cells)", "Latency [ms]", output, name)
            elif name in ["mcp_overhead_vs_baseline", "mcp_llm_overhead_vs_mcp"]:
                base_variant, over_variant = ("baseline","mcp") if name.startswith("mcp_overhead") else ("mcp","mcp_llm")
                values = {}
                for (server, scenario, catalog), group in data[data.variant==over_variant].groupby(["serverName","scenarioId","catalogMode"]):
                    base = data[(data.variant==base_variant)&(data.scenarioId==scenario)]
                    if base_variant != "baseline": base = base[base.serverName==server]
                    if not base.empty: values[f"{server}/{scenario}/{catalog}"] = group.latencyMs.mean()-base.latencyMs.mean()
                bars(pd.Series(values,dtype=float), name.replace("_"," "), "Mean latency difference [ms]", output,name)
            elif name == "token_usage_by_variant":
                bars(data.groupby("cell").totalTokens.mean(), "Total tokens across all model turns", "Tokens / trajectory",output,name)
            elif name == "token_overhead_vs_llm_only":
                values = {}
                for (server, scenario, catalog), group in llm.groupby(["serverName","scenarioId","catalogMode"]):
                    base=data[(data.variant=="llm_only")&(data.serverName==server)&(data.scenarioId==scenario)]
                    if not base.empty: values[f"{server}/{scenario}/{catalog}"]=group.firstPromptTokens.mean()-base.firstPromptTokens.mean()
                bars(pd.Series(values,dtype=float), "First model request: catalog overhead vs matched LLM-only", "Prompt tokens (first request only)",output,name)
            elif name in ["tool_selection_accuracy","tool_success_rate","argument_correctness"]:
                numerator, denominator = {"tool_selection_accuracy":("selectionCorrectCalls","selectionEvaluatedCalls"),"tool_success_rate":("successfulToolCalls","attemptedToolCalls"),"argument_correctness":("semanticCorrectCalls","semanticEvaluatedCalls")}[name]
                grouped=llm.groupby("arm")[[numerator,denominator]].sum(min_count=1)
                values=grouped[numerator]/grouped[denominator].replace(0,np.nan)
                denominators[name]=grouped.fillna(0).to_dict("index")
                bars(values,name.replace("_"," ")+" (sum of call counts)","Correct / assessed calls",output,name)
            elif name == "result_integration_score":
                denominators[name]=llm.groupby("arm").finalAnswerCorrect.count().to_dict()
                bars(llm.groupby("arm").finalAnswerCorrect.mean(),"Final answer correctness — v2 reference oracle", "Correct / assessed final answers",output,name)
                note="Historical heuristic integration score retired; explicit reference-based final answer correctness"
            elif name == "error_code_distribution":
                errors=raw[raw.errorCode!=""].errorCode.value_counts()
                if errors.empty: errors=pd.Series({"No recorded technical errors":0})
                bars(errors,"Recorded technical errors (including SEC)","Attempts",output,name)
            elif name == "measurements_count_by_variant": bars(raw.groupby("variant").size(),"Recorded measurements, including failed attempts","N",output,name)
            elif name in ["usability_score_by_server","time_to_first_success_by_server"]:
                usability=pd.read_csv(ROOT/"results/raw/usability.csv").set_index("server")
                if name.startswith("usability"):
                    cols=["documentationClarityScore","toolListClarityScore","debuggabilityScore","scenarioAdditionEaseScore","agentImplementationDifficultyScore","maintainabilityScore"]
                    values=usability[cols].mean(axis=1); units="Mean of six ordinal ratings (descriptive only)"
                else: values=usability.timeToFirstSuccessfulRun; units="Minutes; missing historic timings remain unassessed"
                bars(values,name.replace("_"," "),units,output,name);note="Usability is a separate observational source, not LLM campaign measurements"
            elif name == "own_vs_third_party_comparison":
                common=set(llm[llm.serverKind=="own"].scenarioId)&set(llm[llm.serverKind=="third_party"].scenarioId)
                selected=llm[llm.scenarioId.isin(common)]
                bars(selected.groupby("cell").taskSuccess.mean(),"Own / ready-made servers on shared scenarios", "SR_task (unassessed excluded)",output,name)
            elif name == "controlled_sql_vs_minimal_sql":
                selected=llm[llm.serverName.isin(["sql-controlled","sql-generic","sql-minimal"])&llm.scenarioId.isin(["SQL-001","SQL-002","SQL-003","SQL-004","SQL-007"])]
                bars(selected.groupby("cell").taskSuccess.mean(),"Three SQL contracts — MCP+LLM only, shared tasks", "SR_task",output,name)
            elif name == "contract_security_profile":
                cols=["stateChangingToolsCount","schemaValidatedArgsRatio","allowListedResourcesCount","constraintViolationsCount"]
                grouped=raw.groupby("serverName")[cols].first().dropna(how="all")
                if grouped.empty: raise Missing("No contract profiles in normalized measurements")
                fig,axes=plt.subplots(2,2,figsize=(13,9))
                for ax,col in zip(axes.flat,cols):
                    ax.bar(grouped.index,grouped[col]);ax.tick_params(axis="x",rotation=70,labelsize=8);ax.set_title(col)
                fig.suptitle("Contract properties — not a security/robustness score");fig.tight_layout();fig.savefig(output/(name+".png"),dpi=150);plt.close(fig)
            generated.append({"name":name,"file":name+".png","note":note})
        except Missing as error: skipped.append({"name":name,"reason":str(error)})
    summary=data.groupby("cell").agg(n=("latencyMs","count"),meanMs=("latencyMs","mean"),p50Ms=("latencyMs","median"),p95Ms=("latencyMs",lambda x:x.quantile(.95)),p99Ms=("latencyMs",lambda x:x.quantile(.99)),taskAssessed=("taskSuccess","count"),taskRate=("taskSuccess","mean"))
    summary.to_csv(output/"summary.csv")
    (output/"manifest.json").write_text(json.dumps({"campaignId":args.campaign,"input":str(input_file),"rows":len(raw),"phase":sorted(raw.phase.unique()),"modelDigests":sorted(digests),"generated":generated,"skipped":skipped,"denominators":denominators},indent=2),encoding="utf8")
    print(json.dumps({"campaign":args.campaign,"generated":len(generated),"skipped":skipped,"output":str(output)}))
    return 0
