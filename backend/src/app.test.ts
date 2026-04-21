import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "./app.js";

describe("createApp", () => {
  it("GET /health returns ok", async () => {
    const app = createApp();
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.service).toBe("finpulse-api");
  });

  it("protected route without Authorization returns 401", async () => {
    const app = createApp();
    const res = await request(app).get("/transactions");
    expect(res.status).toBe(401);
  });

  it("new AI NLQ route without Authorization returns 401", async () => {
    const app = createApp();
    const res = await request(app).post("/ai/nlq").send({ query: "How much did I spend?" });
    expect(res.status).toBe(401);
  });

  it("new AI metadata route without Authorization returns 401", async () => {
    const app = createApp();
    const res = await request(app).get("/meta/ai-feature-flags");
    expect(res.status).toBe(401);
  });

  it("GET /ai-outputs without Authorization returns 401", async () => {
    const app = createApp();
    const res = await request(app).get("/ai-outputs");
    expect(res.status).toBe(401);
  });
});
