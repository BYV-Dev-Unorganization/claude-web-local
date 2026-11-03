import { describe, expect, it } from "vitest";
import { isPublicAddress, assertPublicHttpUrl } from "./security.js";
import { publicModelConfiguration } from "./config.js";
import { sqlite } from "./db.js";

describe("model configuration contract", () => {
  it("exposes exactly the four stable aliases without returning IDs or credentials", () => {
    const models = publicModelConfiguration();
    expect(models.map((item) => item.alias)).toEqual(["fable", "opus", "sonnet", "haiku"]);
    expect(models.every((item) => typeof item.configured === "boolean")).toBe(true);
    expect(JSON.stringify(models)).not.toMatch(/api[_-]?key|sk-[A-Za-z0-9]+/i);
  });
});

describe("network address policy", () => {
  it("permits a public IPv4 address", () => {
    expect(isPublicAddress("8.8.8.8")).toBe(true);
  });
  it.each(["127.0.0.1", "10.0.0.5", "172.16.0.1", "192.168.1.1", "169.254.169.254", "::1"])(
    "blocks private or loopback address %s", (address) => {
      expect(isPublicAddress(address)).toBe(false);
    }
  );
  it("rejects file URLs", async () => {
    await expect(assertPublicHttpUrl("file:///etc/passwd")).rejects.toThrow("Only HTTP and HTTPS");
  });
  it("rejects loopback HTTP URLs", async () => {
    await expect(assertPublicHttpUrl("http://127.0.0.1/")).rejects.toThrow("Private or reserved");
  });
});

describe("database initialization", () => {
  it("creates core tables and enables foreign keys", () => {
    const row = sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'conversations'").get() as { name: string } | undefined;
    expect(row?.name).toBe("conversations");
    expect(sqlite.pragma("foreign_keys", { simple: true })).toBe(1);
  });
});
