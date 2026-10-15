const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "qwen/qwen3.5-flash-02-23";
const NOTION_API = "https://api.notion.com/v1";
const NOTION_VERSION = "2026-03-11";
const MAX_REQUEST_BYTES = 18 * 1024 * 1024;
const MAX_IMAGES = 16;
const USAGE_KEY = "recipe-press:usage:v1";
const ERROR_INDEX_KEY = "recipe-press:processing-errors:v1";
const ERROR_KEY_PREFIX = "recipe-press:processing-error:";
const MAX_ERROR_RECORDS = 50;
const ERROR_TTL_SECONDS = 60 * 60 * 24 * 30;

const ALLOWED_ORIGINS = new Set([
  "https://zescht.github.io",
  "http://localhost:3000",
  "http://localhost:5173",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:5173",
]);

const RECIPE_SCHEMA = {
  name: "german_recipe",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      title: { type: "string" },
      servings: { type: "string" },
      displayImageNumber: { type: "integer", minimum: 0 },
      ingredients: {
        type: "array",
        items: { type: "string" },
      },
      phases: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            name: { type: "string" },
            steps: {
              type: "array",
              items: { type: "string" },
            },
          },
          required: ["name", "steps"],
        },
      },
      warnings: {
        type: "array",
        items: { type: "string" },
      },
    },
    required: [
      "title",
      "servings",
      "displayImageNumber",
      "ingredients",
      "phases",
      "warnings",
    ],
  },
};

const SYSTEM_PROMPT = `Du transkribierst deutschsprachige Kochrezepte aus Fotos.

Arbeite ausschließlich aus dem sichtbaren Inhalt. Korrigiere eindeutige OCR-, Trennungs- und Zeilenumbruchfehler, aber erfinde niemals Mengen, Temperaturen, Zeiten oder Zutaten. Bei Unsicherheit bleibt der bestmögliche Text stehen und ein kurzer deutscher Hinweis kommt in warnings.

Regeln:
- Kochbuchseiten sind häufig in zwei Spalten oder klar getrennte Textblöcke gesetzt. Lies niemals quer über Spaltengrenzen und vermische keine nebeneinanderstehenden Zeilen.
- Die vom Nutzer als ZUTATENBEREICH und ZUBEREITUNGSBEREICH bezeichneten Ausschnitte sind die wichtigste Zuordnung. Auch wenn eine Überschrift fehlt, behandle ihren Inhalt entsprechend dieser Bezeichnung.
- Ein Zutatenblock beginnt oft mit Angaben wie "Für 2/4/6 Personen" und enthält kurze Einträge mit Mengen oder Einheiten wie g, kg, ml, l, TL, EL, Bund, Dose oder Stück. Die Zutaten enden mit dem letzten solchen Eintrag; angrenzender Fließtext gehört nicht automatisch dazu.
- Ein Zubereitungsblock enthält meist vollständige deutsche Sätze und häufig nummerierte Abschnitte wie "1.", "2." und "3.". Erhalte deren logische Reihenfolge, auch wenn der Text über mehrere Spalten oder Seiten läuft.
- Beschreibender Fließtext oberhalb oder neben Zutaten und Zubereitung ist in der Regel Buchtext und kein Rezeptinhalt. Übernimm ihn nur, wenn er eine konkrete Servier-, Vorbereitungs- oder Aufbewahrungsinformation enthält.
- Ignoriere Seitenzahlen, laufende Kopfzeilen, dekorative Texte, Bildunterschriften und allgemeine Einleitungstexte, sofern sie keine wichtige Servier-, Aufbewahrungs- oder Vorbereitungsaussage enthalten.
- ingredients enthält jede Zutat genau einmal, mit Menge, Einheit und Zubereitungshinweis.
- Sortiere Zutaten ohne Zwischenüberschriften in dieser Reihenfolge: (1) Gemüse/Obst, (2) Fleisch/Fisch/Protein, (3) Milch-/Joghurtprodukte, (4) Sonstiges, (5) typische Vorräte wie Öl, Salz und Pfeffer. Behalte innerhalb einer Gruppe die Quellreihenfolge bei.
- phases enthält die Zubereitung in sinnvollen Phasen. Jede Phase hat einen kurzen deutschen Namen und vollständige Arbeitsschritte. Bewahre Fakten, Reihenfolge, Temperaturen, Zeiten und Sichtmerkmale.
- servings ist nur die Zahl, wenn eindeutig vorhanden, sonst eine leere Zeichenfolge.
- Die ORIGINALAUFNAHMEN sind in ihrer Upload-Reihenfolge nummeriert. displayImageNumber ist die Nummer der Aufnahme, auf der das fertig zubereitete Essen das eindeutige Hauptmotiv ist.
- Wähle niemals eine Kochbuchseite, Rezepttext, Zutatenliste oder Zubereitungsseite als displayImageNumber, auch wenn darauf ein kleines Gerichtsfoto oder dekoratives Essen zu sehen ist.
- Eine gültige Displayaufnahme zeigt hauptsächlich das reale fertige Gericht, etwa angerichtet auf einem Teller, in einer Schüssel oder in einem Topf, und nicht hauptsächlich gedruckten Text oder eine Buchseite.
- Wenn keine eindeutige Aufnahme des fertigen Gerichts vorhanden ist, setze displayImageNumber auf 0. Rate nicht.
- Wenn displayImageNumber 0 ist, ergänze in warnings den Hinweis, dass kein eindeutiges Foto des fertigen Gerichts erkannt wurde und deshalb kein Thumbnail importiert wird.
- Wenn kein Titel sicher sichtbar ist, title leer lassen und eine Warnung ergänzen.
- Antworte ausschließlich im vorgegebenen JSON-Schema.`;

function corsHeaders(origin) {
  const allowed = origin && ALLOWED_ORIGINS.has(origin) ? origin : "";
  return {
    ...(allowed ? { "Access-Control-Allow-Origin": allowed } : {}),
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function json(data, status = 200, origin = "") {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...corsHeaders(origin),
    },
  });
}

function emptyUsage() {
  return {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    requests: 0,
    trackedCost: 0,
    trackingStartedAt: new Date().toISOString(),
    updatedAt: null,
  };
}

async function getTrackedUsage(env) {
  if (!env.RECIPE_USAGE) return emptyUsage();
  const existing = await env.RECIPE_USAGE.get(USAGE_KEY, "json");
  if (existing) return existing;
  const initial = emptyUsage();
  await env.RECIPE_USAGE.put(USAGE_KEY, JSON.stringify(initial));
  return initial;
}

async function recordUsage(env, usage) {
  if (!env.RECIPE_USAGE || !usage) return;
  const current = await getTrackedUsage(env);
  const next = {
    ...current,
    promptTokens: current.promptTokens + Number(usage.prompt_tokens || 0),
    completionTokens: current.completionTokens + Number(usage.completion_tokens || 0),
    totalTokens: current.totalTokens + Number(usage.total_tokens || 0),
    requests: current.requests + 1,
    trackedCost: current.trackedCost + Number(usage.cost || 0),
    updatedAt: new Date().toISOString(),
  };
  await env.RECIPE_USAGE.put(USAGE_KEY, JSON.stringify(next));
}

function safeErrorText(value, fallback) {
  const text = typeof value === "string" ? value : fallback;
  return text.replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").trim().slice(0, 800);
}

async function storeProcessingError(env, details) {
  const record = {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    stage: safeErrorText(details.stage, "unknown"),
    message: safeErrorText(details.message, "An unknown processing error occurred."),
    httpStatus: Number(details.httpStatus) || 500,
    ...(Number.isFinite(details.upstreamStatus) ? { upstreamStatus: Number(details.upstreamStatus) } : {}),
    model: env.OPENROUTER_MODEL || DEFAULT_MODEL,
    ...(Number.isFinite(details.recipeGroup) ? { recipeGroup: Number(details.recipeGroup) } : {}),
    ...(Number.isFinite(details.requestBytes) ? { requestBytes: Number(details.requestBytes) } : {}),
    ...(details.imageCounts ? { imageCounts: details.imageCounts } : {}),
  };

  if (!env.RECIPE_USAGE) return record;
  try {
    await env.RECIPE_USAGE.put(`${ERROR_KEY_PREFIX}${record.id}`, JSON.stringify(record), {
      expirationTtl: ERROR_TTL_SECONDS,
    });
    const current = await env.RECIPE_USAGE.get(ERROR_INDEX_KEY, "json");
    const ids = Array.isArray(current) ? current.filter((id) => typeof id === "string") : [];
    await env.RECIPE_USAGE.put(
      ERROR_INDEX_KEY,
      JSON.stringify([record.id, ...ids.filter((id) => id !== record.id)].slice(0, MAX_ERROR_RECORDS)),
    );
  } catch {
    // Returning the diagnostic to the browser is still useful if KV storage is temporarily unavailable.
  }
  return record;
}

async function processingErrorResponse(env, origin, details) {
  const diagnostic = await storeProcessingError(env, details);
  return json({ error: diagnostic.message, diagnostic }, diagnostic.httpStatus, origin);
}

async function getProcessingErrors(env, id) {
  if (!env.RECIPE_USAGE) return [];
  if (id) {
    const record = await env.RECIPE_USAGE.get(`${ERROR_KEY_PREFIX}${id}`, "json");
    return record ? [record] : [];
  }
  const current = await env.RECIPE_USAGE.get(ERROR_INDEX_KEY, "json");
  const ids = Array.isArray(current) ? current.slice(0, MAX_ERROR_RECORDS) : [];
  return (await Promise.all(ids.map((item) => env.RECIPE_USAGE.get(`${ERROR_KEY_PREFIX}${item}`, "json"))))
    .filter(Boolean);
}

async function getOpenRouterKeyUsage(env) {
  const response = await fetch("https://openrouter.ai/api/v1/key", {
    headers: { Authorization: `Bearer ${env.OPENROUTER_API_KEY}` },
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.error?.message || `OpenRouter usage returned HTTP ${response.status}.`);
  return payload.data || {};
}

async function secureEqual(left, right) {
  const encoder = new TextEncoder();
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(left)),
    crypto.subtle.digest("SHA-256", encoder.encode(right)),
  ]);
  const a = new Uint8Array(leftHash);
  const b = new Uint8Array(rightHash);
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a[index] ^ b[index];
  return difference === 0;
}

async function dashboardIsAuthorized(request, env) {
  if (!env.DASHBOARD_PASSWORD) return false;
  const authorization = request.headers.get("Authorization") || "";
  const supplied = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  return secureEqual(supplied, env.DASHBOARD_PASSWORD);
}

function isAllowedDataUrl(value) {
  return typeof value === "string" && /^data:image\/(?:jpeg|png|webp);base64,[a-z0-9+/=\r\n]+$/i.test(value);
}

function normalizeImages(value, label) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
  if (value.length > MAX_IMAGES) throw new Error(`${label} contains too many images.`);
  if (!value.every(isAllowedDataUrl)) throw new Error(`${label} must contain JPEG, PNG, or WebP data URLs.`);
  return value;
}

function addImageSection(content, title, images) {
  if (!images.length) return;
  content.push({ type: "text", text: title });
  for (const image of images) {
    content.push({ type: "image_url", image_url: { url: image } });
  }
}

function addIndexedImageSection(content, title, images) {
  if (!images.length) return;
  content.push({ type: "text", text: title });
  images.forEach((image, index) => {
    content.push({ type: "text", text: `ORIGINALAUFNAHME ${index + 1}` });
    content.push({ type: "image_url", image_url: { url: image } });
  });
}

function extractMessageText(message) {
  if (typeof message?.content === "string") return message.content;
  if (Array.isArray(message?.content)) {
    return message.content
      .filter((part) => part?.type === "text")
      .map((part) => part.text)
      .join("");
  }
  return "";
}

function parseModelJson(text) {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  return JSON.parse(cleaned);
}

function notionHeaders(token, jsonContent = true) {
  return {
    Authorization: `Bearer ${token}`,
    "Notion-Version": NOTION_VERSION,
    ...(jsonContent ? { "Content-Type": "application/json" } : {}),
  };
}

function richText(value, annotations) {
  const text = String(value || "").trim();
  if (!text) return [];
  const chunks = text.match(/[\s\S]{1,1900}/g) || [];
  return chunks.map((content) => ({
    type: "text",
    text: { content },
    ...(annotations ? { annotations } : {}),
  }));
}

function decodeImageDataUrl(dataUrl) {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([a-z0-9+/=\r\n]+)$/i.exec(dataUrl || "");
  if (!match) throw new Error("The finished-dish image is invalid.");
  const bytes = Uint8Array.from(atob(match[2].replace(/\s/g, "")), (character) => character.charCodeAt(0));
  const extension = match[1] === "image/png" ? "png" : match[1] === "image/webp" ? "webp" : "jpg";
  return { blob: new Blob([bytes], { type: match[1] }), contentType: match[1], extension };
}

async function notionJson(path, token, init = {}) {
  const response = await fetch(`${NOTION_API}${path}`, {
    ...init,
    headers: { ...notionHeaders(token), ...(init.headers || {}) },
  });
  let payload;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) {
    throw new Error(payload?.message || `Notion returned HTTP ${response.status}.`);
  }
  return payload;
}

async function uploadImageToNotion(dataUrl, title, token) {
  if (!dataUrl) return null;
  const { blob, contentType, extension } = decodeImageDataUrl(dataUrl);
  const safeTitle = String(title || "recipe").replace(/[^a-z0-9äöüß_-]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "recipe";
  const filename = `${safeTitle}.${extension}`;
  const upload = await notionJson("/file_uploads", token, {
    method: "POST",
    body: JSON.stringify({ mode: "single_part", filename, content_type: contentType }),
  });
  const form = new FormData();
  form.append("file", blob, filename);
  const sent = await fetch(`${NOTION_API}/file_uploads/${upload.id}/send`, {
    method: "POST",
    headers: notionHeaders(token, false),
    body: form,
  });
  let sentPayload;
  try {
    sentPayload = await sent.json();
  } catch {
    sentPayload = null;
  }
  if (!sent.ok) throw new Error(sentPayload?.message || `Notion image upload returned HTTP ${sent.status}.`);
  return upload.id;
}

function buildNotionChildren(recipe, imageUploadId) {
  const children = [];
  if (imageUploadId) {
    children.push({
      object: "block",
      type: "image",
      image: { type: "file_upload", file_upload: { id: imageUploadId } },
    });
  }
  return children;
}

async function importRecipeToNotion(recipe, env) {
  const title = String(recipe?.title || "").trim();
  const difficulty = recipe?.difficulty;
  const courses = Array.isArray(recipe?.courses) ? recipe.courses.filter(Boolean) : [];
  if (!title || !recipe?.ingredients || !recipe?.steps || !courses.length || !["Daily", "Special"].includes(difficulty)) {
    throw new Error("The recipe is missing required review fields.");
  }
  const imageUploadId = await uploadImageToNotion(recipe.imageDataUrl, title, env.NOTION_TOKEN);
  const servings = Number.parseFloat(String(recipe.servings || "").replace(",", "."));
  const properties = {
    Name: { title: richText(title) },
    Course: { multi_select: courses.map((name) => ({ name })) },
    Difficulty: { select: { name: difficulty } },
    Ingredients: { rich_text: richText(recipe.ingredients) },
    Steps: { rich_text: richText(recipe.steps) },
  };
  if (Number.isFinite(servings)) properties.Servings = { number: servings };

  const page = await notionJson("/pages", env.NOTION_TOKEN, {
    method: "POST",
    body: JSON.stringify({
      parent: { type: "data_source_id", data_source_id: env.NOTION_DATA_SOURCE_ID },
      icon: { type: "external", external: { url: "https://www.notion.so/icons/dining_gray.svg" } },
      properties,
      children: buildNotionChildren(recipe, imageUploadId),
    }),
  });
  return { id: page.id, url: page.url, title };
}

const worker = {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";

    if (request.method === "OPTIONS") {
      if (!ALLOWED_ORIGINS.has(origin)) return new Response(null, { status: 403 });
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
      return json(
        {
          ok: true,
          service: "Recipe Press OCR",
          model: env.OPENROUTER_MODEL || DEFAULT_MODEL,
        },
        200,
        origin,
      );
    }

    if (request.method === "GET" && url.pathname === "/v1/notion-status") {
      if (origin && !ALLOWED_ORIGINS.has(origin)) {
        return json({ error: "Origin not allowed." }, 403, origin);
      }
      if (!env.NOTION_TOKEN || !env.NOTION_DATA_SOURCE_ID) {
        return json({ error: "Notion is not configured on the server yet." }, 503, origin);
      }
      try {
        const dataSource = await notionJson(`/data_sources/${env.NOTION_DATA_SOURCE_ID}`, env.NOTION_TOKEN, {
          method: "GET",
        });
        return json(
          {
            ok: true,
            dataSourceId: dataSource.id,
            title: Array.isArray(dataSource.title)
              ? dataSource.title.map((item) => item?.plain_text || "").join("")
              : "",
          },
          200,
          origin,
        );
      } catch (error) {
        return json(
          { error: error instanceof Error ? error.message : "Notion access could not be verified." },
          502,
          origin,
        );
      }
    }

    if (request.method === "GET" && url.pathname === "/v1/usage") {
      if (origin && !ALLOWED_ORIGINS.has(origin)) {
        return json({ error: "Origin not allowed." }, 403, origin);
      }
      if (!env.OPENROUTER_API_KEY) {
        return json({ error: "OpenRouter is not configured on the server yet." }, 503, origin);
      }
      if (!env.DASHBOARD_PASSWORD) {
        return json({ error: "Dashboard access is not configured on the server yet." }, 503, origin);
      }
      if (!(await dashboardIsAuthorized(request, env))) {
        return json({ error: "Incorrect dashboard password." }, 401, origin);
      }
      try {
        const [tracked, key] = await Promise.all([getTrackedUsage(env), getOpenRouterKeyUsage(env)]);
        return json({
          model: env.OPENROUTER_MODEL || DEFAULT_MODEL,
          tokens: {
            prompt: tracked.promptTokens,
            completion: tracked.completionTokens,
            total: tracked.totalTokens,
            requests: tracked.requests,
            trackingStartedAt: tracked.trackingStartedAt,
            updatedAt: tracked.updatedAt,
          },
          cost: {
            total: Number(key.usage || 0),
            today: Number(key.usage_daily || 0),
            week: Number(key.usage_weekly || 0),
            month: Number(key.usage_monthly || 0),
            tracked: Number(tracked.trackedCost || 0),
            limit: key.limit == null ? null : Number(key.limit),
            remaining: key.limit_remaining == null ? null : Number(key.limit_remaining),
            reset: key.limit_reset || null,
          },
        }, 200, origin);
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : "Usage data could not be loaded." }, 502, origin);
      }
    }

    if (request.method === "GET" && url.pathname === "/v1/processing-errors") {
      if (origin && !ALLOWED_ORIGINS.has(origin)) {
        return json({ error: "Origin not allowed." }, 403, origin);
      }
      if (!env.DASHBOARD_PASSWORD) {
        return json({ error: "Diagnostic access is not configured on the server yet." }, 503, origin);
      }
      if (!(await dashboardIsAuthorized(request, env))) {
        return json({ error: "Incorrect dashboard password." }, 401, origin);
      }
      const records = await getProcessingErrors(env, url.searchParams.get("id") || "");
      if (url.searchParams.has("id") && !records.length) {
        return json({ error: "No stored processing error was found for that ID." }, 404, origin);
      }
      return json({ errors: records }, 200, origin);
    }

    const isExtractRequest = request.method === "POST" && url.pathname === "/v1/extract-recipe";
    const isNotionImportRequest = request.method === "POST" && url.pathname === "/v1/import-notion";
    const isClientErrorRequest = request.method === "POST" && url.pathname === "/v1/processing-errors";
    if (!isExtractRequest && !isNotionImportRequest && !isClientErrorRequest) {
      return json({ error: "Not found." }, 404, origin);
    }

    if (origin && !ALLOWED_ORIGINS.has(origin)) {
      return json({ error: "Origin not allowed." }, 403, origin);
    }

    if (isExtractRequest && !env.OPENROUTER_API_KEY) {
      return processingErrorResponse(env, origin, {
        stage: "configuration",
        message: "OPENROUTER_API_KEY is not configured.",
        httpStatus: 500,
      });
    }
    if (isNotionImportRequest && (!env.NOTION_TOKEN || !env.NOTION_DATA_SOURCE_ID)) {
      return json({ error: "Notion is not configured on the server yet." }, 503, origin);
    }

    const contentLength = Number(request.headers.get("Content-Length") || 0);
    let requestBytes = contentLength;
    if (contentLength > MAX_REQUEST_BYTES) {
      return processingErrorResponse(env, origin, {
        stage: "request_validation",
        message: "The image upload is too large.",
        httpStatus: 413,
        requestBytes: contentLength,
      });
    }

    let body;
    try {
      const raw = await request.text();
      requestBytes = new TextEncoder().encode(raw).byteLength;
      if (requestBytes > MAX_REQUEST_BYTES) {
        return processingErrorResponse(env, origin, {
          stage: "request_validation",
          message: "The image upload is too large.",
          httpStatus: 413,
          requestBytes,
        });
      }
      body = JSON.parse(raw);
    } catch {
      return processingErrorResponse(env, origin, {
        stage: "request_validation",
        message: "Request body must be valid JSON.",
        httpStatus: 400,
        requestBytes,
      });
    }

    if (isClientErrorRequest) {
      const submitted = body?.diagnostic || {};
      const diagnostic = await storeProcessingError(env, {
        stage: `client_${safeErrorText(submitted.stage, "unknown")}`,
        message: safeErrorText(submitted.message, "The browser reported an unknown processing error."),
        httpStatus: Number(submitted.httpStatus) || 500,
        upstreamStatus: Number(submitted.upstreamStatus),
        requestBytes,
        recipeGroup: Number(submitted.recipeGroup),
        imageCounts: submitted.imageCounts && typeof submitted.imageCounts === "object"
          ? {
              source: Number(submitted.imageCounts.source) || 0,
              title: Number(submitted.imageCounts.title) || 0,
              ingredients: Number(submitted.imageCounts.ingredients) || 0,
              steps: Number(submitted.imageCounts.steps) || 0,
              total: Number(submitted.imageCounts.total) || 0,
            }
          : undefined,
      });
      return json({ diagnostic }, 201, origin);
    }

    if (isNotionImportRequest) {
      try {
        const result = await importRecipeToNotion(body.recipe, env);
        return json({ page: result }, 201, origin);
      } catch (error) {
        return processingErrorResponse(env, origin, {
          stage: "notion_import",
          message: error instanceof Error ? error.message : "The recipe could not be imported into Notion.",
          httpStatus: 502,
          requestBytes,
          recipeGroup: body?.recipeGroup,
        });
      }
    }

    let sourceImages;
    let titleImages;
    let ingredientImages;
    let stepImages;
    try {
      sourceImages = normalizeImages(body.sourceImages, "sourceImages");
      titleImages = normalizeImages(body.titleImages, "titleImages");
      ingredientImages = normalizeImages(body.ingredientImages, "ingredientImages");
      stepImages = normalizeImages(body.stepImages, "stepImages");
    } catch (error) {
      return processingErrorResponse(env, origin, {
        stage: "image_validation",
        message: error instanceof Error ? error.message : "Invalid images.",
        httpStatus: 400,
        requestBytes,
        recipeGroup: body?.recipeGroup,
      });
    }

    const imageCount = sourceImages.length + titleImages.length + ingredientImages.length + stepImages.length;
    const imageCounts = {
      source: sourceImages.length,
      title: titleImages.length,
      ingredients: ingredientImages.length,
      steps: stepImages.length,
      total: imageCount,
    };
    if (!sourceImages.length || !ingredientImages.length || !stepImages.length || imageCount > MAX_IMAGES) {
      return processingErrorResponse(env, origin, {
        stage: "image_validation",
        message: `Provide original, ingredient, and step images, with no more than ${MAX_IMAGES} images total.`,
        httpStatus: 400,
        requestBytes,
        recipeGroup: body?.recipeGroup,
        imageCounts,
      });
    }

    const userContent = [
      {
        type: "text",
        text: "Erstelle aus den folgenden Bildausschnitten einen strukturierten deutschen Rezeptentwurf. Die Bereiche wurden vom Nutzer bereits zugeordnet.",
      },
    ];
    addIndexedImageSection(userContent, "ORIGINALAUFNAHMEN FÜR DIE DISPLAYBILD-AUSWAHL:", sourceImages);
    addImageSection(userContent, "GANZE SEITE ODER TITELBEREICH:", titleImages.slice(0, 1));
    addImageSection(userContent, "ZUTATENBEREICH(E):", ingredientImages);
    addImageSection(userContent, "ZUBEREITUNGSBEREICH(E):", stepImages);

    let upstream;
    try {
      upstream = await fetch(OPENROUTER_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://zescht.github.io/recipe-press/",
          "X-Title": "Recipe Press",
        },
        body: JSON.stringify({
          model: env.OPENROUTER_MODEL || DEFAULT_MODEL,
          temperature: 0.1,
          max_tokens: 5000,
          usage: { include: true },
          reasoning: { enabled: false },
          response_format: {
            type: "json_schema",
            json_schema: RECIPE_SCHEMA,
          },
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: userContent },
          ],
        }),
      });
    } catch (error) {
      return processingErrorResponse(env, origin, {
        stage: "openrouter_request",
        message: error instanceof Error ? `OpenRouter could not be reached: ${error.message}` : "OpenRouter could not be reached.",
        httpStatus: 502,
        requestBytes,
        recipeGroup: body?.recipeGroup,
        imageCounts,
      });
    }

    let result;
    try {
      result = await upstream.json();
    } catch {
      return processingErrorResponse(env, origin, {
        stage: "openrouter_response",
        message: "OpenRouter returned an unreadable response.",
        httpStatus: 502,
        upstreamStatus: upstream.status,
        requestBytes,
        recipeGroup: body?.recipeGroup,
        imageCounts,
      });
    }

    if (!upstream.ok) {
      return processingErrorResponse(env, origin, {
        stage: "openrouter_response",
        message: result?.error?.message || "OpenRouter rejected the request.",
        httpStatus: 502,
        upstreamStatus: upstream.status,
        requestBytes,
        recipeGroup: body?.recipeGroup,
        imageCounts,
      });
    }

    try {
      const recipe = parseModelJson(extractMessageText(result?.choices?.[0]?.message));
      await recordUsage(env, result?.usage);
      return json(
        {
          recipe,
          usage: result?.usage
            ? {
                promptTokens: result.usage.prompt_tokens,
                completionTokens: result.usage.completion_tokens,
                totalTokens: result.usage.total_tokens,
                cost: result.usage.cost,
              }
            : null,
        },
        200,
        origin,
      );
    } catch (error) {
      return processingErrorResponse(env, origin, {
        stage: "response_parsing",
        message: error instanceof Error
          ? `The AI response did not match the recipe format: ${error.message}`
          : "The AI response did not match the recipe format.",
        httpStatus: 502,
        upstreamStatus: upstream.status,
        requestBytes,
        recipeGroup: body?.recipeGroup,
        imageCounts,
      });
    }
  },
};

export default worker;

