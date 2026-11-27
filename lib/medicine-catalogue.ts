import type { CatalogueProduct } from "./prescriptions";

type RxProduct = Pick<CatalogueProduct, "rxCui" | "product" | "medClass">;

export function describeCatalogueProduct(record: RxProduct, doseForms: string[]): CatalogueProduct {
  // RxNorm SCD/SBD names encode ingredient strengths, the dose form, and an
  // optional bracketed brand. Quantified products also carry a leading presentation.
  const brand = record.product.match(/\[([^\]]+)\]$/)?.[1];
  const clinicalName = record.product.replace(/\s+\[[^\]]+\]$/, "");
  const formulation = doseForms.find(form => clinicalName.toLowerCase().endsWith(` ${form.toLowerCase()}`));
  const composition = formulation ? clinicalName.slice(0, -formulation.length).trimEnd() : clinicalName;
  const prefix = composition.match(/^(?:(?:\d[^a-z]*?(?:MG|MCG|UNT)(?:, \d[^a-z]*?(?:MG|MCG|UNT))* Dose) )?(?:\d+(?:\.\d+)? ML )?/i)?.[0] ?? "";
  const components = composition.slice(prefix.length).split(" / ").map(part =>
    part.match(/^(.+?)\s+(\d+(?:\.\d+)?\s+\S.*)$/));
  const parsed = formulation && components.every(component => component !== null);
  const genericName = parsed ? components.map(component => component![1]).join(" / ") : clinicalName;
  const strength = parsed ? components.map(component => component![2]).join(" / ") : undefined;
  const routes = ["Oral", "Subcutaneous", "Intramuscular", "Intravenous", "Inhalation"];
  const route = routes.find(value => formulation?.split(" ").includes(value));
  return { ...record, genericName, brand, strength, formulation, presentation: prefix.trim() || undefined, route };
}

export function catalogueOptions(products: CatalogueProduct[]) {
  const options = new Map<string, CatalogueProduct>();
  for (const product of products) {
    const key = product.product.trim().replace(/\s+/g, " ").toLowerCase();
    const duplicate = options.get(key);
    if (!duplicate) options.set(key, product);
    else if (duplicate.rxCui !== product.rxCui) {
      duplicate.equivalentRxCuis = [...new Set([...(duplicate.equivalentRxCuis ?? []), product.rxCui])];
    }
  }
  return [...options.values()].sort((a, b) =>
    a.genericName.localeCompare(b.genericName) || (a.formulation ?? "").localeCompare(b.formulation ?? "") ||
    a.product.localeCompare(b.product, undefined, { numeric: true }));
}

