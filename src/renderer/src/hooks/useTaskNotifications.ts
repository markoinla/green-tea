import { useEffect } from 'react'
import { toast } from 'sonner'

export function useTaskNotifications(): void {
  useEffect(() => {
    const unsub = window.api.onTaskCompleted((data) => {
      if (data.status === 'success') {
        toast.success(data.name, {
          description: 'Completed successfully'
        })
      } else {
        toast.error(`${data.name} failed`, {
          description: data.error || 'Unknown error'
        })
      }
    })
    return unsub
  }, [])
}
