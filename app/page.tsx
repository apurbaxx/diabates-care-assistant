import { PatientSelection } from "@/components/patient/PatientSelection";
import { ehrEnabled } from "@/lib/ehr/client";

export const dynamic = "force-dynamic";

export default function Home() {
  return <PatientSelection ehrModeAvailable={ehrEnabled()} />;
}
