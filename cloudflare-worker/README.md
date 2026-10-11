# Recipe Press Cloudflare Worker

This Worker securely calls OpenRouter for German recipe OCR and structuring. The OpenRouter key stays in Cloudflare and is never shipped to the browser.

## Cloudflare secret

The deployed Worker requires a secret named `OPENROUTER_API_KEY`.

## API

- `GET /health` returns the service and model status.
- `POST /v1/extract-recipe` accepts JSON with `titleImages`, `ingredientImages`, and `stepImages`. Each value is an array of JPEG, PNG, or WebP data URLs.

The POST response contains a structured recipe and OpenRouter usage information. The endpoint accepts browser requests only from the published Recipe Press site and local development origins.

## Deploy

From this directory:

```powershell
npx.cmd wrangler login
npx.cmd wrangler secret put OPENROUTER_API_KEY
npx.cmd wrangler deploy
```

The secret already configured in the Cloudflare dashboard does not need to be added again.
