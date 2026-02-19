import { useState, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter
} from '@renderer/components/ui/dialog'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Textarea } from '@renderer/components/ui/textarea'
import { Label } from '@renderer/components/ui/label'
import { Loader2, CheckCircle2 } from 'lucide-react'

export function BugReportDialog({
  open,
  onOpenChange
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [description, setDescription] = useState('')
  const [status, setStatus] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')

  useEffect(() => {
    if (open) {
      Promise.all([
        window.api.settings.get('bug-report:name'),
        window.api.settings.get('bug-report:email')
      ]).then(([savedName, savedEmail]) => {
        if (savedName) setName(savedName)
        if (savedEmail) setEmail(savedEmail)
      })
    }
  }, [open])

  const reset = () => {
    setName('')
    setEmail('')
    setDescription('')
    setStatus('idle')
    setErrorMsg('')
  }

  const handleOpenChange = (next: boolean) => {
    if (!next) reset()
    onOpenChange(next)
  }

  const handleSubmit = async () => {
    if (!description.trim()) return
    setStatus('submitting')
    setErrorMsg('')

    try {
      const result = await window.api.bugReport.submit({
        name: name.trim() || undefined,
        email: email.trim() || undefined,
        description: description.trim()
      })

      if (result.success) {
        const trimmedName = name.trim()
        const trimmedEmail = email.trim()
        if (trimmedName) window.api.settings.set('bug-report:name', trimmedName)
        if (trimmedEmail) window.api.settings.set('bug-report:email', trimmedEmail)
        setStatus('success')
        setTimeout(() => handleOpenChange(false), 1500)
      } else {
        setStatus('error')
        setErrorMsg(result.error || 'Something went wrong')
      }
    } catch {
      setStatus('error')
      setErrorMsg('Failed to submit report')
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Report a Bug</DialogTitle>
          <DialogDescription>
            Describe the issue you encountered and we&apos;ll look into it.
          </DialogDescription>
        </DialogHeader>

        {status === 'success' ? (
          <div className="flex flex-col items-center gap-2 py-6">
            <CheckCircle2 className="h-8 w-8 text-green-500" />
            <p className="text-sm text-muted-foreground">Thanks! Your report has been submitted.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="grid gap-2">
              <Label htmlFor="bug-name">Name (optional)</Label>
              <Input
                id="bug-name"
                placeholder="Your name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={status === 'submitting'}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="bug-email">Email (optional)</Label>
              <Input
                id="bug-email"
                type="email"
                placeholder="your@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={status === 'submitting'}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="bug-description">
                Description <span className="text-destructive">*</span>
              </Label>
              <Textarea
                id="bug-description"
                placeholder="What happened? What did you expect?"
                className="min-h-24"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                disabled={status === 'submitting'}
              />
            </div>

            {status === 'error' && <p className="text-sm text-destructive">{errorMsg}</p>}

            <DialogFooter>
              <Button variant="outline" onClick={() => handleOpenChange(false)}>
                Cancel
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={!description.trim() || status === 'submitting'}
              >
                {status === 'submitting' && <Loader2 className="h-4 w-4 animate-spin" />}
                {status === 'submitting' ? 'Submitting...' : 'Submit'}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
