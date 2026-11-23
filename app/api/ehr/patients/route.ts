import { ehrResponse, listEhrPatients } from "@/lib/ehr/client";

export const dynamic = "force-dynamic";

export function GET() {
  return ehrResponse(async () => ({ patients: await listEhrPatients() }));
}
