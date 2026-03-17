import { describe, it, expect } from "vitest";
import { validateSqlQuery } from "./sql-validation";

describe("validateSqlQuery", () => {
  // ── Valid queries ──────────────────────────────────────────────────

  describe("accepts valid SELECT queries", () => {
    it("simple SELECT", () => {
      expect(validateSqlQuery("SELECT id, name, lat, lng FROM vehicles")).toEqual({ valid: true });
    });

    it("SELECT with WHERE clause", () => {
      expect(validateSqlQuery("SELECT id, name FROM vehicles WHERE status = 'active'")).toEqual({
        valid: true,
      });
    });

    it("SELECT with JOIN", () => {
      expect(
        validateSqlQuery(
          "SELECT v.id, v.name, p.lat, p.lng FROM vehicles v JOIN positions p ON v.id = p.vehicle_id"
        )
      ).toEqual({ valid: true });
    });

    it("SELECT with subquery", () => {
      expect(validateSqlQuery("SELECT * FROM (SELECT id, name FROM vehicles) AS sub")).toEqual({
        valid: true,
      });
    });

    it("SELECT with ORDER BY, LIMIT, OFFSET", () => {
      expect(
        validateSqlQuery("SELECT id, name FROM vehicles ORDER BY name LIMIT 100 OFFSET 0")
      ).toEqual({ valid: true });
    });

    it("SELECT with leading whitespace", () => {
      expect(validateSqlQuery("   SELECT id FROM vehicles")).toEqual({ valid: true });
    });

    it("lowercase select", () => {
      expect(validateSqlQuery("select id, name from vehicles")).toEqual({ valid: true });
    });

    it("mixed case SeLeCt", () => {
      expect(validateSqlQuery("SeLeCt id, name FROM vehicles")).toEqual({ valid: true });
    });

    it("SELECT with trailing semicolon only", () => {
      expect(validateSqlQuery("SELECT id FROM vehicles;")).toEqual({ valid: true });
    });

    it("SELECT with GROUP BY and HAVING", () => {
      expect(
        validateSqlQuery(
          "SELECT fleet_id, COUNT(*) FROM vehicles GROUP BY fleet_id HAVING COUNT(*) > 1"
        )
      ).toEqual({ valid: true });
    });

    it("SELECT with DISTINCT", () => {
      expect(validateSqlQuery("SELECT DISTINCT name FROM vehicles")).toEqual({ valid: true });
    });

    it("column names containing keyword substrings (updated_at, created_by)", () => {
      expect(
        validateSqlQuery("SELECT id, updated_at, created_by, deleted_flag FROM vehicles")
      ).toEqual({ valid: true });
    });
  });

  // ── Invalid: not SELECT ───────────────────────────────────────────

  describe("rejects non-SELECT queries", () => {
    it("empty string", () => {
      const result = validateSqlQuery("");
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/non-empty/i);
    });

    it("whitespace only", () => {
      const result = validateSqlQuery("   ");
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/non-empty/i);
    });

    it("INSERT statement", () => {
      const result = validateSqlQuery("INSERT INTO vehicles (id, name) VALUES (1, 'test')");
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/SELECT/);
    });

    it("UPDATE statement", () => {
      const result = validateSqlQuery("UPDATE vehicles SET name = 'hacked' WHERE 1=1");
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/SELECT/);
    });

    it("DELETE statement", () => {
      const result = validateSqlQuery("DELETE FROM vehicles");
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/SELECT/);
    });

    it("DROP TABLE", () => {
      const result = validateSqlQuery("DROP TABLE vehicles");
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/SELECT/);
    });
  });

  // ── Invalid: dangerous keywords inside SELECT ─────────────────────

  describe("rejects SELECT queries with embedded dangerous keywords", () => {
    it("SELECT … ; DROP TABLE", () => {
      const result = validateSqlQuery("SELECT id FROM vehicles; DROP TABLE vehicles");
      expect(result.valid).toBe(false);
    });

    it("SELECT INTO OUTFILE", () => {
      const result = validateSqlQuery("SELECT * FROM vehicles INTO OUTFILE '/tmp/dump.csv'");
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/INTO\s+OUTFILE/i);
    });

    it("SELECT … UNION INSERT", () => {
      const result = validateSqlQuery("SELECT id FROM vehicles UNION INSERT INTO logs VALUES (1)");
      expect(result.valid).toBe(false);
    });

    it("SELECT with EXEC", () => {
      const result = validateSqlQuery("SELECT id FROM vehicles WHERE EXEC xp_cmdshell('dir')");
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/EXEC/i);
    });

    it("SELECT with CREATE", () => {
      const result = validateSqlQuery("SELECT id FROM vehicles; CREATE TABLE evil (id INT)");
      expect(result.valid).toBe(false);
    });

    it("SELECT with ALTER", () => {
      const result = validateSqlQuery("SELECT 1; ALTER TABLE vehicles ADD COLUMN pwned TEXT");
      expect(result.valid).toBe(false);
    });

    it("SELECT with TRUNCATE", () => {
      const result = validateSqlQuery("SELECT 1; TRUNCATE TABLE vehicles");
      expect(result.valid).toBe(false);
    });

    it("SELECT with GRANT", () => {
      const result = validateSqlQuery("SELECT 1; GRANT ALL ON *.* TO 'root'");
      expect(result.valid).toBe(false);
    });

    it("SELECT with MERGE", () => {
      const result = validateSqlQuery("SELECT 1 WHERE MERGE INTO t USING s ON t.id = s.id");
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/MERGE/i);
    });

    it("SELECT with DELETE (case-insensitive)", () => {
      const result = validateSqlQuery("SELECT id FROM vehicles; delete FROM vehicles");
      expect(result.valid).toBe(false);
    });

    it("dangerous keyword in mixed case (DrOp)", () => {
      const result = validateSqlQuery("SELECT id FROM vehicles; DrOp TABLE vehicles");
      expect(result.valid).toBe(false);
    });
  });

  // ── Invalid: comments ─────────────────────────────────────────────

  describe("rejects queries containing SQL comments", () => {
    it("line comment (--)", () => {
      const result = validateSqlQuery("SELECT id FROM vehicles -- this is a comment");
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/comment/i);
    });

    it("block comment start (/*)", () => {
      const result = validateSqlQuery("SELECT id FROM vehicles /* hidden */");
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/comment/i);
    });

    it("block comment used to obfuscate keyword", () => {
      const result = validateSqlQuery("SELECT id FROM vehicles; DR/**/OP TABLE vehicles");
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/comment/i);
    });
  });

  // ── Invalid: multiple statements ──────────────────────────────────

  describe("rejects multiple statements", () => {
    it("two SELECTs separated by semicolon", () => {
      const result = validateSqlQuery("SELECT 1; SELECT 2");
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/multiple/i);
    });

    it("SELECT followed by SET", () => {
      const result = validateSqlQuery("SELECT 1; SET @a = 1");
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/multiple/i);
    });
  });

  // ── Edge cases ────────────────────────────────────────────────────

  describe("edge cases", () => {
    it("null-ish input", () => {
      expect(validateSqlQuery(null as any).valid).toBe(false);

      expect(validateSqlQuery(undefined as any).valid).toBe(false);
    });

    it("non-string input", () => {
      expect(validateSqlQuery(123 as any).valid).toBe(false);
    });

    it("SELECT keyword alone", () => {
      // Still technically a valid start; real DB will reject it on execution.
      expect(validateSqlQuery("SELECT").valid).toBe(true);
    });
  });
});
