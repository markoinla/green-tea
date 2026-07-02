import { useState, useCallback, type ReactElement } from 'react'
import { Leaf, ListTree, Sparkles, Command, Link2, type LucideIcon } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription
} from '@renderer/components/ui/dialog'
import { Button } from '@renderer/components/ui/button'
import { cn } from '@renderer/lib/utils'

interface Slide {
  icon: LucideIcon
  title: string
  body: string
  hint?: ReactElement
}

// A key combo / syntax chip used inside slide copy to make features tangible.
function Chip({ children }: { children: React.ReactNode }): ReactElement {
  return (
    <kbd className="inline-flex items-center rounded-md border bg-muted px-1.5 py-0.5 font-mono text-[0.72rem] font-medium text-foreground">
      {children}
    </kbd>
  )
}

const SLIDES: Slide[] = [
  {
    icon: Leaf,
    title: 'Welcome to Green Tea',
    body: 'Knowledge work, caffeinated. A calm place to write, connect, and think — with an AI that works right inside your notes. Here are the four things worth knowing.'
  },
  {
    icon: ListTree,
    title: 'Write in outlines',
    body: 'Every note is an outliner. Press Enter for a new bullet, Tab to nest it. A block menu drops in headings, tasks, tables, code, and more.',
    hint: (
      <>
        Press <Chip>/</Chip> on an empty line to open the block menu.
      </>
    )
  },
  {
    icon: Link2,
    title: 'Connect your notes',
    body: 'Link ideas together as you write. Backlinks are tracked automatically, so every note quietly builds a map of how your thinking connects.',
    hint: (
      <>
        Type <Chip>[[</Chip> to search for and link another note.
      </>
    )
  },
  {
    icon: Sparkles,
    title: 'Ask the AI',
    body: 'The chat on the right reads across your whole workspace, answers questions, and edits notes for you. Edits arrive as proposals you review and approve — nothing changes without your say-so.',
    hint: (
      <>
        Mention a note with <Chip>@</Chip> to pull it into the conversation.
      </>
    )
  },
  {
    icon: Command,
    title: 'Jump to anything',
    body: 'Full-text search and quick navigation are one shortcut away. Find any note across every workspace in a keystroke.',
    hint: (
      <>
        Open the command palette with{' '}
        <Chip>
          <span className="text-[0.85em]">⌘</span>K
        </Chip>
        .
      </>
    )
  }
]

interface WelcomeDialogProps {
  open: boolean
  onFinish: () => void
}

export function WelcomeDialog({ open, onFinish }: WelcomeDialogProps): ReactElement {
  const [index, setIndex] = useState(0)
  // Direction drives the slide-in animation (1 = forward, -1 = back).
  const [direction, setDirection] = useState<1 | -1>(1)

  const isLast = index === SLIDES.length - 1
  const slide = SLIDES[index]
  const Icon = slide.icon

  const goTo = useCallback(
    (next: number) => {
      setDirection(next > index ? 1 : -1)
      setIndex(Math.max(0, Math.min(next, SLIDES.length - 1)))
    },
    [index]
  )

  const goNext = useCallback(() => {
    if (index === SLIDES.length - 1) {
      onFinish()
      return
    }
    setDirection(1)
    setIndex((i) => Math.min(i + 1, SLIDES.length - 1))
  }, [index, onFinish])

  return (
    <Dialog open={open}>
      <DialogContent
        showCloseButton={false}
        className="max-w-md overflow-hidden gap-0 p-0"
        // Non-dismissible: block Escape, click-outside, and focus-steal so the only
        // way out is an explicit Skip or finishing the tour.
        onEscapeKeyDown={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div className="flex flex-col items-center px-8 pt-10 pb-6 text-center">
          <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            {/* re-key on index so the icon re-animates per slide */}
            <Icon key={index} className="size-7 animate-in fade-in zoom-in-75 duration-300" />
          </div>

          <div
            key={index}
            className={cn(
              'flex flex-col items-center animate-in fade-in duration-300',
              direction === 1 ? 'slide-in-from-right-4' : 'slide-in-from-left-4'
            )}
          >
            <DialogTitle className="text-xl font-semibold tracking-tight">
              {slide.title}
            </DialogTitle>
            <DialogDescription className="mt-2.5 text-[0.925rem] leading-relaxed text-muted-foreground">
              {slide.body}
            </DialogDescription>
            {slide.hint && (
              <p className="mt-4 text-[0.8rem] leading-relaxed text-muted-foreground/90">
                {slide.hint}
              </p>
            )}
          </div>
        </div>

        {/* Progress dots */}
        <div className="flex items-center justify-center gap-1.5 pb-6">
          {SLIDES.map((_, i) => (
            <button
              key={i}
              type="button"
              aria-label={`Go to step ${i + 1}`}
              onClick={() => goTo(i)}
              className={cn(
                'h-1.5 rounded-full transition-all duration-300',
                i === index
                  ? 'w-5 bg-primary'
                  : 'w-1.5 bg-muted-foreground/30 hover:bg-muted-foreground/50'
              )}
            />
          ))}
        </div>

        <div className="flex items-center justify-between border-t px-6 py-4">
          {index === 0 ? (
            // Remove this branch to force users through every slide (no early exit).
            <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={onFinish}>
              Skip
            </Button>
          ) : (
            <Button variant="ghost" size="sm" onClick={() => goTo(index - 1)}>
              Back
            </Button>
          )}

          <div className="flex items-center gap-2">
            <span className="text-xs tabular-nums text-muted-foreground/70">
              {index + 1} / {SLIDES.length}
            </span>
            <Button size="sm" onClick={goNext}>
              {isLast ? 'Start brewing' : 'Next'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
