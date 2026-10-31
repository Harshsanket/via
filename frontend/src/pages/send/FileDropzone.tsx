import { useRef, useState } from 'react'
import type { ChangeEvent, DragEvent, KeyboardEvent } from 'react'
import { Upload } from 'lucide-react'

interface FileDropzoneProps {
  onFile: (file: File) => void
}

export default function FileDropzone({ onFile }: FileDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [isDragOver, setIsDragOver] = useState(false)

  const openPicker = () => inputRef.current?.click()

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      openPicker()
    }
  }

  const handleDragOver = (event: DragEvent<HTMLElement>) => {
    event.preventDefault()
    event.stopPropagation()
    setIsDragOver(true)
  }

  const handleDragLeave = (event: DragEvent<HTMLElement>) => {
    event.preventDefault()
    event.stopPropagation()
    setIsDragOver(false)
  }

  const handleDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault()
    event.stopPropagation()
    setIsDragOver(false)
    const dropped = event.dataTransfer.files[0]
    if (dropped) onFile(dropped)
  }

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files?.[0]
    if (selected) onFile(selected)
    event.target.value = ''
  }

  return (
    <>
      <button
        type="button"
        aria-label="Choose a file to send"
        className={`h-72 w-full cursor-pointer rounded-2xl border-2 border-dashed p-6 text-center backdrop-blur-sm transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2E8B73] focus-visible:ring-offset-2 sm:h-80 sm:p-10 ${
          isDragOver
            ? 'scale-[1.01] border-[#2E8B73] bg-[#2E8B73]/10 shadow-xl'
            : 'border-white/20 bg-white/5 shadow-lg hover:border-white/40 hover:bg-white/10'
        }`}
        onDragOver={handleDragOver}
        onDragEnter={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={openPicker}
        onKeyDown={handleKeyDown}
      >
        <span className="pointer-events-none flex h-full flex-col items-center justify-center">
          <span className="mb-5 rounded-full bg-[#2E8B73]/15 p-5 sm:mb-6 sm:p-6">
            <Upload
              className="h-14 w-14 text-[#5fc4a8] sm:h-20 sm:w-20"
              aria-hidden="true"
            />
          </span>
          <span className="mb-2 text-xl font-semibold sm:mb-3 sm:text-2xl">
            Drop your file here
          </span>
          <span className="text-sm font-light sm:text-base">
            or click to browse from your device
          </span>
          <span className="mt-4 text-xs text-muted-foreground">
            Any file type. It goes directly to the receiver.
          </span>
        </span>
      </button>

      <label htmlFor="send-file-input" className="sr-only">
        Choose a file to send
      </label>
      <input
        id="send-file-input"
        ref={inputRef}
        type="file"
        onChange={handleChange}
        className="hidden"
      />
    </>
  )
}
