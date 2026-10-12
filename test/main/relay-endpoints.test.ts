import { describe, expect, it } from "vitest";
import { endpoints } from "../../src/main/relay/endpoints";

const env = {
  CALICO_CF_API_URL: "http://127.0.0.1:1/api",
  CALICO_CF_AUTH_URL: "http://127.0.0.1:1/auth",
  CALICO_CF_TOKEN_URL: "http://127.0.0.1:1/token",
  CALICO_CF_REVOKE_URL: "http://127.0.0.1:1/revoke",
  CALICO_CF_CLIENT_ID: "other",
  CALICO_CF_WORKERS_ORIGIN: "http://127.0.0.1:1",
};

describe("endpoints", () => {
  it("lets a test point setup at a fake Cloudflare when not packaged", () => {
    expect(endpoints(env, false)).toMatchObject({
      apiUrl: "http://127.0.0.1:1/api",
      authUrl: "http://127.0.0.1:1/auth",
      tokenUrl: "http://127.0.0.1:1/token",
      revokeUrl: "http://127.0.0.1:1/revoke",
      clientId: "other",
      workersOrigin: "http://127.0.0.1:1",
    });
  });

  it("ignores every override in a packaged build, so the environment cannot redirect the sign-in or the token", () => {
    const real = endpoints(env, true);
    expect(real.apiUrl).toBeUndefined();
    expect(real.authUrl).toBeUndefined();
    expect(real.tokenUrl).toBeUndefined();
    expect(real.revokeUrl).toBeUndefined();
    expect(real.workersOrigin).toBeUndefined();
    expect(real.clientId).not.toBe("other");
  });
});
