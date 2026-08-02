import { api } from "../api";

export interface EvidenceBlobView {
  id: string;
  sha256: string;
  relativePath: string;
  mimeType: string;
  byteSize: number;
  createdAt: string;
}

export interface EvidenceView {
  id: string;
  runId: string;
  kind: "declaration" | "observation" | "validation";
  subjectDigest: string;
  collectorId: string;
  collectorVersion: string;
  createdAt: string;
  blobs: ReadonlyArray<{ role: string; blob: EvidenceBlobView }>;
}

/** Preuves collectées pour un run (GET /api/runs/:id/evidence). */
export async function loadRunEvidence(runId: string): Promise<EvidenceView[]> {
  return api<EvidenceView[]>(`/api/runs/${runId}/evidence`);
}
