// ── Backend base URL ──────────────────────────────────────────────────────────
// In Vite dev (port 5173) we hit the separate uvicorn server.
// When the frontend is served by FastAPI directly (prod / Electron / served bundle),
// we use a same-origin relative URL.
const BASE = (() => {
  const fromWindow = (window as unknown as { __BACKEND_URL__?: string }).__BACKEND_URL__
  if (fromWindow) return fromWindow
  if (typeof window !== 'undefined' && window.location.port === '5173') {
    return 'http://localhost:9090'
  }
  return ''
})()

// ── API key store ─────────────────────────────────────────────────────────────
// sessionStorage by default (cleared when the tab/app closes).
// localStorage when the user opts in to "Remember me" (browser) — in the desktop
// build we'll later swap this for the OS keychain via an Electron preload bridge.

const KEY_NAME = 'anthropic_key'

export const apiKeyStore = {
  get(): string {
    return sessionStorage.getItem(KEY_NAME) || localStorage.getItem(KEY_NAME) || ''
  },
  set(key: string, remember: boolean) {
    const trimmed = key.trim()
    if (!trimmed) {
      this.clear()
      return
    }
    if (remember) {
      localStorage.setItem(KEY_NAME, trimmed)
      sessionStorage.removeItem(KEY_NAME)
    } else {
      sessionStorage.setItem(KEY_NAME, trimmed)
      localStorage.removeItem(KEY_NAME)
    }
  },
  isRemembered(): boolean {
    return !!localStorage.getItem(KEY_NAME)
  },
  clear() {
    sessionStorage.removeItem(KEY_NAME)
    localStorage.removeItem(KEY_NAME)
  },
}

function authHeaders(extra?: HeadersInit): HeadersInit {
  const key = apiKeyStore.get()
  const h: Record<string, string> = {}
  if (extra) {
    if (extra instanceof Headers) {
      extra.forEach((v, k) => { h[k] = v })
    } else if (Array.isArray(extra)) {
      for (const [k, v] of extra) h[k] = v
    } else {
      Object.assign(h, extra as Record<string, string>)
    }
  }
  if (key) h['X-Anthropic-Key'] = key
  return h
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: authHeaders(options?.headers),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`${res.status}: ${text}`)
  }
  return res.json()
}

async function upload<T>(path: string, field: string, file: File): Promise<T> {
  const fd = new FormData()
  fd.append(field, file)
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    body: fd,
    headers: authHeaders(),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`${res.status}: ${text}`)
  }
  return res.json()
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface LabSummary {
  id: string
  name: string
  created_at: string
  total_points: number
  report_count: number
  graded_count: number
  confirmed_count: number
  avg_score: number | null
  has_ground_truth: boolean
  ground_truth_name: string | null
}

export interface SectionResult {
  score: number
  comment: string
  subsection_scores: Record<string, { score: number | string; comment: string }>
  confirmed?: boolean
  confirmed_at?: string
}

export interface Report {
  id: string
  filename: string
  graded: boolean
  confirmed: boolean
  ai_score: number | null
  final_score: number | null
  sections: Record<string, SectionResult>
  section_confirmed_count: number
  section_total_count: number
}

export interface Grades {
  file: string
  sections: Record<string, SectionResult>
  total_score: number
  confirmed?: boolean
  confirmed_score?: number
  confirmed_at?: string
  section_pages?: Record<string, number[]>
}

export interface SchemaSubsection {
  id: string
  name: string
  max_points: number
  grading_criteria?: string
}

export interface SchemaSection {
  id: string
  rubric_name: string
  max_points: number
  student_headers: string[]
  grading_criteria: string
  model_answer_summary?: string
  subsections: SchemaSubsection[]
}

export interface Schema {
  lab_title: string
  total_points: number
  sections: SchemaSection[]
}

export interface GradingStatus {
  status: 'idle' | 'running' | 'cancelling' | 'done' | 'error' | 'cancelled'
  current: number
  total: number
  current_file: string
  results: Array<{ id: string; score: number | null; error: string | null }>
  error: string | null
}

// ── API calls ─────────────────────────────────────────────────────────────────

export const api = {
  // Auth
  validateKey: () =>
    request<{ ok: boolean }>('/api/key/validate', { method: 'POST' }),

  // Labs
  labs:      () => request<LabSummary[]>('/api/labs'),
  lab:       (id: string) => request<LabSummary>(`/api/labs/${id}`),
  createLab: (name: string) =>
    request<LabSummary>('/api/labs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    }),
  deleteLab: (id: string) => request<{ ok: boolean }>(`/api/labs/${id}`, { method: 'DELETE' }),
  renameLab: (id: string, name: string) =>
    request<{ id: string; name: string }>(`/api/labs/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    }),
  schema: (labId: string) => request<Schema>(`/api/labs/${labId}/schema`),

  // Uploads
  uploadReports:    (labId: string, file: File) =>
    upload<{ ok: boolean; extracted: string[] }>(`/api/labs/${labId}/upload/reports`, 'file', file),
  uploadRubric:     (labId: string, file: File) =>
    upload<{ ok: boolean; filename: string }>(`/api/labs/${labId}/upload/rubric`, 'file', file),
  clearReports:     (labId: string) =>
    request<{ ok: boolean }>(`/api/labs/${labId}/reports-all`, { method: 'DELETE' }),
  clearGroundTruth: (labId: string) =>
    request<{ ok: boolean }>(`/api/labs/${labId}/ground-truth`, { method: 'DELETE' }),

  // Reports
  reports:      (labId: string) => request<Report[]>(`/api/labs/${labId}/reports`),
  deleteReport: (labId: string, id: string) =>
    request<{ ok: boolean }>(`/api/labs/${labId}/reports/${id}`, { method: 'DELETE' }),
  grades:       (labId: string, id: string) =>
    request<Grades>(`/api/labs/${labId}/reports/${id}/grades`),
  updateGrades: (labId: string, id: string,
                 patch: { sections: Record<string, Partial<SectionResult>> }) =>
    request<{ ok: boolean; total_score: number; confirmed: boolean;
              sections: Record<string, SectionResult> }>(
      `/api/labs/${labId}/reports/${id}/grades`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      },
    ),

  confirmSection:   (labId: string, id: string, sectionId: string) =>
    request<{ ok: boolean }>(
      `/api/labs/${labId}/reports/${id}/sections/${sectionId}/confirm`,
      { method: 'POST' },
    ),
  unconfirmSection: (labId: string, id: string, sectionId: string) =>
    request<{ ok: boolean }>(
      `/api/labs/${labId}/reports/${id}/sections/${sectionId}/unconfirm`,
      { method: 'POST' },
    ),

  confirm:   (labId: string, id: string) =>
    request<{ ok: boolean; confirmed_score: number }>(
      `/api/labs/${labId}/reports/${id}/confirm`, { method: 'POST' }),
  unconfirm: (labId: string, id: string) =>
    request<{ ok: boolean }>(
      `/api/labs/${labId}/reports/${id}/unconfirm`, { method: 'POST' }),

  // Grading
  startGrading: (labId: string, reportIds: string[] | null, forceRegen = false) =>
    request<{ ok: boolean }>(`/api/labs/${labId}/grade`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ report_ids: reportIds, force_regen: forceRegen }),
    }),
  gradingStatus: (labId: string) =>
    request<GradingStatus>(`/api/labs/${labId}/grade/status`),
  cancelGrading: (labId: string) =>
    request<{ ok: boolean }>(`/api/labs/${labId}/grade/cancel`, { method: 'POST' }),

  // PDFs
  pdfUrl: (labId: string, reportId: string, kind: 'original' | 'graded') =>
    `${BASE}/api/labs/${labId}/reports/${reportId}/pdf/${kind}`,

  // Batch download
  downloadUrl: (labId: string) => `${BASE}/api/labs/${labId}/download`,
}
