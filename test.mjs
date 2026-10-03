// Drives the MCP server over stdio like a real client. No USDC is spent: the wallets used are empty.
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { generatePrivateKey } from "viem/accounts";

async function start(env, args = []) {
  const client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: ["index.mjs", ...args], env: { ...process.env, ...env } }));
  return client;
}
const resultText = (r) => r.content[0].text;

// Without a wallet: tools are listed, paid tools explain how to configure one
let client = await start({ X402_PRIVATE_KEY: "", X402_PAYER_FILE: "" });
const names = (await client.listTools()).tools.map((t) => t.name).sort();
assert.deepEqual(names, ["base_facts_budget", "base_gas", "base_token_facts", "base_token_verdict", "base_tx_summary", "base_wallet_snapshot", "basename_resolve"]);
let r = await client.callTool({ name: "base_gas", arguments: {} });
assert.equal(r.isError, true);
assert.match(resultText(r), /No wallet configured/);
r = await client.callTool({ name: "basename_resolve", arguments: {} });
assert.match(resultText(r), /exactly one/);
await client.close();
console.log("no wallet: ok");

// Empty wallet: the payment is signed but cannot settle, so nothing is charged and the budget stays 0
client = await start({ X402_PRIVATE_KEY: generatePrivateKey() });
r = await client.callTool({ name: "base_gas", arguments: {} });
assert.equal(r.isError, true);
console.log("empty wallet:", resultText(r).replace(/\s+/g, " ").slice(0, 160));
r = await client.callTool({ name: "base_facts_budget", arguments: {} });
assert.equal(JSON.parse(resultText(r)).spentUsd, 0);
await client.close();
console.log("empty wallet: ok");

// Budget below the price, given as options the way Preste passes them: the client refuses to sign
const keyFile = path.join(os.tmpdir(), `base-facts-mcp-test-${process.pid}.json`);
fs.writeFileSync(keyFile, JSON.stringify({ privateKey: generatePrivateKey() }));
client = await start({}, ["--payer-file", keyFile, "--budget", "0.0005"]);
r = await client.callTool({ name: "base_gas", arguments: {} });
assert.equal(r.isError, true);
console.log("budget:", resultText(r).replace(/\s+/g, " ").slice(0, 160));
await client.close();
fs.rmSync(keyFile);
console.log("all checks passed");
