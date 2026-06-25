import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@renderer/components/ui/alert-dialog'

interface FileConflictDialogProps {
  open: boolean
  onReload: () => void
  onKeepMine: () => void
}

/**
 * Shown when a note's file changed on disk while the editor had unsaved edits.
 * Forces an explicit choice (no auto-merge): reload the external version and
 * discard local edits, or keep the local version (which overwrites the file on
 * the next save).
 */
export function FileConflictDialog({ open, onReload, onKeepMine }: FileConflictDialogProps) {
  return (
    <AlertDialog open={open}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>This note changed on disk</AlertDialogTitle>
          <AlertDialogDescription>
            You have unsaved edits, and this note&apos;s file was changed by another app. Reload
            from disk to discard your edits, or keep your version to overwrite the file on your next
            save.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onKeepMine}>Keep my version</AlertDialogCancel>
          <AlertDialogAction onClick={onReload}>Reload from disk</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
