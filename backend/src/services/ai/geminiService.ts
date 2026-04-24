import { GoogleGenerativeAI } from "@google/generative-ai";
import { getDb } from "../db/supabase.js";
import { config, requireEnv } from "../../config.js";

function modelId() {
  return config.geminiModel ?? "gemini-2.0-flash";
}

function getModel() {
  const key = config.geminiApiKey ?? requireEnv("GEMINI_API_KEY");
  const gen = new GoogleGenerativeAI(key);
  return gen.getGenerativeModel({ model: modelId() });
}

async function loadRecentTransactionsSummary(userIds: string[]): Promise<string> {
  if (userIds.length === 0) return "No transactions yet.";
  const sb = getDb();
  const { data } = await sb
    .from("transactions")
    .select("merchant_name, amount, trans_date, category")
    .in("user_id", userIds)
    .order("trans_date", { ascending: false })
    .limit(80);

  if (!data?.length) return "No transactions yet.";
  const prefix =
    userIds.length > 1 ? "Data combines linked accounts for everyone in this household.\n" : "";
  return (
    prefix +
    data
    .map(
      (t) =>
        `${t.trans_date} ${t.merchant_name ?? "Unknown"} ${t.amount} ${(t.category as string[])?.join("/") ?? ""}`
    )
    .join("\n")
  );
}

export async function generateInsights(viewerUserId: string, dataUserIds: string[]) {
  const summary = await loadRecentTransactionsSummary(dataUserIds);
  const model = getModel();
  const prompt = `You are a financial coach. Given recent transactions (amount sign conventions may vary by source):\n${summary}\n\nProvide 3 concise insights as JSON array of objects with keys: title, body, type (one of: spending, savings, risk). No markdown.`;

  const res = await model.generateContent(prompt);
  const text = res.response.text();
  let parsed: { title: string; body: string; type: string }[];
  try {
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    parsed = JSON.parse(jsonMatch ? jsonMatch[0] : text);
  } catch {
    parsed = [
      {
        title: "Insights",
        body: text.slice(0, 2000),
        type: "spending",
      },
    ];
  }

  const sb = getDb();
  const rows = parsed.map((p) => ({
    user_id: viewerUserId,
    insight_type: p.type || "spending",
    title: p.title,
    body: p.body,
    metadata: { source: "gemini" },
    model: modelId(),
  }));

  const { data, error } = await sb.from("insights").insert(rows).select();
  if (error) throw error;
  return data;
}

export async function generateRecommendations(viewerUserId: string, dataUserIds: string[]) {
  const summary = await loadRecentTransactionsSummary(dataUserIds);
  const model = getModel();
  const prompt = `Based on:\n${summary}\n\nList 3 tactical money recommendations (bullet text only, max 400 chars total).`;

  const res = await model.generateContent(prompt);
  const body = res.response.text();
  const sb = getDb();
  const { data, error } = await sb
    .from("insights")
    .insert({
      user_id: viewerUserId,
      insight_type: "recommendation",
      title: "Tactical recommendations",
      body,
      metadata: { source: "gemini" },
      model: modelId(),
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function generateWhatIf(viewerUserId: string, dataUserIds: string[], scenario: string) {
  const summary = await loadRecentTransactionsSummary(dataUserIds);
  const model = getModel();
  const prompt = `User scenario: ${scenario}\n\nRecent activity:\n${summary}\n\nExplain plausible outcomes and tradeoffs in under 500 words. Plain text.`;

  const res = await model.generateContent(prompt);
  const body = res.response.text();
  const sb = getDb();
  const { data, error } = await sb
    .from("insights")
    .insert({
      user_id: viewerUserId,
      insight_type: "what_if",
      title: `What-if: ${scenario.slice(0, 80)}`,
      body,
      metadata: { scenario },
      model: modelId(),
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

/** Predictive-style narrative: 30/60/90 cash flow + risk alerts (saved to insights). */
export async function generateForecast(viewerUserId: string, dataUserIds: string[]) {
  const summary = await loadRecentTransactionsSummary(dataUserIds);
  const model = getModel();
  const prompt = `You are a financial analyst. Given recent transactions (amount sign conventions may vary by account type):\n${summary}\n\nWrite plain text with sections:
1) Expected cash flow for next 30, 60, and 90 days (rough estimates; label as estimates).
2) Upcoming risk alerts (up to 3 short bullets).
3) One line disclaimer: not financial advice.
Keep under 600 words.`;

  const res = await model.generateContent(prompt);
  const body = res.response.text();
  const sb = getDb();
  const { data, error } = await sb
    .from("insights")
    .insert({
      user_id: viewerUserId,
      insight_type: "forecast",
      title: "Predictive forecast (30 / 60 / 90 days)",
      body,
      metadata: { source: "gemini" },
      model: modelId(),
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

/** Stateless chat for the global assistant (not persisted to insights). */
export async function generateChatReply(
  _viewerUserId: string,
  dataUserIds: string[],
  messages: { role: string; content: string }[],
  routeHint?: string
) {
  if (!config.geminiApiKey?.trim()) {
    throw new Error("AI assistant is not configured (missing GEMINI_API_KEY).");
  }
  const summary = await loadRecentTransactionsSummary(dataUserIds);
  const model = getModel();
  const hint = routeHint ? `The user is on screen: ${routeHint}.\n` : "";
  const tail = messages.slice(-8);
  const prompt = `You are a concise assistant for FinPulse, a personal finance app. ${hint}
Recent transactions (amount sign conventions may vary by account type):
${summary}

Conversation:
${tail.map((m) => `${m.role}: ${m.content}`).join("\n")}

Answer the latest user message only. Be brief (under 400 words). Do not provide personalized investment advice; add a one-sentence disclaimer. Plain text.`;

  const res = await model.generateContent(prompt);
  return res.response.text();
}
