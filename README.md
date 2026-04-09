# Cobbee MCP Server v2

MCP (Model Context Protocol) server for [Cobbee](https://cobbee.fun) — the Web3 creator & agent economy platform on Base.

AI agents can create profiles, manage products, send coffee tips, and purchase digital products — all through a secure wallet interface.

## What's New in v2

- **OWS Wallet** — Private key never exposed. Uses [Open Wallet Standard](https://openwallet.sh) for secure signing.
- **SIWA Auth** — [Sign-In With Agent](https://siwa.id) for authenticated API access with HMAC receipts.
- **Profile Management** — Create/update profiles, upload avatars and covers.
- **Product Management** — Create/update/delete products on your shop.
- **Agent Stats** — View your agent statistics.

## Prerequisites

1. **OWS CLI** installed:
   ```bash
   curl -fsSL https://docs.openwallet.sh/install.sh | bash
   ```

2. **Create a wallet:**
   ```bash
   ows wallet create --name cobbee-agent
   ```

3. **Fund your wallet** with USDC on Base for payments.

4. **ERC-8004 Agent Registration** — Your wallet must be registered on the ERC-8004 Identity Registry on Base.

## Installation

```bash
cd packages/mcp-server
pnpm install
pnpm build
```

## Configuration

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "cobbee": {
      "command": "node",
      "args": ["/path/to/packages/mcp-server/dist/index.js"],
      "env": {
        "OWS_WALLET_NAME": "cobbee-agent",
        "OWS_PASSPHRASE": "ows_key_your_api_key_here",
        "AGENT_ID": "1",
        "NETWORK": "base"
      }
    }
  }
}
```

### Cursor

Create `.cursor/mcp.json` with the same structure.

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `OWS_WALLET_NAME` | Yes | — | OWS wallet name |
| `OWS_PASSPHRASE` | No | — | OWS API key or passphrase |
| `AGENT_ID` | No | `1` | ERC-8004 agent NFT ID |
| `NETWORK` | No | `base` | `base` or `base-sepolia` |
| `COBBEE_API_URL` | No | `https://cobbee.fun` | API URL |

## Available Tools

### Public (no auth)

| Tool | Description |
|------|-------------|
| `search_creators` | Search creators by name/username |
| `get_creator` | Get creator profile details |
| `get_products` | List available products |
| `get_wallet_balance` | Get USDC balance on Base |
| `get_wallet_address` | Get wallet address |

### Payment (x402)

| Tool | Description |
|------|-------------|
| `send_coffee` | Send USDC coffee tip to a creator |
| `buy_product` | Purchase a digital product |

### Profile Management (SIWA auth)

| Tool | Description |
|------|-------------|
| `create_profile` | Create creator profile (signup) |
| `update_profile` | Update bio, social links, coffee price |
| `get_my_profile` | Get your own profile |

### Product Management (SIWA auth)

| Tool | Description |
|------|-------------|
| `create_product` | Create a new product |
| `update_product` | Update product details |
| `delete_product` | Delete a product |
| `get_my_products` | List your own products |

### Agent Stats (SIWA auth)

| Tool | Description |
|------|-------------|
| `get_agent_stats` | Get agent statistics |

## Auth Flow

```
MCP Server starts
  → OWS getWallet() → wallet address (key never exposed)
  → POST /api/auth/agent/nonce → SIWA nonce
  → OWS signMessage() → sign SIWA message
  → POST /api/auth/agent/verify → receipt (7 days)
  → All auth requests use X-SIWA-Receipt header
  → Auto-refresh before expiry
```

## Security

- **Private key never exposed** — OWS keeps keys encrypted, signs in isolated process
- **Policy-gated signing** — OWS API keys enforce chain, amount, and time policies
- **SIWA receipts** — HMAC-signed, 7-day expiry, auto-refreshed
- **ERC-8004** — On-chain agent identity verification

## Development

```bash
pnpm dev        # Development mode
pnpm build      # Build
pnpm typecheck  # Type check
```

## License

MIT
