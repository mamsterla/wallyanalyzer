export type Role = 'user' | 'installer' | 'admin';

export type UserAccountStatus = 'provisioned' | 'active' | 'suspended' | 'cancelled';
export type CustomerLifecycle = 'draft' | 'ready' | 'invited' | 'active' | 'suspended' | 'cancelled';
export type PsiuUnitStatus = 'enabled' | 'disabled' | 'unavailable';

export interface CustomerSummary {
  id: string;
  email: string;
  lifecycle: CustomerLifecycle;
  invitedAt?: string;
  units: CustomerUnit[];
}

export interface CustomerUnit {
  id: string;
  serialNumber: string;
  uid: string;
  status: PsiuUnitStatus;
  assignedAt?: string;
  unavailableAt?: string;
}

export interface MeResponse {
  id: string;
  email: string;
  role: Role;
  lifecycle: CustomerLifecycle;
  units: CustomerUnit[];
  firstName?: string;
  lastName?: string;
  address?: Address;
  emailChangeAvailable: false;
}
export interface UpdateProfileRequest { firstName?: string; lastName?: string; address?: Address; }
export interface SystemComponents { turntable: string; tonearm: string; cartridge: string; headshell?: string; }
export interface UserSystem { id: string; name: string; notes: string; components: SystemComponents; active: boolean; createdAt: string; }
export interface CreateSystemRequest { name: string; notes?: string; components: SystemComponents; active?: boolean; }
export interface UpdateSystemRequest extends CreateSystemRequest {}
export type CreditLedgerKind = 'initial_verified_account_credit' | 'purchase' | 'grant' | 'usage' | 'administrative_adjustment';
export interface CreditLedgerEntry { id: string; kind: CreditLedgerKind; delta: number; balanceAfter: number; note: string; createdAt: string; }
export interface CreditsResponse { balance: number; items: Array<{ id: string; kind: CreditLedgerKind; delta: number; balance_after: number; note: string; created_at: string }>; limit: number; offset: number; }
export interface Address { line1: string; line2?: string; city: string; region: string; postalCode: string; countryCode: string; }
export interface AdminUserSummary { id: string; email: string; firstName?: string; lastName?: string; lifecycle: CustomerLifecycle; createdAt: string; lastActiveAt?: string; balance: number; units: Array<{ id: string; serialNumber: string; status: PsiuUnitStatus }>; }
export interface CreditAdjustmentRequest { delta: number; note: string; kind?: 'grant' | 'administrative_adjustment'; }

export interface CreateCustomerRequest { email: string; }
export interface CreatePsiuRequest { serialNumber: string; uid: string; }
export interface AssignPsiuRequest { customerId: string; }

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
export interface EquipmentItem { id: string; type: EquipmentType; manufacturer: string; model: string; notes?: string; }
export type AnalysisStatus = 'uploaded' | 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
export interface SampleUploadRequest { fileName: string; contentType: string; byteLength: number; sha256?: string; psuDeviceId?: string; metadata: { recordedAt: string; testTrackId?: string; equipmentIds: string[]; }; }
export interface SampleUploadResponse { sampleId: string; objectKey: string; uploadUrl: string; expiresAt: string; }
export type SampleSource = 'manual_file' | 'psiu_capture';
export interface SampleUploadFile { clientFileId: string; fileName: string; contentType: string; byteLength: number; sha256Base64?: string; recordedAt: string; source: SampleSource; }
export interface CreateSampleUploadBatchRequest { idempotencyKey: string; psiuUnitId: string; systemId?: string; source: SampleSource; observedPsiuUid?: string; files: SampleUploadFile[]; }
export interface SampleUploadIntent { sampleId: string; clientFileId: string; fileName: string; uploadUrl: string; expiresAt: string; requiredHeaders: Record<string, string>; }
export interface CreateSampleUploadBatchResponse { batchId: string; uploads: SampleUploadIntent[]; }
export interface SampleSummary { id: string; batchId: string; psiuUnitId: string; source: SampleSource; observedPsiuUid?: string; systemSnapshot?: { id: string; name: string; components: SystemComponents }; fileName: string; contentType: string; byteLength: number; sha256Base64?: string; recordedAt: string; uploadState: 'intent' | 'uploaded' | 'failed'; sampleRateHz?: number; channels?: number; bitsPerSample?: number; durationMs?: number; createdAt: string; uploadedAt?: string; }
export interface CompleteSampleUploadResponse { sample: SampleSummary; }
export interface SampleDownloadResponse { downloadUrl: string; expiresAt: string; }
export interface AnalysisReportSummary { id: string; sampleId: string; algorithmVersion: string; status: AnalysisStatus; createdAt: string; completedAt?: string; }
export interface ReportDefinition { key: string; displayName: string; algorithmVersion: string; presets: Array<{ key: string; displayName: string; version: string; notice: string }> }
export interface CreateReportRequest { idempotencyKey: string; batchId: string; reports: Array<{ definitionKey: string; presetKey: string }> }
export interface ReportArtifact { kind: 'manifest' | 'metrics_json' | 'graph_svg' | 'report_pdf'; contentType: string; createdAt: string }
export interface ReportHistoryItem { id: string; requestId: string; reportType: string; algorithmVersion: string; presetName: string; presetVersion: string; status: AnalysisStatus; createdAt: string; completedAt?: string; systemName: string; artifacts: ReportArtifact[] }
export type UserAlertSeverity = 'info' | 'warning' | 'success';
export interface UserAlert { id: string; eventKey: string; severity: UserAlertSeverity; title: string; message: string; actionLabel?: string; actionRoute?: string; dismissible: boolean; createdAt: string; }
export interface PsiuConnectionSettings { baseUrl: string; allowInsecureHttp: boolean; }
export interface PsiuStatus { uid: string; uptimeMs: number; sampleRateHz: number; recording: boolean; xlr: boolean; bufferCount: number; recorderState: string; pagesWritten: number; droppedHalves: number; badBlockCount: number; dmaErrors: number; i2sErrors: number; recordingCount: number; }
export interface PsiuCaptureInfo { sampleRateHz: number; channels: number; bits: number; dataBytes: number; durationMs: number; droppedHalves: number; recordingCount: number; completedAt: string; }
