const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "qwen/qwen3.5-flash-02-23";
const MAX_REQUEST_BYTES = 18 * 1024 * 1024;
const MAX_IMAGES = 10;

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
      cookingTime: { type: "string" },
      comment: { type: "string" },
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
      "cookingTime",
      "comment",
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
- cookingTime ist eine knappe Angabe wie "Gesamtzeit: ca. 1 Std.", jedoch nur wenn die Quelle eine Gesamtzeit nennt oder sie eindeutig aus ausdrücklich genannten Zeiten hervorgeht.
- comment enthält nützliche Angaben zu Servierkontext, Vorbereitung oder Aufbewahrung; sonst leer.
- Wenn kein Titel sicher sichtbar ist, title leer lassen und eine Warnung ergänzen.
- Antworte ausschließlich im vorgegebenen JSON-Schema.`;

function corsHeaders(origin) {
  const allowed = origin && ALLOWED_ORIGINS.has(origin) ? origin : "";
  return {
    ...(allowed ? { "Access-Control-Allow-Origin": allowed } : {}),
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
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

    if (request.method !== "POST" || url.pathname !== "/v1/extract-recipe") {
      return json({ error: "Not found." }, 404, origin);
    }

    if (origin && !ALLOWED_ORIGINS.has(origin)) {
      return json({ error: "Origin not allowed." }, 403, origin);
    }

    if (!env.OPENROUTER_API_KEY) {
      return json({ error: "OPENROUTER_API_KEY is not configured." }, 500, origin);
    }

    const contentLength = Number(request.headers.get("Content-Length") || 0);
    if (contentLength > MAX_REQUEST_BYTES) {
      return json({ error: "The image upload is too large." }, 413, origin);
    }

    let body;
    try {
      const raw = await request.text();
      if (new TextEncoder().encode(raw).byteLength > MAX_REQUEST_BYTES) {
        return json({ error: "The image upload is too large." }, 413, origin);
      }
      body = JSON.parse(raw);
    } catch {
      return json({ error: "Request body must be valid JSON." }, 400, origin);
    }

    let titleImages;
    let ingredientImages;
    let stepImages;
    try {
      titleImages = normalizeImages(body.titleImages, "titleImages");
      ingredientImages = normalizeImages(body.ingredientImages, "ingredientImages");
      stepImages = normalizeImages(body.stepImages, "stepImages");
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "Invalid images." }, 400, origin);
    }

    const imageCount = titleImages.length + ingredientImages.length + stepImages.length;
    if (!ingredientImages.length || !stepImages.length || imageCount > MAX_IMAGES) {
      return json(
        { error: `Provide at least one ingredient image and one step image, with no more than ${MAX_IMAGES} images total.` },
        400,
        origin,
      );
    }

    const userContent = [
      {
        type: "text",
        text: "Erstelle aus den folgenden Bildausschnitten einen strukturierten deutschen Rezeptentwurf. Die Bereiche wurden vom Nutzer bereits zugeordnet.",
      },
    ];
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
    } catch {
      return json({ error: "OpenRouter could not be reached." }, 502, origin);
    }

    let result;
    try {
      result = await upstream.json();
    } catch {
      return json({ error: "OpenRouter returned an unreadable response." }, 502, origin);
    }

    if (!upstream.ok) {
      return json(
        {
          error: result?.error?.message || "OpenRouter rejected the request.",
          upstreamStatus: upstream.status,
        },
        502,
        origin,
      );
    }

    try {
      const recipe = parseModelJson(extractMessageText(result?.choices?.[0]?.message));
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
    } catch {
      return json({ error: "The AI response did not match the recipe format." }, 502, origin);
    }
  },
};

export default worker;

