import { useEffect, useState } from 'react'
import { KeyRound, Check, X, Loader2, Eye, EyeOff } from 'lucide-react'
import { api, apiKeyStore } from '../api'

type Status = 'unset' | 'unverified' | 'checking' | 'valid' | 'invalid'

function maskKey(k: string): string {
  if (!k) return ''
  if (k.length <= 12) return '••••'
  return `${k.slice(0, 7)}…${k.slice(-4)}`
}

export default function ApiKeyBar({ onValidated }: { onValidated?: () => void }) {
  const [key, setKey]         = useState('')
  const [editing, setEditing] = useState(false)
  const [show, setShow]       = useState(false)
  const [remember, setRemember] = useState(false)
  const [status, setStatus]   = useState<Status>('unset')
  const [error, setError]     = useState<string | null>(null)

  useEffect(() => {
    const stored = apiKeyStore.get()
    if (stored) {
      setKey(stored)
      setRemember(apiKeyStore.isRemembered())
      setStatus('unverified')
      void validate(stored, false)
    } else {
      setEditing(true)
    }
  }, [])

  async function validate(candidate: string, persist: boolean) {
    if (!candidate.trim()) {
      setStatus('unset')
      apiKeyStore.clear()
      return
    }
    apiKeyStore.set(candidate, persist)
    setStatus('checking')
    setError(null)
    try {
      await api.validateKey()
      setStatus('valid')
      setEditing(false)
      onValidated?.()
    } catch (e: any) {
      setStatus('invalid')
      setError(e.message || 'Validation failed')
    }
  }

  function save() {
    void validate(key, remember)
  }

  function clear() {
    apiKeyStore.clear()
    setKey('')
    setStatus('unset')
    setEditing(true)
    setError(null)
  }

  const stored = apiKeyStore.get()

  return (
    <div className="bg-white/10 rounded-lg px-3 py-1.5 flex items-center gap-2 text-sm">
      <KeyRound size={14} className="text-red-200"/>
      {!editing && stored ? (
        <>
          <code className="text-red-100 text-xs">{maskKey(stored)}</code>
          {status === 'checking' && <Loader2 size={12} className="animate-spin text-red-100"/>}
          {status === 'valid'    && <Check size={13} className="text-green-300"/>}
          {status === 'invalid'  && <X size={13} className="text-red-300"/>}
          <button
            onClick={() => { setEditing(true); setKey(stored) }}
            className="text-xs text-red-100 hover:text-white underline-offset-2 hover:underline ml-1">
            Edit
          </button>
          <button
            onClick={clear}
            className="text-xs text-red-200 hover:text-white">
            Clear
          </button>
        </>
      ) : (
        <>
          <input
            type={show ? 'text' : 'password'}
            value={key}
            onChange={e => setKey(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && save()}
            placeholder="sk-ant-…"
            className="bg-white/10 border border-white/20 rounded px-2 py-1 text-xs text-white placeholder-red-200 w-56 focus:outline-none focus:border-white"
            autoFocus
          />
          <button
            onClick={() => setShow(s => !s)}
            className="text-red-100 hover:text-white"
            title={show ? 'Hide key' : 'Show key'}>
            {show ? <EyeOff size={13}/> : <Eye size={13}/>}
          </button>
          <label className="flex items-center gap-1 text-xs text-red-100 cursor-pointer">
            <input
              type="checkbox"
              checked={remember}
              onChange={e => setRemember(e.target.checked)}
              className="rounded"/>
            Remember
          </label>
          <button
            onClick={save}
            disabled={status === 'checking' || !key.trim()}
            className="bg-white text-cmu-red font-semibold px-3 py-1 rounded text-xs hover:bg-red-50 disabled:opacity-50 transition-colors">
            {status === 'checking' ? 'Checking…' : 'Save'}
          </button>
          {stored && (
            <button onClick={() => setEditing(false)}
              className="text-xs text-red-200 hover:text-white">Cancel</button>
          )}
        </>
      )}
      {error && (
        <span className="text-xs text-red-200 ml-1">{error}</span>
      )}
    </div>
  )
}
