import { describe, it, expect } from "vitest";
import {
  RunCommandSchema,
  DecisionSchema,
  TerminalStateSchema,
  WorkerFailureTypeSchema,
  WorkerFailureSchema,
  WorkerEvidenceSchema,
  ReviewDecisionEvidenceSchema,
  ReviewReasonCodeSchema,
  RunResultSchema,
} from "../src/index.js";

describe("RunCommandSchema", () => {
  it("accepts valid command values", () => {
    expect(RunCommandSchema.parse("run")).toBe("run");
    expect(RunCommandSchema.parse("review")).toBe("review");
  });

  it("rejects invalid command values", () => {
    expect(() => RunCommandSchema.parse("invalid")).toThrow();
    expect(() => RunCommandSchema.parse("")).toThrow();
  });
});

describe("DecisionSchema", () => {
  it("accepts valid decision values", () => {
    expect(DecisionSchema.parse("PASS")).toBe("PASS");
    expect(DecisionSchema.parse("FAIL")).toBe("FAIL");
    expect(DecisionSchema.parse("INCONCLUSIVE")).toBe("INCONCLUSIVE");
  });

  it("rejects invalid decision values", () => {
    expect(() => DecisionSchema.parse("pass")).toThrow();
    expect(() => DecisionSchema.parse("UNKNOWN")).toThrow();
  });
});

describe("TerminalStateSchema", () => {
  it("accepts all valid terminal states", () => {
    const validStates = [
      "completed",
      "partial_success",
      "failed",
      "cancelled",
      "expired",
    ];
    for (const state of validStates) {
      expect(TerminalStateSchema.parse(state)).toBe(state);
    }
  });

  it("rejects invalid terminal states", () => {
    expect(() => TerminalStateSchema.parse("success")).toThrow();
    expect(() => TerminalStateSchema.parse("pending")).toThrow();
    expect(() => TerminalStateSchema.parse("")).toThrow();
  });
});

describe("WorkerFailureTypeSchema", () => {
  it("accepts all valid failure types", () => {
    const validTypes = ["preflight", "execution", "verification", "unknown"];
    for (const type of validTypes) {
      expect(WorkerFailureTypeSchema.parse(type)).toBe(type);
    }
  });

  it("rejects invalid failure types", () => {
    expect(() => WorkerFailureTypeSchema.parse("error")).toThrow();
    expect(() => WorkerFailureTypeSchema.parse("timeout")).toThrow();
  });
});

describe("WorkerFailureSchema", () => {
  it("parses a valid worker failure", () => {
    const failure = {
      kind: "execution",
      code: "ERR_TIMEOUT",
      message: "Operation timed out after 30s",
    };
    const result = WorkerFailureSchema.parse(failure);
    expect(result.kind).toBe("execution");
    expect(result.code).toBe("ERR_TIMEOUT");
  });

  it("parses failure with optional details", () => {
    const failure = {
      kind: "preflight",
      code: "ERR_SETUP",
      message: "Failed to setup environment",
      details: { env: "test", reason: "missing dependency" },
    };
    const result = WorkerFailureSchema.parse(failure);
    expect(result.details).toEqual({ env: "test", reason: "missing dependency" });
  });

  it("rejects invalid failure kind", () => {
    expect(() =>
      WorkerFailureSchema.parse({
        kind: "error",
        code: "ERR",
        message: "msg",
      })
    ).toThrow();
  });
});

describe("WorkerEvidenceSchema", () => {
  const validEvidence = {
    blockers: [],
    findings: [],
  };

  it("parses valid worker evidence", () => {
    const result = WorkerEvidenceSchema.parse(validEvidence);
    expect(result.blockers).toEqual([]);
    expect(result.findings).toEqual([]);
  });

  it("applies default blockers and findings", () => {
    const result = WorkerEvidenceSchema.parse({});
    expect(result.blockers).toEqual([]);
    expect(result.findings).toEqual([]);
  });

  it("parses evidence with failure summary", () => {
    const result = WorkerEvidenceSchema.parse({
      failureSummary: "Test failed",
      blockers: [],
      findings: [],
    });
    expect(result.failureSummary).toBe("Test failed");
  });

  it("parses evidence with artifacts", () => {
    const result = WorkerEvidenceSchema.parse({
      artifacts: { log: "/tmp/test.log", screenshot: "/tmp/screen.png" },
      blockers: [],
      findings: [],
    });
    expect(result.artifacts).toEqual({
      log: "/tmp/test.log",
      screenshot: "/tmp/screen.png",
    });
  });
});

describe("ReviewDecisionEvidenceSchema", () => {
  it("accepts the standard review reason code taxonomy", () => {
    const result = ReviewReasonCodeSchema.parse("test_failure");
    expect(result).toBe("test_failure");
  });

  it("parses valid review decision evidence", () => {
    const evidence = {
      reasonCode: "SECURITY",
      mustFix: ["CVE-2024-1234", "CVE-2024-5678"],
      canRedrive: true,
      redriveStrategy: "retry-with-fix",
    };
    const result = ReviewDecisionEvidenceSchema.parse(evidence);
    expect(result.reasonCode).toBe("SECURITY");
    expect(result.mustFix).toHaveLength(2);
    expect(result.canRedrive).toBe(true);
  });

  it("keeps legacy custom reason code strings compatible", () => {
    const result = ReviewDecisionEvidenceSchema.parse({ reasonCode: "test_gap" });
    expect(result.reasonCode).toBe("test_gap");
  });

  it("applies default mustFix", () => {
    const result = ReviewDecisionEvidenceSchema.parse({});
    expect(result.mustFix).toEqual([]);
  });

  it("parses with only canRedrive", () => {
    const result = ReviewDecisionEvidenceSchema.parse({ canRedrive: false });
    expect(result.canRedrive).toBe(false);
  });
});

describe("RunResultSchema", () => {
  const baseRunResult = {
    command: "run" as const,
    task_id: "TASK-001",
    artifact_root: "/artifacts/TASK-001",
    decision: "PASS" as const,
    terminal_state: "completed" as const,
    provider_success_count: 5,
    provider_failure_count: 0,
    findings_count: 2,
    parse_success_count: 10,
    parse_failure_count: 1,
    schema_valid_count: 9,
    dropped_findings_count: 1,
    created_new_task: true,
  };

  it("parses a valid run result", () => {
    const result = RunResultSchema.parse(baseRunResult);
    expect(result.task_id).toBe("TASK-001");
    expect(result.decision).toBe("PASS");
  });

  it("parses run result with optional evidence", () => {
    const result = RunResultSchema.parse({
      ...baseRunResult,
      evidence: {
        blockers: [],
        findings: [],
      },
    });
    expect(result.evidence).toBeDefined();
  });

  it("rejects empty task_id", () => {
    expect(() =>
      RunResultSchema.parse({ ...baseRunResult, task_id: "" })
    ).toThrow();
  });

  it("rejects negative counts", () => {
    expect(() =>
      RunResultSchema.parse({ ...baseRunResult, provider_success_count: -1 })
    ).toThrow();
    expect(() =>
      RunResultSchema.parse({ ...baseRunResult, provider_failure_count: -1 })
    ).toThrow();
  });

  it("rejects non-integer counts", () => {
    expect(() =>
      RunResultSchema.parse({ ...baseRunResult, findings_count: 1.5 })
    ).toThrow();
  });

  it("rejects invalid command", () => {
    expect(() =>
      RunResultSchema.parse({ ...baseRunResult, command: "execute" })
    ).toThrow();
  });

  it("rejects invalid terminal_state", () => {
    expect(() =>
      RunResultSchema.parse({ ...baseRunResult, terminal_state: "success" })
    ).toThrow();
  });

  it("validates evidence structure when provided", () => {
    expect(() =>
      RunResultSchema.parse({
        ...baseRunResult,
        evidence: {
          blockers: [{ kind: "invalid", code: "X", message: "Y" }],
          findings: [],
        },
      })
    ).toThrow();
  });
});

describe("Schema inference", () => {
  it("correctly infers RunResult type", () => {
    const result: import("../src/index.js").RunResult = {
      command: "run",
      task_id: "TASK-001",
      artifact_root: "/artifacts/TASK-001",
      decision: "PASS",
      terminal_state: "completed",
      provider_success_count: 1,
      provider_failure_count: 0,
      findings_count: 0,
      parse_success_count: 1,
      parse_failure_count: 0,
      schema_valid_count: 1,
      dropped_findings_count: 0,
      created_new_task: true,
    };
    expect(result.command).toBe("run");
  });
  it("correctly infers ReviewFinding type", () => {
    const finding: import("../src/index.js").ReviewFinding = {
      finding_id: "test",
      severity: "critical",
      category: "security",
      title: "Test",
      evidence: {
        file: "test.js",
        line: 1,
        symbol: null,
        snippet: "test",
      },
      recommendation: "Fix it",
      confidence: 0.9,
      fingerprint: "test",
    };
    expect(finding.severity).toBe("critical");
  });
});
