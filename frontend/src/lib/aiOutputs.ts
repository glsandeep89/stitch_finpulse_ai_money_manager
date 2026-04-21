/** Latest row per family from GET /ai-outputs (maps to `finpulse.ai_outputs`). */
export type AiOutputRow = {
  id: string;
  output_family: string;
  title: string;
  summary: string;
  confidence: number | null;
  assumptions: unknown;
  payload: unknown;
  metadata: unknown;
  generated_at: string;
};

export type AiOutputsResponse = {
  byFamily: Record<string, AiOutputRow | null>;
};
