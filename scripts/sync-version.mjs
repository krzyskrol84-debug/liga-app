import { readFileSync, writeFileSync } from "node:fs";

const packageJsonPath = "package.json";
const tauriConfigPath = "src-tauri/tauri.conf.json";
const cargoTomlPath = "src-tauri/Cargo.toml";

const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
const version = packageJson.version;

if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
  throw new Error(`Invalid package.json version: ${version}`);
}

const tauriConfig = JSON.parse(readFileSync(tauriConfigPath, "utf8"));
tauriConfig.version = version;
writeFileSync(tauriConfigPath, `${JSON.stringify(tauriConfig, null, 2)}\n`);

const cargoToml = readFileSync(cargoTomlPath, "utf8").replace(
  /^version = ".*"$/m,
  `version = "${version}"`,
);
writeFileSync(cargoTomlPath, cargoToml);

console.log(`Synced release version: ${version}`);
