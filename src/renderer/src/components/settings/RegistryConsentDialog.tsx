import { ShieldAlert } from 'lucide-react'
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
import type { ConsentRequest } from '@renderer/hooks/useRegistry'

interface RegistryConsentDialogProps {
  /** The pending consent request, or null when nothing is awaiting consent. */
  request: ConsentRequest | null
  onAllow: () => void
  onCancel: () => void
}

/**
 * Blocking permission-consent dialog for community-registry installs (§9.9).
 * Shown before the install write happens for any registry-sourced item whose
 * manifest declares permissions. Built-in seeded plugins never pass through
 * this path — they ship with the app and are installed without any IPC.
 */
export function RegistryConsentDialog({ request, onAllow, onCancel }: RegistryConsentDialogProps) {
  return (
    <AlertDialog open={!!request} onOpenChange={(open) => !open && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <ShieldAlert className="size-4 text-amber-500" />
            Allow permissions?
          </AlertDialogTitle>
          <AlertDialogDescription>
            <span className="font-medium text-foreground">{request?.name}</span> is a community item
            that requests the following permissions. Only continue if you trust its publisher.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {request && (
          <ul className="space-y-1">
            {request.permissions.map((permission) => (
              <li
                key={permission}
                className="text-sm rounded-lg border border-border bg-muted px-3 py-1.5 font-mono"
              >
                {permission}
              </li>
            ))}
          </ul>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel}>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onAllow}>Allow and install</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
