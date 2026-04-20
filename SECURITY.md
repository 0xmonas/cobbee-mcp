# Security Policy — @cobbee-mcp/server

This MCP manages a crypto wallet with real funds on Base mainnet. Loss of credentials means loss of funds — permanently and irreversibly.

## TL;DR — Non-Negotiable Rules

1. **Strong passphrase** (12+ chars, random, password manager)
2. **Offline seed phrase backup** — paper, safe, never digital
3. **Dedicated agent wallet with limited funds** — never your main wallet
4. **Policy-gated API key** — scope to Base chain + expiry
5. **Never commit credentials to Git**
6. **Test on Base Sepolia first**

---

## Threat Model

### What OWS Protects

- **Private key encryption at rest** — scrypt + AES-256-GCM (wallet passphrase)
- **API key encryption at rest** — HKDF-SHA256 + AES-256-GCM (API token)
- **Process isolation** — key material never enters the MCP process; signing runs in a separate OS process
- **Policy enforcement** — evaluated BEFORE key material is touched
- **Zeroization** — decrypted secrets wiped from memory after each signing operation

### What You Protect

| Threat | Your Mitigation |
|--------|----------------|
| Attacker steals `ows_key_...` token | Strong policy (chain + expiry). Revoke immediately: `ows key revoke --id <id>` |
| Attacker reads disk (no token) | Useless without token — HKDF + AES-256-GCM |
| Attacker gets token + disk access | Policy still enforces rules. Revoke + rotate + move funds using seed backup |
| Attacker learns wallet passphrase | Total compromise of that wallet. Move funds using seed phrase to a new wallet |
| Attacker learns seed phrase | Move funds IMMEDIATELY — they can restore your wallet anywhere |

### What Happens If You Lose

| What You Lose | Result |
|---------------|--------|
| `ows_key_...` token | Recoverable — owner passphrase can create a new API key |
| Wallet passphrase | Funds only recoverable via seed phrase backup |
| Seed phrase + passphrase | **Funds are PERMANENTLY lost**. There is no recovery. |

## Required Setup

### Strong Passphrase

- **Minimum 12 characters** — 16+ recommended
- **Random** — use a password manager's generator
- **Unique** — never reuse across services
- **Not personal** — no birthdays, pet names, addresses

Recommended: `bitwarden`, `1Password`, `KeepassXC` generated passphrase of 16+ chars.

### Offline Seed Phrase Backup

Immediately after `ows wallet create`:

```bash
ows wallet export --wallet cobbee-agent
# Prompts for passphrase, displays BIP-39 mnemonic
```

**DO:**
- Write on paper (pen, not pencil)
- Store in a safe, safety deposit box, or fireproof container
- Make 2 copies in separate locations
- Test recovery on a throwaway wallet first

**DO NOT:**
- Photograph it (phone backups sync to cloud)
- Screenshot it
- Paste into chat, email, cloud notes, password manager
- Type it into any website ever
- Store it on a USB stick without encryption

### Policy-Gated API Key

Never use the raw passphrase for daily operations. Create a policy-gated API key:

```json
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
```

```bash
ows policy create --file policy.json
ows key create --name cobbee --wallet cobbee-agent --policy cobbee-mcp-policy
```

**Why policy?** Without it, the token is full-access. With it, scoped to Base chain + time-limited.

**For advanced protection:** Use an executable policy (custom script) to add:
- Recipient allowlists (only Cobbee fee wallet + known creators)
- Per-transaction amount caps
- Daily spending limits
- Deadline sanity checks

See the [OWS policy engine docs](https://github.com/open-wallet-standard/core/blob/main/docs/03-policy-engine.md) for executable policies.

### Limited Funds (Critical)

**This is a dedicated agent wallet, not your main wallet.**

- Testing: $5–$20 USDC
- Production: $50–$500 USDC (depending on use case)
- Top up periodically from your main wallet as needed

Rationale (from ethskills):
> *"Use a dedicated wallet with limited funds for agent operations. Never the human's main wallet."*

If the agent is compromised, your loss is capped at what's in this wallet.

### Credential Hygiene

**Config file permissions:**
```bash
chmod 600 ~/Library/Application\ Support/Claude/claude_desktop_config.json
chmod 600 /path/to/.cursor/mcp.json
```

**`.gitignore` entries (critical):**
```gitignore
.env
.env.*
*.key
*.pem
.cursor/mcp.json
~/.ows/
```

**Verify before every commit:**
```bash
git diff --cached --name-only | grep -iE '\.env|key|secret|mcp\.json'
# If this matches anything, STOP
```

## Testnet First

Always verify end-to-end flow on Base Sepolia before touching mainnet funds:

1. Get Base Sepolia USDC from a faucet
2. Set `NETWORK: "base-sepolia"` in your config
3. Run a test `send_coffee` with 1 coffee
4. Confirm transaction success
5. Only then switch to `NETWORK: "base"`

## Incident Response

### Suspicion of Compromise

1. **Revoke API key IMMEDIATELY**
   ```bash
   ows key list
   ows key revoke --id <key-id>
   ```
2. **Move funds to a new wallet** using your seed phrase backup (if you still control the passphrase)
3. **Rotate everything** — new wallet, new passphrase, new policy, new API key
4. **Audit recent transactions** on [basescan.org](https://basescan.org) for unauthorized activity

### If Seed Phrase is Compromised

1. **Move all funds immediately** to a new wallet derived from a fresh seed phrase
2. Revoke old API keys
3. Never reuse the compromised wallet — it is permanently untrusted

### If Passphrase Forgotten (Seed Phrase Safe)

1. Restore wallet from seed phrase: `ows wallet import --name recovered --mnemonic "..."`
2. Create new API keys with new policies
3. Update MCP configuration

### If Seed Phrase AND Passphrase Lost

Funds are **permanently unrecoverable**. There is no password reset, no customer support, no recovery. This is why offline backups are mandatory.

## Responsible Disclosure

Found a vulnerability in `@cobbee-mcp/server`? Please report privately:

- **Email:** [Create an issue on GitHub or reach out via Cobbee](https://github.com/0xmonas/cobbee/issues)
- **Do not disclose publicly** until a fix is released

## Security Resources

- [OWS Security Guide](https://github.com/open-wallet-standard/core/blob/main/docs/08-conformance-and-security.md)
- [OWS Key Isolation](https://github.com/open-wallet-standard/core/blob/main/docs/05-key-isolation.md)
- [ethskills/wallets](https://ethskills.com/wallets/SKILL.md)
- [x402 Protocol Security](https://x402.org)
