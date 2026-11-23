import { z } from "zod";

export const syntheticFamily = "ClinIQSynthetic";
export const syntheticIdentifier = /^CLINIQ-SYN-[A-Z0-9]{6,32}$/;
export const openmrsEncounterTag = "http://fhir.openmrs.org/ext/encounter-tag";
export const birthSexUrl = "http://hl7.org/fhir/us/core/StructureDefinition/us-core-birthsex";
export const fhirId = z.string().regex(/^[A-Za-z0-9.-]{1,64}$/).refine(id => id !== "." && id !== "..");
export const clinicalTypes = ["Condition", "Encounter", "Observation"] as const;

const coding = z.object({ system: z.string().optional(), code: z.string().optional(), display: z.string().optional() });
export const concept = z.object({ coding: z.array(coding).optional(), text: z.string().optional() });
export const reference = z.object({ reference: z.string() });
const resource = z.object({
  id: fhirId,
  meta: z.object({ tag: z.array(coding).optional() }).optional(),
});

export const fhirPatient = resource.extend({
  resourceType: z.literal("Patient"),
  active: z.boolean().optional(),
  name: z.array(z.object({
    use: z.string().optional(), text: z.string().optional(),
    given: z.array(z.string()).optional(), family: z.string().optional(),
  })).default([]),
  identifier: z.array(z.object({ value: z.string().trim().optional() })).default([]),
  extension: z.array(z.object({ url: z.string(), valueCode: z.string().optional() })).optional(),
  gender: z.string().optional(),
  birthDate: z.string().optional(),
});

export const fhirCondition = resource.extend({
  resourceType: z.literal("Condition"),
  subject: reference,
  verificationStatus: concept.optional(),
  clinicalStatus: concept.optional(),
  code: concept.optional(),
  onsetDateTime: z.string().optional(),
});

export const fhirEncounter = resource.extend({
  resourceType: z.literal("Encounter"),
  subject: reference,
  status: z.string(),
  period: z.object({ start: z.string().optional() }).optional(),
  reasonCode: z.array(concept).optional(),
  type: z.array(concept).optional(),
});

const quantity = z.object({
  value: z.number().finite(), system: z.string().optional(), code: z.string().optional(),
  unit: z.string().optional(), comparator: z.string().optional(),
});
const measurement = z.object({ code: concept, valueQuantity: quantity.optional() });
export const fhirObservation = resource.merge(measurement).extend({
  resourceType: z.literal("Observation"),
  subject: reference,
  status: z.string(),
  encounter: reference.optional(),
  effectiveDateTime: z.string().optional(),
  valueString: z.string().optional(),
  component: z.array(measurement).optional(),
});

export const searchBundle = z.object({
  resourceType: z.literal("Bundle"),
  type: z.literal("searchset"),
  entry: z.array(z.object({
    search: z.object({ mode: z.string() }).optional(),
    resource: z.unknown(),
  })).optional(),
  link: z.array(z.object({ relation: z.string(), url: z.string() })).optional(),
});

export type FhirPatient = z.infer<typeof fhirPatient>;
export type ClinicalType = typeof clinicalTypes[number];
export type Concept = z.infer<typeof concept>;
export type Measurement = z.infer<typeof measurement>;

export class EhrError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function invalidRecord(message: string): never {
  throw new EhrError(422, message);
}

export function parseResource<T extends z.ZodTypeAny>(schema: T, input: unknown, type: string): z.infer<T> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) invalidRecord(`OpenMRS returned an unsupported or invalid ${type}.`);
  return parsed.data;
}

export function codeFor(value: Concept | undefined, system: string) {
  return value?.coding?.find(c => c.system?.replace(/\/$/, "") === system)?.code;
}

export function conceptLabel(value?: Concept) {
  return value?.text?.trim() || value?.coding?.find(c => c.display)?.display?.trim();
}

export function referenceId(baseUrl: string, value: string | undefined, type: string) {
  const relative = value?.startsWith(`${baseUrl}/`) ? value.slice(baseUrl.length + 1) : value;
  const [resourceType, id, extra] = relative?.split("/") ?? [];
  if (resourceType !== type || extra !== undefined || !fhirId.safeParse(id).success) {
    invalidRecord(`The EHR record has an invalid ${type} reference.`);
  }
  return id;
}
