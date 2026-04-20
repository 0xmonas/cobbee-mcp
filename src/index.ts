#!/usr/bin/env node

/**
 * Cobbee MCP Server v2
 *
 * AI Agent interface for Cobbee platform.
 * Uses OWS (Open Wallet Standard) for secure key management.
 * Uses SIWA (Sign-In With Agent) for authenticated API access.
 * Uses x402 for crypto payments.
 *
 * Private key never exposed — OWS handles signing in an isolated process.
 */

import { webcrypto } from "node:crypto";
if (!globalThis.crypto) {
  globalThis.crypto = webcrypto as typeof globalThis.crypto;
}

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import {
  signMessage as owsSignMessage,
  signTypedData as owsSignTypedData,
  getWallet,
} from "@open-wallet-standard/core";
import { buildSIWAMessage } from "@buildersgarden/siwa";
import { createPublicClient, http, formatUnits } from "viem";
import { base, baseSepolia } from "viem/chains";
import axios, { type AxiosInstance } from "axios";
import { wrapAxiosWithPayment, x402Client } from "@x402/axios";
import { ExactEvmScheme, type ClientEvmSigner } from "@x402/evm";
import { z } from "zod";

// =============================================================================
// Configuration
// =============================================================================

const COBBEE_API_URL = process.env.COBBEE_API_URL || "https://cobbee.fun";
const OWS_WALLET_NAME = process.env.OWS_WALLET_NAME;
const OWS_PASSPHRASE = process.env.OWS_PASSPHRASE;
const NETWORK = process.env.NETWORK || "base";

// AGENT_ID only required for SIWA authentication (profile mgmt, product CRUD).
// Public tools (search, discover) and payment tools work without it.
// Validated lazily inside authenticate() — see getAgentId().
const AGENT_ID_RAW = process.env.AGENT_ID;

function getAgentId(): number {
  if (!AGENT_ID_RAW) {
    throw new Error(
      "AGENT_ID env var is required for this operation. " +
      "Register your agent on ERC-8004 (8004scan.io) and set AGENT_ID."
    );
  }
  const id = parseInt(AGENT_ID_RAW, 10);
  if (isNaN(id) || id < 1) {
    throw new Error("AGENT_ID must be a positive integer");
  }
  return id;
}

// USDC addresses per network (CAIP-2: eip155:{chainId})
const USDC_ADDRESSES: Record<string, `0x${string}`> = {
  base: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  "base-sepolia": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
};

const USDC_ABI = [
  {
    inputs: [{ name: "account", type: "address" }],
    name: "balanceOf",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

// =============================================================================
// State
// =============================================================================

let siwaReceipt: string | null = null;
let receiptExpiresAt: Date | null = null;
let walletAddress: string | null = null;

// =============================================================================
// OWS Wallet Helpers
// =============================================================================

function getWalletConfig() {
  if (!OWS_WALLET_NAME) throw new Error("OWS_WALLET_NAME is required");
  return { wallet: OWS_WALLET_NAME, passphrase: OWS_PASSPHRASE };
}

async function getAddress(): Promise<string> {
  if (walletAddress) return walletAddress;
  const config = getWalletConfig();
  const wallet = getWallet(config.wallet);
  const evmAccount = wallet.accounts.find((a) => a.chainId.startsWith("eip155"));
  if (!evmAccount) throw new Error("No EVM account found in wallet");
  walletAddress = evmAccount.address;
  return walletAddress;
}

async function signMessageOWS(message: string): Promise<string> {
  const config = getWalletConfig();
  const result = owsSignMessage(
    config.wallet,
    "evm",
    message,
    config.passphrase
  );
  return result.signature;
}

/**
 * Creates an x402 ClientEvmSigner backed by OWS.
 * Private key never leaves OWS — signing happens in an isolated process.
 */
async function createOWSx402Signer(): Promise<ClientEvmSigner> {
  const address = await getAddress();
  const config = getWalletConfig();
  return {
    address: address as `0x${string}`,
    signTypedData: async (msg) => {
      const typedDataJson = JSON.stringify({
        domain: msg.domain,
        types: msg.types,
        primaryType: msg.primaryType,
        message: msg.message,
      });
      const result = owsSignTypedData(
        config.wallet,
        "evm",
        typedDataJson,
        config.passphrase
      );
      return result.signature as `0x${string}`;
    },
  };
}

function getNetworkConfig() {
  const isTestnet = NETWORK === "base-sepolia";
  const rpcUrl = isTestnet
    ? process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org"
    : process.env.BASE_RPC_URL || "https://mainnet.base.org";
  return {
    chain: isTestnet ? baseSepolia : base,
    chainId: isTestnet ? 84532 : 8453,
    networkId: isTestnet ? "eip155:84532" : "eip155:8453",
    rpcUrl,
    usdcAddress: USDC_ADDRESSES[NETWORK] ?? USDC_ADDRESSES.base,
  };
}

// =============================================================================
// SIWA Authentication
// =============================================================================

async function authenticate(): Promise<void> {
  const agentId = getAgentId();
  const address = await getAddress();
  const { chainId } = getNetworkConfig();

  console.error("🔐 Authenticating with SIWA...");

  // Step 1: Get nonce
  const nonceRes = await axios.post(`${COBBEE_API_URL}/api/auth/agent/nonce`, {
    address,
    agentId,
  });

  if (!nonceRes.data.success) {
    throw new Error(
      `Nonce failed: ${nonceRes.data.error || nonceRes.data.status}`
    );
  }

  const { nonce, issuedAt, expirationTime, domain, uri, agentRegistry } =
    nonceRes.data;

  // Step 2: Build and sign SIWA message via OWS (private key never exposed)
  const message = buildSIWAMessage({
    domain,
    address,
    uri,
    agentId,
    agentRegistry,
    chainId,
    nonce,
    issuedAt,
    expirationTime,
    statement: "Sign in to Cobbee as an AI Agent",
  });

  const signature = await signMessageOWS(message);

  // Step 3: Verify and get receipt
  const verifyRes = await axios.post(
    `${COBBEE_API_URL}/api/auth/agent/verify`,
    { message, signature }
  );

  if (!verifyRes.data.success) {
    throw new Error(`Verify failed: ${verifyRes.data.error}`);
  }

  siwaReceipt = verifyRes.data.receipt;
  receiptExpiresAt = new Date(verifyRes.data.expiresAt);

  console.error(`✅ Authenticated! Agent ID: ${agentId}`);
  console.error(`   Address: ${address}`);
  console.error(`   Receipt expires: ${receiptExpiresAt.toISOString()}`);
}

async function ensureAuth(): Promise<void> {
  if (!siwaReceipt || !receiptExpiresAt) {
    await authenticate();
    return;
  }

  // Refresh if expiring within 1 hour
  const oneHour = 60 * 60 * 1000;
  if (receiptExpiresAt.getTime() - Date.now() < oneHour) {
    try {
      const res = await authClient().post("/api/auth/agent/refresh");
      if (res.data.success) {
        siwaReceipt = res.data.receipt;
        receiptExpiresAt = new Date(res.data.expiresAt);
        console.error("🔄 Receipt refreshed");
      } else {
        await authenticate();
      }
    } catch {
      await authenticate();
    }
  }
}

// =============================================================================
// HTTP Clients
// =============================================================================

function authClient(): AxiosInstance {
  return axios.create({
    baseURL: COBBEE_API_URL,
    headers: {
      "Content-Type": "application/json",
      "X-SIWA-Receipt": siwaReceipt || "",
    },
  });
}

function publicApi(): AxiosInstance {
  return axios.create({
    baseURL: COBBEE_API_URL,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Creates an axios instance wrapped with x402 payment handling.
 * Automatically handles HTTP 402 responses by signing EIP-3009 payments via OWS.
 * Uses ExactEvmScheme (USDC transferWithAuthorization on Base).
 */
let cachedX402Api: AxiosInstance | null = null;
async function x402Api(): Promise<AxiosInstance> {
  if (cachedX402Api) return cachedX402Api;
  const signer = await createOWSx402Signer();
  const client = new x402Client().register(
    "eip155:*",
    new ExactEvmScheme(signer)
  );
  cachedX402Api = wrapAxiosWithPayment(
    axios.create({
      baseURL: COBBEE_API_URL,
      headers: { "Content-Type": "application/json" },
    }),
    client
  );
  return cachedX402Api;
}

// =============================================================================
// Validation Schemas
// =============================================================================

const SendCoffeeSchema = z.object({
  username: z.string().min(1),
  coffeeCount: z.number().min(1).max(100).default(1),
  message: z.string().max(500).optional(),
  isPrivate: z.boolean().default(false),
});

const BuyProductSchema = z.object({
  productId: z.string().uuid(),
  buyerName: z.string().min(2).max(50),
  tipAmount: z.number().min(0).max(1000).optional(),
  discountCode: z.string().min(6).max(12).optional(),
});

const SearchCreatorsSchema = z.object({
  query: z.string().optional(),
  limit: z.number().min(1).max(50).default(10),
});

const GetCreatorSchema = z.object({
  username: z.string().min(1),
});

const GetProductsSchema = z.object({
  username: z.string().optional(),
  limit: z.number().min(1).max(50).default(10),
});

const SubmitReviewSchema = z.object({
  productId: z.string().uuid(),
  rating: z.number().min(1).max(5),
  reviewText: z.string().max(500).optional(),
});

const ReplyToSupportSchema = z.object({
  supportId: z.string(),
  reply: z.string().min(1).max(1000),
});

const HideSupportSchema = z.object({
  supportId: z.string(),
});

const CreateProfileSchema = z.object({
  username: z.string().min(3).max(20),
  displayName: z.string().min(2).max(50),
});

const UpdateProfileSchema = z.object({
  displayName: z.string().min(2).max(50).optional(),
  bio: z.string().max(500).optional(),
  coffeePrice: z.number().min(1).max(10).optional(),
  twitterHandle: z.string().max(50).optional(),
  instagramHandle: z.string().max(50).optional(),
  githubHandle: z.string().max(50).optional(),
  websiteUrl: z.string().url().optional(),
});

const CreateProductSchema = z.object({
  name: z.string().min(2).max(100),
  description: z.string().max(500).optional(),
  price: z.number().min(0).max(1000),
  category: z.string().max(100).optional(),
  isPayWhatYouWant: z.boolean().default(false),
});

const UpdateProductSchema = z.object({
  productId: z.string().uuid(),
  name: z.string().min(2).max(100).optional(),
  description: z.string().max(500).optional(),
  price: z.number().min(0).max(1000).optional(),
  isActive: z.boolean().optional(),
});

const DeleteProductSchema = z.object({
  productId: z.string().uuid(),
});

// =============================================================================
// Tool Definitions
// =============================================================================

const TOOLS: Tool[] = [
  // === Public ===
  {
    name: "search_creators",
    description: "Search for creators on Cobbee by name or username.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search term" },
        limit: {
          type: "number",
          description: "Max results (1-50)",
          default: 10,
        },
      },
    },
  },
  {
    name: "get_creator",
    description: "Get detailed profile of a Cobbee creator.",
    inputSchema: {
      type: "object",
      properties: {
        username: { type: "string", description: "Creator's username" },
      },
      required: ["username"],
    },
  },
  {
    name: "get_products",
    description: "List available products on Cobbee.",
    inputSchema: {
      type: "object",
      properties: {
        username: {
          type: "string",
          description: "Filter by creator username",
        },
        limit: {
          type: "number",
          description: "Max results (1-50)",
          default: 10,
        },
      },
    },
  },
  {
    name: "get_wallet_balance",
    description: "Get USDC balance of the agent's wallet on Base.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "get_wallet_address",
    description: "Get the agent's wallet address.",
    inputSchema: { type: "object", properties: {} },
  },

  // === Payment ===
  {
    name: "send_coffee",
    description:
      "Send a USDC coffee tip to a Cobbee creator via x402 payment on Base.",
    inputSchema: {
      type: "object",
      properties: {
        username: { type: "string", description: "Creator's username" },
        coffeeCount: {
          type: "number",
          description: "Number of coffees (1-100)",
          default: 1,
        },
        message: {
          type: "string",
          description: "Optional message (max 500 chars)",
        },
        isPrivate: {
          type: "boolean",
          description: "Private message",
          default: false,
        },
      },
      required: ["username"],
    },
  },
  {
    name: "buy_product",
    description:
      "Purchase a digital product from a Cobbee creator via x402 payment.",
    inputSchema: {
      type: "object",
      properties: {
        productId: { type: "string", description: "Product UUID" },
        buyerName: {
          type: "string",
          description: "Your display name (2-50 chars)",
        },
        tipAmount: {
          type: "number",
          description: "For PWYW products: amount in USDC",
        },
        discountCode: {
          type: "string",
          description: "Discount code (6-12 chars)",
        },
      },
      required: ["productId", "buyerName"],
    },
  },

  // === Profile Management ===
  {
    name: "create_profile",
    description: "Create a creator profile on Cobbee (signup).",
    inputSchema: {
      type: "object",
      properties: {
        username: {
          type: "string",
          description: "Username (3-20 chars, alphanumeric)",
        },
        displayName: {
          type: "string",
          description: "Display name (2-50 chars)",
        },
      },
      required: ["username", "displayName"],
    },
  },
  {
    name: "update_profile",
    description:
      "Update your Cobbee profile (bio, social links, coffee price).",
    inputSchema: {
      type: "object",
      properties: {
        displayName: { type: "string", description: "Display name" },
        bio: { type: "string", description: "Bio (max 500 chars)" },
        coffeePrice: {
          type: "number",
          description: "Coffee price in USDC (1-10)",
        },
        twitterHandle: { type: "string" },
        instagramHandle: { type: "string" },
        githubHandle: { type: "string" },
        websiteUrl: { type: "string" },
      },
    },
  },
  {
    name: "get_my_profile",
    description: "Get your own Cobbee profile.",
    inputSchema: { type: "object", properties: {} },
  },

  // === Product Management ===
  {
    name: "create_product",
    description: "Create a new digital product on your Cobbee shop.",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Product name (2-100 chars)",
        },
        description: {
          type: "string",
          description: "Description (max 500 chars)",
        },
        price: { type: "number", description: "Price in USDC (0-1000)" },
        category: { type: "string", description: "Category" },
        isPayWhatYouWant: {
          type: "boolean",
          description: "Enable PWYW",
          default: false,
        },
      },
      required: ["name", "price"],
    },
  },
  {
    name: "update_product",
    description: "Update one of your products.",
    inputSchema: {
      type: "object",
      properties: {
        productId: { type: "string", description: "Product UUID" },
        name: { type: "string" },
        description: { type: "string" },
        price: { type: "number" },
        isActive: { type: "boolean" },
      },
      required: ["productId"],
    },
  },
  {
    name: "delete_product",
    description: "Delete one of your products.",
    inputSchema: {
      type: "object",
      properties: {
        productId: { type: "string", description: "Product UUID" },
      },
      required: ["productId"],
    },
  },
  {
    name: "get_my_products",
    description: "List your own products.",
    inputSchema: { type: "object", properties: {} },
  },

  // === Agent Stats ===
  {
    name: "get_agent_stats",
    description:
      "Get your agent statistics (supports received, products sold, etc.).",
    inputSchema: { type: "object", properties: {} },
  },

  // === Reviews & Replies ===
  {
    name: "submit_review",
    description: "Submit a review for a purchased product (requires verified purchase).",
    inputSchema: {
      type: "object",
      properties: {
        productId: { type: "string", description: "Product UUID" },
        rating: { type: "number", description: "Rating 1-5 stars" },
        reviewText: { type: "string", description: "Review text (max 500 chars)" },
      },
      required: ["productId", "rating"],
    },
  },
  {
    name: "reply_to_support",
    description: "Reply to a support message you received (creator only).",
    inputSchema: {
      type: "object",
      properties: {
        supportId: { type: "string", description: "Support message ID" },
        reply: { type: "string", description: "Reply text (1-1000 chars)" },
      },
      required: ["supportId", "reply"],
    },
  },
  {
    name: "hide_support",
    description: "Toggle hide/unhide a support message on your profile (creator only).",
    inputSchema: {
      type: "object",
      properties: {
        supportId: { type: "string", description: "Support message ID" },
      },
      required: ["supportId"],
    },
  },
];

// =============================================================================
// Tool Handlers
// =============================================================================

async function handleTool(
  name: string,
  args: Record<string, unknown>
): Promise<string> {
  switch (name) {
    // --- Public ---
    case "search_creators": {
      const params = SearchCreatorsSchema.parse(args);
      const res = await publicApi().get("/api/creators", {
        params: { q: params.query, limit: params.limit },
      });
      const creators = (res.data.creators || res.data || []).map(
        (c: Record<string, unknown>) => ({
          username: c.username,
          displayName: c.display_name,
          bio: c.bio,
          coffeePrice: c.coffee_price,
          profileUrl: `${COBBEE_API_URL}/${c.username}`,
        })
      );
      return JSON.stringify({ creators, count: creators.length });
    }

    case "get_creator": {
      const params = GetCreatorSchema.parse(args);
      const res = await publicApi().get(`/api/creators/${params.username}`);
      const c = res.data.creator || res.data;
      return JSON.stringify({
        username: c.username,
        displayName: c.display_name,
        bio: c.bio,
        coffeePrice: c.coffee_price,
        socialLinks: {
          twitter: c.twitter_handle,
          instagram: c.instagram_handle,
          github: c.github_handle,
          website: c.website_url,
        },
        profileUrl: `${COBBEE_API_URL}/${c.username}`,
      });
    }

    case "get_products": {
      const params = GetProductsSchema.parse(args);
      const res = await publicApi().get("/api/products/public", {
        params: { username: params.username, limit: params.limit },
      });
      const products = (res.data.products || res.data || []).map(
        (p: Record<string, unknown>) => ({
          id: p.id,
          name: p.name,
          description: p.description,
          price: p.price,
          isPayWhatYouWant: p.is_pay_what_you_want,
          category: p.category,
        })
      );
      return JSON.stringify({ products, count: products.length });
    }

    case "get_wallet_balance": {
      const address = await getAddress();
      const { chain, rpcUrl, usdcAddress } = getNetworkConfig();
      const client = createPublicClient({ chain, transport: http(rpcUrl) });
      const balance = await client.readContract({
        address: usdcAddress,
        abi: USDC_ABI,
        functionName: "balanceOf",
        args: [address as `0x${string}`],
      });
      return JSON.stringify({
        address,
        balance: formatUnits(balance, 6),
        currency: "USDC",
        network: NETWORK,
      });
    }

    case "get_wallet_address": {
      const address = await getAddress();
      const { chainId } = getNetworkConfig();
      return JSON.stringify({ address, network: NETWORK, chainId });
    }

    // --- Payment (x402) ---
    case "send_coffee": {
      const params = SendCoffeeSchema.parse(args);
      const api = await x402Api();

      const creatorRes = await publicApi().get(
        `/api/creators/${params.username}`
      );
      const creator = creatorRes.data.creator || creatorRes.data;
      const totalAmount = creator.coffee_price * params.coffeeCount;

      // Platform fee — x402 interceptor signs EIP-3009 via OWS on 402 response
      const feeRes = await api.post("/api/platform/fee", {
        support_amount: totalAmount,
      });
      if (!feeRes.data.success || !feeRes.data.feeReceipt?.txHash) {
        throw new Error("Platform fee payment failed");
      }

      // Support payment — also x402, signs payment to creator wallet
      const coffeeRes = await api.post("/api/support/buy", {
        creator_id: creator.id,
        coffee_count: params.coffeeCount,
        message: params.message || "",
        is_private: params.isPrivate,
        supporter_name: "AI Agent",
        platform_fee_tx: feeRes.data.feeReceipt.txHash,
      });

      return JSON.stringify({
        success: true,
        creator: params.username,
        amount: totalAmount,
        coffeeCount: params.coffeeCount,
        txHash: coffeeRes.data.txHash,
      });
    }

    case "buy_product": {
      const params = BuyProductSchema.parse(args);
      const address = await getAddress();
      const api = await x402Api();

      const productRes = await publicApi().get(
        `/api/products/public/${params.productId}`
      );
      const product = productRes.data.product || productRes.data;
      const effectivePrice = product.is_pay_what_you_want
        ? params.tipAmount ?? 0
        : product.price;

      // Platform fee — x402 interceptor signs EIP-3009 via OWS on 402 response
      const feeRes = await api.post("/api/platform/fee", {
        support_amount: effectivePrice,
      });
      if (!feeRes.data.success || !feeRes.data.feeReceipt?.txHash) {
        throw new Error("Platform fee payment failed");
      }

      // Product purchase — also x402 (unless free PWYW with platform fee only)
      const buyRes = await api.post("/api/shop/buy", {
        product_id: params.productId,
        buyer_name: params.buyerName,
        buyer_wallet_address: address,
        platform_fee_tx: feeRes.data.feeReceipt.txHash,
        platform_fee_amount: feeRes.data.feeReceipt.feeAmount,
        tip_amount: params.tipAmount,
        is_pay_what_you_want: product.is_pay_what_you_want,
        is_free_pwyw:
          product.is_pay_what_you_want && (params.tipAmount ?? 0) === 0,
        discount_code: params.discountCode,
      });

      return JSON.stringify({
        success: true,
        product: product.name,
        price: effectivePrice,
        txHash: buyRes.data.purchase?.tx_hash,
      });
    }

    // --- Profile (authenticated) ---
    case "create_profile": {
      await ensureAuth();
      const params = CreateProfileSchema.parse(args);
      const address = await getAddress();
      await authClient().post("/api/user/profile", {
        username: params.username.toLowerCase(),
        display_name: params.displayName,
        wallet_address: address,
      });
      return JSON.stringify({
        success: true,
        username: params.username,
        message: "Profile created!",
      });
    }

    case "update_profile": {
      await ensureAuth();
      const params = UpdateProfileSchema.parse(args);
      const body: Record<string, unknown> = {};
      if (params.displayName) body.display_name = params.displayName;
      if (params.bio !== undefined) body.bio = params.bio;
      if (params.coffeePrice) body.coffee_price = params.coffeePrice;
      if (params.twitterHandle !== undefined)
        body.twitter_handle = params.twitterHandle;
      if (params.instagramHandle !== undefined)
        body.instagram_handle = params.instagramHandle;
      if (params.githubHandle !== undefined)
        body.github_handle = params.githubHandle;
      if (params.websiteUrl !== undefined) body.website_url = params.websiteUrl;

      await authClient().patch("/api/user/profile", body);
      return JSON.stringify({ success: true, message: "Profile updated" });
    }

    case "get_my_profile": {
      await ensureAuth();
      const res = await authClient().get("/api/user/profile");
      return JSON.stringify(res.data);
    }

    // --- Products (authenticated) ---
    case "create_product": {
      await ensureAuth();
      const params = CreateProductSchema.parse(args);
      const res = await authClient().post("/api/products", {
        name: params.name,
        description: params.description || "",
        price: params.price,
        category: params.category || "",
        is_pay_what_you_want: params.isPayWhatYouWant,
        ownership_attestation: true,
      });
      const product = res.data.product;
      return JSON.stringify({
        success: true,
        productId: product.id,
        name: product.name,
        price: product.price,
      });
    }

    case "update_product": {
      await ensureAuth();
      const params = UpdateProductSchema.parse(args);
      const body: Record<string, unknown> = {};
      if (params.name) body.name = params.name;
      if (params.description !== undefined)
        body.description = params.description;
      if (params.price !== undefined) body.price = params.price;
      if (params.isActive !== undefined) body.is_active = params.isActive;

      await authClient().patch(`/api/products/${params.productId}`, body);
      return JSON.stringify({ success: true, message: "Product updated" });
    }

    case "delete_product": {
      await ensureAuth();
      const params = DeleteProductSchema.parse(args);
      await authClient().delete(`/api/products/${params.productId}`);
      return JSON.stringify({ success: true, message: "Product deleted" });
    }

    case "get_my_products": {
      await ensureAuth();
      const res = await authClient().get("/api/products");
      return JSON.stringify(res.data);
    }

    // --- Agent Stats ---
    case "get_agent_stats": {
      await ensureAuth();
      const res = await authClient().get("/api/agent/stats");
      return JSON.stringify(res.data);
    }

    // --- Reviews & Replies ---
    case "submit_review": {
      const params = SubmitReviewSchema.parse(args);
      const address = await getAddress();
      const res = await publicApi().post(
        `/api/products/${params.productId}/reviews`,
        {
          rating: params.rating,
          review_text: params.reviewText || null,
          buyer_wallet_address: address,
        }
      );
      return JSON.stringify(res.data);
    }

    case "reply_to_support": {
      await ensureAuth();
      const params = ReplyToSupportSchema.parse(args);
      const res = await authClient().post(
        `/api/support/${params.supportId}/reply`,
        { reply: params.reply }
      );
      return JSON.stringify(res.data);
    }

    case "hide_support": {
      await ensureAuth();
      const params = HideSupportSchema.parse(args);
      const res = await authClient().patch(
        `/api/support/${params.supportId}/hide`
      );
      return JSON.stringify(res.data);
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// =============================================================================
// MCP Server
// =============================================================================

const server = new Server(
  { name: "cobbee-mcp", version: "2.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    const result = await handleTool(
      request.params.name,
      (request.params.arguments as Record<string, unknown>) || {}
    );
    return { content: [{ type: "text", text: result }] };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error occurred";
    return {
      content: [{ type: "text", text: JSON.stringify({ error: message }) }],
      isError: true,
    };
  }
});

// =============================================================================
// Start
// =============================================================================

async function main() {
  if (!OWS_WALLET_NAME) {
    console.error("❌ OWS_WALLET_NAME environment variable is required");
    console.error("   Create a wallet: ows wallet create --name my-agent");
    process.exit(1);
  }

  console.error("☕ Cobbee MCP Server v2.0.0");
  console.error(`   API: ${COBBEE_API_URL}`);
  console.error(`   Network: ${NETWORK}`);
  console.error(`   Wallet: ${OWS_WALLET_NAME}`);

  try {
    await authenticate();
  } catch (error) {
    console.error(
      "⚠️  SIWA auth failed (will retry on first authenticated request):",
      error instanceof Error ? error.message : error
    );
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("🚀 MCP server running");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
