import { MessageSquareText } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useRegisterTextbee, useSmsGatewayStatus } from '../api/hooks'
import type { SmsGatewayRegistered } from '../api/types'
import { useToast } from './Toast'
import { errorMessage } from './ui'

/** Dashboard panel: connect the textbee app on the helpline phone to this server, so SMS to the
 * helpline land in the review queue. */
export function SmsGatewayPanel() {
  const status = useSmsGatewayStatus()
  const connect = useRegisterTextbee()
  const toast = useToast()
  const [publicUrl, setPublicUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [connected, setConnected] = useState<SmsGatewayRegistered | null>(null)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const url = publicUrl.trim().replace(/\/+$/, '')
    if (!/^https:\/\/[A-Za-z0-9.-]+(:\d+)?$/.test(url))
      return setError('Enter the https:// address from cloudflared.')
    setError(null)
    connect.mutate(
      { public_url: url, api_key: apiKey.trim() || undefined },
      {
        onSuccess: (r) => {
          setConnected(r)
          setApiKey('')
          toast('Connected.')
        },
        onError: (err) => setError(errorMessage(err, "Couldn't connect.")),
      },
    )
  }

  return (
    <section aria-labelledby="smsgw-h" className="card flex flex-col gap-4 p-5">
      <h2 id="smsgw-h" className="flex items-center gap-2 font-semibold">
        <MessageSquareText size={18} aria-hidden="true" className="text-muted" /> SMS to the
        helpline number
      </h2>

      <form
        onSubmit={submit}
        noValidate
        className="grid gap-3 sm:grid-cols-[2fr_2fr_auto] sm:items-end"
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
            placeholder={status.data?.textbee_has_api_key ? 'From .env' : ''}
          />
        </div>
        <button
          type="submit"
          className="btn btn-primary min-h-11"
          disabled={connect.isPending || status.data?.textbee_configured === false}
        >
          {connect.isPending ? 'Connecting…' : 'Connect'}
        </button>
      </form>
      {error && (
        <p role="alert" className="text-sm font-medium text-rejected">
          {error}
        </p>
      )}
      {connected && (
        <p className="text-sm text-muted" aria-live="polite">
          Connected to <code dir="ltr">{connected.webhook_url}</code>
        </p>
      )}
    </section>
  )
}
