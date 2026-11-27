import { diabetesClasses, type CatalogueProduct } from "@/lib/prescriptions";
import { catalogueOptions, describeCatalogueProduct } from "@/lib/medicine-catalogue";
import { z } from "zod";

const concept = z.object({ rxcui: z.string().regex(/^\d+$/), name: z.string().min(1) });
const members = z.object({
  drugMemberGroup: z.object({
    drugMember: z.array(z.object({ minConcept: concept })).optional(),
  }).optional(),
});
const doseFormResponse = z.object({ minConceptGroup: z.object({ minConcept: z.array(concept) }) });
const labelMatches = z.object({ results: z.array(z.object({ term: z.string() })) });
const splList = z.object({ data: z.array(z.object({ setid: z.string().uuid(), title: z.string() })) });
const weightIndication = 'indications_and_usage:("weight management" OR "reduce excess body weight" OR "maintain weight reduction")';
const diabetesIndication = 'indications_and_usage:("improve glycemic control" OR "improving glycemic control") AND indications_and_usage:"type 2 diabetes"';

async function catalogueFetch(url: string) {
  return fetch(url, { next: { revalidate: 86400 }, signal: AbortSignal.timeout(10000) });
}

async function classMembers(classId: string) {
  const params = new URLSearchParams({ classId, relaSource: "ATCPROD", ttys: "SCD SBD" });
  const response = await catalogueFetch(`https://rxnav.nlm.nih.gov/REST/rxclass/classMembers.json?${params}`);
  if (!response.ok) throw new Error("Catalogue request failed");
  return members.parse(await response.json()).drugMemberGroup?.drugMember ?? [];
}

async function doseForms() {
  const response = await catalogueFetch("https://rxnav.nlm.nih.gov/REST/allconcepts.json?tty=DF");
  if (!response.ok) throw new Error("Dose forms unavailable");
  return doseFormResponse.parse(await response.json()).minConceptGroup.minConcept
    .map(concept => concept.name).sort((a, b) => b.length - a.length);
}

async function matchingLabelTerms(brands: string[], indication: string, field: "rxcui" | "brand_name") {
  const terms = brands.map(brand => JSON.stringify(brand)).join(" OR ");
  const params = new URLSearchParams({
    search: `openfda.brand_name:(${terms}) AND ${indication}`,
    count: `openfda.${field}.exact`,
  });
  const response = await catalogueFetch(`https://api.fda.gov/drug/label.json?${params}`);
  if (response.status === 404) return [];
  if (!response.ok) throw new Error("Product indications unavailable");
  return labelMatches.parse(await response.json()).results.map(({ term }) => term.toLowerCase());
}

async function weightManagementLabels(brands: string[]) {
  const batches = [];
  for (let start = 0; start < brands.length; start += 25) batches.push(brands.slice(start, start + 25));
  const matches = new Set((await Promise.all(batches.map(batch =>
    matchingLabelTerms(batch, weightIndication, "brand_name"),
  ))).flat());
  const weightBrands = brands.filter(brand => matches.has(brand.toLowerCase()));
  if (!weightBrands.length) return { weightBrands: matches, weightIds: new Set<string>(),
    diabetesBrands: new Set<string>(), diabetesIds: new Set<string>() };
  const [weightIds, diabetesIds, diabetesBrands] = await Promise.all([
    matchingLabelTerms(weightBrands, weightIndication, "rxcui"),
    matchingLabelTerms(weightBrands, diabetesIndication, "rxcui"),
    matchingLabelTerms(weightBrands, diabetesIndication, "brand_name"),
  ]);
  return { weightBrands: new Set(weightBrands.map(brand => brand.toLowerCase())), weightIds: new Set(weightIds),
    diabetesBrands: new Set(diabetesBrands), diabetesIds: new Set(diabetesIds) };
}

async function dailyMedWeightOnly(brand: string) {
  const root = "https://dailymed.nlm.nih.gov/dailymed/services/v2/spls";
  const params = new URLSearchParams({ drug_name: brand, pagesize: "10" });
  const response = await catalogueFetch(`${root}.json?${params}`);
  if (response.status === 404) return false;
  if (!response.ok) throw new Error("DailyMed label index unavailable");
  const labels = splList.parse(await response.json()).data.filter(label =>
    label.title.toLowerCase().startsWith(`${brand.toLowerCase()} `));
  const uses = await Promise.all(labels.slice(0, 3).map(async ({ setid }) => {
    const response = await catalogueFetch(`${root}/${setid}.xml`);
    if (!response.ok) throw new Error("DailyMed label unavailable");
    // 34067-9 is the coded Indications & Usage section in the SPL.
    const xml = await response.text();
    const section = xml.match(/<code\b[^>]*\bcode=["']34067-9["'][^>]*>([\s\S]*?)<\/section>/i)?.[1] ?? "";
    const indication = section.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").toLowerCase().split(/limitations? of use/)[0];
    return {
      weight: /weight management|reduce excess body weight|maintain weight reduction/.test(indication),
      diabetes: /improv(?:e|ing) glycemic control/.test(indication) && /type 2 diabetes/.test(indication),
    };
  }));
  return uses.some(use => use.weight) && !uses.some(use => use.diabetes);
}

export async function GET() {
  try {
    const [categories, forms, otherGlucoseLowering] = await Promise.all([Promise.all(
      (Object.keys(diabetesClasses) as CatalogueProduct["medClass"][]).map(async medClass => {
        const [classId] = diabetesClasses[medClass];
        return { medClass, records: await classMembers(classId) };
      }),
    ), doseForms(), classMembers("A10BX")]);
    const products = new Map<string, CatalogueProduct>();
    for (const { medClass, records } of categories) {
      for (const { minConcept: { rxcui, name } } of records) {
        if (products.has(rxcui)) continue;
        products.set(rxcui, describeCatalogueProduct({ rxCui: rxcui, product: name, medClass }, forms));
      }
    }
    // Product-level ATC can include weight-management presentations. Check
    // the labelled indication and retain products with a diabetes indication.
    const branded = [...products.values()].filter(product => !!product.brand);
    const brands = [...new Set(branded.map(product => product.brand!))].sort();
    const overlapIds = new Set(otherGlucoseLowering.map(({ minConcept }) => minConcept.rxcui));
    const overlapBrands = [...new Set(branded.filter(product =>
      product.medClass === "glp1-receptor-agonist" || overlapIds.has(product.rxCui)).map(product => product.brand!))].sort();
    const [labels, fallback] = await Promise.all([
      weightManagementLabels(brands),
      (async () => {
        if (!overlapBrands.length) return [];
        const covered = new Set(await matchingLabelTerms(overlapBrands, "_exists_:indications_and_usage", "brand_name"));
        return Promise.all(overlapBrands.filter(brand => !covered.has(brand.toLowerCase())).map(async brand => ({
          brand: brand.toLowerCase(), weightOnly: await dailyMedWeightOnly(brand),
        })));
      })(),
    ]);
    const { weightBrands, weightIds, diabetesBrands, diabetesIds } = labels;
    for (const result of fallback) if (result.weightOnly) weightBrands.add(result.brand);
    const isWeightOnly = (product: CatalogueProduct) => {
      if (diabetesIds.has(product.rxCui)) return false;
      if (weightIds.has(product.rxCui) || /^weight management\b/i.test(product.product)) return true;
      const brand = product.brand?.toLowerCase();
      return !!brand && weightBrands.has(brand) && !diabetesBrands.has(brand);
    };
    const clinicalName = (product: CatalogueProduct) => product.product.replace(/\s+\[[^\]]+\]$/, "").toLowerCase();
    const weightForms = new Set(branded.filter(isWeightOnly).map(clinicalName));
    const diabetesForms = new Set(branded.filter(product => !isWeightOnly(product)).map(clinicalName));
    const eligible = [...products.values()].filter(product => {
      if (product.brand) return !isWeightOnly(product);
      if (diabetesIds.has(product.rxCui) || diabetesForms.has(clinicalName(product))) return true;
      return !isWeightOnly(product) && !weightForms.has(clinicalName(product));
    });
    if (!eligible.length) throw new Error("Catalogue returned no medicines");
    return Response.json(catalogueOptions(eligible), { headers: { "Cache-Control": "public, max-age=3600" } });
  } catch {
    return Response.json({ error: "Medicine catalogue unavailable" }, { status: 503 });
  }
}
