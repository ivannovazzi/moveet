/**
 * SQL query validation for database source plugins.
 *
 * Only read-only SELECT statements are allowed. Queries containing data
 * modification keywords, multiple statements, or SQL comment syntax are
 * rejected to reduce the risk of accidental (or malicious) schema/data
 * changes when the query string is provided via plugin configuration.
 *
 * NOTE: This is a defence-in-depth measure. The query originates from
 * admin-level plugin config, not from end-user input, so the blast radius
 * is limited. The database user should still be granted read-only
 * permissions as the primary safeguard.
 */

/**
 * Keywords that must NOT appear anywhere in the query (case-insensitive).
 * Matched as whole words (word-boundary regex) so column names like
 * "updated_at" do not trigger a false positive.
 */
const DANGEROUS_KEYWORDS = [
  "INSERT",
  "UPDATE",
  "DELETE",
  "DROP",
  "ALTER",
  "TRUNCATE",
  "CREATE",
  "REPLACE",
  "GRANT",
  "REVOKE",
  "EXEC",
  "EXECUTE",
  "CALL",
  "MERGE",
  "RENAME",
  "LOAD",
  "INTO\\s+OUTFILE",
  "INTO\\s+DUMPFILE",
] as const;

const DANGEROUS_RE = new RegExp(`\\b(?:${DANGEROUS_KEYWORDS.join("|")})\\b`, "i");

/**
 * Patterns that indicate multiple statements or comment-based obfuscation.
 */
const SEMICOLON_RE = /;\s*\S/; // semicolon followed by another statement
const COMMENT_RE = /--|\/\*|\*\//; // SQL line or block comment markers

export interface SqlValidationResult {
  valid: boolean;
  reason?: string;
}

/**
 * Validate that a SQL query string is a safe, read-only SELECT statement.
 *
 * Rules applied:
 * 1. Must be a non-empty string.
 * 2. Must start with the SELECT keyword (after optional whitespace).
 * 3. Must not contain dangerous DDL/DML keywords.
 * 4. Must not contain multiple statements (semicolon followed by text).
 * 5. Must not contain SQL comments (-- or block comments).
 */
export function validateSqlQuery(query: string): SqlValidationResult {
  if (!query || typeof query !== "string") {
    return { valid: false, reason: "Query must be a non-empty string" };
  }

  const trimmed = query.trim();

  if (trimmed.length === 0) {
    return { valid: false, reason: "Query must be a non-empty string" };
  }

  // Must start with SELECT
  if (!/^\s*SELECT\b/i.test(trimmed)) {
    return {
      valid: false,
      reason: "Query must be a SELECT statement",
    };
  }

  // Block SQL comments — these can be used to hide dangerous keywords
  if (COMMENT_RE.test(trimmed)) {
    return {
      valid: false,
      reason: "SQL comments are not allowed in queries",
    };
  }

  // Block multiple statements (semicolon followed by more text)
  if (SEMICOLON_RE.test(trimmed)) {
    return {
      valid: false,
      reason: "Multiple SQL statements are not allowed",
    };
  }

  // Block dangerous keywords
  const dangerousMatch = trimmed.match(DANGEROUS_RE);
  if (dangerousMatch) {
    return {
      valid: false,
      reason: `Dangerous SQL keyword detected: ${dangerousMatch[0].toUpperCase()}`,
    };
  }

  return { valid: true };
}
