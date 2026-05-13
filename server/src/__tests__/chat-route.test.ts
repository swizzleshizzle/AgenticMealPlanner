import { describe, it, expect, vi } from "vitest";
import request from "supertest";

vi.mock("../agent/runner.js", () => ({
  runAgent: vi.fn(async () => ({
    message: "stub reply",
    toolCalls: [],
  })),
}));

import app from "../index.js";

describe("POST /api/chat", () => {
  it("returns the agent's message", async () => {
    const res = await request(app)
      .post("/api/chat")
      .send({ message: "hi", pageContext: { path: "/planner" } });
    expect(res.status).toBe(200);
    expect(res.body.message).toBe("stub reply");
  });

  it("rejects empty messages", async () => {
    const res = await request(app).post("/api/chat").send({});
    expect(res.status).toBe(400);
  });
});
