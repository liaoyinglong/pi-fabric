// V2 has no Fabric dashboard. ExecutionService keeps this compatibility hook
// while activity rendering remains optional; returning undefined avoids pulling
// the historical UI parser graph into the lean runtime.
export const fabricExecTitleHintCached = (_code: string): string | undefined => undefined;
