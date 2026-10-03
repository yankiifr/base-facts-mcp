# Preste integration

[Preste](https://preste.vauban.tech) agents can use our Base routes through the `base-facts` MCP
server, with the `base-token-check` skill telling the agent when to call which tool and how to report.

| File | Role |
|---|---|
| `base-token-check/SKILL.md` | Instructions loaded by the agent: which tool for which question, how to report flags, costs, limits, setup |

In Preste 0.66, a local SKILL.md is a prompt, not code: the tools come from the MCP server, which pays
each call from the user's wallet (per-call cap and session budget). Preste starts MCP servers with
`command` and `args` only, without environment variables, so the server takes its settings as options
(`--payer-file`, `--max-price`, `--budget`) or reads `~/.base-facts-mcp/payer.json`.

## Install for a user

1. `~/.base-facts-mcp/payer.json` with a dedicated wallet holding a little USDC on Base.
2. In `~/.preste/config.yaml`:

```yaml
mcp_servers:
  - name: base-facts
    transport: stdio
    command: npx
    args: ["-y", "base-facts-mcp", "--max-price", "0.02", "--budget", "1"]
```

3. Copy `base-token-check/` to `~/.preste/skills/`.

Checked on 2026-10-03 with @vauban-org/preste 0.66.2: `preste skills list` loads the skill (frontmatter
valid against its SkillManifestSchema). Needs `base-facts-mcp` on npm for the `npx` line.

## Marketplace

`preste skills publish ./base-token-check --tier free` would list it for every Preste agent; it needs a
Vauban publisher account. A paid-tier skill is billed through Preste's own x402 receipts (STARK), a
different rail from our USDC-on-Base routes: check with the Preste maintainers before going that way.
