import { useCallback, useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { api, type Grades, type Schema, type SectionResult } from '../api'
import {
  ArrowLeft, CheckCircle2, Save,
  ChevronDown, ChevronUp, Lock, Unlock, GraduationCap, FileText,
} from 'lucide-react'

// ── Score control ──────────────────────────────────────────────────────────────

function ScoreInput({ value, max, onChange, disabled }: {
  value: number; max: number; onChange: (v: number) => void; disabled: boolean
}) {
  return (
    <div className="flex items-center gap-2">
      <button disabled={disabled || value <= 0} onClick={() => onChange(Math.max(0, value - 1))}
        className="w-7 h-7 flex items-center justify-center rounded-md bg-gray-100 hover:bg-gray-200 disabled:opacity-30 font-bold transition-colors">−</button>
      <span className="font-bold text-gray-800 text-lg w-8 text-center">{value}</span>
      <button disabled={disabled || value >= max} onClick={() => onChange(Math.min(max, value + 1))}
        className="w-7 h-7 flex items-center justify-center rounded-md bg-gray-100 hover:bg-gray-200 disabled:opacity-30 font-bold transition-colors">+</button>
      <span className="text-xs text-gray-400">/ {max}</span>
    </div>
  )
}

// ── Section card ───────────────────────────────────────────────────────────────

function SectionCard({
  sectionId, rubricName, maxPts, subsections, result, schemaSection,
  onUpdate, onConfirmSection, onUnconfirmSection,
  overallConfirmed, pages, onJumpToPage,
}: {
  sectionId: string; rubricName: string; maxPts: number
  subsections: Schema['sections'][0]['subsections']
  result: SectionResult
  schemaSection: Schema['sections'][0]
  onUpdate: (id: string, updated: SectionResult) => void
  onConfirmSection: (id: string) => void
  onUnconfirmSection: (id: string) => void
  overallConfirmed: boolean
  pages?: number[]
  onJumpToPage?: (page: number) => void
}) {
  const [open, setOpen] = useState(true)
  const pct      = maxPts > 0 ? (result.score / maxPts) * 100 : 0
  const barColor = pct >= 85 ? 'bg-green-400' : pct >= 60 ? 'bg-yellow-400' : 'bg-red-400'
  const firstPage = pages && pages.length > 0 ? pages[0] : null
  const sectionConfirmed = !!result.confirmed
  const editingDisabled = sectionConfirmed || overallConfirmed

  function setScore(v: number) { onUpdate(sectionId, { ...result, score: v, confirmed: false }) }
  function setComment(v: string) { onUpdate(sectionId, { ...result, comment: v, confirmed: false }) }
  function setSubField(subId: string, field: 'score' | 'comment', v: number | string) {
    const existing = result.subsection_scores?.[subId] ?? { score: 0, comment: '' }
    onUpdate(sectionId, {
      ...result,
      confirmed: false,
      subsection_scores: {
        ...result.subsection_scores,
        [subId]: { ...existing, [field]: field === 'score' ? Number(v) : v },
      },
    })
  }

  return (
    <div className={`bg-white rounded-xl shadow-sm overflow-hidden border-2 transition-colors ${
      sectionConfirmed ? 'border-green-300' : 'border-transparent'
    }`}>
      <div className="flex items-center">
        <button className="flex-1 flex items-center justify-between px-5 py-4 hover:bg-gray-50 transition-colors"
          onClick={() => setOpen(o => !o)}>
          <div className="flex flex-col items-start gap-1">
            <span className="font-semibold text-gray-800 flex items-center gap-2">
              {rubricName}
              {sectionConfirmed && (
                <span className="flex items-center gap-1 bg-green-100 text-green-700 text-[10px] font-medium px-2 py-0.5 rounded-full">
                  <Lock size={9}/> Confirmed
                </span>
              )}
            </span>
            <div className="flex items-center gap-2">
              <div className="w-28 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                <div className={`h-full rounded-full ${barColor} transition-all`} style={{ width: `${pct}%` }}/>
              </div>
              <span className="text-xs text-gray-500">{result.score}/{maxPts}</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <ScoreInput value={result.score} max={maxPts} onChange={setScore} disabled={editingDisabled}/>
            {open ? <ChevronUp size={16} className="text-gray-400"/> : <ChevronDown size={16} className="text-gray-400"/>}
          </div>
        </button>
        {firstPage !== null && onJumpToPage && (
          <button onClick={() => onJumpToPage(firstPage)}
            className="px-3 py-2 mr-2 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
            title={`Jump to page ${firstPage + 1}`}>
            <FileText size={16}/>
          </button>
        )}
      </div>

      {open && (
        <div className="px-5 pb-5 border-t border-gray-50 space-y-4 pt-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Overall Comment</label>
            <textarea disabled={editingDisabled} value={result.comment} onChange={e => setComment(e.target.value)}
              rows={5} placeholder="AI comment…"
              className="w-full text-sm text-gray-700 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 resize-y focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:text-gray-400"/>
          </div>

          {schemaSection.grading_criteria && (
            <details className="text-xs bg-blue-50 rounded-lg px-3 py-2">
              <summary className="cursor-pointer font-medium text-blue-700">Rubric criteria ▸</summary>
              <pre className="mt-2 whitespace-pre-wrap font-sans leading-relaxed text-gray-600">
                {schemaSection.grading_criteria}
              </pre>
            </details>
          )}

          {subsections.length > 0 && (
            <div className="space-y-3">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Subsections</p>
              {subsections.map(sub => {
                const sr    = result.subsection_scores?.[sub.id] ?? { score: 0, comment: '' }
                const score = Number(sr.score)
                return (
                  <div key={sub.id} className="bg-gray-50 rounded-lg p-4 border border-gray-100">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-sm font-medium text-gray-700">{sub.name}</p>
                      <ScoreInput value={score} max={sub.max_points}
                        onChange={v => setSubField(sub.id, 'score', v)} disabled={editingDisabled}/>
                    </div>
                    <textarea disabled={editingDisabled} value={sr.comment}
                      onChange={e => setSubField(sub.id, 'comment', e.target.value)}
                      rows={4} placeholder="TA comment…"
                      className="w-full text-sm text-gray-600 bg-white border border-gray-200 rounded-md px-3 py-2 resize-y focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-400"/>
                  </div>
                )
              })}
            </div>
          )}

          {/* Per-section confirm bar */}
          <div className="pt-2 border-t border-gray-100 flex items-center justify-between">
            {sectionConfirmed ? (
              <>
                <span className="text-xs text-green-700 flex items-center gap-1">
                  <CheckCircle2 size={13}/> Section confirmed
                  {result.confirmed_at && <span className="text-gray-400 ml-1">({result.confirmed_at})</span>}
                </span>
                <button onClick={() => onUnconfirmSection(sectionId)}
                  disabled={overallConfirmed}
                  className="flex items-center gap-1 text-xs text-amber-600 hover:text-amber-800 px-3 py-1.5 rounded-lg hover:bg-amber-50 transition-colors disabled:opacity-40">
                  <Unlock size={12}/> Unlock section
                </button>
              </>
            ) : (
              <>
                <span className="text-xs text-amber-600">Review then confirm this section.</span>
                <button onClick={() => onConfirmSection(sectionId)}
                  disabled={overallConfirmed}
                  className="flex items-center gap-1 text-xs font-semibold text-white bg-green-500 hover:bg-green-600 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-40">
                  <CheckCircle2 size={12}/> Confirm section
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── ReviewPage ─────────────────────────────────────────────────────────────────

export default function ReviewPage() {
  const { labId, reportId } = useParams<{ labId: string; reportId: string }>()
  const navigate = useNavigate()

  const [grades, setGrades]   = useState<Grades | null>(null)
  const [schema, setSchema]   = useState<Schema | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving]   = useState(false)
  const [dirty, setDirty]     = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const [pdfMode, setPdfMode] = useState<'original' | 'graded'>('original')
  const [pdfRev, setPdfRev]   = useState(0)
  const [pdfPage, setPdfPage] = useState<number | null>(null)

  async function load() {
    if (!labId || !reportId) return
    setLoading(true)
    try {
      const [g, s] = await Promise.all([api.grades(labId, reportId), api.schema(labId)])
      setGrades(g); setSchema(s); setDirty(false)
    } catch (e: any) { setError(e.message) }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [labId, reportId])

  // Auto-save then perform server action (used for confirms)
  async function persistAndThen(fn: () => Promise<void>) {
    if (!labId || !reportId || !grades) return
    if (dirty) {
      await api.updateGrades(labId, reportId, { sections: grades.sections })
      setDirty(false)
    }
    await fn()
    await load()
    setPdfRev(r => r + 1)
  }

  const handleUpdate = useCallback((sectionId: string, updated: SectionResult) => {
    setGrades(prev => {
      if (!prev) return prev
      const sections    = { ...prev.sections, [sectionId]: updated }
      const total_score = Object.values(sections).reduce(
        (s, r) => s + (Number(r.score) || 0), 0)
      return { ...prev, sections, total_score, confirmed: false }
    })
    setDirty(true)
  }, [])

  async function handleSave() {
    if (!labId || !reportId || !grades) return
    setSaving(true); setError(null)
    try {
      const res = await api.updateGrades(labId, reportId, { sections: grades.sections })
      // Refresh local state from authoritative server response.
      setGrades(prev => prev ? { ...prev, sections: res.sections, total_score: res.total_score, confirmed: res.confirmed } : prev)
      setDirty(false)
      setPdfRev(r => r + 1)
    } catch (e: any) { setError(e.message) }
    finally { setSaving(false) }
  }

  async function handleConfirmSection(sectionId: string) {
    if (!labId || !reportId) return
    setSaving(true); setError(null)
    try {
      await persistAndThen(() => api.confirmSection(labId, reportId, sectionId).then(() => {}))
    } catch (e: any) { setError(e.message) }
    finally { setSaving(false) }
  }

  async function handleUnconfirmSection(sectionId: string) {
    if (!labId || !reportId) return
    setSaving(true); setError(null)
    try {
      await persistAndThen(() => api.unconfirmSection(labId, reportId, sectionId).then(() => {}))
    } catch (e: any) { setError(e.message) }
    finally { setSaving(false) }
  }

  async function handleConfirmAll() {
    if (!labId || !reportId || !grades) return
    setSaving(true); setError(null)
    try {
      if (dirty) await api.updateGrades(labId, reportId, { sections: grades.sections })
      await api.confirm(labId, reportId)
      await load()
      setPdfRev(r => r + 1)
    } catch (e: any) { setError(e.message) }
    finally { setSaving(false) }
  }

  async function handleUnconfirm() {
    if (!labId || !reportId) return
    setSaving(true); setError(null)
    try {
      await api.unconfirm(labId, reportId)
      await load()
      setPdfRev(r => r + 1)
    } catch (e: any) { setError(e.message) }
    finally { setSaving(false) }
  }

  function handleJumpToPage(pageIndex: number) {
    const offset = pdfMode === 'graded' ? 2 : 1
    setPdfPage(pageIndex + offset)
    setPdfRev(r => r + 1)
  }

  if (loading) return (
    <div className="min-h-screen bg-cmu-gray flex items-center justify-center text-gray-400">Loading…</div>
  )
  if (!grades || !schema) return (
    <div className="min-h-screen bg-cmu-gray flex items-center justify-center text-red-500">
      {error ?? 'Could not load data'}
    </div>
  )

  const overallConfirmed = grades.confirmed ?? false
  const maxPts           = schema.total_points
  const totalSections    = schema.sections.length
  const confirmedSections = schema.sections.reduce(
    (n, s) => n + (grades.sections[s.id]?.confirmed ? 1 : 0), 0
  )
  const allConfirmed = confirmedSections === totalSections

  return (
    <div className="min-h-screen bg-cmu-gray flex flex-col">
      <header className="bg-cmu-red text-white shadow-md flex-shrink-0">
        <div className="max-w-full px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate(`/labs/${labId}`)}
              className="flex items-center gap-1.5 bg-white/10 hover:bg-white/20 px-3 py-1.5 rounded-lg text-sm transition-colors">
              <ArrowLeft size={14}/> Lab
            </button>
            <div className="flex items-center gap-2">
              <GraduationCap size={20}/>
              <span className="font-semibold">Report {reportId}</span>
              {overallConfirmed ? (
                <span className="flex items-center gap-1 bg-green-500 text-white text-xs px-2 py-0.5 rounded-full">
                  <Lock size={10}/> Confirmed
                </span>
              ) : (
                <span className="bg-white/15 text-white/90 text-xs px-2 py-0.5 rounded-full">
                  {confirmedSections}/{totalSections} sections confirmed
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="bg-white/10 px-4 py-1.5 rounded-lg text-center">
              <span className="text-2xl font-bold">{grades.total_score}</span>
              <span className="text-red-200 text-sm">/{maxPts}</span>
            </div>

            {overallConfirmed ? (
              <button onClick={handleUnconfirm} disabled={saving}
                className="flex items-center gap-1.5 bg-white/10 hover:bg-white/20 px-3 py-2 rounded-lg text-sm transition-colors disabled:opacity-50">
                <Unlock size={14}/> Unlock
              </button>
            ) : (
              <>
                <button onClick={handleSave} disabled={saving || !dirty}
                  className="flex items-center gap-1.5 bg-white/10 hover:bg-white/20 px-3 py-2 rounded-lg text-sm transition-colors disabled:opacity-50">
                  <Save size={14}/> {saving ? 'Saving…' : dirty ? 'Save' : 'Saved'}
                </button>
                <button onClick={handleConfirmAll} disabled={saving || !allConfirmed}
                  title={allConfirmed ? 'Lock the entire report' : 'Confirm every section first'}
                  className="flex items-center gap-1.5 bg-green-500 hover:bg-green-600 px-4 py-2 rounded-lg text-sm font-semibold transition-colors disabled:opacity-50">
                  <CheckCircle2 size={14}/> Confirm Grade
                </button>
              </>
            )}
          </div>
        </div>
      </header>

      {error && (
        <div className="bg-red-50 border-b border-red-200 text-red-700 px-6 py-2 text-sm">{error}</div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* PDF */}
        <div className="flex-1 flex flex-col bg-gray-800 min-w-0">
          <div className="flex gap-1 bg-gray-900 px-4 py-2">
            {(['original', 'graded'] as const).map(mode => (
              <button key={mode} onClick={() => setPdfMode(mode)}
                className={`px-3 py-1 rounded text-xs font-medium capitalize transition-colors ${
                  pdfMode === mode ? 'bg-white text-gray-800' : 'text-gray-400 hover:text-white'}`}>
                {mode} PDF
              </button>
            ))}
            <a href={`${api.pdfUrl(labId!, reportId!, pdfMode)}?v=${pdfRev}`} target="_blank" rel="noreferrer"
              className="ml-auto px-3 py-1 rounded text-xs text-gray-500 hover:text-white transition-colors">
              Open ↗
            </a>
          </div>
          <iframe key={`${reportId}-${pdfMode}-${pdfRev}`}
            src={`${api.pdfUrl(labId!, reportId!, pdfMode)}?v=${pdfRev}${pdfPage ? `#page=${pdfPage}` : ''}`}
            className="flex-1 w-full border-0" title={`${pdfMode} PDF`}/>
        </div>

        {/* Grade cards */}
        <div className="w-[560px] flex-shrink-0 overflow-y-auto bg-cmu-gray">
          <div className="p-4 space-y-4">
            {overallConfirmed ? (
              <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 flex items-center gap-2 text-green-700 text-sm">
                <Lock size={14}/> Report confirmed. Unlock to edit.
              </div>
            ) : (
              <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 text-blue-800 text-sm">
                <p className="font-medium">{confirmedSections} of {totalSections} sections confirmed</p>
                <p className="text-xs text-blue-700 mt-0.5">
                  Review and confirm each section. Editing a confirmed section unlocks it for re-review.
                </p>
              </div>
            )}

            {schema.sections.map(sec => {
              const result = grades.sections[sec.id] ?? { score: 0, comment: '', subsection_scores: {} }
              const pages = grades.section_pages?.[sec.id]
              return (
                <SectionCard key={sec.id}
                  sectionId={sec.id} rubricName={sec.rubric_name}
                  maxPts={sec.max_points} subsections={sec.subsections}
                  result={result} schemaSection={sec}
                  onUpdate={handleUpdate}
                  onConfirmSection={handleConfirmSection}
                  onUnconfirmSection={handleUnconfirmSection}
                  overallConfirmed={overallConfirmed}
                  pages={pages} onJumpToPage={handleJumpToPage}/>
              )
            })}

            <div className="bg-white rounded-xl shadow-sm px-5 py-4 flex items-center justify-between">
              <span className="font-bold text-gray-800">Total</span>
              <span className="text-2xl font-bold text-gray-800">
                {grades.total_score}
                <span className="text-gray-400 font-normal text-base">/{maxPts}</span>
              </span>
            </div>

            {!overallConfirmed && (
              <div className="pb-4">
                <button onClick={handleConfirmAll} disabled={saving || !allConfirmed}
                  title={allConfirmed ? 'Lock the entire report' : 'Confirm every section first'}
                  className="w-full flex items-center justify-center gap-2 bg-green-500 hover:bg-green-600 text-white px-4 py-3 rounded-xl font-semibold text-sm transition-colors disabled:opacity-50">
                  <CheckCircle2 size={16}/>
                  {allConfirmed
                    ? 'Confirm Grade'
                    : `Confirm all ${totalSections} sections first (${confirmedSections}/${totalSections})`}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
