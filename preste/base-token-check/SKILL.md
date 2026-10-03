---
name: base-token-check
description: Check a token, wallet or transaction on Base before acting on it. Uses the base-facts MCP tools (paid per call in USDC over x402, $0.001 to $0.01) and reports on-chain facts with their block number. Facts and heuristics, never financial advice.
license: MIT
compatibility: preste >= 0.66 with the base-facts MCP server in mcp_servers
metadata:
  version: 0.1.0
  category: onchain
  tags: [base, token, risk, x402, usdc, mcp]
  author: base-facts
  vauban:
    tier: unverified
    audit_status: review
---

Use this skill when a task involves a token, wallet, transaction or Basename on the Base network:
before buying or recommending a token, before sending funds to an address, or when asked what a
transaction did. You report verifiable on-chain facts; you never tell the user to buy or sell.

## Tools (from the `base-facts` MCP server)

| Tool | Cost | Use it for |
|---|---|---|
| `mcp__base-facts__base_token_verdict` | $0.01 | First call for any "is this token safe / should I buy" question |
| `mcp__base-facts__base_token_facts` | $0.005 | Raw facts only: metadata, owner, proxy, admin selectors |
| `mcp__base-facts__base_wallet_snapshot` | $0.002 | ETH and USDC balance, nonce, contract or not, before sending funds |
| `mcp__base-facts__base_tx_summary` | $0.003 | What a transaction did: status, fee, ERC20 transfers |
| `mcp__base-facts__basename_resolve` | $0.002 | `name.base.eth` to address, or address to its verified primary name |
| `mcp__base-facts__base_gas` | $0.001 | Current fees, only when timing a transaction matters |
| `mcp__base-facts__base_facts_budget` | free | How much this session has spent |

Every paid call costs real USDC. Call each tool once per address per task: answers are cached
for 60 seconds on the server and do not change within a block. Do not call the verdict and the
facts tool for the same token; the verdict already contains the facts.

## How to answer

1. Validate the input first: a Base address is `0x` + 40 hex characters, a transaction hash
   `0x` + 64. Ask the user if it is missing or malformed instead of paying for an error.
2. Call the tool. If it returns `charged: false`, nothing was paid: explain the reason
   (not a contract, unknown transaction, RPC down, not enough USDC) and stop or retry once.
3. Report, in this order:
   - the level (`low`, `medium`, `high`) and the score;
   - each `high` flag, then each `warn` flag, quoting its `fact` field;
   - liquidity in USD and on which DEX;
   - the block number the facts were read at.
4. Close with the limits that apply: bytecode selectors are a heuristic, spot reserves can be
   moved within one block, and none of this is financial advice.

Never invent a flag that the tool did not return, never round a `high` flag into reassurance,
and never present a `low` level as a guarantee.

## Setup (once)

1. Create a dedicated wallet with a little USDC on Base (1 USDC = 100 verdicts; no ETH needed)
   and save it as `~/.base-facts-mcp/payer.json`: `{ "privateKey": "0x..." }`.
2. Add the server to `~/.preste/config.yaml`:

```yaml
mcp_servers:
  - name: base-facts
    transport: stdio
    command: npx
    args: ["-y", "base-facts-mcp", "--max-price", "0.02", "--budget", "1"]
```

3. Copy this folder to `~/.preste/skills/base-token-check/`.
