import { useCallback, useRef, useState } from 'react'
import { IMAGE_EXTENSIONS, MAX_ATTACHMENTS } from './chat-input-constants'
import { isImageMimeType } from './chat-input-utils'
import type { FileAttachment, ImageAttachment, ImagePreview } from './chat-input-types'

interface UseChatAttachmentsOptions {
  disabled: boolean
}

interface UseChatAttachmentsResult {
  images: ImagePreview[]
  files: FileAttachment[]
  pastedText: string | null
  totalAttachments: number
  setPastedText: (text: string | null) => void
  clearAttachments: () => void
  removeImage: (index: number) => void
  removeFile: (index: number) => void
  handleFilePick: () => Promise<void>
  handleContainerPaste: (e: React.ClipboardEvent) => void
  handleDrop: (e: React.DragEvent) => void
  handleDragOver: (e: React.DragEvent) => void
  buildImageAttachments: () => ImageAttachment[]
  buildFileAttachments: () => FileAttachment[]
}

export function useChatAttachments({
  disabled
}: UseChatAttachmentsOptions): UseChatAttachmentsResult {
  const [images, setImages] = useState<ImagePreview[]>([])
  const [files, setFiles] = useState<FileAttachment[]>([])
  const [pastedText, setPastedTextState] = useState<string | null>(null)

  const imagesRef = useRef(images)
  imagesRef.current = images

  const filesRef = useRef(files)
  filesRef.current = files

  const totalAttachments = images.length + files.length

  const setPastedText = useCallback((text: string | null) => {
    setPastedTextState(text)
  }, [])

  const addImageFromFile = useCallback((file: File) => {
    if (!isImageMimeType(file.type)) return

    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = reader.result as string
      const base64 = dataUrl.split(',')[1]
      setImages((prev) => {
        if (prev.length + filesRef.current.length >= MAX_ATTACHMENTS) return prev
        return [...prev, { data: base64, mimeType: file.type, preview: dataUrl }]
      })
    }
    reader.readAsDataURL(file)
  }, [])

  const addImageFromPath = useCallback(async (filePath: string) => {
    const result = await window.api.images.readBase64(filePath)
    setImages((prev) => {
      if (prev.length + filesRef.current.length >= MAX_ATTACHMENTS) return prev
      return [
        ...prev,
        {
          data: result.data,
          mimeType: result.mimeType,
          preview: `data:${result.mimeType};base64,${result.data}`
        }
      ]
    })
  }, [])

  const addFile = useCallback(
    (filePath: string) => {
      const name = filePath.split(/[\\/]/).pop() || filePath
      const ext = name.split('.').pop()?.toLowerCase() || ''
      if (IMAGE_EXTENSIONS.has(ext)) {
        void addImageFromPath(filePath)
        return
      }

      setFiles((prev) => {
        if (prev.length + imagesRef.current.length >= MAX_ATTACHMENTS) return prev
        if (prev.some((file) => file.path === filePath)) return prev
        return [...prev, { name, path: filePath }]
      })
    },
    [addImageFromPath]
  )

  const removeImage = useCallback((index: number) => {
    setImages((prev) => prev.filter((_, imageIndex) => imageIndex !== index))
  }, [])

  const removeFile = useCallback((index: number) => {
    setFiles((prev) => prev.filter((_, fileIndex) => fileIndex !== index))
  }, [])

  const clearAttachments = useCallback(() => {
    setImages([])
    setFiles([])
    setPastedTextState(null)
  }, [])

  const handleFilePick = useCallback(async () => {
    if (disabled) return

    const filePaths = await window.api.files.pickForChat()
    for (const filePath of filePaths) {
      addFile(filePath)
    }
  }, [disabled, addFile])

  const handleContainerPaste = useCallback(
    (e: React.ClipboardEvent) => {
      const items = e.clipboardData?.items
      if (!items) return

      for (const item of items) {
        if (isImageMimeType(item.type)) {
          e.preventDefault()
          const file = item.getAsFile()
          if (file) addImageFromFile(file)
          return
        }
      }
    },
    [addImageFromFile]
  )

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      const droppedFiles = e.dataTransfer?.files
      if (!droppedFiles || droppedFiles.length === 0) return

      e.preventDefault()
      e.stopPropagation()

      for (const file of droppedFiles) {
        if (isImageMimeType(file.type)) {
          addImageFromFile(file)
        } else {
          const filePath = window.api.getPathForFile(file)
          if (filePath) addFile(filePath)
        }
      }
    },
    [addImageFromFile, addFile]
  )

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
  }, [])

  const buildImageAttachments = useCallback((): ImageAttachment[] => {
    return imagesRef.current.map(({ data, mimeType }) => ({ data, mimeType }))
  }, [])

  const buildFileAttachments = useCallback((): FileAttachment[] => {
    return filesRef.current.map(({ name, path }) => ({ name, path }))
  }, [])

  return {
    images,
    files,
    pastedText,
    totalAttachments,
    setPastedText,
    clearAttachments,
    removeImage,
    removeFile,
    handleFilePick,
    handleContainerPaste,
    handleDrop,
    handleDragOver,
    buildImageAttachments,
    buildFileAttachments
  }
}
