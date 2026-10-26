import { CheckCircle2, CircleAlert, MessageSquareText } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useRegisterSmsGateway, useSmsGatewayStatus } from '../api/hooks'
import { relativeTime } from '../lib/format'
import { useToast } from './Toast'
import { Skeleton, errorMessage } from './ui'

function Check({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  const Icon = ok ? CheckCircle2 : CircleAlert
  return (
    <li className="flex items-start gap-2 text-sm">
      <Icon
        size={16}
        aria-hidden="true"
        className={`mt-0.5 shrink-0 ${ok ? 'text-verified-ink' : 'text-muted'}`}
      />
      <span>
        <span className="sr-only">{ok ? 'Done: ' : 'To do: '}</span>
        {children}
      </span>
    </li>
  )
}

/** Dashboard panel: SMS sent to the helpline SIM, forwarded by "SMS Gateway for Android" on the
 * helpline phone. Shows whether texts are arriving and registers the webhook in one click. */
export function SmsGatewayPanel() {
  const status = useSmsGatewayStatus()
  const register = useRegisterSmsGateway()
  const toast = useToast()
  const [publicUrl, setPublicUrl] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const s = status.data

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const url = publicUrl.trim().replace(/\/+$/, '')
    if (!/^https:\/\/[A-Za-z0-9.-]+(:\d+)?$/.test(url))
      return setError(
        'Paste the https:// address cloudflared printed, e.g. https://abc.trycloudflare.com',
      )
    setError(null)
    register.mutate(
      { public_url: url, username: username.trim() || undefined, password: password || undefined },
      {
        onSuccess: (r) => {
          setPassword('')
          toast(
            r.replaced
              ? `Connected. Replaced ${r.replaced} old address.`
              : 'Connected. Send a test SMS to the helpline.',
          )
        },
        onError: (err) => setError(errorMessage(err, "Couldn't connect the gateway.")),
      },
    )
  }

  return (
    <section aria-labelledby="smsgw-h" className="card flex flex-col gap-4 p-5">
      <div>
        <h2 id="smsgw-h" className="flex items-center gap-2 font-semibold">
          <MessageSquareText size={18} aria-hidden="true" className="text-primary" /> SMS to the
          helpline number
        </h2>
        <p className="max-w-3xl text-sm text-muted">
          Texts sent to the helpline SIM are forwarded by the free{' '}
          <a href="https://sms-gate.app" target="_blank" rel="noreferrer" className="link">
            SMS Gateway for Android
          </a>{' '}
          app on the helpline phone, and land in the review queue as SMS reports.
        </p>
      </div>

      {status.isPending ? (
        <Skeleton className="h-24" />
      ) : s ? (
        <>
          <ul className="flex flex-col gap-1.5">
            <Check ok={s.configured}>
              {s.configured
                ? 'Signing key set on the server.'
                : 'Set SMS_GATEWAY_SIGNING_KEY in .env and restart the backend.'}
            </Check>
            <Check ok={s.received_24h > 0}>
              {s.last_received_at
                ? `Last SMS ${relativeTime(s.last_received_at)} · ${s.received_24h} in the last 24 h`
                : 'No forwarded SMS yet.'}
            </Check>
            <Check ok={s.reply_enabled}>
              {s.reply_enabled
                ? 'Senders get the reference number back by SMS.'
                : 'Reply SMS off (optional: SMS_GATEWAY_REPLY=true with the gateway username/password).'}
            </Check>
          </ul>

          <details className="rounded-lg border border-border bg-surface-2 p-3 text-sm">
            <summary className="cursor-pointer font-medium">Set up the helpline phone</summary>
            <ol className="mt-2 flex list-decimal flex-col gap-1.5 pl-5">
              <li>
                On the phone with the helpline SIM, install SMS Gateway for Android, allow SMS
                access and turn on <strong>Cloud Server</strong>.
              </li>
              <li>
                In the app, <strong>Settings → Webhooks → Signing Key</strong>: enter the{' '}
                <code>SMS_GATEWAY_SIGNING_KEY</code> value from the server's <code>.env</code>.
              </li>
              <li>
                On the server laptop, run{' '}
                <code>cloudflared tunnel --url http://localhost:8000</code> and copy the https
                address it prints. Only the webhooks are reachable through it.
              </li>
              <li>Paste the address below with the app's Cloud Server username and password.</li>
            </ol>
          </details>

          <form
            onSubmit={submit}
            noValidate
            className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr_auto] sm:items-end"
          >
            <div>
              <label htmlFor="smsgw-url" className="label">
                Public address (cloudflared)
              </label>
              <input
                id="smsgw-url"
                className="input"
                dir="ltr"
                inputMode="url"
                value={publicUrl}
                onChange={(e) => setPublicUrl(e.target.value)}
                placeholder="https://abc.trycloudflare.com"
              />
            </div>
            <div>
              <label htmlFor="smsgw-user" className="label">
                Gateway username
              </label>
              <input
                id="smsgw-user"
                className="input"
                autoComplete="off"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder={s.has_credentials ? 'From .env' : ''}
              />
            </div>
            <div>
              <label htmlFor="smsgw-pass" className="label">
                Gateway password
              </label>
              <input
                id="smsgw-pass"
                className="input"
                type="password"
                autoComplete="off"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={s.has_credentials ? 'From .env' : ''}
              />
            </div>
            <button
              type="submit"
              className="btn btn-primary min-h-11"
              disabled={register.isPending || !s.configured}
            >
              {register.isPending ? 'Connecting…' : 'Connect'}
            </button>
          </form>
          {error && (
            <p role="alert" className="text-sm font-medium text-rejected">
              {error}
            </p>
          )}
          {register.data && (
            <p className="text-sm text-muted" aria-live="polite">
              Texts are forwarded to <code dir="ltr">{register.data.webhook_url}</code>. The address
              changes when cloudflared restarts; connect again then.
            </p>
          )}
        </>
      ) : (
        <p className="text-sm text-rejected">
          {errorMessage(status.error, "Couldn't load the status.")}
        </p>
      )}
    </section>
  )
}
