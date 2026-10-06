"use client";

import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  FileText,
  ImagePlus,
  LoaderCircle,
  Plus,
  RotateCcw,
  Sparkles,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  clearImageBlobs,
  deleteImageBlob,
  loadImageBlob,
  saveImageBlob,
} from "@/lib/local-batch-store";

type FlowStep = "upload" | "assign" | "groups" | "processing" | "review" | "results";

type BatchImage = {
  id: string;
  name: string;
  url: string;
  samplePath?: string;
  group: number | null;
  excluded: boolean;
};

type Draft = {
  id: string;
  group: number;
  title: string;
  courses: string[];
  difficulty: "" | "Daily" | "Special";
  ingredients: string;
  steps: string;
  cookingTime: string;
  servings: string;
  comment: string;
  link: string;
  visited: boolean;
  deleted: boolean;
  warning?: string;
};

type PersistedState = {
  flow: FlowStep;
  images: Omit<BatchImage, "url">[];
  drafts: Draft[];
  imageIndex: number;
  draftIndex: number;
};

const STORAGE_KEY = "recipe-press:batch:v1";
const PUBLIC_BASE = import.meta.env.BASE_URL || "/";

function publicAsset(path: string) {
  return `${PUBLIC_BASE.endsWith("/") ? PUBLIC_BASE : `${PUBLIC_BASE}/`}${path.replace(/^\//, "")}`;
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
  warning?: string;
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

export function RecipeImporter() {
  const [flow, setFlow] = useState<FlowStep>("upload");
  const [images, setImages] = useState<BatchImage[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [imageIndex, setImageIndex] = useState(0);
  const [draftIndex, setDraftIndex] = useState(0);
  const [hydrated, setHydrated] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [undoDraft, setUndoDraft] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState("");
  const [processingMessage, setProcessingMessage] = useState("Preparing the OCR reader…");
  const [processingProgress, setProcessingProgress] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;

    async function restore() {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
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
        setImages(available);
        setDrafts(saved.drafts ?? []);
        setImageIndex(Math.min(saved.imageIndex ?? 0, Math.max(available.length - 1, 0)));
        setDraftIndex(Math.min(saved.draftIndex ?? 0, Math.max((saved.drafts?.length ?? 1) - 1, 0)));
        setFlow(saved.flow === "processing" ? "groups" : saved.flow);
      } catch {
        localStorage.removeItem(STORAGE_KEY);
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
    if (!hydrated) return;
    const state: PersistedState = {
      flow,
      images: images.map((image) => ({
        id: image.id,
        name: image.name,
        samplePath: image.samplePath,
        group: image.group,
        excluded: image.excluded,
      })),
      drafts,
      imageIndex,
      draftIndex,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [draftIndex, drafts, flow, hydrated, imageIndex, images]);

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

  async function addFiles(files: File[]) {
    const accepted = files.filter((file) => file.type.startsWith("image/"));
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
    setFlow("assign");
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
    const firstTextName = group.images[0]?.name ?? `Recipe ${group.number}`;
    return {
      id: crypto.randomUUID(),
      group: group.number,
      title: isSample ? "Linsen-Auberginen-Eintopf" : parsed?.title || stripExtension(firstTextName),
      courses: [],
      difficulty: "",
      ingredients: isSample ? sampleIngredients : parsed?.ingredients || "[Review and add the extracted ingredients]",
      steps: isSample ? sampleSteps : parsed?.steps || "[Review and add the preparation steps]",
      cookingTime: isSample ? "Gesamtzeit: ca. 1 Std." : "",
      servings: isSample ? "2" : "",
      comment: isSample
        ? "Für 4 Personen als Vorspeise oder Beilage, für 2 Personen als Hauptgericht."
        : "",
      link: "",
      visited: false,
      deleted: false,
      warning: isSample ? undefined : parsed?.warning,
    };
  }

  async function createDrafts() {
    setFlow("processing");
    setProcessingProgress(0);
    setProcessingMessage("Preparing the OCR reader…");

    let nextDrafts: Draft[] = [];
    const sampleOnly = groups.every((group) => group.images.some((image) => image.id === "sample-text"));

    if (sampleOnly) {
      await new Promise((resolve) => window.setTimeout(resolve, 650));
      nextDrafts = groups.map((group) => buildDraft(group));
      setProcessingProgress(1);
    } else {
      let worker: Awaited<ReturnType<(typeof import("tesseract.js"))["createWorker"]>> | undefined;
      try {
        const { createWorker } = await import("tesseract.js");
        worker = await createWorker(["eng", "deu"], 1, {
          logger(message) {
            if (message.status === "recognizing text" && typeof message.progress === "number") {
              setProcessingProgress(Math.min(0.96, message.progress));
            }
          },
        });

        for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
          const group = groups[groupIndex];
          setProcessingMessage(`Reading recipe ${groupIndex + 1} of ${groups.length}…`);
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

          const rawText = pages.join("\n\n");
          const averageConfidence = confidences.length
            ? confidences.reduce((total, value) => total + value, 0) / confidences.length
            : 0;
          const fallbackTitle = stripExtension(group.images[0]?.name ?? `Recipe ${group.number}`);
          const parsed = parseRecipeText(rawText, fallbackTitle, averageConfidence);
          nextDrafts.push(buildDraft(group, parsed));
          setProcessingProgress((groupIndex + 1) / groups.length);
        }
      } catch {
        nextDrafts = groups.map((group) =>
          buildDraft(group, {
            title: stripExtension(group.images[0]?.name ?? `Recipe ${group.number}`),
            ingredients: "[Review and add the extracted ingredients]",
            steps: "[Review and add the preparation steps]",
            warning: "OCR could not start. Check your connection and try creating the drafts again.",
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
      setFlow("review");
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

  function submitBatch() {
    setDrafts((current) => current.map((draft) => (draft.deleted ? draft : { ...draft, visited: true })));
    const firstInvalid = drafts.findIndex((draft) => !draft.deleted && !draftIsComplete(draft));
    if (firstInvalid >= 0) {
      setDraftIndex(firstInvalid);
      setSubmitError("Complete the highlighted fields before submitting this batch.");
      return;
    }
    setSubmitError("");
    setFlow("results");
  }

  async function startNewBatch() {
    images.forEach((image) => {
      if (!image.samplePath) URL.revokeObjectURL(image.url);
    });
    await clearImageBlobs();
    localStorage.removeItem(STORAGE_KEY);
    setImages([]);
    setDrafts([]);
    setImageIndex(0);
    setDraftIndex(0);
    setFlow("upload");
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
  const railPhase = ["Collect", "Pair", "Refine", "Archive"][activeStep];

  return (
    <main className="app-shell">
      <aside className={`editorial-rail editorial-rail--${flow}`} aria-hidden="true">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={railImage} alt="" />
        <div className="editorial-rail__veil" />
        <div className="editorial-rail__copy">
          <span>Private cookbook archive</span>
          <h2>Recipe<br /><em>Press</em></h2>
          <p>{String(activeStep + 1).padStart(2, "0")} / 04 — {railPhase}</p>
        </div>
        <div className="editorial-rail__issue">VOL. 01</div>
      </aside>

      <header className="topbar">
        <button className="brand" type="button" onClick={() => setFlow("upload")} aria-label="Recipe Press home">
          <span className="brand-mark" aria-hidden="true">R/P</span>
          <span>Recipe Press</span>
        </button>
        {flow !== "upload" && flow !== "results" ? (
          <span className="save-state"><CircleCheck size={16} /> Saved locally</span>
        ) : null}
      </header>

      <nav className="workflow" aria-label="Import progress">
        {workflow.map((step, index) => (
          <div className={`workflow-step ${index === activeStep ? "is-active" : ""} ${index < activeStep ? "is-done" : ""}`} key={step.key}>
            <span>{index < activeStep ? <Check size={14} /> : index + 1}</span>
            <p>{step.label}</p>
          </div>
        ))}
      </nav>

      {flow === "upload" ? (
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
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={image.url} alt={`Uploaded image ${index + 1}`} />
                  <figcaption>{index + 1}</figcaption>
                  <button type="button" onClick={() => void removeImage(image)} aria-label={`Remove image ${index + 1}`}><X size={15} /></button>
                </figure>
              ))}
            </div>
          ) : null}

          <div className="view-footer">
            <p>{images.length ? "Next: assign each image to a recipe number." : "JPG, PNG, WebP, and phone photos"}</p>
            <button className="button button--primary button--large" type="button" disabled={!images.length} onClick={startGrouping}>
              Start grouping
            </button>
          </div>
        </section>
      ) : null}

      {flow === "assign" && images[imageIndex] ? (
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
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={images[imageIndex].url} alt={images[imageIndex].name} />
              {images[imageIndex].excluded ? <figcaption>Excluded</figcaption> : null}
            </figure>
            <button className="stage-arrow stage-arrow--right" type="button" onClick={() => setImageIndex((imageIndex + 1) % images.length)} aria-label="Next image">
              <ChevronRight />
            </button>
          </div>

          <div className="group-picker">
            <p>Which recipe does this belong to?</p>
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
            <button className={`exclude-button ${images[imageIndex].excluded ? "is-selected" : ""}`} type="button" onClick={excludeCurrent}>
              <X size={17} /> {images[imageIndex].excluded ? "Excluded" : "Exclude this image"}
            </button>
          </div>

          <div className="view-footer">
            <button className="button button--ghost" type="button" onClick={() => setFlow("upload")}>Back to upload</button>
            <button className="button button--primary button--large" type="button" disabled={!allAssigned || !assignedGroups.length} onClick={() => setFlow("groups")}>
              Review {assignedGroups.length || ""} group{assignedGroups.length === 1 ? "" : "s"}
            </button>
          </div>
        </section>
      ) : null}

      {flow === "groups" ? (
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
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={image.url} alt={`${image.name}, position ${index + 1}`} />
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
            <button className="button button--ghost" type="button" onClick={() => setFlow("assign")}>Change assignments</button>
            <button className="button button--primary button--large" type="button" onClick={() => void createDrafts()}><Sparkles size={18} /> Create drafts</button>
          </div>
        </section>
      ) : null}

      {flow === "processing" ? (
        <section className="workspace processing-view page-enter" aria-live="polite">
          <div className="processing-mark"><FileText size={35} /><Sparkles size={19} /></div>
          <p className="eyebrow">Creating {groups.length} draft{groups.length === 1 ? "" : "s"}</p>
          <h1>Reading the cookbook pages…</h1>
          <p>{processingMessage} The first run downloads the English and German OCR models.</p>
          <div className="processing-bar" role="progressbar" aria-label="OCR progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(processingProgress * 100)}>
            <span style={{ width: `${Math.max(8, processingProgress * 100)}%` }} />
          </div>
        </section>
      ) : null}

      {flow === "review" && activeDraft ? (
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
                {courseOptions.map((course) => (
                  <button type="button" className={activeDraft.courses.includes(course) ? "is-selected" : ""} key={course} onClick={() => toggleCourse(course)} aria-pressed={activeDraft.courses.includes(course)}>
                    {activeDraft.courses.includes(course) ? <Check size={15} /> : null}{course}
                  </button>
                ))}
              </div>
            </fieldset>

            <fieldset className="field-group">
              <legend>Difficulty <em>Choose one</em></legend>
              <div className="segmented-control">
                {(["Daily", "Special"] as const).map((difficulty) => (
                  <button type="button" key={difficulty} className={activeDraft.difficulty === difficulty ? "is-selected" : ""} onClick={() => updateDraft({ difficulty })} aria-pressed={activeDraft.difficulty === difficulty}>
                    {difficulty}
                  </button>
                ))}
              </div>
            </fieldset>

            <label className="field">
              <span>Ingredients <em>Notion property</em></span>
              <textarea className="ingredients-editor" value={activeDraft.ingredients} onChange={(event) => updateDraft({ ingredients: event.target.value, warning: undefined })} />
            </label>

            <label className="field">
              <span>Steps <em>Notion page body</em></span>
              <textarea className="steps-editor" value={activeDraft.steps} onChange={(event) => updateDraft({ steps: event.target.value, warning: undefined })} />
            </label>

            <div className="details-panel">
              <button type="button" onClick={() => setDetailsOpen((open) => !open)} aria-expanded={detailsOpen}>
                Additional details <ChevronDown className={detailsOpen ? "is-open" : ""} size={18} />
              </button>
              {detailsOpen ? (
                <div className="details-grid">
                  <label className="field"><span>Cooking time</span><input value={activeDraft.cookingTime} onChange={(event) => updateDraft({ cookingTime: event.target.value })} /></label>
                  <label className="field"><span>Servings</span><input inputMode="numeric" value={activeDraft.servings} onChange={(event) => updateDraft({ servings: event.target.value })} /></label>
                  <label className="field field--wide"><span>Comment</span><textarea value={activeDraft.comment} onChange={(event) => updateDraft({ comment: event.target.value })} /></label>
                  <label className="field field--wide"><span>Source link</span><input inputMode="url" value={activeDraft.link} onChange={(event) => updateDraft({ link: event.target.value })} /></label>
                </div>
              ) : null}
            </div>
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
            <button className="button button--primary button--submit" type="button" disabled={!canSubmit} onClick={submitBatch}>
              Submit {canSubmit ? remainingDrafts.length : `${completedDrafts.length}/${remainingDrafts.length}`}
            </button>
          </div>
        </section>
      ) : null}

      {flow === "results" ? (
        <section className="workspace results-view page-enter">
          <div className="result-seal"><Check size={34} /></div>
          <p className="eyebrow">Batch complete</p>
          <h1>{remainingDrafts.length} recipe{remainingDrafts.length === 1 ? " is" : "s are"} ready for Notion</h1>
          <p>This localhost version completed the full upload and review workflow. Notion is not connected to the website yet, so no library pages were created.</p>

          <div className="result-list">
            {remainingDrafts.map((draft) => (
              <article key={draft.id}>
                <span><CircleCheck size={18} /></span>
                <div><h2>{draft.title}</h2><p>{draft.courses.join(" · ")} · {draft.difficulty}</p></div>
                <strong>Ready</strong>
              </article>
            ))}
          </div>

          <div className="connection-note">
            <Sparkles size={20} />
            <div><strong>Next implementation step</strong><p>Connect the server-side OpenAI and Notion credentials to turn draft creation and Submit into live operations.</p></div>
          </div>

          <button className="button button--primary button--large" type="button" onClick={() => void startNewBatch()}><RotateCcw size={18} /> Start another batch</button>
        </section>
      ) : null}

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
