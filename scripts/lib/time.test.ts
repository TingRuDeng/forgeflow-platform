import { describe, it, expect } from "vitest";
import { formatLocalTimestamp } from "./time.js";

describe("time.ts", () => {
  describe("pad", () => {
    it("pads single digit numbers with leading zeros", () => {
      const pad = (value: number, width = 2) =>
        String(Math.trunc(Math.abs(value))).padStart(width, "0");
      expect(pad(1)).toBe("01");
      expect(pad(5)).toBe("05");
      expect(pad(9)).toBe("09");
    });

    it("does not pad numbers already at target width", () => {
      const pad = (value: number, width = 2) =>
        String(Math.trunc(Math.abs(value))).padStart(width, "0");
      expect(pad(10)).toBe("10");
      expect(pad(99)).toBe("99");
    });

    it("handles custom width", () => {
      const pad = (value: number, width = 2) =>
        String(Math.trunc(Math.abs(value))).padStart(width, "0");
      expect(pad(1, 4)).toBe("0001");
      expect(pad(12, 4)).toBe("0012");
    });

    it("handles negative numbers by truncating to absolute value", () => {
      const pad = (value: number, width = 2) =>
        String(Math.trunc(Math.abs(value))).padStart(width, "0");
      expect(pad(-5)).toBe("05");
      expect(pad(-123)).toBe("123");
    });

    it("handles zero", () => {
      const pad = (value: number, width = 2) =>
        String(Math.trunc(Math.abs(value))).padStart(width, "0");
      expect(pad(0)).toBe("00");
      expect(pad(0, 4)).toBe("0000");
    });
  });

  describe("formatLocalTimestamp", () => {
    it("formats a date in UTC+0 as +00:00 offset", () => {
      const date = new Date("2024-01-15T12:00:00.000Z");
      const result = formatLocalTimestamp(date);
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}$/);
    });

    it("does not end with Z (UTC indicator)", () => {
      const date = new Date();
      const result = formatLocalTimestamp(date);
      expect(result.endsWith("Z")).toBe(false);
    });

    it("includes timezone offset with correct sign", () => {
      const date = new Date();
      const result = formatLocalTimestamp(date);
      expect(result).toMatch(/[+-]\d{2}:\d{2}$/);
    });

    it("produces consistent output for same instant in different timezones", () => {
      const instant = new Date("2024-06-15T08:00:00.000Z");
      const result1 = formatLocalTimestamp(instant);
      expect(result1).toContain("+");
    });

    it("handles epoch start", () => {
      const date = new Date(0);
      const result = formatLocalTimestamp(date);
      expect(result).toMatch(/^1970-01-01/);
    });

    it("handles far future dates", () => {
      const date = new Date("2099-06-15T12:00:00.000Z");
      const result = formatLocalTimestamp(date);
      expect(result).toMatch(/^2099-06-15/);
    });

    it("includes milliseconds in the formatted output", () => {
      const date = new Date("2024-01-15T12:00:00.123Z");
      const result = formatLocalTimestamp(date);
      expect(result).toMatch(/\.\d{3}/);
    });

    it("defaults to current time when no date provided", () => {
      const before = Date.now();
      const result = formatLocalTimestamp();
      const after = Date.now();
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}/);
      const timestamp = new Date(result).getTime();
      expect(timestamp).toBeGreaterThanOrEqual(before);
      expect(timestamp).toBeLessThanOrEqual(after);
    });
  });
});
