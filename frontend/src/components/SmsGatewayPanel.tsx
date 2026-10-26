import { CheckCircle2, CircleAlert, MessageSquareText } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useRegisterSmsGateway, useRegisterTextbee, useSmsGatewayStatus } from '../api/hooks'
import type { SmsGatewayRegistered } from '../api/types'
import { relativeTime } from '../lib/format'
import { useToast } from './Toast'
import { Skeleton, errorMessage } from './ui'

type Provider = 'textbee' | 'smsgate'

const TUNNEL_CMD = 'cloudflared tunnel --url http://localhost:8000'

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

/** Dashboard panel: SMS sent to the helpline SIM, forwarded by an SMS gateway app on the helpline
 * phone (textbee, or SMS Gateway for Android). Shows whether texts are arriving and connects the
 * gateway's webhook in one click. */
export function SmsGatewayPanel() {
  const status = useSmsGatewayStatus()
  const smsgate = useRegisterSmsGateway()
  const tb = useRegisterTextbee()
  const toast = useToast()
  const [provider, setProvider] = useState<Provider>('textbee')
  const [publicUrl, setPublicUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [connected, setConnected] = useState<SmsGatewayRegistered | null>(null)
  const s = status.data
  const busy = smsgate.isPending || tb.isPending
  const ready = provider === 'textbee' ? s?.textbee_configured : s?.configured
  const replyOn = provider === 'textbee' ? s?.textbee_reply_enabled : s?.reply_enabled

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const url = publicUrl.trim().replace(/\/+$/, '')
    if (!/^https:\/\/[A-Za-z0-9.-]+(:\d+)?$/.test(url))
      return setError(
        'Paste the https:// address cloudflared printed, e.g. https://abc.trycloudflare.com',
      )
    setError(null)
    const done = {
      onSuccess: (r: SmsGatewayRegistered) => {
        setConnected(r)
        setApiKey('')
        setPassword('')
        toast(
          r.replaced
            ? 'Connected. The old address was replaced.'
            : 'Connected. Send a test SMS to the helpline.',
        )
      },
      onError: (err: Error) => setError(errorMessage(err, "Couldn't connect the gateway.")),
    }
    if (provider === 'textbee')
      tb.mutate({ public_url: url, api_key: apiKey.trim() || undefined }, done)
    else
      smsgate.mutate(
        {
          public_url: url,
          username: username.trim() || undefined,
          password: password || undefined,
        },
        done,
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
          Texts sent to the helpline SIM are forwarded by an SMS gateway app on the helpline phone
          and land in the review queue as SMS reports.
        </p>
      </div>

      <fieldset className="flex flex-wrap gap-2">
        <legend className="label">App on the helpline phone</legend>
        {(
          [
            ['textbee', 'textbee'],
            ['smsgate', 'SMS Gateway for Android'],
          ] as const
        ).map(([value, label]) => (
          <label
            key={value}
            className={`inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border px-4 text-sm font-medium ${
              provider === value ? 'border-primary bg-primary text-on-primary' : 'border-border'
            }`}
          >
            <input
              type="radio"
              name="sms-provider"
              value={value}
              checked={provider === value}
              onChange={() => {
                setProvider(value)
                setError(null)
                setConnected(null)
              }}
              className="sr-only"
            />
            {label}
          </label>
        ))}
      </fieldset>

      {status.isPending ? (
        <Skeleton className="h-24" />
      ) : s ? (
        <>
          <ul className="flex flex-col gap-1.5">
            <Check ok={!!ready}>
              {ready
                ? 'Signing secret set on the server.'
                : provider === 'textbee'
                  ? 'Set TEXTBEE_SIGNING_SECRET (20+ characters) in .env and restart the backend.'
                  : 'Set SMS_GATEWAY_SIGNING_KEY in .env and restart the backend.'}
            </Check>
            <Check ok={s.received_24h > 0}>
              {s.last_received_at
                ? `Last SMS ${relativeTime(s.last_received_at)} · ${s.received_24h} in the last 24 h`
                : 'No forwarded SMS yet.'}
            </Check>
            <Check ok={!!replyOn}>
              {replyOn
                ? 'Senders get the reference number back by SMS.'
                : provider === 'textbee'
                  ? 'Reply SMS off (optional: TEXTBEE_REPLY=true and TEXTBEE_API_KEY in .env).'
                  : 'Reply SMS off (optional: SMS_GATEWAY_REPLY=true with the gateway username/password).'}
            </Check>
          </ul>

          <details className="rounded-lg border border-border bg-surface-2 p-3 text-sm" open>
            <summary className="cursor-pointer font-medium">Set up the helpline phone</summary>
            {provider === 'textbee' ? (
              <ol className="mt-2 flex list-decimal flex-col gap-1.5 pl-5">
                <li>
                  Create a free account at{' '}
                  <a href="https://textbee.dev" target="_blank" rel="noreferrer" className="link">
                    textbee.dev
                  </a>{' '}
                  and open its dashboard.
                </li>
                <li>
                  Click <strong>Register device</strong> / <strong>Add device</strong>: it shows a
                  QR code. In the textbee app on the helpline phone, scan it.
                </li>
                <li>
                  In the app, allow SMS access and switch on <strong>Receive SMS</strong>.
                </li>
                <li>
                  Copy the <strong>API key</strong> from the textbee dashboard.
                </li>
                <li>
                  On this laptop run <code>{TUNNEL_CMD}</code> and copy the https address it prints.
                  Only the webhooks are reachable through it.
                </li>
                <li>Paste both below and click Connect. The signing secret is sent for you.</li>
              </ol>
            ) : (
              <ol className="mt-2 flex list-decimal flex-col gap-1.5 pl-5">
                <li>
                  Install SMS Gateway for Android, allow SMS access and turn on{' '}
                  <strong>Cloud Server</strong>.
                </li>
                <li>
                  In the app, <strong>Settings → Webhooks → Signing Key</strong>: enter the{' '}
                  <code>SMS_GATEWAY_SIGNING_KEY</code> value from the server's <code>.env</code>.
                </li>
                <li>
                  On this laptop run <code>{TUNNEL_CMD}</code> and copy the https address.
                </li>
                <li>Paste it below with the app's Cloud Server username and password.</li>
              </ol>
            )}
          </details>

          <form
            onSubmit={submit}
            noValidate
            className={`grid gap-3 sm:items-end ${
              provider === 'textbee'
                ? 'sm:grid-cols-[2fr_2fr_auto]'
                : 'sm:grid-cols-[2fr_1fr_1fr_auto]'
            }`}
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
            {provider === 'textbee' ? (
              <div>
                <label htmlFor="smsgw-key" className="label">
                  textbee API key
                </label>
                <input
                  id="smsgw-key"
                  className="input"
                  type="password"
                  autoComplete="off"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={s.textbee_has_api_key ? 'From .env' : ''}
                />
              </div>
            ) : (
              <>
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
              </>
            )}
            <button type="submit" className="btn btn-primary min-h-11" disabled={busy || !ready}>
              {busy ? 'Connecting…' : 'Connect'}
            </button>
          </form>
          {error && (
            <p role="alert" className="text-sm font-medium text-rejected">
              {error}
            </p>
          )}
          {connected && (
            <p className="text-sm text-muted" aria-live="polite">
              Texts are forwarded to <code dir="ltr">{connected.webhook_url}</code>. The address
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
