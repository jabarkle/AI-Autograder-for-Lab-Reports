import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { api, type GradingStatus } from './api'

interface GradingContextValue {
  jobs: Record<string, GradingStatus>
  startGrading: (labId: string, reportIds: string[] | null, forceRegen?: boolean) => Promise<void>
  cancelGrading: (labId: string) => Promise<void>
}

const GradingContext = createContext<GradingContextValue | null>(null)

export function useGrading() {
  const ctx = useContext(GradingContext)
  if (!ctx) throw new Error('useGrading must be inside GradingProvider')
  return ctx
}

export function GradingProvider({ children }: { children: ReactNode }) {
  const [jobs, setJobs] = useState<Record<string, GradingStatus>>({})
  const pollRefs = useRef<Record<string, ReturnType<typeof setInterval>>>({})

  function updateJob(labId: string, status: GradingStatus) {
    setJobs(prev => ({ ...prev, [labId]: status }))
  }

  function startPolling(labId: string) {
    if (pollRefs.current[labId]) return
    pollRefs.current[labId] = setInterval(async () => {
      try {
        const s = await api.gradingStatus(labId)
        updateJob(labId, s)
        if (s.status === 'done' || s.status === 'error' || s.status === 'cancelled') {
          stopPolling(labId)
        }
      } catch { /* ignore transient errors */ }
    }, 2000)
  }

  function stopPolling(labId: string) {
    if (pollRefs.current[labId]) {
      clearInterval(pollRefs.current[labId])
      delete pollRefs.current[labId]
    }
  }

  useEffect(() => {
    return () => {
      Object.keys(pollRefs.current).forEach(stopPolling)
    }
  }, [])

  const startGrading = useCallback(async (labId: string, reportIds: string[] | null, forceRegen = false) => {
    await api.startGrading(labId, reportIds, forceRegen)
    updateJob(labId, {
      status: 'running', current: 0, total: 0,
      current_file: '', results: [], error: null,
    })
    startPolling(labId)
  }, [])

  const cancelGrading = useCallback(async (labId: string) => {
    try {
      await api.cancelGrading(labId)
      updateJob(labId, { ...jobs[labId], status: 'cancelled' } as GradingStatus)
      stopPolling(labId)
    } catch { /* ignore */ }
  }, [jobs])

  return (
    <GradingContext.Provider value={{ jobs, startGrading, cancelGrading }}>
      {children}
    </GradingContext.Provider>
  )
}
