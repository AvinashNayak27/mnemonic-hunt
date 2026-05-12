import dotenv from "dotenv";

import express from "express";
import type { RequestHandler } from "express";
import { generateImage } from "ai";
import { openai } from "@ai-sdk/openai";
import { discovery, Mppx, tempo } from "mppx/express";
import { createPublicClient, createWalletClient, erc20Abi, formatUnits, getAddress, http } from "viem";
import { mnemonicToAccount } from "viem/accounts";
import { tempo as tempoMainnet } from "viem/chains";

dotenv.config();

const PORT = Number(process.env.PORT ?? 3000);

const TOKEN_ADDRESS = getAddress("0x20c000000000000000000000b9537d11c60e8b50");
const TOKEN_DECIMALS = 6;
const TEMPO_CHAIN_ID = 4217;
const TEMPO_RPC_URL = process.env.TEMPO_RPC_URL ?? "https://rpc.tempo.xyz";
const IMAGE_MODEL = process.env.IMAGE_MODEL ?? "gpt-image-1";
const ADMIN_WALLET_ADDRESS = getAddress("0x5b42b5330ae35679a982494079095248ee4edab5");
const SWEEP_UNLOCK_AT = new Date("2026-06-01T00:00:00.000Z");

const PRICE_BY_SELECTED_COUNT_MICRO_USDC = new Map<number, bigint>([
  [1, 500_000n],
  [2, 500_000n],
  [3, 450_000n],
  [4, 400_000n],
  [5, 350_000n],
  [6, 300_000n],
  [7, 260_000n],
  [8, 220_000n],
  [9, 190_000n],
  [10, 160_000n],
  [11, 130_000n],
  [12, 100_000n],
  [13, 80_000n],
  [14, 60_000n],
  [15, 50_000n],
  [16, 40_000n],
  [17, 35_000n],
  [18, 30_000n],
  [19, 25_000n],
  [20, 20_000n],
  [21, 15_000n],
  [22, 12_000n],
  [23, 11_000n],
  [24, 10_000n],
]);

if (!process.env.MPP_SECRET_KEY) {
  throw new Error("MPP_SECRET_KEY is required. Add it to your environment before starting the server.");
}

if (!process.env.MNEMONIC) {
  throw new Error("MNEMONIC is required. Add the 24-word mnemonic to your environment before starting the server.");
}

const mnemonicWords = process.env.MNEMONIC.trim().split(/\s+/);
if (mnemonicWords.length !== 24) {
  throw new Error(`MNEMONIC must contain exactly 24 words; received ${mnemonicWords.length}.`);
}

const prizeWallet = mnemonicToAccount(process.env.MNEMONIC);
const tempoChain = {
  ...tempoMainnet,
  rpcUrls: {
    default: {
      http: [TEMPO_RPC_URL],
      webSocket: tempoMainnet.rpcUrls.default.webSocket,
    },
  },
} as const;

const publicClient = createPublicClient({
  chain: tempoChain,
  transport: http(TEMPO_RPC_URL),
});
const walletClient = createWalletClient({
  account: prizeWallet,
  chain: tempoChain,
  transport: http(TEMPO_RPC_URL),
});

const app = express();
app.use(express.json());

const mppx = Mppx.create({
  methods: [
    tempo.charge({
      currency: TOKEN_ADDRESS,
      recipient: prizeWallet.address,
    }),
  ],
});

type SelectedIndex = {
  index: number;
  word: string;
};

type ClueRequest = {
  amount: string;
  indices: SelectedIndex[];
  selectedCount: number;
};

declare global {
  namespace Express {
    interface Request {
      clueRequest?: ClueRequest;
    }
  }
}

function formatMicroUsdc(amount: bigint): string {
  const whole = amount / 1_000_000n;
  const fraction = amount % 1_000_000n;
  const fractionText = fraction.toString().padStart(6, "0").replace(/0+$/, "");
  return fractionText ? `${whole}.${fractionText}` : whole.toString();
}

function parseIndicesParam(raw: unknown): number[] {
  const values = Array.isArray(raw) ? raw : [raw];
  const indices = values
    .filter((value): value is string => typeof value === "string")
    .flatMap((value) => value.split(","))
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isInteger(value));

  return [...new Set(indices)].sort((a, b) => a - b);
}

function buildClueRequest(rawIndices: unknown): ClueRequest {
  const indices = parseIndicesParam(rawIndices);
  if (indices.length === 0) {
    throw new Error("Provide at least one index with ?indices=1 or ?indices=1,2.");
  }

  const invalid = indices.filter((index) => index < 1 || index > 24);
  if (invalid.length > 0) {
    throw new Error(`Invalid mnemonic indices: ${invalid.join(", ")}. Valid paid indices are 1 through 24.`);
  }

  const selected = indices.map((index) => {
    return {
      index,
      word: mnemonicWords[index - 1],
    };
  });

  const price = PRICE_BY_SELECTED_COUNT_MICRO_USDC.get(indices.length);
  if (price === undefined) throw new Error(`Missing price for ${indices.length} selected indices.`);

  return {
    amount: formatMicroUsdc(price),
    indices: selected,
    selectedCount: indices.length,
  };
}

const parseClueRequest: RequestHandler = (req, res, next) => {
  try {
    req.clueRequest = buildClueRequest(req.query.indices ?? req.query.index);
    next();
  } catch (error) {
    res.status(400).json({
      ok: false,
      error: error instanceof Error ? error.message : "Invalid indices.",
    });
  }
};

const chargeForClues: RequestHandler = (req, res, next) => {
  if (!req.clueRequest) {
    res.status(400).json({ ok: false, error: "Missing clue request." });
    return;
  }

  return mppx.charge({
    amount: req.clueRequest.amount,
    description: `Mnemonic image clues for indices ${req.clueRequest.indices.map(({ index }) => index).join(", ")}`,
  })(req, res, next);
};

function buildImagePrompt(indices: SelectedIndex[]): string {
  const words = indices.map(({ word }) => word);
  return `generate one scenario image combining ${words.join(
    " and ",
  )} with no text or words in the image`;
}

function pickRandomMnemonicIndices(count: number): SelectedIndex[] {
  const available = mnemonicWords.map((word, index) => ({ index: index + 1, word }));
  const selected: SelectedIndex[] = [];

  while (selected.length < count && available.length > 0) {
    const randomIndex = Math.floor(Math.random() * available.length);
    const [entry] = available.splice(randomIndex, 1);
    selected.push(entry);
  }

  return selected.sort((a, b) => a.index - b.index);
}

function getPrizeWalletTokenBalance() {
  return publicClient.readContract({
    address: TOKEN_ADDRESS,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [prizeWallet.address],
  });
}


app.get("/", (_req, res) => {
  res.type("html").send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Mnemonic Hunt API</title>
    <style>
      body {
        color: #111827;
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        line-height: 1.55;
        margin: 0 auto;
        max-width: 840px;
        padding: 40px 20px;
      }
      code, pre {
        background: #f3f4f6;
        border-radius: 6px;
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      }
      code {
        padding: 2px 5px;
      }
      pre {
        overflow-x: auto;
        padding: 14px;
      }
      li {
        margin: 8px 0;
      }
    </style>
  </head>
  <body>
    <h1>Mnemonic Hunt</h1>
    <p>
      Mnemonic Hunt is a paid image-clue puzzle. A 24-word mnemonic controls the prize wallet.
      Players buy visual clues for given word indices, then use those clues to guess the
      mnemonic and recover the wallet. Payments are collected directly into the prize wallet.
    </p>

    <h2>How It Works</h2>
    <ol>
      <li>Check the prize wallet and token balance with <code>GET /wallet</code>.</li>
      <li>Check clue pricing with <code>GET /pricing</code>.</li>
      <li>Request one or more word positions using <code>GET /api/clues?indices=1,2,3</code>.</li>
      <li>The clue route returns an MPP <code>402 Payment Required</code> challenge until paid.</li>
      <li>After payment, the API returns one combined image scenario for the requested words.</li>
    </ol>

    <h2>API</h2>
    <ul>
      <li><code>GET /</code> - this documentation page.</li>
      <li><code>GET /health</code> - basic service health check.</li>
      <li><code>GET /wallet</code> - prize wallet address and USDC balance on Tempo.</li>
      <li><code>GET /pricing</code> - clue price table by number of selected indices.</li>
      <li><code>GET /api/clues?indices=1,2</code> - paid endpoint that returns one combined image clue.</li>
      <li><code>POST /admin/sweep</code> - admin-only route to sweep prize-wallet USDC after May 31, 2026.</li>
      <li><code>GET /openapi.json</code> - OpenAPI/MPP discovery document.</li>
    </ul>

    <h2>Examples</h2>
    <p>Inspect the prize wallet:</p>
    <pre><code>curl http://localhost:${PORT}/wallet</code></pre>

    <p>View pricing:</p>
    <pre><code>curl http://localhost:${PORT}/pricing</code></pre>

    <p>Buy a combined image clue for words 1, 2, and 3:</p>
    <pre><code>npx mppx 'http://localhost:${PORT}/api/clues?indices=1,2,3'</code></pre>

    <p>Admin sweep after May 31, 2026:</p>
    <pre><code>curl -X POST http://localhost:${PORT}/admin/sweep -H 'x-admin-secret: $ADMIN_SWEEP_SECRET'</code></pre>
  </body>
</html>`);
});

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/pricing", (_req, res) => {
  res.json({
    ok: true,
    currency: TOKEN_ADDRESS,
    recipient: prizeWallet.address,
    prices: [...PRICE_BY_SELECTED_COUNT_MICRO_USDC.entries()].map(([selectedCount, microPrice]) => ({
      selectedCount,
      price: formatMicroUsdc(microPrice),
    })),
  });
});

app.get("/wallet", async (_req, res, next) => {
  try {
    const rawBalance = await getPrizeWalletTokenBalance();

    res.json({
      ok: true,
      address: prizeWallet.address,
      chainId: TEMPO_CHAIN_ID,
      token: TOKEN_ADDRESS,
      balance: formatUnits(rawBalance, TOKEN_DECIMALS),
    });
  } catch (error) {
    next(error);
  }
});

app.get("/admin/sweep", async (_req, res, next) => {
  try {

    if (Date.now() < SWEEP_UNLOCK_AT.getTime()) {
      res.status(403).json({
        ok: false,
        error: "Sweep is locked until after May 31, 2026.",
        unlockAt: SWEEP_UNLOCK_AT.toISOString(),
      });
      return;
    }

    const rawBalance = await getPrizeWalletTokenBalance();

    if (rawBalance === 0n) {
      res.json({
        ok: true,
        transferred: false,
        reason: "Prize wallet has no token balance to sweep.",
        from: prizeWallet.address,
        to: ADMIN_WALLET_ADDRESS,
        token: TOKEN_ADDRESS,
        amount: "0",
      });
      return;
    }

    const sweepAmount = (rawBalance * 99n) / 100n;
    const retainedAmount = rawBalance - sweepAmount;

    if (sweepAmount === 0n) {
      res.json({
        ok: true,
        transferred: false,
        reason: "Prize wallet balance is too small to sweep 99%.",
        from: prizeWallet.address,
        to: ADMIN_WALLET_ADDRESS,
        token: TOKEN_ADDRESS,
        balance: formatUnits(rawBalance, TOKEN_DECIMALS),
        amount: "0",
      });
      return;
    }

    const { request } = await publicClient.simulateContract({
      account: prizeWallet,
      address: TOKEN_ADDRESS,
      abi: erc20Abi,
      functionName: "transfer",
      args: [ADMIN_WALLET_ADDRESS, sweepAmount],
      feeToken: TOKEN_ADDRESS,
    });

    const hash = await walletClient.writeContract(request);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    res.json({
      ok: receipt.status === "success",
      transferred: true,
      from: prizeWallet.address,
      to: ADMIN_WALLET_ADDRESS,
      token: TOKEN_ADDRESS,
      balanceBeforeSweep: formatUnits(rawBalance, TOKEN_DECIMALS),
      amount: formatUnits(sweepAmount, TOKEN_DECIMALS),
      retainedAmount: formatUnits(retainedAmount, TOKEN_DECIMALS),
      transactionHash: hash,
      receiptStatus: receipt.status,
      blockNumber: receipt.blockNumber.toString(),
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/clues", parseClueRequest, chargeForClues, async (req, res, next) => {
  try {
    if (!process.env.OPENAI_API_KEY) {
      res.status(500).json({ ok: false, error: "OPENAI_API_KEY is required to generate image clues." });
      return;
    }

    const clueRequest = req.clueRequest;
    if (!clueRequest) {
      res.status(400).json({ ok: false, error: "Missing clue request." });
      return;
    }

    const randomClueIndices = pickRandomMnemonicIndices(clueRequest.selectedCount);

    const { image } = await generateImage({
      model: openai.image(IMAGE_MODEL),
      prompt: buildImagePrompt(randomClueIndices),
      size: "1024x1024",
      providerOptions: {
        openai: {
          quality: "low",
          outputFormat: "png",
        },
      },
    });

    res.json({
      ok: true,
      amount: clueRequest.amount,
      currency: TOKEN_ADDRESS,
      recipient: prizeWallet.address,
      clue: {
        requestedIndices: clueRequest.indices.map(({ index }) => index),
        indices: randomClueIndices.map(({ index }) => index),
        selectedCount: clueRequest.selectedCount,
        price: clueRequest.amount,
        mediaType: image.mediaType,
        image: `data:${image.mediaType};base64,${image.base64}`,
      },
    });
  } catch (error) {
    next(error);
  }
});

discovery(app, mppx, {
  info: {
    title: "Mnemonic Hunt API",
    version: "1.0.0",
  },
  routes: [],
});

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(error);
  res.status(500).json({
    ok: false,
    error: error instanceof Error ? error.message : "Internal server error.",
  });
});

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
  console.log(`Prize wallet: ${prizeWallet.address}`);
  console.log(`Paid clue endpoint: http://localhost:${PORT}/api/clues?indices=2,3`);
});
