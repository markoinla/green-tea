import { FileText, X } from 'lucide-react'
import type { FileAttachment, ImagePreview } from './chat-input-types'

interface ChatInputAttachmentListProps {
  images: ImagePreview[]
  files: FileAttachment[]
  onRemoveImage: (index: number) => void
  onRemoveFile: (index: number) => void
}

export function ChatInputAttachmentList({
  images,
  files,
  onRemoveImage,
  onRemoveFile
}: ChatInputAttachmentListProps) {
  if (images.length === 0 && files.length === 0) {
    return null
  }

  return (
    <div className="flex items-center gap-2 px-3 pt-2 pb-1 overflow-x-auto">
      {images.map((image, index) => (
        <div key={`img-${index}`} className="relative flex-shrink-0 group">
          <img
            src={image.preview}
            alt={`Attachment ${index + 1}`}
            className="h-14 w-14 rounded-lg object-cover border border-border/50"
          />
          <button
            type="button"
            onClick={() => onRemoveImage(index)}
            className="absolute -top-1.5 -right-1.5 h-4 w-4 rounded-full bg-foreground text-background flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <X className="h-2.5 w-2.5" />
          </button>
        </div>
      ))}
      {files.map((file, index) => (
        <div
          key={`file-${index}`}
          className="flex items-center gap-1.5 h-14 px-2.5 rounded-lg bg-background/50 border border-border/50 text-xs group flex-shrink-0"
        >
          <FileText className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
          <span className="truncate max-w-[100px] text-muted-foreground">{file.name}</span>
          <button
            type="button"
            onClick={() => onRemoveFile(index)}
            className="h-4 w-4 rounded-full flex items-center justify-center text-muted-foreground/50 hover:text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <X className="h-2.5 w-2.5" />
          </button>
        </div>
      ))}
    </div>
  )
}
