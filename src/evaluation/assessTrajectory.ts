import type { Scenario } from "../shared/scenarioLoader.js";
import type { Trajectory } from "./trajectory.js";
import { answerCorrectness, semanticResultCorrectness, shapeCorrectness, type OracleReference } from "./taskOracle.js";

const DISCOVERY=/^(health_check|list_tables|json_list_files|list_allowed_directories|list_directory|get_workbook_metadata|get_sheet_info|pg_get_connection_info|get_scene_info|read_resource)$/;
export function assessTrajectory(s:Scenario,trace:Trajectory,reference:OracleReference,expectedTools:string[],stateTask:boolean|null=null) {
  const calls=trace.calls;
  const unparsed=!trace.validJson&&trace.answer===null&&trace.finalText.trim().length>0;
  const finalAnswerCorrect=unparsed?null:answerCorrectness(s,trace.answer,reference);
  const targets=calls.filter(call=>expectedTools.includes(call.originalName));
  const selections=calls.filter(call=>expectedTools.includes(call.originalName)||!DISCOVERY.test(call.originalName));
  const schemaEvaluated=calls.filter(call=>call.schemaValid!==null);
  const semantic=targets.map(call=>call.success?semanticResultCorrectness(s,call.result,reference):false).filter((value):value is boolean=>value!==null);
  const evaluatedTargets=targets.filter(call=>call.success).map(call=>semanticResultCorrectness(s,call.result,reference));
  const semanticEvidence=evaluatedTargets.some(value=>value===true)||evaluatedTargets.some(value=>value===null);
  const taskSuccess=s.expected_outcome==="unavailable"?null:stateTask!==null?stateTask:
    finalAnswerCorrect===null?null:finalAnswerCorrect&&(s.variant==="llm_only"||semanticEvidence);
  const last=targets.at(-1);
  return {
    taskSuccess,finalAnswerCorrect,finalAnswerValidJson:trace.validJson,
    assessmentReason:s.expected_outcome==="unavailable"?"Contract has no authorized write operation":stateTask!==null?"Post-state oracle (independent of final JSON)":unparsed?"Unparsed or ambiguous final answer; qualitative review required":finalAnswerCorrect===null?"No quantitative final-answer oracle; qualitative review required":"Reference-data answer oracle and target-call evidence",
    schemaValidCalls:schemaEvaluated.filter(call=>call.schemaValid).length,schemaEvaluatedCalls:schemaEvaluated.length,
    semanticCorrectCalls:semantic.filter(Boolean).length,semanticEvaluatedCalls:semantic.length,
    selectionCorrectCalls:selections.filter(call=>expectedTools.includes(call.originalName)).length,selectionEvaluatedCalls:selections.length,
    successfulToolCalls:calls.filter(call=>call.success).length,attemptedToolCalls:calls.length,
    timeoutCount:calls.filter(call=>/timeout|timed out/i.test(call.error??"")).length+Number(/timeout|timed out/i.test(trace.error??"")),
    numberOfToolCalls:calls.length,unnecessaryToolCalls:Math.max(0,calls.length-s.minimum_tool_calls),
    toolCallRequested:calls.length>0,toolCallSuccess:calls.length?calls.every(call=>call.success):null,
    toolSelectionCorrect:selections.length?selections.every(call=>expectedTools.includes(call.originalName)):null,
    argumentCorrectness:semantic.length?semantic.filter(Boolean).length/semantic.length:null,
    resultShapeCorrect:last?shapeCorrectness(last.result,s.expected_result_shape):null
  };
}
