import { describe, it, expect } from "vitest";
import { ReviewFindingSchema } from "../src/index.js";

describe("ReviewFindingSchema", () => {
  const validFinding = {
    finding_id: "finding-1",
    severity: "high",
    category: "security",
    title: "SQL Injection Vulnerability",
    evidence: {
      file: "src/db.js",
      line: 42,
      symbol: "query",
      snippet: "query = 'SELECT * FROM users WHERE id = ' + id",
    },
    recommendation: "Use parameterized queries",
    confidence: 0.95,
    fingerprint: "abc123",
  };

  it("parses a valid review finding", () => {
    const result = ReviewFindingSchema.parse(validFinding);
    expect(result.finding_id).toBe("finding-1");
    expect(result.severity).toBe("high");
    expect(result.detected_by).toEqual([]);
  });

  it("applies default finding_id when not provided", () => {
    const { finding_id, ...rest } = validFinding;
    const result = ReviewFindingSchema.parse(rest);
    expect(result.finding_id).toBe("finding");
  });

  it("applies default detected_by when not provided", () => {
    const result = ReviewFindingSchema.parse(validFinding);
    expect(result.detected_by).toEqual([]);
  });

  it("rejects invalid severity", () => {
    expect(() =>
      ReviewFindingSchema.parse({ ...validFinding, severity: "urgent" })
    ).toThrow();
    expect(() =>
      ReviewFindingSchema.parse({ ...validFinding, severity: "warning" })
    ).toThrow();
  });

  it("rejects invalid category", () => {
    expect(() =>
      ReviewFindingSchema.parse({ ...validFinding, category: "error" })
    ).toThrow();
    expect(() =>
      ReviewFindingSchema.parse({ ...validFinding, category: "typo" })
    ).toThrow();
  });

  it("rejects empty title", () => {
    expect(() =>
      ReviewFindingSchema.parse({ ...validFinding, title: "" })
    ).toThrow();
  });

  it("rejects confidence outside [0, 1]", () => {
    expect(() =>
      ReviewFindingSchema.parse({ ...validFinding, confidence: 1.5 })
    ).toThrow();
    expect(() =>
      ReviewFindingSchema.parse({ ...validFinding, confidence: -0.1 })
    ).toThrow();
  });

  it("rejects invalid evidence.file", () => {
    expect(() =>
      ReviewFindingSchema.parse({
        ...validFinding,
        evidence: { ...validFinding.evidence, file: "" },
      })
    ).toThrow();
  });

  it("accepts nullable line and symbol", () => {
    const result = ReviewFindingSchema.parse({
      ...validFinding,
      evidence: { ...validFinding.evidence, line: null, symbol: null },
    });
    expect(result.evidence.line).toBeNull();
    expect(result.evidence.symbol).toBeNull();
  });

  it("rejects non-positive line number", () => {
    expect(() =>
      ReviewFindingSchema.parse({
        ...validFinding,
        evidence: { ...validFinding.evidence, line: 0 },
      })
    ).toThrow();
    expect(() =>
      ReviewFindingSchema.parse({
        ...validFinding,
        evidence: { ...validFinding.evidence, line: -1 },
      })
    ).toThrow();
  });
});
