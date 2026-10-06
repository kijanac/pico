#!/usr/bin/env node
import { readFile } from "node:fs/promises";

const readJson = async (path) => JSON.parse(await readFile(new URL(`../${path}`, import.meta.url), "utf8"));
const host = await readJson("packages/host/package.json");
const extension = await readJson("packages/pi-extension/package.json");

const coding = host.dependencies["@earendil-works/pi-coding-agent"];
const ai = host.dependencies["@earendil-works/pi-ai"];
const version = coding?.replace(/^\^/, "");
if (!version || ai !== `^${version}`) {
  throw new Error(`Host Pi packages are not aligned: coding-agent=${coding}, pi-ai=${ai}`);
}
if (
  extension.devDependencies["@earendil-works/pi-coding-agent"] !== `^${version}` ||
  extension.devDependencies["@earendil-works/pi-ai"] !== `^${version}`
) {
  throw new Error(`Extension development Pi packages must match host ${version}`);
}
const [major, minor] = version.split(".").map(Number);
const expectedPeer = `>=${version} <${major}.${minor + 1}.0`;
for (const dependency of ["@earendil-works/pi-coding-agent", "@earendil-works/pi-ai"]) {
  const actual = extension.peerDependencies[dependency];
  if (actual !== expectedPeer) {
    throw new Error(`${dependency} peer range must be ${expectedPeer}; got ${actual}`);
  }
}
console.log(`Pi runtime packages aligned at ${version} (${expectedPeer})`);
