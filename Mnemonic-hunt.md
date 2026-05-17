# Mnemonic Hunt

A cryptographic treasure hunt game where players compete to discover a hidden 24-word mnemonic phrase and claim the pooled prize wallet. Anyone — **human or AI agent** — can play.

The prize wallet is funded by every clue purchase. The first player to assemble the correct 24-word mnemonic can reconstruct the wallet and sweep the entire pool.

---

## How It Works

1. A 24-word BIP-39 mnemonic controls a prize wallet on [Tempo](https://tempo.xyz).
2. Players pay (in USDC on Tempo, via [x402 / MPP](https://x402.org)) for AI-generated **image clues** that visually encode words at specific positions in the mnemonic.
3. Every payment flows directly into the prize wallet — growing the pot for whoever cracks it.
4. Combine clues, guess the phrase, derive the wallet, and transfer the funds out before the deadline.
5. If no one solves it by **May 31, 2026 (UTC)**, the admin can sweep 99% of the remaining balance.

---

## The Twist: Nobody Knows the Mnemonic — Not Even the Admin

The 24-word mnemonic is **not** chosen, stored, or known by any human operator. It is generated deterministically inside the [Eigen Compute](https://docs.eigencloud.xyz/eigencompute/concepts/eigencompute-kms-overview#deterministic-mnemomic-generation) trusted runtime when the service is deployed, and injected into the server as an environment variable that never leaves the enclave.

This means:

- The admin **cannot** read, leak, or change the mnemonic.
- The admin **cannot** front-run players by solving the puzzle early.
- The admin's only privilege is calling `POST /admin/sweep` **after** the May 31, 2026 deadline if the prize remains unclaimed.
- The only way to win the pool before the deadline is to **guess the 24 words from the image clues** — the same path available to every other player.

The game is genuinely adversarial: the operator runs the server, but is on equal footing with the players when it comes to the secret.

---

## Endpoints

The live game is hosted at `http://35.204.106.224:3000/`.

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/` | Game documentation page. |
| `GET` | `/health` | Liveness check. |
| `GET` | `/wallet` | Prize wallet address + current USDC balance on Tempo. |
| `GET` | `/pricing` | Clue price table by number of selected indices. |
| `GET` | `/api/clues?indices=1,2,3` | Paid endpoint — returns one combined image clue. Returns a `402 Payment Required` MPP challenge until paid. |
| `POST` | `/admin/sweep` | Admin-only sweep route, locked until after May 31, 2026. |
| `GET` | `/openapi.json` | MPP discovery document (machine-readable for agents). |

---

## Pricing

The price per request decreases as you buy more positions in one shot — bulk discovery is cheaper than picking off single words.

```bash
curl http://35.204.106.224:3000/pricing
```

Prices range from `$0.50` USDC for a single index down to `$0.01` USDC per index when you request all 24 at once.

---

## Playing as a Human

```bash
curl http://35.204.106.224:3000/wallet
curl http://35.204.106.224:3000/pricing

npx mppx 'http://35.204.106.224:3000/api/clues?indices=1,2,3'
```

`mppx` handles the x402 payment handshake — it pays from your wallet and returns the decoded clue image.

---

## Playing as an Agent

Agents can discover and play the game with a single entry point:

```bash
curl http://35.204.106.224:3000/
```

From there, an agent can read the docs page, fetch `/openapi.json`, inspect `/pricing`, and call `/api/clues` through any x402-aware client (e.g. [AgentCash](https://agentcash.dev)).

### Example: Claude Code + AgentCash

```text
❯ curl http://35.204.106.224:3000/

⏺ Bash(curl -s -i http://35.204.106.224:3000/)
  ⎿  HTTP/1.1 200 OK
     X-Powered-By: Express
     Content-Type: text/html; charset=utf-8
     … +41 lines

⏺ The endpoint serves the Mnemonic Hunt API docs page (Express server, 200 OK).

  Key bits:
  - Concept: A 24-word mnemonic controls a prize wallet. Players pay (via
    x402/MPP, USDC on Tempo) for image clues hinting at words at specific
    indices, then guess the mnemonic to recover the wallet.
  - Endpoints:
    - GET /health           — health check
    - GET /wallet           — prize wallet address + USDC balance
    - GET /pricing          — clue price table
    - GET /api/clues?indices=1,2,3 — paid endpoint, returns one combined
                                     image clue (402 challenge until paid)
    - POST /admin/sweep     — admin sweep after May 31, 2026
    - GET /openapi.json     — MPP discovery doc

❯ use agentcash to fetch clues for any random 10 indices

⏺ I'll check the wallet balance and pricing for 10 clues in parallel.
  Called agentcash …

⏺ Balance is $10.65, 10 clues cost $0.16. Picking 10 indices: 3, 6, 8, 11,
  14, 17, 19, 20, 22, 24.

  Called agentcash …
⏺ Payment succeeded — $0.16 on Tempo.
  Tx: 0xa9730422e0d330f441d7f83beb161e0695ddbe8c53c79731fe5d02a12d6e88dd
  Image: /tmp/mnemonic_clue.png (1024×1024 PNG)

  Visual scene — appears to combine clues into one painting:
  - A castle/mansion in the background  → castle, house, or mansion
  - Four runners on a red dirt path     → race, run, sprint
  - A giant peanut on the path          → peanut or nut
  - A dark hole in the foreground       → hole or pit
```

The agent autonomously: discovered the API, read the pricing, picked indices, paid `$0.16` USDC on Tempo via x402, decoded the returned image, and proposed candidate words. From there it can iterate — buy more positions, narrow down BIP-39 candidates, and assemble the full phrase.

---

## Winning

Once a player believes they know all 24 words:

1. Derive the wallet from the mnemonic (any BIP-39 / `viem` / `ethers` tool).
2. Verify the address matches the one returned by `GET /wallet`.
3. Sign and broadcast a USDC transfer on Tempo from the prize wallet to any address you control.

The pool is yours.

---

## Deadline & Admin Sweep

- **Deadline:** `2026-05-31T23:59:59Z`
- After the deadline, `POST /admin/sweep` becomes callable and transfers 99% of the remaining USDC to the admin wallet (`0x5b42…dab5`). 1% is left behind as gas dust.
- Before the deadline, the sweep route is hard-locked and returns `403`.

There is no other way for the admin to access the prize wallet — the mnemonic lives only inside the Eigen Compute runtime.

---

## Stack

- **Runtime:** [Eigen Compute](https://docs.eigencloud.xyz/eigencompute) (deterministic mnemonic generation via KMS)
- **Chain:** [Tempo](https://tempo.xyz)
- **Payments:** [x402 / MPP](https://x402.org) over USDC
- **Image clues:** OpenAI `gpt-image-1` via the Vercel AI SDK
- **Server:** Node.js + Express + `viem`

---

## TL;DR

> Pay a few cents per clue. Stare at AI-generated images. Guess 24 words. Empty the wallet before May 31, 2026.
>
> Nobody — including the admin — knows the answer.
