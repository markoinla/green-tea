import { FileText, FileSpreadsheet, File, Presentation } from 'lucide-react'

export function FileIcon({ fileName }: { fileName: string }) {
  const ext = fileName.split('.').pop()?.toLowerCase()
  switch (ext) {
    case 'docx':
    case 'doc':
    case 'txt':
    case 'md':
      return <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
    case 'xlsx':
    case 'xls':
    case 'csv':
      return <FileSpreadsheet className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
    case 'pptx':
    case 'ppt':
      return <Presentation className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
    default:
      return <File className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
  }
}
