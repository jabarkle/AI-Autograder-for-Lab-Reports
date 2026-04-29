import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, apiKeyStore, type LabSummary } from '../api'
import { useGrading } from '../GradingContext'
import { GraduationCap, Plus, Trash2, ChevronRight, RefreshCw, X, Loader2, Pencil } from 'lucide-react'
import ApiKeyBar from '../components/ApiKeyBar'

function LabCard({ lab, isGrading, onDelete, onRename }: {
  lab: LabSummary; isGrading: boolean; onDelete: () => void; onRename: (name: string) => void
}) {
  const navigate  = useNavigate()
  const pct       = lab.graded_count / Math.max(lab.report_count, 1)
  const confirmed = lab.confirmed_count / Math.max(lab.report_count, 1)
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(lab.name)
  const inputRef = useRef<HTMLInputElement>(null)

  function startEdit(e: React.MouseEvent) {
    e.stopPropagation()
    setName(lab.name)
    setEditing(true)
    setTimeout(() => inputRef.current?.select(), 0)
  }

  function commitEdit() {
    setEditing(false)
    const trimmed = name.trim()
    if (trimmed && trimmed !== lab.name) onRename(trimmed)
    else setName(lab.name)
  }

  return (
    <div
      onClick={() => !editing && navigate(`/labs/${lab.id}`)}
      className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 cursor-pointer hover:shadow-md hover:border-blue-200 transition-all group"
    >
      <div className="flex justify-between items-start mb-4">
        <div className="bg-cmu-red/10 rounded-xl p-3">
          <GraduationCap size={22} className="text-cmu-red"/>
        </div>
        <div className="flex items-center gap-1">
          {isGrading && (
            <span className="flex items-center gap-1 text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full mr-1">
              <Loader2 size={10} className="animate-spin"/> Grading…
            </span>
          )}
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onClick={startEdit}
              className="p-1.5 rounded-lg text-gray-400 hover:text-blue-500 hover:bg-blue-50 transition-colors"
              title="Rename lab"
            >
              <Pencil size={13}/>
            </button>
            <button
              onClick={e => { e.stopPropagation(); onDelete() }}
              className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
              title="Delete lab"
            >
              <Trash2 size={15}/>
            </button>
            <ChevronRight size={16} className="text-gray-300"/>
          </div>
        </div>
      </div>

      {editing ? (
        <input ref={inputRef} autoFocus value={name}
          onChange={e => setName(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') { setEditing(false); setName(lab.name) } }}
          onClick={e => e.stopPropagation()}
          className="font-semibold text-gray-800 text-base mb-1 leading-snug w-full border border-blue-300 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500"/>
      ) : (
        <h3 className="font-semibold text-gray-800 text-base mb-1 leading-snug">{lab.name}</h3>
      )}
      <p className="text-xs text-gray-400 mb-4">
        {lab.report_count} report{lab.report_count !== 1 ? 's' : ''}
        {lab.avg_score !== null && ` · avg ${lab.avg_score}/${lab.total_points}`}
      </p>

      {/* Progress bars */}
      <div className="space-y-2">
        <div>
          <div className="flex justify-between text-xs text-gray-500 mb-1">
            <span>Graded</span>
            <span>{lab.graded_count}/{lab.report_count}</span>
          </div>
          <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <div className="h-full bg-blue-400 rounded-full transition-all" style={{ width: `${pct * 100}%` }}/>
          </div>
        </div>
        <div>
          <div className="flex justify-between text-xs text-gray-500 mb-1">
            <span>Confirmed</span>
            <span>{lab.confirmed_count}/{lab.report_count}</span>
          </div>
          <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <div className="h-full bg-green-400 rounded-full transition-all" style={{ width: `${confirmed * 100}%` }}/>
          </div>
        </div>
      </div>

      {/* Status chips */}
      <div className="flex gap-2 mt-4 flex-wrap">
        {lab.has_ground_truth ? (
          <span className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full">Ground Truth ✓</span>
        ) : (
          <span className="text-xs bg-orange-50 text-orange-600 px-2 py-0.5 rounded-full">No ground truth</span>
        )}
      </div>
    </div>
  )
}

function CreateLabModal({ onClose, onCreate }: { onClose: () => void; onCreate: () => void }) {
  const [name, setName]     = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState('')

  async function submit() {
    if (!name.trim()) return
    setSaving(true)
    try {
      await api.createLab(name.trim())
      onCreate()
      onClose()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-bold text-gray-800 text-lg">New Lab</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={20}/>
          </button>
        </div>

        <label className="block text-sm font-medium text-gray-700 mb-1.5">Lab name</label>
        <input
          autoFocus
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && submit()}
          placeholder="e.g. THRef – Refrigeration Cycle"
          className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 mb-2"
        />
        {name.trim() && (
          <p className="text-xs text-gray-400 mb-4">
            Folder ID: <code className="bg-gray-100 px-1 rounded">
              {name.trim().replace(/[^\w]+/g, '_').replace(/^_|_$/g, '')}
            </code>
          </p>
        )}
        {error && <p className="text-xs text-red-600 mb-3">{error}</p>}

        <div className="flex gap-3 justify-end">
          <button onClick={onClose}
            className="px-4 py-2 rounded-xl text-sm text-gray-600 hover:bg-gray-100 transition-colors">
            Cancel
          </button>
          <button onClick={submit} disabled={!name.trim() || saving}
            className="px-5 py-2 rounded-xl text-sm font-semibold bg-cmu-red text-white hover:bg-red-700 disabled:opacity-40 transition-colors">
            {saving ? 'Creating…' : 'Create Lab'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function LabsPage() {
  const { jobs } = useGrading()
  const [labs, setLabs]         = useState<LabSummary[]>([])
  const [loading, setLoading]   = useState(true)
  const [showModal, setModal]   = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const [hasKey, setHasKey]     = useState<boolean>(!!apiKeyStore.get())

  async function load() {
    setLoading(true); setError(null)
    try { setLabs(await api.labs()) }
    catch (e: any) { setError(e.message) }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  async function handleDelete(lab: LabSummary) {
    if (!confirm(`Delete "${lab.name}" and all its reports? This cannot be undone.`)) return
    try { await api.deleteLab(lab.id); load() }
    catch (e: any) { alert(e.message) }
  }

  async function handleRename(lab: LabSummary, newName: string) {
    try { await api.renameLab(lab.id, newName); load() }
    catch (e: any) { alert(e.message) }
  }

  return (
    <div className="min-h-screen bg-cmu-gray">
      {/* Header */}
      <header className="bg-cmu-red text-white shadow-md">
        <div className="max-w-6xl mx-auto px-6 py-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <GraduationCap size={30}/>
            <div>
              <h1 className="text-xl font-bold leading-tight">Lab Grader</h1>
              <p className="text-red-200 text-xs">CMU 24-321 Thermal Fluids Experimentation</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ApiKeyBar onValidated={() => { setHasKey(true); load() }}/>
            <button onClick={load}
              className="flex items-center gap-2 bg-white/10 hover:bg-white/20 px-3 py-1.5 rounded-lg text-sm transition-colors">
              <RefreshCw size={14}/> Refresh
            </button>
            <button onClick={() => setModal(true)}
              className="flex items-center gap-2 bg-white text-cmu-red font-semibold px-4 py-1.5 rounded-lg text-sm hover:bg-red-50 transition-colors">
              <Plus size={15}/> New Lab
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-6 py-8">
        {!hasKey && (
          <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-xl px-4 py-3 mb-6 text-sm">
            Enter your Anthropic API key in the header above to enable grading.
            The key is stored only in this session unless you check "Remember".
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 mb-6 text-sm">
            {error}
          </div>
        )}

        {loading ? (
          <div className="text-center text-gray-400 py-20">Loading labs…</div>
        ) : labs.length === 0 ? (
          <div className="text-center py-20">
            <GraduationCap size={48} className="text-gray-200 mx-auto mb-4"/>
            <p className="text-gray-500 font-medium">No labs yet</p>
            <p className="text-gray-400 text-sm mt-1">Click "New Lab" to get started</p>
            <button onClick={() => setModal(true)}
              className="mt-6 flex items-center gap-2 bg-cmu-red text-white px-6 py-2.5 rounded-xl text-sm font-semibold mx-auto hover:bg-red-700 transition-colors">
              <Plus size={15}/> New Lab
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {labs.map(lab => (
              <LabCard key={lab.id} lab={lab}
                isGrading={jobs[lab.id]?.status === 'running'}
                onDelete={() => handleDelete(lab)}
                onRename={name => handleRename(lab, name)}/>
            ))}
            {/* Add new card */}
            <div
              onClick={() => setModal(true)}
              className="rounded-2xl border-2 border-dashed border-gray-200 p-6 flex flex-col items-center justify-center gap-3 cursor-pointer hover:border-gray-300 hover:bg-white transition-all text-gray-400 hover:text-gray-500 min-h-[200px]"
            >
              <Plus size={28}/>
              <span className="text-sm font-medium">New Lab</span>
            </div>
          </div>
        )}
      </div>

      {showModal && (
        <CreateLabModal onClose={() => setModal(false)} onCreate={load}/>
      )}
    </div>
  )
}
