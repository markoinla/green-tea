import { ShieldCheck, LogIn, LogOut, Loader2, Calendar, Mail, HardDrive } from 'lucide-react'
import { useGoogleAccount } from '@renderer/hooks/useGoogleAccount'
import { useMicrosoftAccount } from '@renderer/hooks/useMicrosoftAccount'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger
} from '@renderer/components/ui/accordion'

const GOOGLE_SERVICES = [
  {
    id: 'calendar',
    name: 'Google Calendar',
    description: 'Give the AI agent read-only access to your calendar events',
    icon: Calendar
  },
  {
    id: 'gmail',
    name: 'Gmail',
    description: 'Give the AI agent read-only access to search and read your emails',
    icon: Mail
  },
  {
    id: 'drive',
    name: 'Google Drive',
    description: 'Search files and create Google Docs and Sheets',
    icon: HardDrive
  }
] as const

const MS_SERVICES = [
  {
    id: 'outlook',
    name: 'Microsoft Outlook',
    description: 'Give the AI agent read-only access to search and read your emails',
    icon: Mail
  }
] as const

interface ServiceCardProps {
  service: { id: string; name: string; description: string; icon: typeof Mail }
  isConnected: boolean
  isConnecting: boolean
  anyConnecting: boolean
  loading: boolean
  onConnect: (id: string) => void
  onDisconnect: (id: string) => void
}

function ServiceCard({
  service,
  isConnected,
  isConnecting,
  anyConnecting,
  loading,
  onConnect,
  onDisconnect
}: ServiceCardProps) {
  const Icon = service.icon
  return (
    <div className="rounded-lg border border-border p-4 space-y-3">
      <div className="flex items-center gap-3">
        <div className="flex size-10 items-center justify-center rounded-lg bg-muted">
          <Icon className="size-5 text-muted-foreground" />
        </div>
        <div className="flex-1">
          <h3 className="text-sm font-medium">{service.name}</h3>
          <p className="text-xs text-muted-foreground">{service.description}</p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Loading...
        </div>
      ) : isConnected ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-green-600" />
            <span className="text-sm text-green-600">Connected</span>
          </div>
          <button
            type="button"
            className="h-8 rounded-lg border border-border px-3 text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5"
            onClick={() => onDisconnect(service.id)}
          >
            <LogOut className="size-3.5" />
            Disconnect
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="h-9 rounded-lg bg-accent text-accent-foreground px-4 text-sm inline-flex items-center gap-2 disabled:opacity-50"
          disabled={anyConnecting}
          onClick={() => onConnect(service.id)}
        >
          {isConnecting ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              Waiting for browser...
            </>
          ) : (
            <>
              <LogIn className="size-4" />
              Connect
            </>
          )}
        </button>
      )}
    </div>
  )
}

function ConnectionDot({ connected }: { connected: boolean }) {
  if (!connected) return null
  return <span className="size-2 rounded-full bg-green-500 shrink-0" />
}

export function AccountsTab() {
  const google = useGoogleAccount()
  const microsoft = useMicrosoftAccount()

  const googleConnected = google.status.authenticated && google.status.enabledServices.length > 0
  const microsoftConnected =
    microsoft.status.authenticated && microsoft.status.enabledServices.length > 0

  return (
    <Accordion type="multiple" defaultValue={[]}>
      <AccordionItem value="google">
        <AccordionTrigger>
          <span className="flex items-center gap-2">
            Google
            <ConnectionDot connected={googleConnected} />
          </span>
        </AccordionTrigger>
        <AccordionContent>
          <div className="space-y-4">
            {google.status.authenticated && google.status.email && (
              <div className="text-sm text-muted-foreground">
                Google account: {google.status.email}
              </div>
            )}
            {GOOGLE_SERVICES.map((service) => (
              <ServiceCard
                key={service.id}
                service={service}
                isConnected={google.status.enabledServices.includes(service.id)}
                isConnecting={google.connectingService === service.id}
                anyConnecting={google.connectingService !== null}
                loading={google.loading}
                onConnect={google.connectService}
                onDisconnect={google.disconnectService}
              />
            ))}
          </div>
        </AccordionContent>
      </AccordionItem>

      <AccordionItem value="microsoft">
        <AccordionTrigger>
          <span className="flex items-center gap-2">
            Microsoft
            <ConnectionDot connected={microsoftConnected} />
          </span>
        </AccordionTrigger>
        <AccordionContent>
          <div className="space-y-4">
            {microsoft.status.authenticated && microsoft.status.email && (
              <div className="text-sm text-muted-foreground">
                Microsoft account: {microsoft.status.email}
              </div>
            )}
            {MS_SERVICES.map((service) => (
              <ServiceCard
                key={service.id}
                service={service}
                isConnected={microsoft.status.enabledServices.includes(service.id)}
                isConnecting={microsoft.connectingService === service.id}
                anyConnecting={microsoft.connectingService !== null}
                loading={microsoft.loading}
                onConnect={microsoft.connectService}
                onDisconnect={microsoft.disconnectService}
              />
            ))}
          </div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  )
}
