"use client";

import {
  ArrowLeft,
  BarChart3,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  CircleDollarSign,
  Crop,
  FileText,
  ImagePlus,
  LoaderCircle,
  Maximize2,
  Plus,
  RotateCcw,
  RefreshCw,
  Sparkles,
  Trash2,
  Upload,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { ChangeEvent, PointerEvent as ReactPointerEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  deleteImageBlob,
  loadImageBlob,
  saveImageBlob,
} from "@/lib/local-batch-store";

type FlowStep = "upload" | "assign" | "groups" | "processing" | "review" | "results";

type CropPoint = { x: number; y: number };
type CropQuad = [CropPoint, CropPoint, CropPoint, CropPoint];
type OcrRegions = { ingredients: CropQuad; steps: CropQuad };
type PreviewImage = { src: string; alt: string; name: string };

type BatchImage = {
  id: string;
  name: string;
  url: string;
  samplePath?: string;
  group: number | null;
  excluded: boolean;
  ocrRegions?: OcrRegions;
};

type Draft = {
  id: string;
  group: number;
  title: string;
  courses: string[];
  difficulty: "" | "Daily" | "Special";
  servings: string;
  ingredients: string;
  steps: string;
  visited: boolean;
  deleted: boolean;
  warning?: string;
};

type NotionResult = {
  draftId: string;
  title: string;
  url: string;
};

type PersistedState = {
  flow: FlowStep;
  images: Omit<BatchImage, "url">[];
  drafts: Draft[];
  imageIndex: number;
  draftIndex: number;
  notionResults?: NotionResult[];
};

type SavedBatchSummary = {
  id: string;
  title: string;
  flow: FlowStep;
  updatedAt: string;
  imageCount: number;
  recipeCount: number;
  importedCount: number;
};

const LEGACY_STORAGE_KEY = "recipe-press:batch:v1";
const BATCH_STORAGE_PREFIX = "recipe-press:batch:v2:";
const BATCH_INDEX_KEY = "recipe-press:batches:v2";
const PUBLIC_BASE = import.meta.env.BASE_URL || "/";
const RECIPE_API_URL = "https://recipe-notion-app.pinkas-paolo.workers.dev/v1/extract-recipe";
const NOTION_IMPORT_URL = "https://recipe-notion-app.pinkas-paolo.workers.dev/v1/import-notion";
const USAGE_API_URL = "https://recipe-notion-app.pinkas-paolo.workers.dev/v1/usage";

function publicAsset(path: string) {
  return `${PUBLIC_BASE.endsWith("/") ? PUBLIC_BASE : `${PUBLIC_BASE}/`}${path.replace(/^\//, "")}`;
}

const flowSteps: FlowStep[] = ["upload", "assign", "groups", "processing", "review", "results"];

function batchStorageKey(id: string) {
  return `${BATCH_STORAGE_PREFIX}${id}`;
}

function batchUrl(id: string, flow: FlowStep) {
  return `${publicAsset("")}#/batch/${encodeURIComponent(id)}/${flow}`;
}

function parseBatchRoute() {
  if (typeof window === "undefined") return null;
  const match = window.location.hash.match(/^#\/batch\/([^/]+)\/([^/]+)$/);
  if (!match || !flowSteps.includes(match[2] as FlowStep)) return null;
  return { id: decodeURIComponent(match[1]), flow: match[2] as FlowStep };
}

function readBatchIndex(): SavedBatchSummary[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(BATCH_INDEX_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeBatchIndex(entries: SavedBatchSummary[]) {
  localStorage.setItem(BATCH_INDEX_KEY, JSON.stringify(entries));
}

function summarizeBatch(id: string, state: PersistedState, updatedAt = new Date().toISOString()): SavedBatchSummary {
  const activeDrafts = (state.drafts || []).filter((draft) => !draft.deleted);
  return {
    id,
    title: activeDrafts[0]?.title?.trim() || `Photo batch · ${state.images.length} image${state.images.length === 1 ? "" : "s"}`,
    flow: state.flow,
    updatedAt,
    imageCount: state.images.length,
    recipeCount: activeDrafts.length,
    importedCount: state.notionResults?.length || 0,
  };
}

function formatSavedBatchDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function savedBatchLabel(batch: SavedBatchSummary) {
  if (batch.importedCount) return `${batch.importedCount} imported`;
  if (batch.recipeCount) return `${batch.recipeCount} draft${batch.recipeCount === 1 ? "" : "s"}`;
  return `${batch.imageCount} image${batch.imageCount === 1 ? "" : "s"}`;
}

const sampleRecipePath = publicAsset("samples/recipe-text.jpeg");
const sampleDishPath = publicAsset("samples/finished-dish.jpeg");

const courseOptions = [
  "🍛 Main Dishes",
  "🫒 Appetizers",
  "🥗 Salads",
  "🍳 Breakfast",
  "🍪 Baked Goods",
  "🥫 Sauces",
  "🧉 Drinks",
  "🍪 Desserts",
];

const sampleIngredients = `- 3 Knoblauchzehen, in feine Scheiben geschnitten
- 1 große rote Zwiebel, fein gehackt (160 g)
- 2 kleine Auberginen, in etwa 5 × 2 cm große Stücke geschnitten (420 g)
- 200 g Kirschtomaten
- 180 g Puy-Linsen
- 100 g Crème fraîche
- ½ EL Thymianblätter
- 500 ml Gemüsebrühe
- 80 ml trockener Weißwein
- 1 TL Isot Biber (oder ½ TL Chiliflocken)
- 2 TL Oreganoblätter
- 3 EL Olivenöl, plus mehr zum Servieren
- Salz und schwarzer Pfeffer`;

const sampleSteps = `Zwiebelbasis
1. In einer großen Pfanne 2 EL Olivenöl bei mittlerer Temperatur erhitzen. Knoblauch, Zwiebel, Thymian und ¼ TL Salz hineingeben und 8 Minuten goldgelb anbraten.

Eintopf kochen
1. Auberginen und Tomaten mit ¼ TL Salz und reichlich Pfeffer würzen.
2. Das restliche Öl in der Pfanne kräftig erhitzen.
3. Auberginen und Tomaten 10 Minuten braten, bis sie goldbraun und weich sind.
4. Zwiebelbasis, Linsen, Brühe, Wein und 450 ml Wasser unterrühren.
5. Aufkochen und bei mittlerer Hitze 40 Minuten köcheln lassen.

Servieren
1. Mit Crème fraîche, Olivenöl, Isot Biber und Oregano servieren.`;

const workflow = [
  { key: "upload", label: "Upload" },
  { key: "assign", label: "Group" },
  { key: "review", label: "Review" },
  { key: "results", label: "Notion" },
] as const;

function activeWorkflowIndex(flow: FlowStep) {
  if (flow === "upload") return 0;
  if (["assign", "groups"].includes(flow)) return 1;
  if (["processing", "review"].includes(flow)) return 2;
  return 3;
}

function stripExtension(filename: string) {
  return filename.replace(/\.[^/.]+$/, "").replace(/[-_]+/g, " ").trim();
}

function draftIsComplete(draft: Draft) {
  return Boolean(
    draft.title.trim() &&
      draft.courses.length &&
      draft.difficulty &&
      draft.ingredients.trim() &&
      !draft.ingredients.includes("[Review") &&
      draft.steps.trim() &&
      !draft.steps.includes("[Review"),
  );
}

type ParsedRecipe = {
  title: string;
  ingredients: string;
  steps: string;
  servings?: string;
  warning?: string;
};

type QwenRecipe = {
  title: string;
  servings: string;
  ingredients: string[];
  phases: { name: string; steps: string[] }[];
  warnings: string[];
};

function ingredientRank(line: string) {
  const value = line.toLowerCase();
  const includesAny = (terms: string[]) => terms.some((term) => value.includes(term));
  if (includesAny(["oil", "öl", "salt", "salz", "pepper", "pfeffer", "water", "wasser"])) return 4;
  if (includesAny(["milk", "milch", "yog", "jogh", "cream", "sahne", "crème", "cheese", "käse", "butter"])) return 2;
  if (includesAny(["beef", "rind", "chicken", "huhn", "pork", "schwein", "fish", "fisch", "salmon", "lachs", "tofu", "egg", "ei ", "eggs", "lentil", "linse", "bean", "bohne"])) return 1;
  if (includesAny(["onion", "zwiebel", "garlic", "knoblauch", "tomato", "tomate", "auberg", "potato", "kartoff", "carrot", "karotte", "möhre", "pepper", "paprika", "lemon", "zitrone", "lime", "apple", "apfel", "herb", "kräuter", "thyme", "thymian", "oregano", "spinach", "spinat", "cabbage", "kohl"])) return 0;
  return 3;
}

function parseRecipeText(rawText: string, fallbackTitle: string, confidence: number): ParsedRecipe {
  const lines = rawText
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const ingredientHeading = /^(ingredients?|zutaten|you will need)\b[:\s-]*/i;
  const stepHeading = /^(method|directions?|instructions?|preparation|steps?|zubereitung|anleitung|zubereiten)\b[:\s-]*/i;
  const ingredientIndex = lines.findIndex((line) => ingredientHeading.test(line));
  const stepIndex = lines.findIndex((line) => stepHeading.test(line));
  const firstSection = [ingredientIndex, stepIndex].filter((index) => index >= 0).sort((a, b) => a - b)[0] ?? lines.length;
  const titleCandidates = lines
    .slice(0, Math.min(firstSection, 12))
    .map((line, index) => ({
      line: line.replace(/^[^A-Za-zÀ-ž]+/, "").trim(),
      index,
    }))
    .filter(({ line }) => /[A-Za-zÀ-ž]/.test(line) && line.length >= 4 && line.length <= 90)
    .map((candidate) => ({
      ...candidate,
      score:
        (candidate.line.includes("-") ? 4 : 0) +
        (candidate.line.split(" ").length <= 8 ? 2 : 0) -
        (candidate.line.includes(",") ? 2 : 0) -
        candidate.index * 0.05,
    }))
    .sort((left, right) => right.score - left.score || left.index - right.index);
  const title = titleCandidates[0]?.line ?? fallbackTitle;

  let ingredientLines: string[] = [];
  if (ingredientIndex >= 0) {
    const end = stepIndex > ingredientIndex ? stepIndex : lines.length;
    ingredientLines = lines.slice(ingredientIndex + 1, end);
  } else {
    const quantity = /(^[-•·]\s*|\b\d+[\d\s.,/]*\s*(g|kg|ml|l|cl|dl|oz|lb|cups?|tbsp|tsp|el|tl|esslöffel|teelöffel)\b|[½¼¾⅓⅔])/i;
    ingredientLines = lines.filter((line) => quantity.test(line));
  }

  let stepLines: string[] = [];
  if (stepIndex >= 0) {
    stepLines = lines.slice(stepIndex + 1);
  } else {
    const ingredientSet = new Set(ingredientLines);
    const numberedStepIndex = lines.findIndex((line) => /^\d+\s*[.)]\s+/.test(line));
    const stepSource = numberedStepIndex >= 0 ? lines.slice(numberedStepIndex) : lines;
    stepLines = stepSource.filter(
      (line) => line !== title && !ingredientSet.has(line) && !ingredientHeading.test(line) && line.length >= 20,
    );
  }

  const ingredients = ingredientLines
    .map((line) => line.replace(/^[-•·]\s*/, "").trim())
    .filter(Boolean)
    .map((line, index) => ({ line, index, rank: ingredientRank(line) }))
    .sort((left, right) => left.rank - right.rank || left.index - right.index)
    .map(({ line }) => line)
    .map((line) => `- ${line}`)
    .join("\n");
  const steps = stepLines
    .map((line) => line.replace(stepHeading, "").trim())
    .filter(Boolean)
    .join("\n\n");

  const warnings: string[] = [];
  warnings.push("Browser OCR is a first pass; verify column order and quantities against the photo.");
  if (confidence < 62) warnings.push("OCR confidence is low; compare the text with the original photo.");
  if (!ingredients) warnings.push("No clear ingredient section was found.");
  if (!steps) warnings.push("No clear preparation section was found.");

  return {
    title,
    ingredients: ingredients || "[Review and add the extracted ingredients]",
    steps: steps || rawText.trim() || "[Review and add the preparation steps]",
    warning: warnings.length ? warnings.join(" ") : undefined,
  };
}

const defaultOcrRegions: OcrRegions = {
  ingredients: [
    { x: 0.55, y: 0.22 },
    { x: 0.93, y: 0.22 },
    { x: 0.93, y: 0.9 },
    { x: 0.55, y: 0.9 },
  ],
  steps: [
    { x: 0.08, y: 0.43 },
    { x: 0.53, y: 0.43 },
    { x: 0.53, y: 0.9 },
    { x: 0.08, y: 0.9 },
  ],
};

function copyRegions(regions: OcrRegions): OcrRegions {
  return {
    ingredients: regions.ingredients.map((point) => ({ ...point })) as CropQuad,
    steps: regions.steps.map((point) => ({ ...point })) as CropQuad,
  };
}

function normalizeOcrLines(rawText: string) {
  return rawText
    .replace(/\r/g, "")
    .replace(/-\n(?=[a-zäöüß])/g, "")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function formatDefinedIngredients(rawText: string) {
  const heading = /^(zutaten|ingredients?)\b[:\s-]*/i;
  const serving = /^für\s+\d+.*(personen|portionen)/i;
  const quantity = /^(?:[-•·]\s*)?(?:\d|[½¼¾⅓⅔]|ein(?:e|en)?\b|salz\b|pfeffer\b)/i;
  const lines = normalizeOcrLines(rawText)
    .map((line) => line.replace(heading, "").trim())
    .filter((line) => line && !serving.test(line));
  const firstIngredient = lines.findIndex((line) => quantity.test(line));
  const source = firstIngredient >= 0 ? lines.slice(firstIngredient) : lines;
  const ingredients: string[] = [];

  source.forEach((line) => {
    const cleaned = line.replace(/^[-•·]\s*/, "").trim();
    if (!cleaned) return;
    if (quantity.test(cleaned) || !ingredients.length) ingredients.push(cleaned);
    else ingredients[ingredients.length - 1] = `${ingredients[ingredients.length - 1]} ${cleaned}`;
  });

  return ingredients
    .map((line, index) => ({ line, index, rank: ingredientRank(line) }))
    .sort((left, right) => left.rank - right.rank || left.index - right.index)
    .map(({ line }) => `- ${line}`)
    .join("\n");
}

function formatDefinedSteps(rawText: string) {
  const heading = /^(zubereitung|anleitung|schritte?|steps?|method|directions?|instructions?)\b[:\s-]*/i;
  const lines = normalizeOcrLines(rawText)
    .map((line) => line.replace(heading, "").trim())
    .filter(Boolean);
  const steps: string[] = [];

  lines.forEach((line) => {
    if (/^\d+\s*[.)]\s*/.test(line) || !steps.length) steps.push(line);
    else steps[steps.length - 1] = `${steps[steps.length - 1]} ${line}`;
  });

  return steps.join("\n\n");
}

function triangleTransform(source: CropPoint[], destination: CropPoint[]) {
  const [s0, s1, s2] = source;
  const [d0, d1, d2] = destination;
  const denominator = s0.x * (s1.y - s2.y) + s1.x * (s2.y - s0.y) + s2.x * (s0.y - s1.y);
  return {
    a: (d0.x * (s1.y - s2.y) + d1.x * (s2.y - s0.y) + d2.x * (s0.y - s1.y)) / denominator,
    b: (d0.y * (s1.y - s2.y) + d1.y * (s2.y - s0.y) + d2.y * (s0.y - s1.y)) / denominator,
    c: (d0.x * (s2.x - s1.x) + d1.x * (s0.x - s2.x) + d2.x * (s1.x - s0.x)) / denominator,
    d: (d0.y * (s2.x - s1.x) + d1.y * (s0.x - s2.x) + d2.y * (s1.x - s0.x)) / denominator,
    e: (d0.x * (s1.x * s2.y - s2.x * s1.y) + d1.x * (s2.x * s0.y - s0.x * s2.y) + d2.x * (s0.x * s1.y - s1.x * s0.y)) / denominator,
    f: (d0.y * (s1.x * s2.y - s2.x * s1.y) + d1.y * (s2.x * s0.y - s0.x * s2.y) + d2.y * (s0.x * s1.y - s1.x * s0.y)) / denominator,
  };
}

async function cropImageForOcr(imageUrl: string, quad: CropQuad) {
  const image = new Image();
  image.decoding = "async";
  image.src = imageUrl;
  await image.decode();

  const source = quad.map((point) => ({
    x: point.x * image.naturalWidth,
    y: point.y * image.naturalHeight,
  })) as CropQuad;
  const distance = (first: CropPoint, second: CropPoint) => Math.hypot(second.x - first.x, second.y - first.y);
  const naturalWidth = Math.max(1, Math.round((distance(source[0], source[1]) + distance(source[3], source[2])) / 2));
  const naturalHeight = Math.max(1, Math.round((distance(source[0], source[3]) + distance(source[1], source[2])) / 2));
  const scale = Math.min(1, 2400 / Math.max(naturalWidth, naturalHeight));
  const width = Math.max(1, Math.round(naturalWidth * scale));
  const height = Math.max(1, Math.round(naturalHeight * scale));
  const destination: CropQuad = [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: 0, y: height },
  ];
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas is unavailable.");
  context.fillStyle = "#fff";
  context.fillRect(0, 0, width, height);

  ([[0, 1, 2], [0, 2, 3]] as const).forEach((indexes) => {
    const sourceTriangle = indexes.map((index) => source[index]);
    const destinationTriangle = indexes.map((index) => destination[index]);
    const matrix = triangleTransform(sourceTriangle, destinationTriangle);
    context.save();
    context.beginPath();
    context.moveTo(destinationTriangle[0].x, destinationTriangle[0].y);
    context.lineTo(destinationTriangle[1].x, destinationTriangle[1].y);
    context.lineTo(destinationTriangle[2].x, destinationTriangle[2].y);
    context.closePath();
    context.clip();
    context.setTransform(matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f);
    context.drawImage(image, 0, 0);
    context.restore();
  });

  return canvas.toDataURL("image/jpeg", 0.9);
}

async function prepareFullImageForAi(imageUrl: string) {
  const image = new Image();
  image.decoding = "async";
  image.src = imageUrl;
  await image.decode();

  const scale = Math.min(1, 1800 / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas is unavailable.");
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.84);
}

function formatQwenRecipe(recipe: QwenRecipe, fallbackTitle: string): ParsedRecipe {
  const ingredients = recipe.ingredients
    .map((line) => line.replace(/^[-â€¢Â·]\s*/, "").trim())
    .filter(Boolean)
    .map((line, index) => ({ line, index, rank: ingredientRank(line) }))
    .sort((left, right) => left.rank - right.rank || left.index - right.index)
    .map(({ line }) => `- ${line}`)
    .join("\n");
  const steps = recipe.phases
    .filter((phase) => phase.steps?.length)
    .map((phase) => {
      const name = phase.name.trim() || "Zubereitung";
      return `${name}\n${phase.steps.map((step, index) => `${index + 1}. ${step.trim()}`).join("\n")}`;
    })
    .join("\n\n");

  return {
    title: recipe.title.trim() || fallbackTitle,
    ingredients: ingredients || "[Review and add the extracted ingredients]",
    steps: steps || "[Review and add the preparation steps]",
    servings: recipe.servings?.trim() || "",
    warning: recipe.warnings?.filter(Boolean).join(" ") || undefined,
  };
}

async function extractRecipeWithQwen(group: { number: number; images: BatchImage[] }) {
  const fallbackTitle = stripExtension(group.images[0]?.name ?? `Recipe ${group.number}`);
  const definedImages = group.images.filter((image) => image.ocrRegions).slice(0, 4);
  let titleImages: string[];
  let ingredientImages: string[];
  let stepImages: string[];

  if (definedImages.length) {
    titleImages = [await prepareFullImageForAi(definedImages[0].url)];
    ingredientImages = await Promise.all(
      definedImages.map((image) => cropImageForOcr(image.url, image.ocrRegions!.ingredients)),
    );
    stepImages = await Promise.all(
      definedImages.map((image) => cropImageForOcr(image.url, image.ocrRegions!.steps)),
    );
  } else {
    const fullImages = await Promise.all(group.images.slice(0, 4).map((image) => prepareFullImageForAi(image.url)));
    titleImages = fullImages.slice(0, 1);
    ingredientImages = fullImages;
    stepImages = fullImages;
  }

  const response = await fetch(RECIPE_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ titleImages, ingredientImages, stepImages }),
  });
  const payload = await response.json() as { recipe?: QwenRecipe; error?: string };
  if (!response.ok || !payload.recipe) {
    throw new Error(payload.error || "Qwen could not create the recipe draft.");
  }
  return formatQwenRecipe(payload.recipe, fallbackTitle);
}

function RegionEditor({
  image,
  onCancel,
  onSave,
}: {
  image: BatchImage;
  onCancel: () => void;
  onSave: (regions: OcrRegions) => void;
}) {
  const [phase, setPhase] = useState<keyof OcrRegions>("ingredients");
  const [regions, setRegions] = useState<OcrRegions>(() => copyRegions(image.ocrRegions ?? defaultOcrRegions));
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [onCancel]);

  function moveCorner(event: ReactPointerEvent<HTMLButtonElement>, cornerIndex: number) {
    if (!event.currentTarget.hasPointerCapture(event.pointerId) || !overlayRef.current) return;
    const bounds = overlayRef.current.getBoundingClientRect();
    const point = {
      x: Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width)),
      y: Math.min(1, Math.max(0, (event.clientY - bounds.top) / bounds.height)),
    };
    setRegions((current) => {
      const next = copyRegions(current);
      next[phase][cornerIndex] = point;
      return next;
    });
  }

  const activeQuad = regions[phase];
  const inactivePhase: keyof OcrRegions = phase === "ingredients" ? "steps" : "ingredients";
  const polygon = (quad: CropQuad) => quad.map((point) => `${point.x * 100},${point.y * 100}`).join(" ");

  return (
    <div className="region-editor" role="dialog" aria-modal="true" aria-label={`Define ${phase} region`}>
      <header className="region-editor__header">
        <div>
          <p className="eyebrow">Region {phase === "ingredients" ? "1" : "2"} of 2</p>
          <h2>Define {phase}</h2>
        </div>
        <button className="region-editor__close" type="button" onClick={onCancel} aria-label="Close region editor"><X /></button>
      </header>

      <div className="region-editor__canvas">
        <div className="region-editor__image-wrap">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={image.url} alt={image.name} draggable={false} />
          <div className="region-editor__overlay" ref={overlayRef}>
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
              <polygon className="region-editor__polygon region-editor__polygon--inactive" points={polygon(regions[inactivePhase])} />
              <polygon className={`region-editor__polygon region-editor__polygon--${phase}`} points={polygon(activeQuad)} />
            </svg>
            {activeQuad.map((point, index) => (
              <button
                className={`region-handle region-handle--${phase}`}
                style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%` }}
                type="button"
                key={`${phase}-${index}`}
                aria-label={`Move ${phase} corner ${index + 1}`}
                onPointerDown={(event) => event.currentTarget.setPointerCapture(event.pointerId)}
                onPointerMove={(event) => moveCorner(event, index)}
              ><span>{index + 1}</span></button>
            ))}
          </div>
        </div>
      </div>

      <footer className="region-editor__footer">
        <p>Drag all four corners around only the <strong>{phase}</strong> text.</p>
        <div className="region-editor__legend"><span className="is-ingredients" /> Ingredients <span className="is-steps" /> Steps</div>
        <div className="region-editor__actions">
          {phase === "steps" ? <button className="button region-editor__back" type="button" onClick={() => setPhase("ingredients")}><ChevronLeft size={18} /> Back</button> : <button className="button region-editor__back" type="button" onClick={onCancel}>Cancel</button>}
          {phase === "ingredients" ? (
            <button className="button button--primary" type="button" onClick={() => setPhase("steps")}>Next: steps <ChevronRight size={18} /></button>
          ) : (
            <button className="button button--primary" type="button" onClick={() => onSave(regions)}><Check size={18} /> Save regions</button>
          )}
        </div>
      </footer>
    </div>
  );
}

function ImagePreview({ image, onClose }: { image: PreviewImage; onClose: () => void }) {
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
      if (event.key === "+" || event.key === "=") setZoom((current) => Math.min(4, current + 0.5));
      if (event.key === "-") setZoom((current) => Math.max(1, current - 0.5));
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  return (
    <div
      className="image-preview"
      role="dialog"
      aria-modal="true"
      aria-label={`Preview ${image.name}`}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <header className="image-preview__header">
        <div>
          <p className="eyebrow">Image inspection</p>
          <strong>{image.name}</strong>
        </div>
        <button type="button" onClick={onClose} aria-label="Close full-screen image preview"><X size={24} /></button>
      </header>

      <div className="image-preview__viewport">
        <div
          className="image-preview__stage"
          style={{ width: `${zoom * 100}%`, height: `${zoom * 100}%` }}
          onDoubleClick={() => setZoom((current) => current === 1 ? 2 : 1)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={image.src} alt={image.alt} draggable={false} />
        </div>
      </div>

      <footer className="image-preview__controls">
        <button type="button" disabled={zoom <= 1} onClick={() => setZoom((current) => Math.max(1, current - 0.5))} aria-label="Zoom out"><ZoomOut size={20} /></button>
        <button className="image-preview__zoom-value" type="button" disabled={zoom === 1} onClick={() => setZoom(1)} aria-label="Reset zoom to fit">
          <Maximize2 size={17} /> {Math.round(zoom * 100)}%
        </button>
        <button type="button" disabled={zoom >= 4} onClick={() => setZoom((current) => Math.min(4, current + 0.5))} aria-label="Zoom in"><ZoomIn size={20} /></button>
        <span>Use +/− or double-click to zoom. Scroll to inspect.</span>
      </footer>
    </div>
  );
}

type UsageSummary = {
  model: string;
  tokens: { prompt: number; completion: number; total: number; requests: number; trackingStartedAt: string; updatedAt: string | null };
  cost: { total: number; today: number; week: number; month: number; tracked: number; limit: number | null; remaining: number | null; reset: string | null };
};

function formatUsd(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: value < 1 ? 4 : 2,
    maximumFractionDigits: value < 1 ? 4 : 2,
  }).format(value);
}

function UsageDashboard({ onBack }: { onBack: () => void }) {
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const loadUsage = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(USAGE_API_URL, {
        cache: "no-store",
        headers: { Authorization: `Bearer ${password}` },
      });
      const payload = await response.json() as UsageSummary & { error?: string };
      if (!response.ok) throw new Error(payload.error || "Usage data could not be loaded.");
      setUsage(payload);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Usage data could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [password]);

  if (!usage) {
    return (
      <section className="workspace dashboard-view dashboard-view--locked page-enter">
        <div className="dashboard-lock">
          <span className="usage-card__icon"><BarChart3 size={24} /></span>
          <p className="eyebrow">Private API dashboard</p>
          <h1>Unlock<br /><em>the numbers.</em></h1>
          <p>Enter the Recipe Press dashboard password. It is used only for this request and is not saved in your browser.</p>
          <form onSubmit={(event) => { event.preventDefault(); void loadUsage(); }}>
            <label className="field">
              <span>Dashboard password</span>
              <input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} autoFocus />
            </label>
            {error ? <div className="notice notice--error"><CircleAlert size={18} /><p>{error}</p></div> : null}
            <button className="button button--primary" type="submit" disabled={!password || loading}>
              {loading ? <><LoaderCircle className="spin" size={17} /> Checking…</> : <>Open dashboard <ChevronRight size={17} /></>}
            </button>
          </form>
          <button className="button button--ghost dashboard-back" type="button" onClick={onBack}><ArrowLeft size={17} /> Back to recipes</button>
        </div>
      </section>
    );
  }

  return (
    <section className="workspace dashboard-view page-enter">
      <div className="dashboard-heading">
        <div>
          <p className="eyebrow">API observatory</p>
          <h1>Usage,<br /><em>at a glance.</em></h1>
          <p>Live spending from OpenRouter, with persistent token tracking for Recipe Press.</p>
        </div>
        <button className="button button--secondary" type="button" onClick={() => void loadUsage()} disabled={loading}>
          <RefreshCw className={loading ? "spin" : ""} size={17} /> Refresh
        </button>
      </div>

      {error ? <div className="notice notice--error"><CircleAlert size={18} /><p>{error}</p></div> : null}

      <div className="usage-grid" aria-live="polite">
        <article className="usage-card usage-card--hero">
          <span className="usage-card__icon"><CircleDollarSign size={24} /></span>
          <p>Lifetime API spend</p>
          <strong>{usage ? formatUsd(usage.cost.total) : "—"}</strong>
          <small>Exact total reported by this OpenRouter API key</small>
        </article>
        <article className="usage-card usage-card--hero usage-card--acid">
          <span className="usage-card__icon"><BarChart3 size={24} /></span>
          <p>Tokens tracked</p>
          <strong>{usage ? new Intl.NumberFormat().format(usage.tokens.total) : "—"}</strong>
          <small>{usage ? `${usage.tokens.requests} AI request${usage.tokens.requests === 1 ? "" : "s"} since tracking began` : "Loading persistent counter"}</small>
        </article>
        <article className="usage-card"><p>Today</p><strong>{usage ? formatUsd(usage.cost.today) : "—"}</strong></article>
        <article className="usage-card"><p>This week</p><strong>{usage ? formatUsd(usage.cost.week) : "—"}</strong></article>
        <article className="usage-card"><p>This month</p><strong>{usage ? formatUsd(usage.cost.month) : "—"}</strong></article>
        <article className="usage-card"><p>Input tokens</p><strong>{usage ? new Intl.NumberFormat().format(usage.tokens.prompt) : "—"}</strong></article>
        <article className="usage-card"><p>Output tokens</p><strong>{usage ? new Intl.NumberFormat().format(usage.tokens.completion) : "—"}</strong></article>
        <article className="usage-card"><p>Tracked cost</p><strong>{usage ? formatUsd(usage.cost.tracked) : "—"}</strong></article>
      </div>

      <div className="usage-footnote">
        <div><span>Model</span><strong>{usage?.model || "Qwen 3.5"}</strong></div>
        <div><span>Token tracking began</span><strong>{usage ? new Date(usage.tokens.trackingStartedAt).toLocaleString() : "—"}</strong></div>
        <p>OpenRouter provides the exact lifetime cost for this key. Historical token totals were not available through the inference key, so the token counter starts from the date above.</p>
      </div>

      <button className="button button--ghost dashboard-back" type="button" onClick={onBack}><ArrowLeft size={17} /> Back to recipes</button>
    </section>
  );
}

export function RecipeImporter() {
  const [batchId, setBatchId] = useState<string | null>(null);
  const [flow, setFlow] = useState<FlowStep>("upload");
  const [images, setImages] = useState<BatchImage[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [imageIndex, setImageIndex] = useState(0);
  const [draftIndex, setDraftIndex] = useState(0);
  const [hydrated, setHydrated] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [undoDraft, setUndoDraft] = useState<string | null>(null);
  const [defineImageId, setDefineImageId] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState("");
  const [processingMessage, setProcessingMessage] = useState("Connecting securely to Qwen…");
  const [processingProgress, setProcessingProgress] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [notionResults, setNotionResults] = useState<NotionResult[]>([]);
  const [savedBatches, setSavedBatches] = useState<SavedBatchSummary[]>([]);
  const [previewImage, setPreviewImage] = useState<PreviewImage | null>(null);
  const [dashboardOpen, setDashboardOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;

    async function restore() {
      let index = readBatchIndex();
      const legacyRaw = localStorage.getItem(LEGACY_STORAGE_KEY);
      if (legacyRaw) {
        try {
          const legacyState = JSON.parse(legacyRaw) as PersistedState;
          const legacyId = crypto.randomUUID();
          localStorage.setItem(batchStorageKey(legacyId), JSON.stringify({ ...legacyState, notionResults: [] }));
          index = [summarizeBatch(legacyId, legacyState), ...index];
          writeBatchIndex(index);
        } catch {
          // Ignore invalid legacy state while keeping all newer saved sessions intact.
        }
        localStorage.removeItem(LEGACY_STORAGE_KEY);
      }
      setSavedBatches(index);

      if (window.location.hash === "#/dashboard") {
        setDashboardOpen(true);
        setHydrated(true);
        return;
      }

      const route = parseBatchRoute();
      if (!route) {
        setHydrated(true);
        return;
      }

      const raw = localStorage.getItem(batchStorageKey(route.id));
      if (!raw) {
        window.history.replaceState({}, "", publicAsset(""));
        setHydrated(true);
        return;
      }

      try {
        const saved = JSON.parse(raw) as PersistedState;
        const restored = await Promise.all(
          saved.images.map(async (image) => {
            if (image.samplePath) return { ...image, url: image.samplePath };
            const blob = await loadImageBlob(image.id);
            return blob ? { ...image, url: URL.createObjectURL(blob) } : null;
          }),
        );

        if (cancelled) return;
        const available = restored.filter((image): image is BatchImage => Boolean(image));
        setBatchId(route.id);
        setImages(available);
        setDrafts(saved.drafts ?? []);
        setNotionResults(saved.notionResults ?? []);
        setImageIndex(Math.min(saved.imageIndex ?? 0, Math.max(available.length - 1, 0)));
        setDraftIndex(Math.min(saved.draftIndex ?? 0, Math.max((saved.drafts?.length ?? 1) - 1, 0)));
        const restoredFlow = route.flow === "processing" ? "groups" : route.flow;
        setFlow(restoredFlow);
        if (restoredFlow !== route.flow) {
          window.history.replaceState({}, "", batchUrl(route.id, restoredFlow));
        }
      } catch {
        window.history.replaceState({}, "", publicAsset(""));
      } finally {
        if (!cancelled) setHydrated(true);
      }
    }

    restore();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!hydrated || !batchId) return;
    const state: PersistedState = {
      flow,
      images: images.map((image) => ({
        id: image.id,
        name: image.name,
        samplePath: image.samplePath,
        group: image.group,
        excluded: image.excluded,
        ocrRegions: image.ocrRegions,
      })),
      drafts,
      imageIndex,
      draftIndex,
      notionResults,
    };
    localStorage.setItem(batchStorageKey(batchId), JSON.stringify(state));
    const nextSummary = summarizeBatch(batchId, state);
    const nextIndex = [nextSummary, ...readBatchIndex().filter((entry) => entry.id !== batchId)]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    writeBatchIndex(nextIndex);
  }, [batchId, draftIndex, drafts, flow, hydrated, imageIndex, images, notionResults]);

  useEffect(() => {
    if (!hydrated) return;
    function handleHistoryNavigation() {
      if (window.location.hash === "#/dashboard") {
        setDashboardOpen(true);
        return;
      }
      setDashboardOpen(false);
      const route = parseBatchRoute();
      if (!route) {
        window.location.reload();
        return;
      }
      if (route.id !== batchId) {
        window.location.reload();
        return;
      }
      setFlow(route.flow === "processing" ? "groups" : route.flow);
    }
    window.addEventListener("popstate", handleHistoryNavigation);
    return () => window.removeEventListener("popstate", handleHistoryNavigation);
  }, [batchId, hydrated]);

  const assignedGroups = useMemo(
    () => [...new Set(images.filter((image) => !image.excluded && image.group).map((image) => image.group!))].sort((a, b) => a - b),
    [images],
  );

  const groups = useMemo(
    () =>
      assignedGroups.map((number) => ({
        number,
        images: images.filter((image) => !image.excluded && image.group === number),
      })),
    [assignedGroups, images],
  );

  const unresolvedCount = images.filter((image) => image.group === null && !image.excluded).length;
  const allAssigned = images.length > 0 && unresolvedCount === 0;
  const activeDraft = drafts[draftIndex];
  const remainingDrafts = drafts.filter((draft) => !draft.deleted);
  const completedDrafts = remainingDrafts.filter((draft) => draft.visited && draftIsComplete(draft));
  const canSubmit = remainingDrafts.length > 0 && completedDrafts.length === remainingDrafts.length;
  const defineImage = images.find((image) => image.id === defineImageId);

  function ensureBatch(nextFlow: FlowStep = flow) {
    if (batchId) return batchId;
    const nextId = crypto.randomUUID();
    setBatchId(nextId);
    window.history.pushState({}, "", batchUrl(nextId, nextFlow));
    return nextId;
  }

  function goToFlow(nextFlow: FlowStep, replace = false) {
    const activeBatchId = ensureBatch(nextFlow);
    setFlow(nextFlow);
    const nextUrl = batchUrl(activeBatchId, nextFlow);
    if (`${window.location.pathname}${window.location.hash}` === nextUrl) return;
    window.history[replace ? "replaceState" : "pushState"]({}, "", nextUrl);
  }

  function openFreshStart() {
    images.forEach((image) => {
      if (!image.samplePath) URL.revokeObjectURL(image.url);
    });
    setBatchId(null);
    setImages([]);
    setDrafts([]);
    setImageIndex(0);
    setDraftIndex(0);
    setNotionResults([]);
    setSubmitError("");
    setFlow("upload");
    setDashboardOpen(false);
    setSavedBatches(readBatchIndex());
    window.history.pushState({}, "", publicAsset(""));
  }

  function openDashboard() {
    setDashboardOpen(true);
    window.history.pushState({}, "", `${publicAsset("")}#/dashboard`);
  }

  function openSavedBatch(savedBatch: SavedBatchSummary) {
    window.location.assign(batchUrl(savedBatch.id, savedBatch.flow === "processing" ? "groups" : savedBatch.flow));
  }

  async function addFiles(files: File[]) {
    const accepted = files.filter((file) => file.type.startsWith("image/"));
    if (!accepted.length) return;
    ensureBatch("upload");
    const additions = accepted.map((file) => ({
      id: crypto.randomUUID(),
      name: file.name,
      url: URL.createObjectURL(file),
      group: null,
      excluded: false,
      file,
    }));

    await Promise.all(additions.map((image) => saveImageBlob(image.id, image.file)));
    setImages((current) => [
      ...current,
      ...additions.map((image) => ({
        id: image.id,
        name: image.name,
        url: image.url,
        group: image.group,
        excluded: image.excluded,
      })),
    ]);
  }

  async function onFilesSelected(event: ChangeEvent<HTMLInputElement>) {
    await addFiles(Array.from(event.target.files ?? []));
    event.target.value = "";
  }

  function loadSample() {
    const hadBatch = Boolean(batchId);
    const activeBatchId = ensureBatch("assign");
    setImages([
      {
        id: "sample-text",
        name: "Cookbook recipe page.jpeg",
        url: sampleRecipePath,
        samplePath: sampleRecipePath,
        group: null,
        excluded: false,
      },
      {
        id: "sample-dish",
        name: "Finished dish.jpeg",
        url: sampleDishPath,
        samplePath: sampleDishPath,
        group: null,
        excluded: false,
      },
    ]);
    setDrafts([]);
    setImageIndex(0);
    setFlow("assign");
    if (hadBatch) window.history.pushState({}, "", batchUrl(activeBatchId, "assign"));
  }

  async function removeImage(image: BatchImage) {
    if (!image.samplePath) {
      URL.revokeObjectURL(image.url);
      await deleteImageBlob(image.id);
    }
    setImages((current) => current.filter((item) => item.id !== image.id));
  }

  function startGrouping() {
    if (!images.length) return;
    setImageIndex(0);
    goToFlow("assign");
  }

  function findNextUnresolved(fromIndex: number, nextImages: BatchImage[]) {
    for (let offset = 1; offset <= nextImages.length; offset += 1) {
      const index = (fromIndex + offset) % nextImages.length;
      const image = nextImages[index];
      if (image.group === null && !image.excluded) return index;
    }
    return Math.min(fromIndex + 1, nextImages.length - 1);
  }

  function assignCurrent(group: number) {
    const currentImage = images[imageIndex];
    if (!currentImage) return;
    const nextImages = images.map((image) =>
      image.id === currentImage.id ? { ...image, group, excluded: false } : image,
    );
    setImages(nextImages);
    setImageIndex(findNextUnresolved(imageIndex, nextImages));
  }

  function excludeCurrent() {
    const currentImage = images[imageIndex];
    if (!currentImage) return;
    const nextImages = images.map((image) =>
      image.id === currentImage.id ? { ...image, group: null, excluded: true } : image,
    );
    setImages(nextImages);
    setImageIndex(findNextUnresolved(imageIndex, nextImages));
  }

  function saveOcrRegions(regions: OcrRegions) {
    if (!defineImageId) return;
    setImages((current) =>
      current.map((image) => image.id === defineImageId ? { ...image, ocrRegions: regions } : image),
    );
    setDefineImageId(null);
  }

  function createNewGroup() {
    const nextGroup = Math.max(0, ...assignedGroups) + 1;
    assignCurrent(nextGroup);
  }

  function moveImageToGroup(imageId: string, group: number) {
    setImages((current) =>
      current.map((image) =>
        image.id === imageId ? { ...image, group, excluded: false } : image,
      ),
    );
  }

  function moveWithinGroup(imageId: string, direction: -1 | 1) {
    setImages((current) => {
      const selected = current.find((image) => image.id === imageId);
      if (!selected?.group) return current;
      const indexes = current
        .map((image, index) => ({ image, index }))
        .filter(({ image }) => image.group === selected.group && !image.excluded)
        .map(({ index }) => index);
      const from = current.findIndex((image) => image.id === imageId);
      const position = indexes.indexOf(from);
      const target = indexes[position + direction];
      if (target === undefined) return current;
      const copy = [...current];
      [copy[from], copy[target]] = [copy[target], copy[from]];
      return copy;
    });
  }

  function buildDraft(group: { number: number; images: BatchImage[] }, parsed?: ParsedRecipe): Draft {
    const isSample = group.images.some((image) => image.id === "sample-text");
    const useSampleDefaults = isSample && !parsed;
    const firstTextName = group.images[0]?.name ?? `Recipe ${group.number}`;
    return {
      id: crypto.randomUUID(),
      group: group.number,
      title: useSampleDefaults ? "Linsen-Auberginen-Eintopf" : parsed?.title || stripExtension(firstTextName),
      courses: [],
      difficulty: "",
      servings: useSampleDefaults ? "2" : parsed?.servings || "",
      ingredients: useSampleDefaults ? sampleIngredients : parsed?.ingredients || "[Review and add the extracted ingredients]",
      steps: useSampleDefaults ? sampleSteps : parsed?.steps || "[Review and add the preparation steps]",
      visited: false,
      deleted: false,
      warning: useSampleDefaults ? "Offline sample shown; Qwen was not contacted." : parsed?.warning,
    };
  }

  async function createDrafts() {
    goToFlow("processing");
    setProcessingProgress(0);
    setProcessingMessage("Connecting securely to Qwen…");

    let nextDrafts: Draft[] = [];
    const sampleOnly = groups.every((group) =>
      group.images.some((image) => image.id === "sample-text" && !image.ocrRegions),
    );

    if (sampleOnly && !navigator.onLine) {
      await new Promise((resolve) => window.setTimeout(resolve, 650));
      nextDrafts = groups.map((group) => buildDraft(group));
      setProcessingProgress(1);
    } else {
      let worker: Awaited<ReturnType<(typeof import("tesseract.js"))["createWorker"]>> | undefined;
      try {
        for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
          const group = groups[groupIndex];
          setProcessingMessage(`Qwen is reading recipe ${groupIndex + 1} of ${groups.length}…`);
          let parsed: ParsedRecipe;

          try {
            parsed = await extractRecipeWithQwen(group);
          } catch {
            setProcessingMessage(`Qwen was unavailable. Using German browser OCR for recipe ${groupIndex + 1}…`);
            if (!worker) {
              const { createWorker, PSM } = await import("tesseract.js");
              worker = await createWorker(["deu"], 1, {
                logger(message) {
                  if (message.status === "recognizing text" && typeof message.progress === "number") {
                    setProcessingProgress(Math.min(0.96, message.progress));
                  }
                },
              });
              await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO });
            }

            const fallbackTitle = stripExtension(group.images[0]?.name ?? `Recipe ${group.number}`);
            const definedImages = group.images.filter((image) => image.ocrRegions);
            if (definedImages.length) {
              const ingredientPages: string[] = [];
              const stepPages: string[] = [];
              const confidences: number[] = [];

              for (const image of definedImages) {
                const ingredientsUrl = await cropImageForOcr(image.url, image.ocrRegions!.ingredients);
                const stepsUrl = await cropImageForOcr(image.url, image.ocrRegions!.steps);
                const ingredientResult = await worker.recognize(ingredientsUrl);
                const stepResult = await worker.recognize(stepsUrl);
                if (ingredientResult.data.text.trim()) ingredientPages.push(ingredientResult.data.text.trim());
                if (stepResult.data.text.trim()) stepPages.push(stepResult.data.text.trim());
                confidences.push(ingredientResult.data.confidence ?? 0, stepResult.data.confidence ?? 0);
              }

              const titleResult = await worker.recognize(definedImages[0].url);
              const title = parseRecipeText(titleResult.data.text, fallbackTitle, titleResult.data.confidence ?? 0).title;
              const ingredients = formatDefinedIngredients(ingredientPages.join("\n"));
              const steps = formatDefinedSteps(stepPages.join("\n"));
              const averageConfidence = confidences.length
                ? confidences.reduce((total, value) => total + value, 0) / confidences.length
                : 0;
              const warnings = ["Qwen was unavailable, so German browser OCR was used. Verify quantities and column order."];
              if (averageConfidence < 62) warnings.push("OCR confidence is low, so this draft needs extra checking.");
              parsed = {
                title,
                ingredients: ingredients || "[Review and add the extracted ingredients]",
                steps: steps || "[Review and add the preparation steps]",
                warning: warnings.join(" "),
              };
            } else {
              const pages: string[] = [];
              const confidences: number[] = [];
              for (const image of group.images) {
                const result = await worker.recognize(image.url);
                const text = result.data.text.trim();
                if (text.length >= 12) {
                  pages.push(text);
                  confidences.push(result.data.confidence ?? 0);
                }
              }
              const averageConfidence = confidences.length
                ? confidences.reduce((total, value) => total + value, 0) / confidences.length
                : 0;
              parsed = parseRecipeText(pages.join("\n\n"), fallbackTitle, averageConfidence);
              parsed.warning = `Qwen was unavailable, so German browser OCR was used. ${parsed.warning || ""}`.trim();
            }
          }

          nextDrafts.push(buildDraft(group, parsed));
          setProcessingProgress((groupIndex + 1) / groups.length);
        }
      } catch {
        nextDrafts = groups.map((group) =>
          buildDraft(group, {
            title: stripExtension(group.images[0]?.name ?? `Recipe ${group.number}`),
            ingredients: "[Review and add the extracted ingredients]",
            steps: "[Review and add the preparation steps]",
            warning: "Neither Qwen nor the browser OCR could create this draft. Check your connection and try again.",
          }),
        );
      } finally {
        await worker?.terminate();
      }
    }

    setProcessingMessage("Preparing the review…");
    window.setTimeout(() => {
      if (nextDrafts[0]) nextDrafts[0].visited = true;
      setDrafts(nextDrafts);
      setDraftIndex(0);
      setDetailsOpen(false);
      goToFlow("review");
    }, 250);
  }

  function updateDraft(patch: Partial<Draft>) {
    if (!activeDraft) return;
    setDrafts((current) =>
      current.map((draft, index) => (index === draftIndex ? { ...draft, ...patch } : draft)),
    );
    setSubmitError("");
  }

  function toggleCourse(course: string) {
    if (!activeDraft) return;
    const courses = activeDraft.courses.includes(course)
      ? activeDraft.courses.filter((item) => item !== course)
      : [...activeDraft.courses, course];
    updateDraft({ courses });
  }

  function navigateDraft(direction: -1 | 1) {
    if (!activeDraft) return;
    updateDraft({ visited: true });
    let index = draftIndex;
    for (let count = 0; count < drafts.length; count += 1) {
      index = (index + direction + drafts.length) % drafts.length;
      if (!drafts[index].deleted) {
        setDraftIndex(index);
        setDrafts((current) =>
          current.map((draft, draftPosition) =>
            draftPosition === index ? { ...draft, visited: true } : draft,
          ),
        );
        setDetailsOpen(false);
        return;
      }
    }
  }

  function confirmDelete() {
    if (!deleteTarget) return;
    const targetIndex = drafts.findIndex((draft) => draft.id === deleteTarget);
    setDrafts((current) =>
      current.map((draft) => (draft.id === deleteTarget ? { ...draft, deleted: true } : draft)),
    );
    setUndoDraft(deleteTarget);
    setDeleteTarget(null);

    const nextIndex = drafts.findIndex((draft, index) => index > targetIndex && !draft.deleted);
    const previousIndex = [...drafts]
      .map((draft, index) => ({ draft, index }))
      .reverse()
      .find(({ draft, index }) => index < targetIndex && !draft.deleted)?.index;
    setDraftIndex(nextIndex >= 0 ? nextIndex : previousIndex ?? targetIndex);
  }

  function undoDelete() {
    if (!undoDraft) return;
    const restoredIndex = drafts.findIndex((draft) => draft.id === undoDraft);
    setDrafts((current) =>
      current.map((draft) => (draft.id === undoDraft ? { ...draft, deleted: false } : draft)),
    );
    setDraftIndex(Math.max(0, restoredIndex));
    setUndoDraft(null);
  }

  async function submitBatch() {
    setDrafts((current) => current.map((draft) => (draft.deleted ? draft : { ...draft, visited: true })));
    const firstInvalid = drafts.findIndex((draft) => !draft.deleted && !draftIsComplete(draft));
    if (firstInvalid >= 0) {
      setDraftIndex(firstInvalid);
      setSubmitError("Complete the highlighted fields before submitting this batch.");
      return;
    }
    setSubmitError("");
    setIsSubmitting(true);
    try {
      const imported = [...notionResults];
      for (const draft of remainingDrafts) {
        if (imported.some((result) => result.draftId === draft.id)) continue;
        const group = groups.find((item) => item.number === draft.group);
        const dishImage = [...(group?.images || [])].reverse().find((image) => !image.ocrRegions);
        const imageDataUrl = dishImage ? await prepareFullImageForAi(dishImage.url) : undefined;
        const response = await fetch(NOTION_IMPORT_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            recipe: {
              title: draft.title,
              courses: draft.courses,
              difficulty: draft.difficulty,
              servings: draft.servings,
              ingredients: draft.ingredients,
              steps: draft.steps,
              imageDataUrl,
            },
          }),
        });
        const payload = await response.json() as { page?: { title: string; url: string }; error?: string };
        if (!response.ok || !payload.page) {
          throw new Error(payload.error || `Notion could not import ${draft.title}.`);
        }
        imported.push({ draftId: draft.id, title: payload.page.title, url: payload.page.url });
        setNotionResults([...imported]);
      }
      goToFlow("results");
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "The batch could not be imported into Notion.");
    } finally {
      setIsSubmitting(false);
    }
  }

  function startNewBatch() {
    openFreshStart();
  }

  if (!hydrated) {
    return (
      <main className="app-shell app-shell--centered">
        <LoaderCircle className="spin" aria-hidden="true" />
        <p>Opening your workbench…</p>
      </main>
    );
  }

  const activeStep = activeWorkflowIndex(flow);
  const railImage = images[imageIndex]?.url ?? sampleDishPath;
  const railPhase = dashboardOpen ? "API dashboard" : ["Collect", "Pair", "Refine", "Archive"][activeStep];

  return (
    <main className="app-shell">
      <aside className={`editorial-rail editorial-rail--${dashboardOpen ? "dashboard" : flow}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={railImage} alt="" />
        <div className="editorial-rail__veil" />
        <div className="editorial-rail__copy">
          <span>Private cookbook archive</span>
          <h2>Recipe<br /><em>Press</em></h2>
          <p>{dashboardOpen ? railPhase : `${String(activeStep + 1).padStart(2, "0")} / 04 — ${railPhase}`}</p>
        </div>
        <div className="editorial-rail__issue">
          <span>VOL. 01</span>
          <button type="button" className={dashboardOpen ? "is-active" : ""} onClick={openDashboard}>Dashboard</button>
        </div>
      </aside>

      <header className="topbar">
        <button className="brand" type="button" onClick={openFreshStart} aria-label="Recipe Press home">
          <span className="brand-mark" aria-hidden="true">R/P</span>
          <span>Recipe Press</span>
        </button>
        {!dashboardOpen && flow !== "upload" && flow !== "results" ? (
          <span className="save-state"><CircleCheck size={16} /> Saved locally</span>
        ) : null}
      </header>

      {!dashboardOpen ? <nav className="workflow" aria-label="Import progress">
        {workflow.map((step, index) => (
          <div className={`workflow-step ${index === activeStep ? "is-active" : ""} ${index < activeStep ? "is-done" : ""}`} key={step.key}>
            <span>{index < activeStep ? <Check size={14} /> : index + 1}</span>
            <p>{step.label}</p>
          </div>
        ))}
      </nav> : null}

      {dashboardOpen ? <UsageDashboard onBack={openFreshStart} /> : null}

      {!dashboardOpen && flow === "upload" ? (
        <section className="workspace upload-view page-enter">
          <div className="section-heading">
            <p className="eyebrow">New cookbook batch</p>
            <h1>Add the pages.<br /><em>Build the recipe.</em></h1>
            <p>Collect recipe pages and finished-dish photos from this session, then pair them before anything is prepared.</p>
          </div>

          <div
            className={`dropzone ${dragging ? "is-dragging" : ""}`}
            onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              void addFiles(Array.from(event.dataTransfer.files));
            }}
          >
            <div className="dropzone-icon"><ImagePlus size={30} /></div>
            <h2>{images.length ? `${images.length} photo${images.length === 1 ? "" : "s"} ready` : "Add cookbook photos"}</h2>
            <p>Choose several images at once, take new photos, or drop them here.</p>
            <div className="dropzone-actions">
              <button className="button button--primary" type="button" onClick={() => fileInput.current?.click()}>
                <Upload size={18} /> Choose photos
              </button>
              <button className="button button--secondary" type="button" onClick={loadSample}>
                <Sparkles size={18} /> Try sample batch
              </button>
            </div>
            <input ref={fileInput} className="sr-only" type="file" accept="image/*" multiple onChange={onFilesSelected} />
          </div>

          {images.length ? (
            <div className="upload-strip" aria-label="Uploaded images">
              {images.map((image, index) => (
                <figure className="upload-thumb" key={image.id}>
                  <button className="upload-thumb__preview" type="button" onClick={() => setPreviewImage({ src: image.url, alt: `Uploaded image ${index + 1}`, name: image.name })} aria-label={`Preview uploaded image ${index + 1} full screen`}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={image.url} alt={`Uploaded image ${index + 1}`} />
                  </button>
                  <figcaption>{index + 1}</figcaption>
                  <button className="upload-thumb__remove" type="button" onClick={() => void removeImage(image)} aria-label={`Remove image ${index + 1}`}><X size={15} /></button>
                </figure>
              ))}
            </div>
          ) : null}

          {!batchId && savedBatches.length ? (
            <section className="saved-batches" aria-labelledby="saved-batches-title">
              <div className="saved-batches__heading">
                <div>
                  <p className="eyebrow">Saved locally on this device</p>
                  <h2 id="saved-batches-title">Previous sessions</h2>
                </div>
                <span>{savedBatches.length}</span>
              </div>
              <div className="saved-batches__list">
                {savedBatches.map((savedBatch) => (
                  <button type="button" key={savedBatch.id} onClick={() => openSavedBatch(savedBatch)}>
                    <span className="saved-batches__icon">
                      {savedBatch.importedCount ? <CircleCheck size={20} /> : <FileText size={20} />}
                    </span>
                    <span className="saved-batches__copy">
                      <strong>{savedBatch.title}</strong>
                      <small>{formatSavedBatchDate(savedBatch.updatedAt)} · {savedBatchLabel(savedBatch)}</small>
                    </span>
                    <ChevronRight size={20} aria-hidden="true" />
                  </button>
                ))}
              </div>
            </section>
          ) : null}

          <div className="view-footer">
            <p>{images.length ? "Next: assign each image to a recipe number." : "JPG, PNG, WebP, and phone photos"}</p>
            <button className="button button--primary button--large" type="button" disabled={!images.length} onClick={startGrouping}>
              Start grouping
            </button>
          </div>
        </section>
      ) : null}

      {!dashboardOpen && flow === "assign" && images[imageIndex] ? (
        <section className="workspace assign-view page-enter">
          <div className="compact-heading">
            <div>
              <p className="eyebrow">Assign recipe</p>
              <h1>Image {imageIndex + 1} of {images.length}</h1>
            </div>
            <div className="assignment-status"><strong>{images.length - unresolvedCount}</strong> / {images.length} assigned</div>
          </div>

          <div className="progress-track" aria-label={`${images.length - unresolvedCount} of ${images.length} assigned`}>
            <span style={{ width: `${((images.length - unresolvedCount) / images.length) * 100}%` }} />
          </div>

          <div className="image-stage">
            <button className="stage-arrow stage-arrow--left" type="button" onClick={() => setImageIndex((imageIndex - 1 + images.length) % images.length)} aria-label="Previous image">
              <ChevronLeft />
            </button>
            <figure className={images[imageIndex].excluded ? "is-excluded" : ""}>
              <button className="stage-preview-trigger" type="button" onClick={() => setPreviewImage({ src: images[imageIndex].url, alt: images[imageIndex].name, name: images[imageIndex].name })} aria-label={`Preview ${images[imageIndex].name} full screen`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={images[imageIndex].url} alt={images[imageIndex].name} />
                <span><Maximize2 size={17} /> Enlarge</span>
              </button>
              {images[imageIndex].excluded ? <figcaption>Excluded</figcaption> : null}
            </figure>
            <button className="stage-arrow stage-arrow--right" type="button" onClick={() => setImageIndex((imageIndex + 1) % images.length)} aria-label="Next image">
              <ChevronRight />
            </button>
          </div>

          <div className="group-picker">
            <p>Which recipe does this belong to?</p>
            <div className="group-picker__actions">
              <div className="group-buttons">
                {(assignedGroups.length ? assignedGroups : [1]).map((group) => {
                  const count = images.filter((image) => image.group === group && !image.excluded).length;
                  const selected = images[imageIndex].group === group && !images[imageIndex].excluded;
                  return (
                    <button className={selected ? "is-selected" : ""} type="button" key={group} onClick={() => assignCurrent(group)} aria-pressed={selected}>
                      <strong>{group}</strong>{count ? <small>{count}</small> : null}
                    </button>
                  );
                })}
                {assignedGroups.length ? (
                  <button className="group-new" type="button" onClick={createNewGroup}><Plus size={20} /><span>New</span></button>
                ) : null}
              </div>
              <button
                className={`define-button ${images[imageIndex].ocrRegions ? "is-defined" : ""}`}
                type="button"
                onClick={() => setDefineImageId(images[imageIndex].id)}
              >
                {images[imageIndex].ocrRegions ? <Check size={17} /> : <Crop size={17} />}
                {images[imageIndex].ocrRegions ? "Defined" : "Define"}
              </button>
            </div>
            <button className={`exclude-button ${images[imageIndex].excluded ? "is-selected" : ""}`} type="button" onClick={excludeCurrent}>
              <X size={17} /> {images[imageIndex].excluded ? "Excluded" : "Exclude this image"}
            </button>
          </div>

          <div className="view-footer">
            <button className="button button--ghost" type="button" onClick={() => goToFlow("upload")}>Back to upload</button>
            <button className="button button--primary button--large" type="button" disabled={!allAssigned || !assignedGroups.length} onClick={() => goToFlow("groups")}>
              Review {assignedGroups.length || ""} group{assignedGroups.length === 1 ? "" : "s"}
            </button>
          </div>
        </section>
      ) : null}

      {!dashboardOpen && flow === "groups" ? (
        <section className="workspace groups-view page-enter">
          <div className="section-heading section-heading--compact">
            <p className="eyebrow">Check the pairings</p>
            <h1>{groups.length} recipe group{groups.length === 1 ? "" : "s"}</h1>
            <p>Images with the same number become one recipe. Reorder multi-page text from left to right.</p>
          </div>

          <div className="group-review-list">
            {groups.map((group) => (
              <article className="group-card" key={group.number}>
                <header>
                  <span className="group-number">{group.number}</span>
                  <div><h2>Recipe {group.number}</h2><p>{group.images.length} image{group.images.length === 1 ? "" : "s"}</p></div>
                  {group.images.length === 1 ? <span className="soft-badge">Text-only is okay</span> : <span className="soft-badge soft-badge--good"><Check size={14} /> Ready</span>}
                </header>
                <div className="group-thumbnails">
                  {group.images.map((image, index) => (
                    <div className="group-thumbnail" key={image.id}>
                      <button className="group-thumbnail__preview" type="button" onClick={() => setPreviewImage({ src: image.url, alt: `${image.name}, position ${index + 1}`, name: image.name })} aria-label={`Preview ${image.name} full screen`}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={image.url} alt={`${image.name}, position ${index + 1}`} />
                      </button>
                      <span>{index + 1}</span>
                      <div className="thumbnail-tools">
                        <button type="button" disabled={index === 0} onClick={() => moveWithinGroup(image.id, -1)} aria-label="Move image left"><ChevronLeft size={15} /></button>
                        <button type="button" disabled={index === group.images.length - 1} onClick={() => moveWithinGroup(image.id, 1)} aria-label="Move image right"><ChevronRight size={15} /></button>
                      </div>
                      <label>
                        <span className="sr-only">Move {image.name} to recipe</span>
                        <select value={group.number} onChange={(event) => moveImageToGroup(image.id, Number(event.target.value))}>
                          {assignedGroups.map((number) => <option value={number} key={number}>Recipe {number}</option>)}
                        </select>
                      </label>
                    </div>
                  ))}
                </div>
              </article>
            ))}
          </div>

          <div className="view-footer">
            <button className="button button--ghost" type="button" onClick={() => goToFlow("assign")}>Change assignments</button>
            <button className="button button--primary button--large" type="button" onClick={() => void createDrafts()}><Sparkles size={18} /> Create drafts</button>
          </div>
        </section>
      ) : null}

      {!dashboardOpen && flow === "processing" ? (
        <section className="workspace processing-view page-enter" aria-live="polite">
          <div className="processing-mark"><FileText size={35} /><Sparkles size={19} /></div>
          <p className="eyebrow">Creating {groups.length} draft{groups.length === 1 ? "" : "s"}</p>
          <h1>Reading the cookbook pages…</h1>
          <p>{processingMessage} Your selected recipe regions are processed through the private API connection.</p>
          <div className="processing-bar" role="progressbar" aria-label="Recipe extraction progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(processingProgress * 100)}>
            <span style={{ width: `${Math.max(8, processingProgress * 100)}%` }} />
          </div>
        </section>
      ) : null}

      {!dashboardOpen && flow === "review" && activeDraft ? (
        <section className="workspace review-view page-enter">
          <div className="review-topline">
            <div>
              <p className="eyebrow">Recipe {draftIndex + 1} of {drafts.length}</p>
              <span className={`draft-state ${draftIsComplete(activeDraft) ? "is-complete" : ""}`}>
                {draftIsComplete(activeDraft) ? <><CircleCheck size={15} /> Complete</> : <><CircleAlert size={15} /> Needs review</>}
              </span>
            </div>
            <button className="delete-button" type="button" onClick={() => setDeleteTarget(activeDraft.id)}><Trash2 size={17} /> Delete</button>
          </div>

          {activeDraft.warning ? <div className="notice"><CircleAlert size={18} /><p>{activeDraft.warning}</p></div> : null}
          {submitError ? <div className="notice notice--error"><CircleAlert size={18} /><p>{submitError}</p></div> : null}

          <div className="review-form">
            <label className="field field--title">
              <span>Recipe title</span>
              <input value={activeDraft.title} onChange={(event) => updateDraft({ title: event.target.value })} placeholder="Recipe name" />
            </label>

            <fieldset className="field-group">
              <legend>Course <em>Choose one or more</em></legend>
              <div className="choice-grid">
                {courseOptions.map((course) => {
                  const selected = activeDraft.courses.includes(course);
                  return (
                    <button type="button" className={selected ? "is-selected" : ""} key={course} onClick={() => toggleCourse(course)} aria-pressed={selected}>
                      <span className="choice-marker" aria-hidden="true">{selected ? <Check size={15} /> : null}</span>
                      <span>{course}</span>
                    </button>
                  );
                })}
              </div>
            </fieldset>

            <fieldset className="field-group">
              <legend>Difficulty <em>Choose one</em></legend>
              <div className="segmented-control">
                {(["Daily", "Special"] as const).map((difficulty) => (
                  <button type="button" key={difficulty} className={activeDraft.difficulty === difficulty ? "is-selected" : ""} onClick={() => updateDraft({ difficulty })} aria-pressed={activeDraft.difficulty === difficulty}>
                    <span className="choice-marker" aria-hidden="true">{activeDraft.difficulty === difficulty ? <Check size={15} /> : null}</span>
                    <span>{difficulty}</span>
                  </button>
                ))}
              </div>
            </fieldset>

            <label className="field">
              <span>Servings <em>Notion property</em></span>
              <input inputMode="numeric" value={activeDraft.servings} onChange={(event) => updateDraft({ servings: event.target.value })} />
            </label>

            <label className="field">
              <span>Ingredients <em>Notion property</em></span>
              <textarea className="ingredients-editor" value={activeDraft.ingredients} onChange={(event) => updateDraft({ ingredients: event.target.value, warning: undefined })} />
            </label>

            <label className="field">
              <span>Steps <em>Notion property</em></span>
              <textarea className="steps-editor" value={activeDraft.steps} onChange={(event) => updateDraft({ steps: event.target.value, warning: undefined })} />
            </label>
          </div>

          <div className="recipe-dots" aria-label="Recipe review status">
            {drafts.map((draft, index) => (
              <button type="button" key={draft.id} onClick={() => { setDraftIndex(index); setDrafts((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, visited: true } : item)); }} className={`${index === draftIndex ? "is-active" : ""} ${draft.deleted ? "is-deleted" : ""} ${draft.visited && draftIsComplete(draft) ? "is-complete" : ""}`} aria-label={`Open recipe ${index + 1}`}>
                {index + 1}
              </button>
            ))}
          </div>

          <div className="review-actions">
            <button className="button button--secondary" type="button" disabled={remainingDrafts.length < 2} onClick={() => navigateDraft(-1)}>Prev</button>
            <button className="button button--secondary" type="button" disabled={remainingDrafts.length < 2} onClick={() => navigateDraft(1)}>Next</button>
            <button className="button button--primary button--submit" type="button" disabled={!canSubmit || isSubmitting} onClick={() => void submitBatch()}>
              {isSubmitting ? <><LoaderCircle className="spin" size={18} /> Importing…</> : <>Submit {canSubmit ? remainingDrafts.length : `${completedDrafts.length}/${remainingDrafts.length}`}</>}
            </button>
          </div>
        </section>
      ) : null}

      {!dashboardOpen && flow === "results" ? (
        <section className="workspace results-view page-enter">
          <div className="result-seal"><Check size={34} /></div>
          <p className="eyebrow">Batch complete</p>
          <h1>{notionResults.length} recipe{notionResults.length === 1 ? " is" : "s are"} now in Notion</h1>
          <p>The reviewed recipes were created in Recipe Book TEST. Open a recipe below to verify its properties and finished-dish image.</p>

          <div className="result-list">
            {notionResults.map((result) => {
              const draft = drafts.find((item) => item.id === result.draftId);
              return <article key={result.draftId}>
                <span><CircleCheck size={18} /></span>
                <div><h2>{result.title}</h2><p>{draft?.courses.join(" · ")} · {draft?.difficulty}</p></div>
                <a href={result.url} target="_blank" rel="noreferrer">Open in Notion</a>
              </article>;
            })}
          </div>

          <div className="connection-note">
            <CircleCheck size={20} />
            <div><strong>Imported successfully</strong><p>Finished-dish photos are stored in Notion and used as the first page block whenever an image was available.</p></div>
          </div>

          <button className="button button--primary button--large" type="button" onClick={startNewBatch}><RotateCcw size={18} /> Start another batch</button>
        </section>
      ) : null}

      {defineImage ? (
        <RegionEditor image={defineImage} onCancel={() => setDefineImageId(null)} onSave={saveOcrRegions} />
      ) : null}

      {previewImage ? <ImagePreview image={previewImage} onClose={() => setPreviewImage(null)} /> : null}

      {deleteTarget ? (
        <div className="dialog-backdrop" role="presentation" onMouseDown={() => setDeleteTarget(null)}>
          <div className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="delete-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="dialog-icon"><Trash2 size={22} /></div>
            <h2 id="delete-title">Delete this recipe draft?</h2>
            <p>It will be removed from this upload session. Your original photos are not deleted.</p>
            <div>
              <button className="button button--secondary" type="button" onClick={() => setDeleteTarget(null)}>Cancel</button>
              <button className="button button--danger" type="button" onClick={confirmDelete}>Delete draft</button>
            </div>
          </div>
        </div>
      ) : null}

      {undoDraft ? (
        <div className="undo-toast" role="status">
          <span>Recipe deleted</span>
          <button type="button" onClick={undoDelete}>Undo</button>
          <button type="button" aria-label="Dismiss" onClick={() => setUndoDraft(null)}><X size={16} /></button>
        </div>
      ) : null}
    </main>
  );
}
