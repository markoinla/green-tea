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
import { cn } from '@renderer/lib/utils'
import { Loader2, CheckCircle2, Bug, MessageSquare } from 'lucide-react'

type FeedbackType = 'bug' | 'feedback'

export function BugReportDialog({
  open,
  onOpenChange
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [type, setType] = useState<FeedbackType>('bug')
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
    setType('bug')
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
        type,
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
          <DialogTitle>Share Feedback</DialogTitle>
          <DialogDescription>
            Report a bug or share feedback and we&apos;ll look into it.
          </DialogDescription>
        </DialogHeader>

        {status === 'success' ? (
          <div className="flex flex-col items-center gap-2 py-6">
            <CheckCircle2 className="h-8 w-8 text-green-500" />
            <p className="text-sm text-muted-foreground">
              Thanks! Your {type === 'bug' ? 'report' : 'feedback'} has been submitted.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  { value: 'bug', label: 'Bug', icon: Bug },
                  { value: 'feedback', label: 'Feedback', icon: MessageSquare }
                ] as const
              ).map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setType(opt.value)}
                  disabled={status === 'submitting'}
                  className={cn(
                    'flex items-center justify-center gap-2 rounded-md border py-2 text-sm transition-colors',
                    type === opt.value
                      ? 'border-primary bg-primary/10 text-foreground'
                      : 'border-border text-muted-foreground hover:bg-accent'
                  )}
                >
                  <opt.icon className="h-4 w-4" />
                  {opt.label}
                </button>
              ))}
            </div>

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
                placeholder={
                  type === 'bug'
                    ? 'What happened? What did you expect?'
                    : 'What would you like to see? Share your thoughts.'
                }
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
