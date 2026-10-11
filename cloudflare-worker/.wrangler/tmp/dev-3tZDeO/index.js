var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/index.js
var OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
var DEFAULT_MODEL = "qwen/qwen3.5-flash-02-23";
var MAX_REQUEST_BYTES = 18 * 1024 * 1024;
var MAX_IMAGES = 10;
var ALLOWED_ORIGINS = /* @__PURE__ */ new Set([
  "https://zescht.github.io",
  "http://localhost:3000",
  "http://localhost:5173",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:5173"
]);
var RECIPE_SCHEMA = {
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
        items: { type: "string" }
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
              items: { type: "string" }
            }
          },
          required: ["name", "steps"]
        }
      },
      warnings: {
        type: "array",
        items: { type: "string" }
      }
    },
    required: [
      "title",
      "servings",
      "cookingTime",
      "comment",
      "ingredients",
      "phases",
      "warnings"
    ]
  }
};
var SYSTEM_PROMPT = `Du transkribierst deutschsprachige Kochrezepte aus Fotos.

Arbeite ausschlie\xDFlich aus dem sichtbaren Inhalt. Korrigiere eindeutige OCR-, Trennungs- und Zeilenumbruchfehler, aber erfinde niemals Mengen, Temperaturen, Zeiten oder Zutaten. Bei Unsicherheit bleibt der bestm\xF6gliche Text stehen und ein kurzer deutscher Hinweis kommt in warnings.

Regeln:
- Ignoriere Seitenzahlen, laufende Kopfzeilen, dekorative Texte, Bildunterschriften und allgemeine Einleitungstexte, sofern sie keine wichtige Servier-, Aufbewahrungs- oder Vorbereitungsaussage enthalten.
- ingredients enth\xE4lt jede Zutat genau einmal, mit Menge, Einheit und Zubereitungshinweis.
- Sortiere Zutaten ohne Zwischen\xFCberschriften in dieser Reihenfolge: (1) Gem\xFCse/Obst, (2) Fleisch/Fisch/Protein, (3) Milch-/Joghurtprodukte, (4) Sonstiges, (5) typische Vorr\xE4te wie \xD6l, Salz und Pfeffer. Behalte innerhalb einer Gruppe die Quellreihenfolge bei.
- phases enth\xE4lt die Zubereitung in sinnvollen Phasen. Jede Phase hat einen kurzen deutschen Namen und vollst\xE4ndige Arbeitsschritte. Bewahre Fakten, Reihenfolge, Temperaturen, Zeiten und Sichtmerkmale.
- servings ist nur die Zahl, wenn eindeutig vorhanden, sonst eine leere Zeichenfolge.
- cookingTime ist eine knappe Angabe wie "Gesamtzeit: ca. 1 Std.", jedoch nur wenn die Quelle eine Gesamtzeit nennt oder sie eindeutig aus ausdr\xFCcklich genannten Zeiten hervorgeht.
- comment enth\xE4lt n\xFCtzliche Angaben zu Servierkontext, Vorbereitung oder Aufbewahrung; sonst leer.
- Wenn kein Titel sicher sichtbar ist, title leer lassen und eine Warnung erg\xE4nzen.
- Antworte ausschlie\xDFlich im vorgegebenen JSON-Schema.`;
function corsHeaders(origin) {
  const allowed = origin && ALLOWED_ORIGINS.has(origin) ? origin : "";
  return {
    ...allowed ? { "Access-Control-Allow-Origin": allowed } : {},
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin"
  };
}
__name(corsHeaders, "corsHeaders");
function json(data, status = 200, origin = "") {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...corsHeaders(origin)
    }
  });
}
__name(json, "json");
function isAllowedDataUrl(value) {
  return typeof value === "string" && /^data:image\/(?:jpeg|png|webp);base64,[a-z0-9+/=\r\n]+$/i.test(value);
}
__name(isAllowedDataUrl, "isAllowedDataUrl");
function normalizeImages(value, label) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
  if (value.length > MAX_IMAGES) throw new Error(`${label} contains too many images.`);
  if (!value.every(isAllowedDataUrl)) throw new Error(`${label} must contain JPEG, PNG, or WebP data URLs.`);
  return value;
}
__name(normalizeImages, "normalizeImages");
function addImageSection(content, title, images) {
  if (!images.length) return;
  content.push({ type: "text", text: title });
  for (const image of images) {
    content.push({ type: "image_url", image_url: { url: image } });
  }
}
__name(addImageSection, "addImageSection");
function extractMessageText(message) {
  if (typeof message?.content === "string") return message.content;
  if (Array.isArray(message?.content)) {
    return message.content.filter((part) => part?.type === "text").map((part) => part.text).join("");
  }
  return "";
}
__name(extractMessageText, "extractMessageText");
function parseModelJson(text) {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  return JSON.parse(cleaned);
}
__name(parseModelJson, "parseModelJson");
var src_default = {
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
          model: env.OPENROUTER_MODEL || DEFAULT_MODEL
        },
        200,
        origin
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
        origin
      );
    }
    const userContent = [
      {
        type: "text",
        text: "Erstelle aus den folgenden Bildausschnitten einen strukturierten deutschen Rezeptentwurf. Die Bereiche wurden vom Nutzer bereits zugeordnet."
      }
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
          "X-Title": "Recipe Press"
        },
        body: JSON.stringify({
          model: env.OPENROUTER_MODEL || DEFAULT_MODEL,
          temperature: 0.1,
          max_tokens: 5e3,
          reasoning: { enabled: false },
          response_format: {
            type: "json_schema",
            json_schema: RECIPE_SCHEMA
          },
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: userContent }
          ]
        })
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
          upstreamStatus: upstream.status
        },
        502,
        origin
      );
    }
    try {
      const recipe = parseModelJson(extractMessageText(result?.choices?.[0]?.message));
      return json(
        {
          recipe,
          usage: result?.usage ? {
            promptTokens: result.usage.prompt_tokens,
            completionTokens: result.usage.completion_tokens,
            totalTokens: result.usage.total_tokens,
            cost: result.usage.cost
          } : null
        },
        200,
        origin
      );
    } catch {
      return json({ error: "The AI response did not match the recipe format." }, 502, origin);
    }
  }
};

// ../node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// ../node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    return Response.json(error, {
      status: 500,
      headers: { "MF-Experimental-Error-Stack": "true" }
    });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-Bcn1RX/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = src_default;

// ../node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-Bcn1RX/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=index.js.map
