import { useState } from 'react'
import {
  ShieldCheck,
  LogIn,
  LogOut,
  Loader2,
  Calendar,
  Mail,
  HardDrive,
  Sparkles,
  UserRound
} from 'lucide-react'
import { useGoogleAccount } from '@renderer/hooks/useGoogleAccount'
import { useMicrosoftAccount } from '@renderer/hooks/useMicrosoftAccount'
import { useLlmAccounts } from '@renderer/hooks/useLlmAccounts'
import { useAccount } from '@renderer/hooks/useAccount'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger
} from '@renderer/components/ui/accordion'

const LLM_ACCOUNTS = [
  {
    id: 'anthropic',
    name: 'Anthropic - Claude',
    description:
      'Power the agent with your Claude subscription. Usage is billed per token as extra usage, separate from Claude.ai plan limits.'
  },
  {
    id: 'openai-codex',
    name: 'OpenAI - ChatGPT',
    description: 'Power the agent with your ChatGPT Plus/Pro subscription via Codex.'
  }
] as const

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

/** Full-color Google "G" glyph for the sign-in button. */
function GoogleGlyph() {
  return (
    <svg viewBox="0 0 48 48" className="size-4 shrink-0" aria-hidden="true">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  )
}

/**
 * Green Tea marketplace account (auth layer one). Purely additive — signing in
 * unlocks publishing/browsing later, but the app is fully functional signed-out.
 * The method chooser (Google / email) is native; Google opens the user's Chrome
 * in a chromeless window, email sends a magic link.
 */
function GreenTeaAccountSection() {
  const { account, loading, signingIn, signIn, sendMagicLink, signOut } = useAccount()
  const [email, setEmail] = useState('')
  const [emailSending, setEmailSending] = useState(false)
  const [inboxSentTo, setInboxSentTo] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleEmail(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    const addr = email.trim()
    if (!addr) return
    setEmailSending(true)
    setError(null)
    const res = await sendMagicLink(addr)
    setEmailSending(false)
    if (res.success) setInboxSentTo(addr)
    else setError(res.error ?? 'Could not send sign-in email')
  }

  return (
    <div className="rounded-lg border border-border p-4 space-y-3">
      <div className="flex items-center gap-3">
        <div className="flex size-10 items-center justify-center rounded-lg bg-muted">
          <UserRound className="size-5 text-muted-foreground" />
        </div>
        <div className="flex-1">
          <h3 className="text-sm font-medium">Green Tea account</h3>
          <p className="text-xs text-muted-foreground">
            Optional. Sign in to publish and browse the marketplace later. The app works fully
            without an account.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Loading...
        </div>
      ) : account ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-green-600" />
            <span className="text-sm text-green-600">
              Signed in{account.email ? ` as ${account.email}` : ''}
            </span>
          </div>
          <button
            type="button"
            className="h-8 rounded-lg border border-border px-3 text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5"
            onClick={() => signOut()}
          >
            <LogOut className="size-3.5" />
            Sign out
          </button>
        </div>
      ) : inboxSentTo ? (
        <div className="rounded-lg border border-border bg-muted/40 p-4 text-center space-y-1">
          <Mail className="size-5 mx-auto text-muted-foreground" />
          <p className="text-sm font-medium">Check your inbox</p>
          <p className="text-xs text-muted-foreground">
            We sent a sign-in link to {inboxSentTo}. Open it to finish signing in.
          </p>
          <button
            type="button"
            className="text-xs text-muted-foreground underline underline-offset-2 pt-1"
            onClick={() => {
              setInboxSentTo(null)
              setEmail('')
            }}
          >
            Use a different method
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <button
            type="button"
            className="w-full h-10 rounded-lg border border-border bg-background hover:bg-muted px-4 text-sm font-medium inline-flex items-center justify-center gap-2.5 disabled:opacity-50"
            disabled={signingIn}
            onClick={() => signIn()}
          >
            {signingIn ? <Loader2 className="size-4 animate-spin" /> : <GoogleGlyph />}
            {signingIn ? 'Waiting for browser…' : 'Continue with Google'}
          </button>

          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="h-px flex-1 bg-border" />
            OR
            <span className="h-px flex-1 bg-border" />
          </div>

          <form onSubmit={handleEmail} className="space-y-2">
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Enter your email"
              className="w-full h-10 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring"
            />
            <button
              type="submit"
              className="w-full h-10 rounded-lg bg-accent text-accent-foreground px-4 text-sm font-medium inline-flex items-center justify-center gap-2 disabled:opacity-50"
              disabled={emailSending}
            >
              {emailSending ? <Loader2 className="size-4 animate-spin" /> : null}
              Continue with email
            </button>
          </form>

          {error && <p className="text-xs text-red-500">{error}</p>}
        </div>
      )}
    </div>
  )
}

export function AccountsTab({ defaultSection }: { defaultSection?: string } = {}) {
  const google = useGoogleAccount()
  const microsoft = useMicrosoftAccount()
  const llm = useLlmAccounts()

  const googleConnected = google.status.authenticated && google.status.enabledServices.length > 0
  const microsoftConnected =
    microsoft.status.authenticated && microsoft.status.enabledServices.length > 0
  const anyLlmConnected = LLM_ACCOUNTS.some((a) => llm.isConnected(a.id))

  return (
    <Accordion type="multiple" defaultValue={defaultSection ? [defaultSection] : []}>
      <AccordionItem value="greentea-account">
        <AccordionTrigger>Green Tea account</AccordionTrigger>
        <AccordionContent>
          <GreenTeaAccountSection />
        </AccordionContent>
      </AccordionItem>

      <AccordionItem value="ai-models">
        <AccordionTrigger>
          <span className="flex items-center gap-2">
            AI Model Providers
            <ConnectionDot connected={anyLlmConnected} />
          </span>
        </AccordionTrigger>
        <AccordionContent>
          <div className="space-y-4">
            <p className="text-xs text-muted-foreground">
              Connect a subscription to power the agent, then pick its models in Model settings.
            </p>
            {LLM_ACCOUNTS.map((account) => (
              <ServiceCard
                key={account.id}
                service={{ ...account, icon: Sparkles }}
                isConnected={llm.isConnected(account.id)}
                isConnecting={llm.connecting === account.id}
                anyConnecting={llm.connecting !== null}
                loading={llm.loading}
                onConnect={llm.connect}
                onDisconnect={llm.disconnect}
              />
            ))}
          </div>
        </AccordionContent>
      </AccordionItem>

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
