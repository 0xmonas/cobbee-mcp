# @cobbee-mcp/server

MCP (Model Context Protocol) server for Cobbee — Enable AI agents to manage profiles, sell products, and make USDC payments to creators using the x402 payment protocol.

## Overview

This MCP server allows AI assistants like Claude to interact with the [Cobbee](https://cobbee.fun) platform. It uses [OWS (Open Wallet Standard)](https://openwallet.sh) for secure wallet management and [SIWA (Sign-In With Agent)](https://siwa.id) for authenticated API access. Payments use the x402 protocol on the Base network.

## Features

- **Send Coffee**: Tip creators with USDC on Base network
- **Buy Products**: Purchase digital products from creators
- **Create Profile**: Register as a creator on Cobbee
- **Update Profile**: Edit bio, social links, coffee price
- **Create Products**: List digital products in your shop
- **Update Products**: Edit product details, activate/deactivate
- **Delete Products**: Remove products from your shop
- **Search Creators**: Find creators by name or username
- **Get Creator Profile**: View detailed creator information
- **List Products**: Browse available products
- **Agent Stats**: View your agent statistics
- **Wallet Management**: Check balance and address

## Prerequisites

- Node.js >= 20.0.0
- [OWS CLI](https://openwallet.sh) installed
- An OWS wallet with USDC on Base network
- ERC-8004 agent registration on Base (for authenticated actions)

## Installation

### Option 1: Install from npm

```bash
npm install -g @cobbee-mcp/server
```

### Option 2: Build from source

```bash
cd cobbee-mcp
pnpm install
pnpm build
```

## Wallet Setup

### 1. Install OWS

```bash
curl -fsSL https://docs.openwallet.sh/install.sh | bash
```

### 2. Create a Wallet

```bash
ows wallet create --name cobbee-agent
```

This creates an encrypted wallet with addresses for all supported chains. Your private key is never exposed.

### 3. Fund Your Wallet

Deposit USDC on Base network to your wallet's EVM address.

```bash
ows fund balance --wallet cobbee-agent --chain base
```

### 4. Create an API Key (Optional)

For policy-gated access (restrict chains, amounts, expiry):

```bash
cat > policy.json << 'EOF'
{
  "id": "base-only",
  "name": "Base chain only",
  "version": 1,
  "rules": [
    { "type": "allowed_chains", "chain_ids": ["eip155:8453"] }
  ],
  "action": "deny"
}
EOF
ows policy create --file policy.json
ows key create --name cobbee --wallet cobbee-agent --policy base-only
```

## Configuration

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `OWS_WALLET_NAME` | Yes | — | Your OWS wallet name |
| `OWS_PASSPHRASE` | No | — | OWS API key (`ows_key_...`) or wallet passphrase |
| `AGENT_ID` | No | `1` | Your ERC-8004 agent NFT ID |
| `NETWORK` | No | `base` | `base` for mainnet, `base-sepolia` for testnet |
| `COBBEE_API_URL` | No | `https://cobbee.fun` | Cobbee API URL |

### Claude Desktop Configuration

Add to your Claude Desktop config file:

**macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "cobbee": {
      "command": "npx",
      "args": ["-y", "@cobbee-mcp/server"],
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

Or if built from source:

```json
{
  "mcpServers": {
    "cobbee": {
      "command": "node",
      "args": ["/path/to/cobbee-mcp/dist/index.js"],
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

### Cursor IDE Configuration

Create a `.cursor/mcp.json` file in your project directory:

```json
{
  "mcpServers": {
    "cobbee": {
      "command": "npx",
      "args": ["-y", "@cobbee-mcp/server"],
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

Setup steps for Cursor:

1. Create the `.cursor` directory in your project root
2. Create `.cursor/mcp.json` with the configuration above
3. Enable MCP in Cursor: Settings > Cursor Settings > MCP Servers > Toggle Enable
4. **Switch to Agent Mode** in Cursor chat (MCP tools only work in Agent Mode, not Ask Mode)
5. Verify the connection — the MCP server indicator should turn green

## Available Tools

### Public (no authentication needed)

#### `search_creators`
Search for creators on Cobbee.

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `query` | No | — | Search query for name/username |
| `limit` | No | 10 | Maximum results (1-50) |

Example: *"Search for creators related to 'digital art'"*

#### `get_creator`
Get detailed information about a specific creator.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `username` | Yes | Creator's username |

Example: *"Get profile information for @johndoe"*

#### `get_products`
List products available for purchase.

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `username` | No | — | Filter by creator username |
| `limit` | No | 10 | Maximum results (1-50) |

Example: *"List products from @johndoe"*

#### `get_wallet_balance`
Get the USDC balance of the configured wallet.

Example: *"What's my wallet balance?"*

#### `get_wallet_address`
Get the wallet address configured for payments.

Example: *"What's my wallet address?"*

### Payment Tools (x402)

#### `send_coffee`
Send a coffee tip (USDC) to a Cobbee creator.

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `username` | Yes | — | Creator's username |
| `coffeeCount` | No | 1 | Number of coffees (1-100) |
| `message` | No | — | Message to creator (max 500 chars) |
| `isPrivate` | No | false | Make the message private |

Example: *"Send 3 coffees to @johndoe with the message 'Love your work!'"*

#### `buy_product`
Purchase a digital product from a Cobbee creator.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `productId` | Yes | Product's UUID |
| `buyerName` | Yes | Your display name (2-50 chars) |
| `tipAmount` | No | For PWYW products: amount in USDC |
| `discountCode` | No | Discount code (6-12 chars) |

Example: *"Buy the product with ID abc123-def456"*

### Profile Management (authenticated)

#### `create_profile`
Create a creator profile on Cobbee (signup).

| Parameter | Required | Description |
|-----------|----------|-------------|
| `username` | Yes | Username (3-20 chars, alphanumeric) |
| `displayName` | Yes | Display name (2-50 chars) |

Example: *"Create a Cobbee profile with username 'myagent' and name 'My AI Agent'"*

#### `update_profile`
Update your Cobbee profile.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `displayName` | No | Display name |
| `bio` | No | Bio (max 500 chars) |
| `coffeePrice` | No | Coffee price in USDC (1-10) |
| `twitterHandle` | No | Twitter handle |
| `instagramHandle` | No | Instagram handle |
| `githubHandle` | No | GitHub handle |
| `websiteUrl` | No | Website URL |

Example: *"Update my bio to 'AI agent that helps with code reviews'"*

#### `get_my_profile`
Get your own Cobbee profile.

Example: *"Show me my Cobbee profile"*

### Product Management (authenticated)

#### `create_product`
Create a new digital product on your Cobbee shop.

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `name` | Yes | — | Product name (2-100 chars) |
| `price` | Yes | — | Price in USDC (0-1000) |
| `description` | No | — | Description (max 500 chars) |
| `category` | No | — | Category |
| `isPayWhatYouWant` | No | false | Enable PWYW pricing |

Example: *"Create a product called 'Code Review Pack' for $5 USDC"*

#### `update_product`
Update one of your products.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `productId` | Yes | Product UUID |
| `name` | No | New name |
| `description` | No | New description |
| `price` | No | New price |
| `isActive` | No | Activate/deactivate |

Example: *"Update the price of product abc123 to $10"*

#### `delete_product`
Delete one of your products.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `productId` | Yes | Product UUID |

Example: *"Delete product abc123"*

#### `get_my_products`
List your own products.

Example: *"Show me my products"*

### Agent Stats (authenticated)

#### `get_agent_stats`
Get your agent statistics (supports received, products sold, etc.).

Example: *"Show me my agent stats"*

## How Authentication Works

When the MCP server starts, it authenticates automatically:

1. **OWS** retrieves your wallet address (private key never leaves the encrypted vault)
2. Server requests a **SIWA nonce** from Cobbee API
3. **OWS** signs the SIWA message in an isolated process
4. Server verifies the signature and receives an **HMAC receipt** (valid 7 days)
5. All authenticated requests include the receipt header
6. Receipt auto-refreshes before expiry

Your private key is **never exposed** — OWS keeps it encrypted at rest and signs in an isolated process.

## How x402 Payment Works

1. When you request a payment (`send_coffee`, `buy_product`), the MCP server makes a request to Cobbee's API
2. The API responds with `402 Payment Required` and payment details
3. The x402-wrapped client automatically signs the payment with your wallet
4. The signed payment is sent back to complete the transaction
5. The payment is verified and settled on the Base blockchain

## Security

- **Private Key Storage**: OWS keeps your key encrypted. Never stored as plaintext in environment variables.
- **Policy-Gated Signing**: OWS API keys enforce chain, amount, and time policies.
- **Authenticated Sessions**: HMAC-signed receipts with 7-day expiry, auto-refreshed.
- **ERC-8004**: On-chain agent identity verification at authentication time.
- **Amount Limits**: Max 100 coffees per transaction. Product prices enforced by API.
- **Network Confirmation**: Always verify you're on the correct network (mainnet vs testnet).

## Troubleshooting

### "OWS_WALLET_NAME environment variable is required"
Set the `OWS_WALLET_NAME` environment variable with your OWS wallet name. Create one with `ows wallet create --name my-agent`.

### "No EVM account found in wallet"
Your OWS wallet doesn't have an EVM account. Try creating a new wallet: `ows wallet create --name new-agent`.

### "SIWA auth failed"
Your wallet may not be registered as an ERC-8004 agent on Base. Check your agent registration status.

### "Insufficient balance"
Your wallet doesn't have enough USDC. Use `get_wallet_balance` to check. Fund with `ows fund deposit --wallet my-agent --chain base`.

### "Creator not found"
The username doesn't exist on Cobbee. Try `search_creators` to find the correct username.

### "Payment failed"
This could be due to network issues or insufficient gas. Make sure you have:
- Enough USDC for the payment
- Some ETH for gas fees on Base network

## Development

```bash
# Install dependencies
pnpm install

# Run in development mode
pnpm dev

# Build for production
pnpm build

# Type check
pnpm typecheck
```

## License

MIT

## Links

- [Cobbee Platform](https://cobbee.fun)
- [Open Wallet Standard](https://openwallet.sh)
- [SIWA (Sign-In With Agent)](https://siwa.id)
- [x402 Protocol](https://x402.org)
- [Model Context Protocol](https://modelcontextprotocol.io)
- [Base Network](https://base.org)
