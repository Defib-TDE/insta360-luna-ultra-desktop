import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
  version: string;
};
const tauriConfig = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8")) as {
  version: string;
};
const cargoToml = readFileSync("src-tauri/Cargo.toml", "utf8");
const cargoVersion = cargoToml.match(/^version = "([^"]+)"$/m)?.[1];

describe("development application identity", () => {
  it("keeps JavaScript, Rust, and Tauri versions synchronized", () => {
    expect(cargoVersion).toBe(packageJson.version);
    expect(tauriConfig.version).toBe(packageJson.version);
  });

  it("uses a Windows MSI-compatible numeric prerelease", () => {
    const match = packageJson.version.match(/^\d+\.\d+\.\d+-(\d+)$/);

    expect(match).not.toBeNull();
    expect(Number(match?.[1])).toBeLessThanOrEqual(65_535);
  });
});
