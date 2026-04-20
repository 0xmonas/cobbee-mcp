# @cobbee-mcp/server

MCP (Model Context Protocol) server for Cobbee — Enable AI agents to manage profiles, sell products, and make USDC payments to creators using the x402 payment protocol.

---

## 🔒 SECURITY FIRST — READ BEFORE INSTALLING

This MCP manages a **crypto wallet with real funds**. Losing access or leaking credentials can result in **permanent, irreversible loss of funds**.

### Before You Start

- [ ] **Understand:** There is no "forgot password" in crypto. Lose the passphrase → lose the funds. Forever.
- [ ] **Understand:** Leak the seed phrase → anyone who sees it can drain your wallet.
- [ ] **Understand:** AI agents are the #1 source of leaked credentials. Bots scan GitHub in real-time.

### Non-Negotiable Rules

1. **Use a strong passphrase** — minimum 12 characters, random, stored in a password manager. NOT your email password.
2. **Back up the seed phrase offline** — write it on paper, store it in a safe. NEVER photograph it, screenshot it, or paste it into a chat.
3. **Use a dedicated wallet with limited funds** — never your main wallet. Fund only what you're willing to lose (e.g., $50-$500 for agent operations).
4. **Never commit credentials to Git** — `.env`, wallet files, API keys. If you see it in a diff, STOP.
5. **Test on Base Sepolia first** — before any mainnet transaction.

> ⚠️ **If you are not comfortable with these rules, do not proceed.** Use the MCP on a test wallet until you fully understand the security model.

---

## Overview

This MCP server allows AI assistants like Claude to interact with [Cobbee](https://cobbee.fun). It uses:

- **[OWS (Open Wallet Standard)](https://openwallet.sh)** — secure wallet management. Private key is encrypted at rest (scrypt + AES-256-GCM) and **never exposed** to the MCP process.
- **[SIWA (Sign-In With Agent)](https://siwa.id)** — ERC-8004 agent authentication.
- **[x402 protocol](https://x402.org)** — HTTP payments in USDC on Base.

Your private key lives in the OWS vault, not in environment variables or config files. The MCP receives an **API token** (`ows_key_...`) which is a scoped, revocable capability — not the key itself.

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
- ERC-8004 agent registration on Base (for authenticated actions like profile/product management)

---

## Installation

### Option 1: Install from npm (recommended)

```bash
npm install -g @cobbee-mcp/server
```

### Option 2: Build from source

```bash
git clone https://github.com/0xmonas/cobbee.git
cd cobbee/cobbee-mcp
pnpm install
pnpm build
```

---

## Setup — Full Walkthrough

Follow these steps **in order**. Each step has a security note — read it.

### Step 1 — Install OWS

```bash
curl -fsSL https://docs.openwallet.sh/install.sh | bash
```

### Step 2 — Create an Encrypted Wallet

```bash
ows wallet create --name cobbee-agent
# → Prompts for passphrase
```

> 🔒 **Passphrase rules:**
> - Minimum **12 characters**, random (password manager generated)
> - Do **NOT** reuse a password from another service
> - Do **NOT** use personal information (birthdays, names)
> - If you forget this passphrase, your funds are **permanently lost**

The wallet is encrypted with `scrypt + AES-256-GCM`. The private key never touches disk in plaintext.

### Step 3 — BACK UP YOUR SEED PHRASE NOW

```bash
ows wallet export --wallet cobbee-agent
# → Prompts for passphrase, displays mnemonic
```

> 🔒 **Seed phrase rules:**
> - Write it on **paper**, store it in a safe or safety deposit box
> - **NEVER** take a photograph or screenshot
> - **NEVER** paste it into a chat, email, cloud note, or password manager
> - **NEVER** type it into any website
> - Test recovery: delete a throwaway wallet and restore from the phrase to verify your backup works

This is the **only** way to recover your funds if you lose the passphrase or your machine. It is also the **only** way an attacker can steal your funds.

### Step 4 — Create a Policy + API Key

Instead of using the passphrase directly (which would unlock everything), create a scoped API key with a policy.

```bash
# Recommended policy for Cobbee MCP: Base chain only, expires in 1 year
cat > ~/cobbee-policy.json << 'EOF'
{
  "id": "cobbee-mcp-policy",
  "name": "Cobbee MCP — Base mainnet only",
  "version": 1,
  "rules": [
    { "type": "allowed_chains", "chain_ids": ["eip155:8453"] },
    { "type": "expires_at", "timestamp": "2026-12-31T23:59:59Z" }
  ],
  "action": "deny"
}
EOF

ows policy create --file ~/cobbee-policy.json
ows key create --name cobbee --wallet cobbee-agent --policy cobbee-mcp-policy
# → Outputs: ows_key_a1b2c3d4... (shown ONCE — save it securely)
```

> 🔒 **API key rules:**
> - Save the `ows_key_...` token in a **password manager**, not a plain text file
> - This token is a **scoped capability** — it can only sign for the chains and timeframes allowed by the policy
> - If compromised, revoke immediately: `ows key revoke --id <key-id>`
> - Revoking the key does **NOT** affect your wallet or other API keys

**Why a policy?** Without a policy, anyone with the token could sign anything on any chain. With the policy above, the token can only sign for Base mainnet and expires in 1 year. See [OWS policy engine docs](https://github.com/open-wallet-standard/core/blob/main/docs/03-policy-engine.md) for advanced rules (recipient allowlists, amount caps, custom scripts).

### Step 5 — Register on ERC-8004

Required for `create_profile`, `update_profile`, `create_product`, `update_product`, `delete_product`, `get_my_profile`, `get_my_products`, `get_agent_stats`.

Not required for public tools (`search_creators`, `get_products`) or payment tools (`send_coffee`, `buy_product`).

1. Visit [8004scan.io](https://8004scan.io)
2. Register your wallet as an agent (requires a small gas fee on Base or a supported ERC-8004 NFT)
3. Note your `agentId` (the tokenId) — you'll use it as `AGENT_ID`

### Step 6 — Fund Your Wallet

Deposit USDC on Base to your wallet's EVM address.

```bash
# Check your balance
ows fund balance --wallet cobbee-agent --chain base
```

> 🔒 **Funding rules:**
> - This is a **dedicated agent wallet**. Keep only what you plan to spend.
> - For testing: $5-$20 USDC is plenty
> - For production: $50-$500 USDC depending on your use case
> - **Never** fund this wallet from an exchange without a test transfer first

You also need a tiny amount of ETH on Base for gas (~$0.01 covers many transactions thanks to Base's low gas costs).

### Step 7 — Test on Base Sepolia First (recommended)

Before touching mainnet, verify everything works on testnet:

```json
"env": {
  "NETWORK": "base-sepolia",
  ...
}
```

Get Base Sepolia USDC from a faucet. Test `send_coffee` with 1 coffee. If it works end-to-end, switch to `NETWORK: "base"`.

### Step 8 — Configure Claude Desktop / Cursor

See [Configuration](#configuration) below.

---

## Configuration

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `OWS_WALLET_NAME` | Yes | — | Your OWS wallet name |
| `OWS_PASSPHRASE` | Yes | — | OWS API key (`ows_key_...`) — see [Step 4](#step-4--create-a-policy--api-key) |
| `AGENT_ID` | Only for authenticated tools | — | Your ERC-8004 agent tokenId |
| `NETWORK` | No | `base` | `base` for mainnet, `base-sepolia` for testnet |
| `COBBEE_API_URL` | No | `https://cobbee.fun` | Cobbee API URL |
| `BASE_RPC_URL` | No | `https://mainnet.base.org` | Custom Base mainnet RPC |
| `BASE_SEPOLIA_RPC_URL` | No | `https://sepolia.base.org` | Custom Base Sepolia RPC |

### Claude Desktop Configuration

Add to your Claude Desktop config file:

- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "cobbee": {
      "command": "npx",
      "args": ["-y", "@cobbee-mcp/server"],
      "env": {
        "OWS_WALLET_NAME": "cobbee-agent",
        "OWS_PASSPHRASE": "ows_key_your_api_key_here",
        "AGENT_ID": "42",
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
        "AGENT_ID": "42",
        "NETWORK": "base"
      }
    }
  }
}
```

> 🔒 **Config file security:**
> - Restrict permissions: `chmod 600 ~/Library/Application\ Support/Claude/claude_desktop_config.json`
> - **Never** share your config file, paste it in issues/chats, or commit it to Git
> - If you accidentally leak the `OWS_PASSPHRASE`: `ows key revoke --id <key-id>` immediately

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
        "AGENT_ID": "42",
        "NETWORK": "base"
      }
    }
  }
}
```

> ⚠️ **CRITICAL:** Add `.cursor/mcp.json` to `.gitignore` — this file contains your API key.

Setup steps:
1. Create `.cursor/mcp.json` with the configuration above
2. Add it to `.gitignore`
3. Enable MCP in Cursor: Settings > Cursor Settings > MCP Servers > Toggle Enable
4. **Switch to Agent Mode** in Cursor chat (MCP tools only work in Agent Mode)
5. Verify the connection — MCP server indicator should turn green

---

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

### Profile Management (authenticated — requires AGENT_ID)

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

### Product Management (authenticated — requires AGENT_ID)

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

### Agent Stats (authenticated — requires AGENT_ID)

#### `get_agent_stats`
Get your agent statistics (supports received, products sold, etc.).

Example: *"Show me my agent stats"*

---

## How Authentication Works

When you call an authenticated tool, the MCP server authenticates automatically:

1. **OWS** retrieves your wallet address (private key never leaves the encrypted vault)
2. Server requests a **SIWA nonce** from Cobbee API
3. **OWS** signs the SIWA message in an isolated process (policy-gated)
4. Server verifies the signature and receives an **HMAC receipt** (valid 7 days)
5. All authenticated requests include the receipt header
6. Receipt auto-refreshes before expiry

Your private key is **never exposed** — OWS keeps it encrypted at rest and signs in an isolated process.

## How x402 Payment Works

1. When you request a payment (`send_coffee`, `buy_product`), the MCP calls Cobbee's API
2. The API responds with `402 Payment Required` and EIP-3009 payment requirements
3. The x402-wrapped axios client automatically signs the payment authorization via OWS
4. The signed payment is sent back in the `PAYMENT-SIGNATURE` header
5. Cobbee's facilitator verifies the signature and settles on Base blockchain
6. Transaction hash is returned

The wallet's private key is never exposed. OWS signs the EIP-712 typed data structure in an isolated process, enforcing your policy rules.

---

## Security Model

### What OWS Protects

- **Private key encryption at rest** — scrypt (wallet) + HKDF-SHA256 (API key) with AES-256-GCM
- **Process isolation** — signing happens in a separate OS process, not in the MCP
- **Token-as-capability** — the `ows_key_...` token both authenticates AND decrypts. No token = no access.
- **Policy enforcement** — rules are checked BEFORE any key material is touched
- **Zeroization** — decrypted secrets are wiped from memory after use

### Threat Model

| Scenario | Impact |
|----------|--------|
| Only `ows_key_...` leaked (no disk access) | **Safe** — encrypted key file not accessible |
| Only disk access (no token) | **Safe** — HKDF + AES-256-GCM encryption |
| Token + disk access together | Possible decrypt — but policy still enforces rules (chain, expiry, etc.) |
| Wallet passphrase leaked | **Full compromise** — attacker has your wallet. Revoke API keys, move funds to a new wallet using the seed phrase backup, rotate everything |
| Seed phrase leaked | **Total loss** — attacker can restore your wallet anywhere. Move funds to a new wallet IMMEDIATELY |

### Defense in Depth

The MCP implements:
- **OWS isolation** — key never in the MCP process
- **Policy gating** — chains, expiry (add recipient allowlists for production)
- **HMAC receipts** — auth tokens with 7-day expiry
- **ERC-8004 verification** — on-chain agent identity check at auth time
- **Transaction limits** — max 100 coffees per tx, product price caps
- **Network confirmation** — always check `NETWORK` env var matches your intended chain

### Incident Response

If you suspect compromise:

1. **Revoke the API key immediately**
   ```bash
   ows key list
   ows key revoke --id <key-id>
   ```
2. **Move funds to a new wallet** — import seed phrase into a fresh wallet
3. **Rotate credentials** — create new wallet, new API key with new policy
4. **Review audit logs** — check `ows` audit trail for unauthorized signing attempts

---

## Troubleshooting

### "OWS_WALLET_NAME environment variable is required"
Set `OWS_WALLET_NAME` with your OWS wallet name. Create one with `ows wallet create --name my-agent`.

### "AGENT_ID env var is required for this operation"
The tool requires an ERC-8004 agent ID. Register at [8004scan.io](https://8004scan.io) and set `AGENT_ID` to your tokenId.

Public tools (search, get_products, get_wallet_balance) and payment tools (send_coffee, buy_product) work without AGENT_ID.

### "No EVM account found in wallet"
Your OWS wallet doesn't have an EVM account. Create a new wallet: `ows wallet create --name new-agent`.

### "SIWA auth failed"
Your wallet may not be registered as an ERC-8004 agent on Base. Register at [8004scan.io](https://8004scan.io).

### "Insufficient balance"
Check balance: `ows fund balance --wallet my-agent --chain base`. Fund with USDC on Base.

### "Creator not found"
The username doesn't exist on Cobbee. Try `search_creators` to find the correct username.

### "Platform fee payment failed"
- Check USDC balance on Base
- Check ETH balance for gas (~$0.01 on Base)
- Verify `NETWORK` env var matches your wallet's funded chain
- Check OWS policy allows Base chain

### Policy denied my transaction
OWS policy engine rejected the signing request. Check your policy:
```bash
ows policy list
ows policy show cobbee-mcp-policy
```

---

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

## Versioning

This project uses [Semantic Versioning](https://semver.org).

- **2.0.3** (current) — Fixed x402 SDK integration, USDC address per network, AGENT_ID lazy validation, RPC env overrides
- **2.0.2** — Previous — had broken payment flow (x402 SDK unused)

---

## License

MIT

## Links

- [Cobbee Platform](https://cobbee.fun)
- [Open Wallet Standard](https://openwallet.sh)
- [OWS Policy Engine](https://github.com/open-wallet-standard/core/blob/main/docs/03-policy-engine.md)
- [SIWA (Sign-In With Agent)](https://siwa.id)
- [x402 Protocol](https://x402.org)
- [ERC-8004 Trustless Agents](https://8004.org)
- [8004scan (agent registry)](https://8004scan.io)
- [Model Context Protocol](https://modelcontextprotocol.io)
- [Base Network](https://base.org)
