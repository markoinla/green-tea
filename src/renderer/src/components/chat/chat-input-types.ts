export interface ImageAttachment {
  data: string
  mimeType: string
}

export interface FileAttachment {
  name: string
  path: string
}

export interface DocumentRef {
  id: string
  title: string
}

export interface ImagePreview {
  data: string
  mimeType: string
  preview: string
}
