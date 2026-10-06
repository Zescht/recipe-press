# Recipe Press

A mobile-first website for turning cookbook photographs into reviewed recipe drafts.

## Current prototype

The current test version includes:

- multi-image upload from a phone or desktop;
- one-by-one image assignment to numbered recipe groups;
- support for a recipe with several text pages, an optional dish photo, or no dish photo;
- a group confirmation screen before processing;
- separate, editable title, Course, Difficulty, Ingredients, and Steps fields;
- Prev, Next, Delete, Undo, and whole-batch Submit controls;
- local draft persistence with `localStorage` and IndexedDB;
- a bundled sample batch based on the two test cookbook images.
- English and German OCR that runs in the browser for newly uploaded images;
- automatic first-pass splitting into title, Ingredients, and Steps;
- ingredient ordering that follows the project shopping sequence.

The first OCR run downloads the language models used by Tesseract.js. Recipe images and extracted text remain in the browser and are not uploaded to an application server. OCR is deliberately followed by the review screen because photography, typography, and cookbook layouts affect accuracy.

The final Notion write adapter is not connected yet. The result screen says this explicitly and does not pretend that a Notion page was created.

## Run locally

```powershell
cd C:\Users\Vincent\Documents\Codex\NotionFoodLibrary\recipe-importer
npm.cmd install
npm.cmd run dev -- --host 127.0.0.1
```

Open <http://127.0.0.1:5173/>.

## Verify

```powershell
npm.cmd run lint
npm.cmd run build
npm.cmd run build:github
```

## Next integration slice

1. Compare the in-browser OCR results with an OpenAI vision extraction route.
2. Validate its JSON output against the recipe schema before exposing it to the review screen.
3. Add a server-only Notion OAuth/API adapter that maps approved drafts to the existing database properties and page blocks.
4. Upload the selected dish image to durable storage and use its public URL for the Notion card preview.
5. Replace the local result screen with per-recipe Notion success/error results and retry support.

Never put an OpenAI or Notion secret in browser code or a `NEXT_PUBLIC_` environment variable.

See [DESIGN.md](./DESIGN.md) for the visual direction and source references.
