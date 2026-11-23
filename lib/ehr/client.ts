import { clinicalTypes, EhrError, fhirPatient, openmrsEncounterTag, parseResource, searchBundle, syntheticFamily, type ClinicalType } from "./fhir";
import { mapPatient, requireSyntheticPatient, syntheticIdentity, workspacePatientId } from "./map-patient";

export function ehrEnabled() {
  return Boolean(process.env.EHR_FHIR_BASE_URL?.trim());
}

function configuration() {
  if (!ehrEnabled()) throw new EhrError(404, "EHR Mode is disabled.");
  const username = process.env.EHR_FHIR_USERNAME;
  const password = process.env.EHR_FHIR_PASSWORD;
  let base: URL;
  try {
    base = new URL(process.env.EHR_FHIR_BASE_URL!);
  } catch {
    throw new EhrError(503, "The EHR connection URL is invalid.");
  }
  const local = ["127.0.0.1", "localhost", "[::1]"].includes(base.hostname);
  if (base.username || base.password || base.search || base.hash ||
      (base.protocol !== "https:" && !(local && base.protocol === "http:"))) {
    throw new EhrError(503, "The EHR connection requires HTTPS or a local HTTP demo URL.");
  }
  if (!base.pathname.replace(/\/+$/, "").endsWith("/ws/fhir2/R4")) {
    throw new EhrError(503, "Set the OpenMRS FHIR R4 URL ending in /ws/fhir2/R4.");
  }
  if (!username || username.includes(":") || !password) {
    throw new EhrError(503, "The EHR reader credentials are missing or invalid.");
  }
  return {
    baseUrl: base.href.replace(/\/+$/, ""),
    authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`,
  };
}

type Connection = ReturnType<typeof configuration>;

async function read(connection: Connection, url: string) {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Accept: "application/fhir+json", Authorization: connection.authorization },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    throw new EhrError(502, "ClinIQ could not reach OpenMRS. Check that OpenMRS is running.");
  }
  if (response.status === 401 || response.status === 403) throw new EhrError(502, "OpenMRS rejected ClinIQ’s credentials or read permissions.");
  if (response.status === 404) throw new EhrError(404, "The requested EHR resource was not found.");
  if (!response.ok) {
    const outcome: { resourceType?: unknown; issue?: unknown } | undefined =
      response.status === 500 ? await response.json().catch(() => undefined) : undefined;
    if (outcome?.resourceType === "OperationOutcome" && Array.isArray(outcome.issue) &&
        outcome.issue.some(issue => typeof issue?.diagnostics === "string" && /Privileges required:/i.test(issue.diagnostics))) {
      throw new EhrError(502, "OpenMRS rejected ClinIQ’s read permissions.");
    }
    throw new EhrError(502, `OpenMRS returned HTTP ${response.status} for the FHIR request.`);
  }
  try {
    return await response.json() as unknown;
  } catch {
    throw new EhrError(502, "The EHR did not return FHIR JSON.");
  }
}

async function search(connection: Connection, type: string, params: Record<string, string>) {
  const endpoint = new URL(`${connection.baseUrl}/${type}`);
  const basePath = new URL(`${connection.baseUrl}/`).pathname;
  const query = new URLSearchParams({ ...params, _count: "10" });
  let page = new URL(`?${query}`, endpoint);
  const pages = new Set<string>();
  const records: unknown[] = [];
  while (true) {
    const validPath = page.pathname === endpoint.pathname || page.pathname === basePath ||
      page.pathname === basePath.slice(0, -1);
    if (page.origin !== endpoint.origin || !validPath || page.username || page.password ||
        page.hash || pages.has(page.href) || pages.size >= 20) {
      throw new EhrError(502, "The EHR returned invalid or excessive search pagination.");
    }
    pages.add(page.href);
    const bundle = searchBundle.safeParse(await read(connection, page.href));
    if (!bundle.success) throw new EhrError(502, "The EHR did not return a valid FHIR search bundle.");
    for (const entry of bundle.data.entry ?? []) {
      if (!entry.search || entry.search.mode === "match") records.push(entry.resource);
    }
    if (records.length > 1000) throw new EhrError(502, "The EHR search exceeds the demo record limit.");
    const next = bundle.data.link?.find(link => link.relation === "next");
    if (!next) return records;
    try {
      page = new URL(next.url, page);
    } catch {
      throw new EhrError(502, "The EHR returned an invalid next page URL.");
    }
  }
}

const directoryPatient = fhirPatient.pick({ resourceType: true, id: true, name: true, identifier: true, active: true });

export async function listEhrPatients() {
  const connection = configuration();
  const records = await search(connection, "Patient", { family: syntheticFamily });
  const patients = new Map<string, { name: string; mrn: string; id: string; workspaceId: string }>();
  for (const record of records) {
    const patient = parseResource(directoryPatient, record, "Patient");
    const identity = syntheticIdentity(patient);
    if (identity) patients.set(patient.id, { ...identity, id: patient.id, workspaceId: workspacePatientId(connection.baseUrl, patient.id) });
  }
  return [...patients.values()]
    .sort((a, b) => a.name.localeCompare(b.name) || a.mrn.localeCompare(b.mrn));
}

export async function importEhrPatient(id: string) {
  const connection = configuration();
  const patient = parseResource(fhirPatient, await read(connection, `${connection.baseUrl}/Patient/${id}`), "Patient");
  requireSyntheticPatient(patient, id);
  const resources = Object.fromEntries(await Promise.all(clinicalTypes.map(async type => {
    const params: Record<string, string> = { patient: id };
    if (type === "Encounter") params._tag = `${openmrsEncounterTag}|encounter`;
    return [type, await search(connection, type, params)] as const;
  }))) as Record<ClinicalType, unknown[]>;
  return mapPatient(connection.baseUrl, id, patient, resources);
}

export async function ehrResponse(load: () => Promise<unknown>) {
  const headers = { "Cache-Control": "no-store" };
  try {
    return Response.json(await load(), { headers });
  } catch (error) {
    if (error instanceof EhrError) return Response.json({ error: error.message }, { status: error.status, headers });
    return Response.json({ error: "ClinIQ could not process the EHR response." }, { status: 500, headers });
  }
}
