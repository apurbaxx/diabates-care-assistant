import { NextRequest, NextResponse } from "next/server";
import { assistantRequestSchema } from "@/lib/assistant/schema";
import { answerPatientQuestion } from "@/lib/assistant/server";
import { localDate } from "@/lib/dates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const headers = {"Cache-Control":"no-store"};
  try {
    const raw = await req.text();
    if (new TextEncoder().encode(raw).length > 2_000_000) return NextResponse.json({error:"Record exceeds the request limit"},{status:413,headers});
    let body: unknown;
    try { body=JSON.parse(raw); } catch { return NextResponse.json({error:"Invalid JSON"},{status:400,headers}); }
    const parsed=assistantRequestSchema.safeParse(body);
    if(!parsed.success) return NextResponse.json({error:"Invalid patient-record request"},{status:400,headers});
    // Allow a one-day timezone difference between browser and server calendars.
    const tomorrow=new Date(); tomorrow.setDate(tomorrow.getDate()+1);
    if(parsed.data.asOf>localDate(tomorrow)) return NextResponse.json({error:"Invalid reference date"},{status:400,headers});
    return NextResponse.json(await answerPatientQuestion(parsed.data),{headers});
  } catch {
    return NextResponse.json({error:"Unable to verify this record answer. Please try again."},{status:500,headers});
  }
}
