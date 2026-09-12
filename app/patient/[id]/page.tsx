"use client";

import { useParams } from "next/navigation";
import { PatientDashboard } from "@/components/patient/PatientDashboard";

export default function PatientPage() {
  const params = useParams<{ id: string }>();
  return <PatientDashboard patientId={params.id} />;
}
