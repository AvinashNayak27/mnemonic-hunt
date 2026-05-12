# Mnemonic Hunt

TypeScript Express server for a paid mnemonic-image puzzle on Tempo.

## Setup

```bash
npm install
cp .env.example .env
```

Set these values in `.env`:

- `MPP_SECRET_KEY`: random server-side secret for MPP challenges
- `MNEMONIC`: the 24-word mnemonic for the prize wallet
- `OPENAI_API_KEY`: API key used by the AI SDK image generator
- `TEMPO_RPC_URL`: optional Tempo RPC override

## Run

```bash
npm run dev
```

Free health check:

```bash
curl http://localhost:3000/health
```

Wallet info:

```bash
curl http://localhost:3000/wallet
```

Pricing:

```bash
curl http://localhost:3000/pricing
```

Paid image clues:

```bash
npx mppx 'http://localhost:3000/api/clues?indices=1,2'
```

`indices` accepts comma-separated values or repeated query params. Paid indices are `1` through `24`; price is based on the number of unique indices selected, and the response contains one combined image for all requested words.

Inspect the payment challenge without paying:

```bash
npm run challenge
```
