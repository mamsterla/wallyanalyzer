export type Role = 'user' | 'installer' | 'admin';

export type UserAccountStatus = 'provisioned' | 'active' | 'suspended' | 'cancelled';

export interface AdminFulfillmentRequest {
  email: string;
  psiuSerialNumber: string;
  psiuOpaqueUid?: string;
}

export interface AdminFulfillmentResult {
  userId: string;
  cognitoSubject: string;
  psiuUnitId: string;
  assignmentId: string;
  accountStatus: UserAccountStatus;
}

export type EquipmentType = 'turntable' | 'tonearm' | 'cartridge';

export interface EquipmentItem {
  id: string;
  type: EquipmentType;
  manufacturer: string;
  model: string;
  notes?: string;
}

export type AnalysisStatus =
  | 'uploaded'
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface SampleUploadRequest {
  fileName: string;
  contentType: string;
  byteLength: number;
  sha256?: string;
  psuDeviceId?: string;
  metadata: {
    recordedAt: string;
    testTrackId?: string;
    equipmentIds: string[];
  };
}

export interface SampleUploadResponse {
  sampleId: string;
  objectKey: string;
  uploadUrl: string;
  expiresAt: string;
}

export interface AnalysisReportSummary {
  id: string;
  sampleId: string;
  algorithmVersion: string;
  status: AnalysisStatus;
  createdAt: string;
  completedAt?: string;
}

export interface PsiuConnectionSettings {
  baseUrl: string;
  allowInsecureHttp: boolean;
}

export interface PsiuStatus {
  uid: string;
  uptimeMs: number;
  sampleRateHz: number;
  recording: boolean;
  xlr: boolean;
  bufferCount: number;
  recorderState: string;
  pagesWritten: number;
  droppedHalves: number;
  badBlockCount: number;
  dmaErrors: number;
  i2sErrors: number;
  recordingCount: number;
}

export interface PsiuCaptureInfo {
  sampleRateHz: number;
  channels: number;
  bits: number;
  dataBytes: number;
  durationMs: number;
  droppedHalves: number;
  recordingCount: number;
  completedAt: string;
}
