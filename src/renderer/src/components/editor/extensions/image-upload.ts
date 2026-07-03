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

    // Upload and insert files one at a time so document order matches file
    // order regardless of upload completion order. When `pos` is given the
    // first image lands there; subsequent inserts continue from the selection
    // (insertContentAt places it after the inserted node).
    const insertImagesSequentially = async (files: File[], pos?: number): Promise<void> => {
      let insertAt = pos
      for (const file of files) {
        let url: string
        try {
          url = await uploadFile(file)
        } catch (err) {
          console.error('Image upload failed:', err)
          continue
        }
        if (editor.isDestroyed) return
        // Clamp in case the doc changed while the upload was in flight
        const at = Math.min(insertAt ?? editor.state.selection.to, editor.state.doc.content.size)
        editor
          .chain()
          .focus()
          .insertContentAt(at, { type: 'image', attrs: { src: url } })
          .run()
        insertAt = undefined
      }
    }

    return [
      new Plugin({
        key: new PluginKey('imageUpload'),
        props: {
          handleDrop(view, event) {
            const files = event.dataTransfer?.files
            if (!files || files.length === 0) return false

            const imageFiles = Array.from(files).filter((f) => IMAGE_MIME_TYPES.includes(f.type))
            if (imageFiles.length === 0) return false

            event.preventDefault()
            // Capture the drop point now — uploads resolve later, when the
            // selection may be somewhere else entirely
            const coords = view.posAtCoords({ left: event.clientX, top: event.clientY })
            void insertImagesSequentially(imageFiles, coords?.pos)
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
            const imageFiles = imageItems
              .map((item) => item.getAsFile())
              .filter((f): f is File => f !== null)
            void insertImagesSequentially(imageFiles)
            return true
          }
        }
      })
    ]
  }
})
