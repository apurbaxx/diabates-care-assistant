import { ehrResponse, importEhrPatient } from "@/lib/ehr/client";
import { EhrError, fhirId } from "@/lib/ehr/fhir";

export const dynamic = "force-dynamic";

export function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  return ehrResponse(async () => {
    const { id } = await context.params;
    if (!fhirId.safeParse(id).success) throw new EhrError(400, "Invalid EHR patient identifier.");
    return { patient: await importEhrPatient(id) };
  });
}
