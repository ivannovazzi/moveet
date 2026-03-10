import { describe, it, expect } from "vitest";
import { redactConfig } from "../utils/redact";
import type { ConfigField, PluginConfig } from "../plugins/types";

const REDACTED = "••••••";

describe("redactConfig", () => {
  const schema: ConfigField[] = [
    { name: "url", label: "URL", type: "string", required: true },
    { name: "token", label: "Auth Token", type: "password" },
    { name: "password", label: "Password", type: "password" },
    { name: "host", label: "Host", type: "string" },
    { name: "port", label: "Port", type: "number", default: 5432 },
    { name: "verbose", label: "Verbose", type: "boolean", default: false },
    { name: "query", label: "Query", type: "string" },
  ];

  it("redacts fields with schema type 'password'", () => {
    const config: PluginConfig = {
      url: "http://example.com",
      token: "secret-token-123",
      password: "super-secret",
    };

    const result = redactConfig(config, schema);

    expect(result.token).toBe(REDACTED);
    expect(result.password).toBe(REDACTED);
  });

  it("does not redact non-sensitive fields", () => {
    const config: PluginConfig = {
      url: "http://example.com",
      host: "localhost",
      port: 5432,
      verbose: true,
      query: "SELECT * FROM vehicles",
    };

    const result = redactConfig(config, schema);

    expect(result.url).toBe("http://example.com");
    expect(result.host).toBe("localhost");
    expect(result.port).toBe(5432);
    expect(result.verbose).toBe(true);
    expect(result.query).toBe("SELECT * FROM vehicles");
  });

  it("redacts fields matching sensitive name patterns even without schema", () => {
    const emptySchema: ConfigField[] = [];
    const config: PluginConfig = {
      apiToken: "tok-abc",
      secretKey: "sk-123",
      authHeader: "Bearer xyz",
      credentials: "user:pass",
      url: "http://example.com",
    };

    const result = redactConfig(config, emptySchema);

    expect(result.apiToken).toBe(REDACTED);
    expect(result.secretKey).toBe(REDACTED);
    expect(result.authHeader).toBe(REDACTED);
    expect(result.credentials).toBe(REDACTED);
    expect(result.url).toBe("http://example.com");
  });

  it("does not redact empty or null sensitive values", () => {
    const config: PluginConfig = {
      token: "",
      password: null,
      url: "http://example.com",
    };

    const result = redactConfig(config, schema);

    expect(result.token).toBe("");
    expect(result.password).toBeNull();
    expect(result.url).toBe("http://example.com");
  });

  it("handles config with no sensitive fields", () => {
    const safeSchema: ConfigField[] = [
      { name: "count", label: "Count", type: "number", default: 10 },
    ];
    const config: PluginConfig = { count: 20 };

    const result = redactConfig(config, safeSchema);

    expect(result.count).toBe(20);
  });

  it("works with mixed source and sink configs", () => {
    // Simulates a GraphQL source config
    const graphqlSchema: ConfigField[] = [
      { name: "url", label: "URL", type: "string", required: true },
      { name: "token", label: "Auth Token", type: "password" },
      { name: "maxVehicles", label: "Max Vehicles", type: "number", default: 0 },
    ];

    const config: PluginConfig = {
      url: "http://api.example.com/graphql",
      token: "bearer-token-value",
      maxVehicles: 50,
    };

    const result = redactConfig(config, graphqlSchema);

    expect(result.url).toBe("http://api.example.com/graphql");
    expect(result.token).toBe(REDACTED);
    expect(result.maxVehicles).toBe(50);
  });

  it("is case insensitive for name pattern matching", () => {
    const emptySchema: ConfigField[] = [];
    const config: PluginConfig = {
      API_TOKEN: "abc",
      SecretKey: "def",
      PASSWORD: "ghi",
    };

    const result = redactConfig(config, emptySchema);

    expect(result.API_TOKEN).toBe(REDACTED);
    expect(result.SecretKey).toBe(REDACTED);
    expect(result.PASSWORD).toBe(REDACTED);
  });
});
