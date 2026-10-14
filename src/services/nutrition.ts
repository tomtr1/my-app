import { getJSON, httpFetch } from '../platform/http';
import { getSecret } from '../platform/secure';
import type { Settings } from '../store/settings';

export type Meal = 'breakfast' | 'lunch' | 'dinner' | 'snack';

export interface Macros {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
}

export interface DiaryEntry extends Macros {
  id: string;
  time: number;
  meal: Meal;
  name: string;
  grams: number;
  source: 'photo' | 'barcode' | 'search' | 'manual';
  /** small JPEG data URL (photo entries) */
  thumb?: string;
}

export interface FoodCandidate {
  name: string;
  brand?: string;
  /** per 100 g */
  per100: Macros;
  defaultGrams: number;
  image?: string;
  barcode?: string;
  confidence?: number;
}

export interface Goals extends Macros {
  waterMl: number;
}

// ---- goals ------------------------------------------------------------------------------

/** Mifflin–St Jeor BMR × activity factor, ±500 kcal for lose/gain; protein 1.8 g/kg, fat 27 %. */
export function computeGoals(n: Settings['nutrition']): Goals {
  const bmr = 10 * n.weightKg + 6.25 * n.heightCm - 5 * n.age + (n.sex === 'male' ? 5 : -161);
  const tdee = bmr * n.activity;
  const kcal = Math.round(n.kcalOverride ?? tdee + (n.goal === 'lose' ? -500 : n.goal === 'gain' ? 350 : 0));
  const protein = Math.round(n.weightKg * (n.goal === 'maintain' ? 1.6 : 1.9));
  const fat = Math.round((kcal * 0.27) / 9);
  const carbs = Math.max(0, Math.round((kcal - protein * 4 - fat * 9) / 4));
  return { kcal, protein, fat, carbs, waterMl: n.waterGoalMl };
}

export function sumMacros(entries: Macros[]): Macros {
  return entries.reduce((a, e) => ({ kcal: a.kcal + e.kcal, protein: a.protein + e.protein, carbs: a.carbs + e.carbs, fat: a.fat + e.fat }), {
    kcal: 0,
    protein: 0,
    carbs: 0,
    fat: 0,
  });
}

export function scale(per100: Macros, grams: number): Macros {
  const f = grams / 100;
  return { kcal: Math.round(per100.kcal * f), protein: +(per100.protein * f).toFixed(1), carbs: +(per100.carbs * f).toFixed(1), fat: +(per100.fat * f).toFixed(1) };
}

export function suggestMeal(d = new Date()): Meal {
  const h = d.getHours();
  if (h < 10.5) return 'breakfast';
  if (h < 15) return 'lunch';
  if (h >= 17.5 && h < 22) return 'dinner';
  return 'snack';
}

// ---- Open Food Facts (keyless) ------------------------------------------------------------

const OFF_FIELDS = 'code,product_name,brands,nutriments,serving_quantity,image_front_small_url';
const OFF_HEADERS = { 'User-Agent': 'Lifedash/0.1 (personal dashboard)' };

type OffProduct = {
  code: string;
  product_name?: string;
  brands?: string;
  serving_quantity?: number | string;
  image_front_small_url?: string;
  nutriments?: Record<string, number>;
};

function offToCandidate(p: OffProduct): FoodCandidate | null {
  const n = p.nutriments ?? {};
  const kcal = n['energy-kcal_100g'] ?? (n['energy_100g'] ? n['energy_100g'] / 4.184 : undefined);
  if (!p.product_name || kcal === undefined) return null;
  return {
    name: p.product_name,
    brand: p.brands?.split(',')[0]?.trim(),
    per100: { kcal: Math.round(kcal), protein: n.proteins_100g ?? 0, carbs: n.carbohydrates_100g ?? 0, fat: n.fat_100g ?? 0 },
    defaultGrams: Number(p.serving_quantity) || 100,
    image: p.image_front_small_url,
    barcode: p.code,
  };
}

export async function lookupBarcode(code: string): Promise<FoodCandidate | null> {
  const r = await getJSON<{ status: number; product?: OffProduct }>(
    `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json?fields=${OFF_FIELDS}`,
    { corsSafe: true, headers: OFF_HEADERS },
  );
  return r.status === 1 && r.product ? offToCandidate({ ...r.product, code }) : null;
}

export async function searchFoods(q: string): Promise<FoodCandidate[]> {
  if (q.trim().length < 2) return [];
  const local = GENERIC_FOODS.filter((f) => f.name.toLowerCase().includes(q.toLowerCase())).slice(0, 5);
  try {
    const r = await getJSON<{ products: OffProduct[] }>(
      `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(q)}&search_simple=1&action=process&json=1&page_size=20&fields=${OFF_FIELDS}`,
      { corsSafe: true, headers: OFF_HEADERS },
    );
    return [...local, ...r.products.map(offToCandidate).filter((x): x is FoodCandidate => !!x)];
  } catch {
    return local;
  }
}

/** Generic whole foods & common dishes (per 100 g) — used for search and as a fallback. */
export const GENERIC_FOODS: FoodCandidate[] = (
  [
    ['Apple', 52, 0.3, 14, 0.2, 180],
    ['Banana', 89, 1.1, 23, 0.3, 120],
    ['Oatmeal (cooked)', 71, 2.5, 12, 1.5, 250],
    ['Greek yogurt 2 %', 73, 10, 3.9, 2, 170],
    ['Egg (boiled)', 155, 13, 1.1, 11, 55],
    ['Scrambled eggs', 148, 10, 1.6, 11, 150],
    ['Whole-grain bread', 247, 13, 41, 3.4, 45],
    ['Chicken breast (grilled)', 165, 31, 0, 3.6, 150],
    ['Salmon (baked)', 206, 22, 0, 12, 140],
    ['Rice (cooked)', 130, 2.7, 28, 0.3, 180],
    ['Pasta (cooked)', 158, 5.8, 31, 0.9, 220],
    ['Spaghetti bolognese', 132, 7, 15, 4.8, 400],
    ['Pizza margherita', 250, 11, 31, 9, 300],
    ['Caesar salad', 127, 6.5, 6.5, 9, 250],
    ['Mixed salad (no dressing)', 20, 1.3, 3.5, 0.2, 150],
    ['Burger', 254, 13, 24, 12, 230],
    ['French fries', 312, 3.4, 41, 15, 150],
    ['Sushi (nigiri / maki)', 145, 6, 26, 1.5, 250],
    ['Döner kebab', 215, 12, 20, 10, 400],
    ['Avocado', 160, 2, 8.5, 15, 100],
    ['Almonds', 579, 21, 22, 50, 30],
    ['Protein shake (whey + milk)', 80, 9, 5, 2.5, 350],
    ['Cappuccino', 40, 2.2, 3.5, 2, 200],
    ['Croissant', 406, 8, 46, 21, 60],
    ['Müsli with milk', 110, 4, 17, 3, 300],
  ] as Array<[string, number, number, number, number, number]>
).map(([name, kcal, protein, carbs, fat, g]) => ({ name, per100: { kcal, protein, carbs, fat }, defaultGrams: g }));

// ---- photo recognition (your own key / local model — never Claude) ---------------------------

export interface RecognizedItem {
  name: string;
  grams: number;
  per100: Macros;
  confidence: number;
}

const PROMPT = `You are a nutrition assistant. Identify every distinct food item on the plate in this photo.
Estimate each item's portion in grams from visual cues (plate ~26 cm, cutlery, hands), and give typical nutrition PER 100 g.
Reply with ONLY JSON: {"items":[{"name":string,"grams":number,"kcal_per_100g":number,"protein_per_100g":number,"carbs_per_100g":number,"fat_per_100g":number,"confidence":number 0..1}]}`;

export function parseRecognition(content: string): RecognizedItem[] {
  const json = content.slice(content.indexOf('{'), content.lastIndexOf('}') + 1);
  const parsed = JSON.parse(json) as { items?: Array<Record<string, unknown>> };
  return (parsed.items ?? [])
    .map((i) => ({
      name: String(i.name ?? 'Food'),
      grams: Math.max(1, Math.round(Number(i.grams) || 100)),
      per100: {
        kcal: Math.max(0, Number(i.kcal_per_100g) || 0),
        protein: Math.max(0, Number(i.protein_per_100g) || 0),
        carbs: Math.max(0, Number(i.carbs_per_100g) || 0),
        fat: Math.max(0, Number(i.fat_per_100g) || 0),
      },
      confidence: Math.min(1, Math.max(0, Number(i.confidence) || 0.5)),
    }))
    .filter((i) => i.per100.kcal > 0);
}

/**
 * Any OpenAI-compatible vision endpoint with YOUR key — OpenAI, Google Gemini
 * (…/v1beta/openai), Mistral, OpenRouter — or a fully local model via Ollama
 * (http://localhost:11434/v1, e.g. qwen2.5vl / llava) for 100 % offline recognition.
 */
export async function recognizeMeal(imageDataUrl: string, n: Settings['nutrition']): Promise<RecognizedItem[]> {
  if (n.provider === 'none') throw new Error('No food-recognition provider configured (Settings → Nutrition)');
  if (!n.model) throw new Error('Set a vision model name in Settings → Nutrition');
  const key = await getSecret('food-api-key');
  const local = /localhost|127\.0\.0\.1/.test(n.endpoint);
  if (!key && !local) throw new Error('API key missing (Settings → Nutrition)');
  const r = await httpFetch(`${n.endpoint.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    timeoutMs: 90_000,
    headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify({
      model: n.model,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: PROMPT },
            { type: 'image_url', image_url: { url: imageDataUrl } },
          ],
        },
      ],
    }),
  });
  if (!r.ok) throw new Error(`Recognition failed: ${r.status} ${(await r.text()).slice(0, 160)}`);
  const j = (await r.json()) as { choices: Array<{ message: { content: string } }> };
  return parseRecognition(j.choices[0]?.message.content ?? '{}');
}

/** Downscale a photo before upload / storage (privacy + bandwidth). */
export async function downscale(dataUrl: string, maxSide: number, quality = 0.8): Promise<string> {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  const s = Math.min(1, maxSide / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * s);
  c.height = Math.round(img.height * s);
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', quality);
}
