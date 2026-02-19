import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'

const IMAGE_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  'image/bmp'
]

function mimeToExt(mime: string): string {
  const map: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/svg+xml': 'svg',
    'image/bmp': 'bmp'
  }
  return map[mime] ?? 'png'
}

async function uploadFile(file: File): Promise<string> {
  // Try to get the native file path first (works for drag-drop from filesystem)
  try {
    const filePath = window.api.getPathForFile(file)
    if (filePath) {
      return await window.api.images.save(filePath)
    }
  } catch {
    // Fall through to buffer approach
  }
  // Read as buffer (clipboard paste or when path unavailable)
  const buffer = new Uint8Array(await file.arrayBuffer())
  const ext = mimeToExt(file.type)
  return await window.api.images.saveFromBuffer(buffer, ext)
}

export const ImageUpload = Extension.create({
  name: 'imageUpload',

  addProseMirrorPlugins() {
    const editor = this.editor
    return [
      new Plugin({
        key: new PluginKey('imageUpload'),
        props: {
          handleDrop(_view, event) {
            const files = event.dataTransfer?.files
            if (!files || files.length === 0) return false

            const imageFiles = Array.from(files).filter((f) => IMAGE_MIME_TYPES.includes(f.type))
            if (imageFiles.length === 0) return false

            event.preventDefault()
            for (const file of imageFiles) {
              uploadFile(file).then((url) => {
                editor.chain().focus().setImage({ src: url }).run()
              })
            }
            return true
          },
          handlePaste(_view, event) {
            const items = event.clipboardData?.items
            if (!items) return false

            const imageItems = Array.from(items).filter((item) =>
              IMAGE_MIME_TYPES.includes(item.type)
            )
            if (imageItems.length === 0) return false

            event.preventDefault()
            for (const item of imageItems) {
              const file = item.getAsFile()
              if (!file) continue
              uploadFile(file).then((url) => {
                editor.chain().focus().setImage({ src: url }).run()
              })
            }
            return true
          }
        }
      })
    ]
  }
})
