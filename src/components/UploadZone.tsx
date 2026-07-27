import { useCallback, useRef, useState } from 'react'
import { UploadCloud, FileType2 } from 'lucide-react'
import { cn } from '@/lib/utils'

interface UploadZoneProps {
  disabled: boolean
  onFiles: (files: File[]) => void
}

export function UploadZone({ disabled, onFiles }: UploadZoneProps) {
  const [armed, setArmed] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setArmed(false)
      if (disabled) return
      const files = [...e.dataTransfer.files].filter((f) =>
        /pdf|jpe?g|png|webp|bmp|tiff?$/i.test(f.name) || f.type === 'application/pdf' || f.type.startsWith('image/'),
      )
      if (files.length > 0) onFiles(files)
    },
    [disabled, onFiles],
  )

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label="Upload lab report files"
      onClick={() => !disabled && inputRef.current?.click()}
      onKeyDown={(e) => e.key === 'Enter' && !disabled && inputRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault()
        if (!disabled) setArmed(true)
      }}
      onDragLeave={() => setArmed(false)}
      onDrop={handleDrop}
      className={cn(
        'hud-panel relative flex cursor-pointer flex-col items-center justify-center gap-3 rounded-sm border-dashed px-6 py-10 text-center transition-all',
        disabled && 'cursor-not-allowed opacity-50',
        armed && 'hud-dropzone-armed',
      )}
      style={{ borderStyle: 'dashed' }}
    >
      <span className="hud-corner hud-corner-tl" />
      <span className="hud-corner hud-corner-tr" />
      <span className="hud-corner hud-corner-bl" />
      <span className="hud-corner hud-corner-br" />
      <UploadCloud className={cn('h-9 w-9 text-cyan-300', !disabled && 'hud-blink')} strokeWidth={1.25} />
      <div>
        <p className="hud-mono text-sm tracking-wide text-cyan-100">
          Drop lab reports here or <span className="text-cyan-300 underline underline-offset-4">browse files</span>
        </p>
        <p className="hud-mono mt-1.5 text-[11px] text-cyan-100/45">
          Multiple files supported · PDF (text or scanned) · JPG / PNG · processed locally, never uploaded
        </p>
      </div>
      <div className="flex items-center gap-2 text-cyan-400/40">
        <FileType2 className="h-3.5 w-3.5" />
        <span className="hud-label">pdf · jpg · png</span>
      </div>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept=".pdf,.jpg,.jpeg,.png,.webp,.bmp,.tif,.tiff,application/pdf,image/*"
        className="hidden"
        onChange={(e) => {
          const files = e.target.files ? [...e.target.files] : []
          if (files.length > 0) onFiles(files)
          e.target.value = ''
        }}
      />
    </div>
  )
}
