import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { api, type LabSummary, type Report, type Schema } from '../api'
import { useGrading } from '../GradingContext'
import DropZone from '../components/DropZone'
import {
  ArrowLeft, CheckCircle2, ChevronRight, Clock, GraduationCap,
  Play, RefreshCw, Trash2, AlertCircle, Loader2, XCircle, X, Download,
} from 'lucide-react'

// ── Sub-components ────────────────────────────────────────────────────────────

function ScoreBadge({ score, max }: { score: number | null; max: number }) {
  if (score === null) return <span className="text-gray-300 text-sm">—</span>
  const pct   = (score / max) * 100
  const color = pct >= 85 ? 'bg-green-100 text-green-800'
              : pct >= 70 ? 'bg-yellow-100 text-yellow-800'
              :              'bg-red-100 text-red-800'
  return (
    <span className={`inline-flex items-center gap-0.5 px-2.5 py-0.5 rounded-full text-sm font-semibold ${color}`}>
      {score}<span className="font-normal text-xs opacity-60">/{max}</span>
    </span>
  )
}

function GradingProgress({ status, onCancel }: { status: { status: string; current: number; total: number; current_file: string }; onCancel: () => void }) {
  const pct = status.total > 0 ? Math.round((status.current / status.total) * 100) : 0
  return (
    <div className="bg-blue-50 border border-blue-200 rounded-xl px-5 py-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 text-blue-700 font-medium text-sm">
          <Loader2 size={15} className="animate-spin"/>
          Grading in progress…
        </div>
        <div className="flex items-center gap-3">
          <span className="text-blue-600 text-sm">
            {status.current} / {status.total}
          </span>
          <button onClick={onCancel}
            className="flex items-center gap-1 text-red-500 hover:text-red-700 text-sm font-medium px-2 py-1 rounded-lg hover:bg-red-50 transition-colors">
            <XCircle size={14}/> Cancel
          </button>
        </div>
      </div>
      <div className="h-2 bg-blue-100 rounded-full overflow-hidden mb-2">
        <div className="h-full bg-blue-500 rounded-full transition-all duration-500"
          style={{ width: `${pct}%` }}/>
      </div>
      {status.current_file && (
        <p className="text-xs text-blue-500">Currently grading: {status.current_file}</p>
      )}
    </div>
  )
}

// ── Main LabDashboard ─────────────────────────────────────────────────────────

export default function LabDashboard() {
  const { labId }   = useParams<{ labId: string }>()
  const navigate    = useNavigate()
  const { jobs, startGrading, cancelGrading } = useGrading()

  const [lab, setLab]           = useState<LabSummary | null>(null)
  const [reports, setReports]   = useState<Report[]>([])
  const [schema, setSchema]     = useState<Schema | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState<string | null>(null)

  const status = labId ? jobs[labId] : undefined
  const isGrading = status?.status === 'running'

  // ── Data loading ────────────────────────────────────────────────────────────

  async function load() {
    if (!labId) return
    try {
      const [l, r] = await Promise.all([api.lab(labId), api.reports(labId)])
      setLab(l); setReports(r)
      try { setSchema(await api.schema(labId)) } catch { /* not generated yet */ }
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [labId])

  // Reload reports when grading finishes
  useEffect(() => {
    if (status?.status === 'done' || status?.status === 'error' || status?.status === 'cancelled') {
      load()
    }
  }, [status?.status])

  // ── Grading ─────────────────────────────────────────────────────────────────

  async function handleGrade(ids: string[] | null) {
    if (!labId) return
    setError(null)
    try {
      await startGrading(labId, ids)
      setSelected(new Set())
    } catch (e: any) {
      setError(e.message)
    }
  }

  async function handleCancel() {
    if (!labId) return
    try { await cancelGrading(labId) } catch (e: any) { setError(e.message) }
  }

  // ── Selection ───────────────────────────────────────────────────────────────

  const allSelected = reports.length > 0 && selected.size === reports.length
  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(reports.map(r => r.id)))
  }
  function toggleOne(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  // ── Delete ──────────────────────────────────────────────────────────────────

  async function handleDeleteReport(id: string) {
    if (!labId || !confirm(`Delete report ${id}?`)) return
    try {
      await api.deleteReport(labId, id)
      load()
    } catch (e: any) { setError(e.message) }
  }

  // ── Upload handlers ─────────────────────────────────────────────────────────

  const handleZip = useCallback(async (file: File) => {
    const res = await api.uploadReports(labId!, file)
    await load()
    alert(`Extracted ${res.extracted.length} PDF(s): ${res.extracted.join(', ')}`)
  }, [labId])

  const handleGroundTruth = useCallback(async (file: File) => {
    await api.uploadRubric(labId!, file)
    setSchema(null)
    await load()
  }, [labId])

  async function handleClearReports() {
    if (!labId || !confirm('Delete all student reports and their grades? This cannot be undone.')) return
    try { await api.clearReports(labId); await load() }
    catch (e: any) { setError(e.message) }
  }

  async function handleClearGroundTruth() {
    if (!labId || !confirm('Delete the ground truth document? The grading schema will also be cleared.')) return
    try { await api.clearGroundTruth(labId); setSchema(null); await load() }
    catch (e: any) { setError(e.message) }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  const maxPts    = schema?.total_points ?? 100
  const graded    = reports.filter(r => r.graded).length
  const confirmed = reports.filter(r => r.confirmed).length

  if (loading) return (
    <div className="min-h-screen bg-cmu-gray flex items-center justify-center text-gray-400">Loading…</div>
  )

  return (
    <div className="min-h-screen bg-cmu-gray">
      {/* Header */}
      <header className="bg-cmu-red text-white shadow-md">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate('/')}
              className="flex items-center gap-1.5 bg-white/10 hover:bg-white/20 px-3 py-1.5 rounded-lg text-sm transition-colors">
              <ArrowLeft size={14}/> Labs
            </button>
            <div className="flex items-center gap-2">
              <GraduationCap size={20}/>
              <span className="font-semibold">{lab?.name ?? labId}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={load}
              className="flex items-center gap-1.5 bg-white/10 hover:bg-white/20 px-3 py-1.5 rounded-lg text-sm transition-colors">
              <RefreshCw size={14}/>
            </button>
            <button
              onClick={() => labId && (window.location.href = api.downloadUrl(labId))}
              disabled={graded === 0 || isGrading}
              className="flex items-center gap-1.5 bg-white/10 hover:bg-white/20 px-3 py-1.5 rounded-lg text-sm transition-colors disabled:opacity-40"
              title={graded === 0 ? 'No graded reports yet' : `Download ${graded} graded PDF(s) as ZIP`}>
              <Download size={14}/> Download Graded ({graded})
            </button>
            {selected.size > 0 ? (
              <button onClick={() => handleGrade([...selected])} disabled={isGrading}
                className="flex items-center gap-2 bg-white text-cmu-red font-semibold px-4 py-1.5 rounded-lg text-sm hover:bg-red-50 disabled:opacity-50 transition-colors">
                <Play size={14}/> Grade Selected ({selected.size})
              </button>
            ) : (
              <button onClick={() => handleGrade(null)} disabled={isGrading || reports.length === 0}
                className="flex items-center gap-2 bg-white text-cmu-red font-semibold px-4 py-1.5 rounded-lg text-sm hover:bg-red-50 disabled:opacity-50 transition-colors">
                <Play size={14}/> Grade All
              </button>
            )}
          </div>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-6 py-6 space-y-6">
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm">
            {error}
          </div>
        )}

        {/* Grading progress */}
        {isGrading && status && <GradingProgress status={status} onCancel={handleCancel}/>}

        {/* Grading completed notification */}
        {status?.status === 'done' && (
          <div className="bg-green-50 border border-green-200 rounded-xl px-5 py-3 flex items-center gap-2 text-green-700 text-sm">
            <CheckCircle2 size={16}/> Grading complete — {status.results?.length ?? 0} report(s) processed.
          </div>
        )}
        {status?.status === 'error' && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-5 py-3 text-red-700 text-sm">
            Grading failed: {status.error}
          </div>
        )}
        {status?.status === 'cancelled' && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-5 py-3 flex items-center gap-2 text-amber-700 text-sm">
            <XCircle size={16}/> Grading was cancelled.
          </div>
        )}

        {/* Stats row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Reports',   value: reports.length },
            { label: 'Graded',    value: graded,    sub: `${reports.length - graded} remaining` },
            { label: 'Confirmed', value: confirmed,  sub: `${graded - confirmed} pending` },
            { label: 'Avg Score', value: reports.filter(r => r.ai_score !== null).length
                ? Math.round(reports.reduce((s, r) => s + (r.ai_score ?? 0), 0) /
                             reports.filter(r => r.ai_score !== null).length) + `/${maxPts}`
                : '—' },
          ].map(c => (
            <div key={c.label} className="bg-white rounded-xl shadow-sm p-4">
              <p className="text-xs text-gray-500 uppercase tracking-wide font-medium">{c.label}</p>
              <p className="text-2xl font-bold text-gray-800 mt-0.5">{c.value}</p>
              {c.sub && <p className="text-xs text-gray-400">{c.sub}</p>}
            </div>
          ))}
        </div>

        {/* Upload zones — 2 boxes */}
        <div className="bg-white rounded-2xl shadow-sm p-6">
          <h2 className="font-semibold text-gray-800 mb-4">Lab Files</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <DropZone
                label="Student Reports"
                hint="Drag & drop a .zip of all student PDFs"
                accept=".zip"
                currentFile={reports.length > 0 ? `${reports.length} report(s) loaded` : null}
                onFile={handleZip}
                disabled={isGrading}
              />
              {reports.length > 0 && (
                <button onClick={handleClearReports} disabled={isGrading}
                  className="flex items-center gap-1 text-xs text-red-500 hover:text-red-700 px-2 py-1 rounded-lg hover:bg-red-50 transition-colors disabled:opacity-40">
                  <X size={12}/> Clear all reports
                </button>
              )}
            </div>
            <div className="space-y-2">
              <DropZone
                label="Ground Truth"
                hint="TA base lab document with grading criteria and model answers"
                accept=".pdf"
                currentFile={lab?.ground_truth_name ?? null}
                onFile={handleGroundTruth}
                disabled={isGrading}
              />
              {lab?.ground_truth_name && (
                <button onClick={handleClearGroundTruth} disabled={isGrading}
                  className="flex items-center gap-1 text-xs text-red-500 hover:text-red-700 px-2 py-1 rounded-lg hover:bg-red-50 transition-colors disabled:opacity-40">
                  <X size={12}/> Clear ground truth
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Reports table */}
        <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
            <h2 className="font-semibold text-gray-800">Reports</h2>
            {selected.size > 0 && (
              <span className="text-xs text-blue-600 font-medium">{selected.size} selected</span>
            )}
          </div>

          {reports.length === 0 ? (
            <div className="py-16 text-center text-gray-400">
              <AlertCircle size={32} className="mx-auto mb-3 opacity-40"/>
              <p className="text-sm">No reports yet — drop a ZIP above</p>
            </div>
          ) : (
            <table className="w-full">
              <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-3 text-left w-10">
                    <input type="checkbox" checked={allSelected} onChange={toggleAll}
                      className="rounded border-gray-300 cursor-pointer"/>
                  </th>
                  <th className="px-4 py-3 text-left">Report</th>
                  <th className="px-4 py-3 text-center">AI Score</th>
                  <th className="px-4 py-3 text-center">Final</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 w-16"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {reports.map(r => (
                  <tr key={r.id}
                    className={`transition-colors ${r.graded ? 'hover:bg-blue-50' : 'opacity-60'} ${selected.has(r.id) ? 'bg-blue-50/50' : ''}`}>
                    <td className="px-4 py-3.5">
                      <input type="checkbox" checked={selected.has(r.id)}
                        onChange={() => toggleOne(r.id)}
                        className="rounded border-gray-300 cursor-pointer"/>
                    </td>
                    <td className="px-4 py-3.5 cursor-pointer" onClick={() => r.graded && navigate(`/labs/${labId}/review/${r.id}`)}>
                      <span className="font-medium text-gray-800">{r.filename}</span>
                    </td>
                    <td className="px-4 py-3.5 text-center" onClick={() => r.graded && navigate(`/labs/${labId}/review/${r.id}`)}>
                      <ScoreBadge score={r.ai_score} max={maxPts}/>
                    </td>
                    <td className="px-4 py-3.5 text-center" onClick={() => r.graded && navigate(`/labs/${labId}/review/${r.id}`)}>
                      {r.confirmed
                        ? <ScoreBadge score={r.final_score} max={maxPts}/>
                        : <span className="text-gray-300 text-sm">—</span>}
                    </td>
                    <td className="px-4 py-3.5" onClick={() => r.graded && navigate(`/labs/${labId}/review/${r.id}`)}>
                      {!r.graded
                        ? <span className="flex items-center gap-1 text-gray-400 text-xs"><AlertCircle size={12}/> Not graded</span>
                        : r.confirmed
                        ? <span className="flex items-center gap-1 text-green-600 text-xs"><CheckCircle2 size={12}/> Confirmed</span>
                        : <span className="flex items-center gap-1 text-amber-600 text-xs"><Clock size={12}/> Pending review</span>}
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-1 justify-end">
                        {r.graded && (
                          <ChevronRight size={15} className="text-gray-300 cursor-pointer"
                            onClick={() => navigate(`/labs/${labId}/review/${r.id}`)}/>
                        )}
                        <button onClick={() => handleDeleteReport(r.id)}
                          className="p-1 rounded text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors">
                          <Trash2 size={14}/>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
