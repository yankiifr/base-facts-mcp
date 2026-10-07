#!/usr/bin/env node
// MCP server (stdio) that gives an AI agent on-chain facts about Base, each call paid in USDC
// over x402 from a small wallet the user controls. Every answer is read at one block and says which.
//
// Settings, as command-line options or environment variables (options win). Some MCP hosts,
// like Preste, pass only command and args to the server, so every setting has an option.
//   --payer-file / X402_PAYER_FILE    JSON file { "privateKey": "0x..." } of a wallet holding a little
//                                     USDC on Base (no ETH needed); default ~/.base-facts-mcp/payer.json
//   X402_PRIVATE_KEY                  the key itself, instead of a file
//   --max-price / MAX_PRICE_USD       refuse any single call above this price (default 0.02)
//   --budget / SESSION_BUDGET_USD     stop paying once this much was spent this session (default 1)
//   --api / BASE_FACTS_URL            API base URL (default https://base-facts.yankii.fr)
//   --pay-to / BASE_FACTS_PAY_TO      the only address allowed to receive payments; defaults to the
//                                     official one for the default API, and is REQUIRED for any other API
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { privateKeyToAccount } from "viem/accounts";
import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm/exact/client";

function option(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

const API = (option("api") || process.env.BASE_FACTS_URL || "https://base-facts.yankii.fr").replace(/\/$/, "");
const NETWORK = "eip155:8453";
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const OFFICIAL_API = "https://base-facts.yankii.fr";
const OFFICIAL_PAY_TO = "0x40661D56c2Bf416c5946A8b21098eaF8D33459A2";
const PAY_TO = (option("pay-to") || process.env.BASE_FACTS_PAY_TO || (API === OFFICIAL_API ? OFFICIAL_PAY_TO : "")).toLowerCase();
const MAX_PRICE_USD = Number(option("max-price") || process.env.MAX_PRICE_USD || 0.02);
const SESSION_BUDGET_USD = Number(option("budget") || process.env.SESSION_BUDGET_USD || 1);
const DEFAULT_PAYER_FILE = path.join(os.homedir(), ".base-facts-mcp", "payer.json");
const toAtomic = (usd) => BigInt(Math.round(usd * 1e6)); // USDC has 6 decimals

let spentAtomic = 0n;
let signedAtomic = 0n; // amount signed for the call in progress (paid calls run one at a time)
let queue = Promise.resolve();

function loadAccount() {
  const fileOption = option("payer-file");
  let key = fileOption ? null : process.env.X402_PRIVATE_KEY;
  const file = fileOption || process.env.X402_PAYER_FILE || (fs.existsSync(DEFAULT_PAYER_FILE) ? DEFAULT_PAYER_FILE : null);
  if (!key && file) key = JSON.parse(fs.readFileSync(file, "utf8")).privateKey;
  return key ? privateKeyToAccount(key.startsWith("0x") ? key : `0x${key}`) : null;
}

const account = loadAccount();
let payFetch = null;
if (account) {
  const client = new x402Client()
    .register(NETWORK, new ExactEvmScheme(account))
    .setSpendControls({ maxAmountPerPayment: MAX_PRICE_USD })
    // Only Base USDC, to the expected recipient, that still fits in the session budget.
    // With no known recipient (custom API and no --pay-to) nothing is signed.
    .registerPolicy((_version, reqs) =>
      reqs.filter(
        (r) =>
          r.network === NETWORK &&
          String(r.asset).toLowerCase() === USDC_BASE.toLowerCase() &&
          PAY_TO !== "" &&
          String(r.payTo).toLowerCase() === PAY_TO &&
          spentAtomic + BigInt(r.amount) <= toAtomic(SESSION_BUDGET_USD),
      ),
    );
  client.onAfterPaymentCreation(async ({ selectedRequirements }) => {
    signedAtomic = BigInt(selectedRequirements.amount);
  });
  payFetch = wrapFetchWithPayment(fetch, client);
}

function text(value, isError = false) {
  return { content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }], isError };
}

function callRoute(method, path, body) {
  const run = queue.then(() => paidCall(method, path, body));
  queue = run.catch(() => {});
  return run;
}

async function paidCall(method, path, body) {
  signedAtomic = 0n;
  if (!payFetch) {
    return text(`No wallet configured. Pass --payer-file, set X402_PAYER_FILE or X402_PRIVATE_KEY, or create ${DEFAULT_PAYER_FILE}: a wallet holding a little USDC on Base.`, true);
  }
  let res;
  try {
    res = await payFetch(`${API}${path}`, {
      method,
      headers: { "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    return text(`Payment or network error: ${err.message}. Spent this session: $${Number(spentAtomic) / 1e6}.`, true);
  }
  const settlement = res.headers.get("PAYMENT-RESPONSE");
  const paid = settlement ? JSON.parse(Buffer.from(settlement, "base64").toString("utf8")) : null;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    // A second 402 means the payment was refused (e.g. not enough USDC); the reason is in the header
    const challenge = res.status === 402 ? res.headers.get("PAYMENT-REQUIRED") : null;
    const reason = challenge ? JSON.parse(Buffer.from(challenge, "base64").toString("utf8")).error : null;
    // 4xx/5xx answers cancel the settlement: nothing was charged
    return text({ status: res.status, error: reason || data?.error || data, charged: false }, true);
  }
  if (paid?.success) spentAtomic += signedAtomic;
  return text({ ...data, payment: paid?.transaction ? `https://basescan.org/tx/${paid.transaction}` : undefined });
}

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "0x-prefixed 20-byte address");
const server = new McpServer({ name: "base-facts", version: "0.1.0" });

server.registerTool("base_token_verdict", {
  title: "Base token verdict ($0.01)",
  description: "Before buying a token on Base: risk level, score and flags (upgradeable proxy, mint, pause, blacklist, owner not renounced, DEX liquidity on Uniswap v2/v3 and Aerodrome), each with the on-chain fact behind it. Facts and heuristics, not financial advice. Costs $0.01 in USDC.",
  inputSchema: { token: address.describe("Token contract address on Base") },
}, ({ token }) => callRoute("POST", "/v1/verdict", { token }));
server.registerTool("base_token_sellcheck", {
  title: "Base token sell check ($0.005)",
  description: "Honeypot and tax check for a Base token: simulates a small buy and an immediate sell on its deepest pool (Uniswap v2/v3/v4, Aerodrome) inside eth_call. Returns buy tax, sell tax, round-trip loss and whether the sell reverted. Paid with x402 from your payer wallet.",
  inputSchema: { token: address.describe("Token contract address on Base") },
}, ({ token }) => callRoute("POST", "/v1/sellcheck", { token }));
server.registerTool("base_token_sellcheck_size", {
  title: "Base token sell check at your trade size ($0.01)",
  description: "The sell check at YOUR size: simulates a buy of amountEth (0.001 to 10 ETH) and an immediate sell inside eth_call. Returns buy tax, sell tax, round-trip loss, the buy price impact against a small trade (buyPriceImpactPct) and a depthWarning when the size is larger than the pool can absorb. Costs $0.01.",
  inputSchema: { token: address.describe("Token contract address on Base"), amountEth: z.string().regex(/^\d{1,3}(\.\d{1,18})?$/, "decimal string such as 0.5").describe("Trade size in ETH, 0.001 to 10") },
}, ({ token, amountEth }) => callRoute("POST", "/v1/sellcheck/size", { token, amountEth }));


server.registerTool("base_token_facts", {
  title: "Base token facts ($0.005)",
  description: "Raw on-chain facts about a Base token contract: ERC20 metadata, owner(), proxy standard and implementation, admin function selectors found in the bytecode, block number. Costs $0.005.",
  inputSchema: { token: address.describe("Token contract address on Base") },
}, ({ token }) => callRoute("POST", "/v1/facts", { token }));

server.registerTool("base_wallet_snapshot", {
  title: "Base wallet snapshot ($0.002)",
  description: "ETH and USDC balances, transaction count (nonce) and whether the address is a contract, on Base. Costs $0.002.",
  inputSchema: { address: address.describe("Wallet address on Base") },
}, ({ address: a }) => callRoute("POST", "/v1/wallet", { address: a }));

server.registerTool("base_gas", {
  title: "Base gas snapshot ($0.001)",
  description: "Current Base base fee, max priority fee, gas price (wei) and block usage. Costs $0.001.",
  inputSchema: {},
}, () => callRoute("GET", "/v1/gas"));

server.registerTool("base_tx_summary", {
  title: "Base transaction summary ($0.003)",
  description: "Status, from/to, gas used, fee in ETH and decoded ERC20 transfers of a Base transaction. Costs $0.003.",
  inputSchema: { hash: z.string().regex(/^0x[0-9a-fA-F]{64}$/, "0x-prefixed 32-byte hash") },
}, ({ hash }) => callRoute("POST", "/v1/tx", { hash }));

server.registerTool("basename_resolve", {
  title: "Basename resolve ($0.002)",
  description: "Resolve a Basename (name.base.eth) to its address, or an address to its verified primary Basename. Give exactly one of name or address. Costs $0.002.",
  inputSchema: {
    name: z.string().regex(/^[a-z0-9-]+\.base\.eth$/i).optional().describe("e.g. jesse.base.eth"),
    address: address.optional(),
  },
}, ({ name, address: a }) => {
  if (!name === !a) return text("Give exactly one of name or address.", true);
  return callRoute("POST", "/v1/basename", name ? { name } : { address: a });
});

server.registerTool("base_facts_budget", {
  title: "Spending so far (free)",
  description: "How much this session has paid, the per-call cap and the session budget. Free.",
  inputSchema: {},
}, () => text({
  wallet: account?.address ?? null,
  spentUsd: Number(spentAtomic) / 1e6,
  maxPriceUsd: MAX_PRICE_USD,
  sessionBudgetUsd: SESSION_BUDGET_USD,
}));

await server.connect(new StdioServerTransport());
