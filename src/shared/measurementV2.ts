import * as z from "zod/v4";

const count = () => z.number().int().nonnegative().nullable().default(null);
const flag = () => z.boolean().nullable().default(null);
export const measurementV2Fields = {
  measurementVersion: z.number().int().default(1),
  campaignId: z.string().nullable().default(null),
  phase: z.enum(["pilot", "final", "test"]).nullable().default(null),
  taskSuccess: flag(),
  assessmentReason: z.string().nullable().default(null),
  schemaValidCalls: count(), schemaEvaluatedCalls: count(),
  semanticCorrectCalls: count(), semanticEvaluatedCalls: count(),
  selectionCorrectCalls: count(), selectionEvaluatedCalls: count(),
  successfulToolCalls: count(), attemptedToolCalls: count(), timeoutCount: count(),
  stateChangingToolsCount: count(),
  schemaValidatedArgsRatio: z.number().min(0).max(1).nullable().default(null),
  allowListedResourcesCount: count(), constraintViolationsCount: count(),
  catalogDriftDetected: flag(), privilegeSeparationEnforced: flag(),
  unexpectedStateChange: flag(), injectionInstructionEchoed: flag()
};
export const EMPTY_MEASUREMENT_V2 = z.object(measurementV2Fields).parse({});
export type MeasurementV2 = typeof EMPTY_MEASUREMENT_V2;
export const MEASUREMENT_V2_COLUMNS = Object.keys(EMPTY_MEASUREMENT_V2) as Array<keyof MeasurementV2>;
