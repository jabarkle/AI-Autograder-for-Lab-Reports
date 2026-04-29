import { useRef, useState } from 'react'
import { Upload, CheckCircle2, Loader2 } from 'lucide-react'

interface Props {
  label: string
  hint: string
  accept: string          // e.g. ".zip" or ".pdf"
  currentFile?: string | null
  onFile: (file: File) => Promise<void>
  disabled?: boolean
}

export default function DropZone({ label, hint, accept, currentFile, onFile, disabled }: Props) {
  const [dragging, setDragging]   = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError]         = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  async function handle(file: File) {
    setError(null)
    setUploading(true)
    try {
      await onFile(file)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setUploading(false)
    }
  }

  return (
    <div
      onClick={() => !disabled && !uploading && inputRef.current?.click()}
      onDragOver={e => { e.preventDefault(); if (!disabled) setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={e => {
        e.preventDefault()
        setDragging(false)
        const file = e.dataTransfer.files[0]
        if (file && !disabled) handle(file)
      }}
      className={`
        relative rounded-xl border-2 border-dashed p-5 text-center transition-all cursor-pointer select-none
        ${dragging  ? 'border-blue-500 bg-blue-50 scale-[1.01]' : ''}
        ${!dragging && !currentFile ? 'border-gray-300 hover:border-gray-400 bg-white hover:bg-gray-50' : ''}
        ${currentFile && !dragging  ? 'border-green-400 bg-green-50' : ''}
        ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
      `}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={e => {
          const file = e.target.files?.[0]
          if (file) handle(file)
          e.target.value = ''
        }}
      />

      <div className="flex flex-col items-center gap-2">
        {uploading ? (
          <Loader2 size={24} className="text-blue-500 animate-spin"/>
        ) : currentFile ? (
          <CheckCircle2 size={24} className="text-green-500"/>
        ) : (
          <Upload size={24} className="text-gray-400"/>
        )}

        <div>
          <p className={`text-sm font-medium ${currentFile ? 'text-green-700' : 'text-gray-700'}`}>
            {uploading ? 'Uploading…' : currentFile ? currentFile : label}
          </p>
          {!uploading && (
            <p className="text-xs text-gray-400 mt-0.5">
              {currentFile ? 'Drop a new file to replace' : hint}
            </p>
          )}
        </div>
      </div>

      {error && (
        <p className="mt-2 text-xs text-red-600">{error}</p>
      )}
    </div>
  )
}
