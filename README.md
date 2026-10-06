# base-facts-mcp

An MCP server for AI agents that trade or move money on Base. Each tool calls
[Base Token Facts](https://base-facts.yankii.fr) and pays for the call itself in USDC over
[x402](https://x402.org), from a small wallet you control. Every answer is read at one block and says which.

| Tool | Price | Answers |
|---|---|---|
| `base_token_verdict` | $0.01 | Before buying a token: risk level, score and flags (proxy, mint, pause, blacklist, owner, DEX liquidity), each with its on-chain fact |
| `base_token_sellcheck` | $0.005 | Honeypot and tax check: simulates a small buy and immediate sell on the deepest pool, returns buy/sell tax, round-trip loss |
| `base_token_sellcheck_size` | $0.01 | The same check at your trade size (`amountEth`, 0.001 to 10 ETH): tax, round-trip loss, buy price impact and a depth warning when the size is larger than the pool can absorb |
| `base_token_facts` | $0.005 | ERC20 metadata, owner, proxy and implementation, admin selectors in the bytecode |
| `base_wallet_snapshot` | $0.002 | ETH and USDC balances, nonce, contract or not |
| `base_gas` | $0.001 | Base fee, priority fee, gas price |
| `base_tx_summary` | $0.003 | Status, fee and decoded ERC20 transfers of a transaction |
| `basename_resolve` | $0.002 | `name.base.eth` to address, or address to its verified primary Basename |
| `base_facts_budget` | free | What this session has spent |

Facts and heuristics, not financial advice. API docs and live revenue counter:
https://base-facts.yankii.fr and https://base-facts.yankii.fr/stats

## Setup

1. Make a **dedicated** wallet and put a little USDC on it, on the Base network (1 USDC pays for
   100 verdicts). No ETH is needed: the x402 facilitator pays the gas. Never use your main wallet.
2. Add the server to your MCP client, for example `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "base-facts": {
      "command": "npx",
      "args": ["-y", "base-facts-mcp"],
      "env": {
        "X402_PAYER_FILE": "/path/to/payer.json",
        "MAX_PRICE_USD": "0.02",
        "SESSION_BUDGET_USD": "1"
      }
    }
  }
}
```

`payer.json` is `{ "privateKey": "0x..." }`; `X402_PRIVATE_KEY` works too. Without either, the server
uses `~/.base-facts-mcp/payer.json` when it exists.

Every setting also exists as an option, for hosts that pass only `command` and `args` (Preste):
`--payer-file <path>`, `--max-price <usd>`, `--budget <usd>`, `--api <url>`. See
`integrations/preste/` for the Preste config and skill.

## Spending safety

- `MAX_PRICE_USD` (default 0.02): the client refuses to sign any single payment above it.
- `SESSION_BUDGET_USD` (default 1): once reached, the client stops signing until restarted.
- Only USDC on Base (`eip155:8453`) is ever signed.
- A refused or failed call (4xx/5xx) cancels the settlement: you are not charged, and the tool says
  `charged: false` with the reason (for example not enough USDC).
- Paid calls run one at a time so the budget count stays exact.

## Development

`npm test` drives the server over stdio like a real client, with empty wallets: no USDC is spent.
