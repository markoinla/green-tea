import { useEffect } from 'react'
import { toast } from 'sonner'

export function usePythonCheck(): void {
  useEffect(() => {
    window.api.app.checkPython().then(({ installed, bundled }) => {
      if (!installed && !bundled) {
        toast.warning('Python not found', {
          description:
            'Skills like PDF, DOCX, XLSX, and PPTX require Python. Install it from python.org or run: brew install python3',
          duration: 15000
        })
      }
    })
  }, [])
}
