export interface SerializableBlock {
  id: string
  type:
    | 'paragraph'
    | 'heading1'
    | 'heading2'
    | 'heading3'
    | 'heading4'
    | 'heading5'
    | 'code_block'
    | 'task_item'
    | 'blockquote'
    | 'table'
    | 'image'
  content: string
  checked?: boolean
  isList?: boolean
  rows?: string[][]
  src?: string
  alt?: string
  children: SerializableBlock[]
}
