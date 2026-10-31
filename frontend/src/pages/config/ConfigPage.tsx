import { useEffect, useState, type FormEvent } from 'react'
import {
  KeyRound,
  Loader2,
  LogOut,
  Save,
  Settings,
  ShieldCheck,
} from 'lucide-react'

import ErrorAlert from '../../components/ErrorAlert'
import PageHeader from '../../components/PageHeader'
import { Button } from '../../components/ui/button'
import {
  AdminApiError,
  changeAdminCredentials,
  fetchAdminSettings,
  loginAdmin,
  saveAdminSettings,
  type AdminSettings,
} from '../../lib/admin-api'

const TOKEN_KEY = 'via-admin-token'
const FIELD =
  'h-11 w-full rounded-lg border border-white/20 bg-black/20 px-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-blue-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-2'
const LABEL = 'block text-xs font-medium uppercase tracking-wide text-muted-foreground'
const CARD =
  'rounded-2xl border border-white/10 bg-white/5 p-5 shadow-lg backdrop-blur-sm sm:p-6'

const errorMessage = (error: unknown): string =>
  error instanceof AdminApiError
    ? error.message
    : error instanceof Error
      ? error.message
      : 'Something went wrong.'

const numberValue = (value: string, fallback: number): number => {
  const parsed = Number.parseInt(value, 10)
  return Number.isSafeInteger(parsed) ? parsed : fallback
}

function LoginCard({
  onSignedIn,
}: {
  onSignedIn: (token: string) => void
}) {
  const [username, setUsername] = useState('admin')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const result = await loginAdmin(username, password)
      sessionStorage.setItem(TOKEN_KEY, result.token)
      onSignedIn(result.token)
    } catch (loginError) {
      setError(errorMessage(loginError))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className={`${CARD} mx-auto flex w-full max-w-md flex-col gap-4`}>
      <div className="flex items-center gap-2 text-sm font-semibold">
        <KeyRound className="h-4 w-4 text-blue-300" aria-hidden="true" />
        Admin sign-in
      </div>
      {error && <ErrorAlert message={error} />}
      <label className={LABEL} htmlFor="admin-username">
        Username
      </label>
      <input
        id="admin-username"
        className={FIELD}
        value={username}
        onChange={(event) => setUsername(event.target.value)}
        autoComplete="username"
        autoCapitalize="off"
        spellCheck={false}
        required
      />
      <label className={LABEL} htmlFor="admin-password">
        Password
      </label>
      <input
        id="admin-password"
        className={FIELD}
        type="password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        autoComplete="current-password"
        required
      />
      <Button type="submit" disabled={busy} className="h-11 bg-[#2E8B73] text-white">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
        Sign in
      </Button>
      <p className="text-xs text-muted-foreground">
        The admin page is only served on 127.0.0.1. The default account is
        admin / admin; change it immediately after signing in.
      </p>
    </form>
  )
}

export default function ConfigPage() {
  const [token, setToken] = useState<string | null>(() =>
    typeof window === 'undefined' ? null : sessionStorage.getItem(TOKEN_KEY),
  )
  const [settings, setSettings] = useState<AdminSettings | null>(null)
  const [loading, setLoading] = useState(Boolean(token))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newUsername, setNewUsername] = useState('admin')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  useEffect(() => {
    if (!token) return

    let cancelled = false
    fetchAdminSettings(token)
      .then((next) => {
        if (cancelled) return
        setSettings(next)
        setNewUsername(next.admin.username)
      })
      .catch((loadError: unknown) => {
        if (cancelled) return
        if (loadError instanceof AdminApiError && loadError.status === 401) {
          sessionStorage.removeItem(TOKEN_KEY)
          setToken(null)
          setSettings(null)
          setError('The admin session expired. Sign in again.')
        } else {
          setError(errorMessage(loadError))
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [token])

  const signOut = () => {
    sessionStorage.removeItem(TOKEN_KEY)
    setToken(null)
    setSettings(null)
    setLoading(false)
    setNotice(null)
    setError(null)
  }

  const change =
    <K extends keyof AdminSettings>(
      section: K,
      patch: Partial<AdminSettings[K]>,
    ) => {
      setSettings((current) =>
        current ? { ...current, [section]: { ...current[section], ...patch } } : current,
      )
    }

  const save = async () => {
    if (!token || !settings) return
    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      const next = await saveAdminSettings(token, settings)
      setSettings(next)
      setNotice('Settings saved. New sessions and sockets use them immediately.')
    } catch (saveError) {
      setError(errorMessage(saveError))
    } finally {
      setSaving(false)
    }
  }

  const changeCredentials = async (event: FormEvent) => {
    event.preventDefault()
    if (!token) return
    if (newPassword !== confirmPassword) {
      setError('The new passwords do not match.')
      return
    }

    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      const result = await changeAdminCredentials(
        token,
        currentPassword,
        newUsername,
        newPassword,
      )
      sessionStorage.setItem(TOKEN_KEY, result.token)
      setLoading(true)
      setToken(result.token)
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setNotice('Admin credentials changed. Other admin sessions were signed out.')
    } catch (changeError) {
      setError(errorMessage(changeError))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 pt-2 sm:pt-6">
      <PageHeader
        icon={<Settings className="h-8 w-8 text-blue-300 md:h-12 md:w-12" aria-hidden="true" />}
        title="Admin."
        description="Host-only settings for this Via instance."
      />

      <div className="rounded-xl border border-blue-400/20 bg-blue-500/10 px-4 py-3 text-sm text-blue-100">
        This page is served only on <span className="font-mono">127.0.0.1</span>.
        Open <span className="font-mono">http://127.0.0.1:8081/config</span> on
        the host machine; the public Via address returns 404 for this route.
      </div>

      {error && <ErrorAlert message={error} />}
      {notice && (
        <div className="rounded-xl border border-emerald-400/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
          {notice}
        </div>
      )}

      {!token ? (
        <LoginCard
          onSignedIn={(nextToken) => {
            setLoading(true)
            setToken(nextToken)
            setError(null)
          }}
        />
      ) : loading ? (
        <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
          Loading settings…
        </div>
      ) : settings ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <ShieldCheck className="h-4 w-4 text-emerald-300" aria-hidden="true" />
              Signed in as <span className="font-mono">{settings.admin.username}</span>
            </div>
            <Button type="button" variant="ghost" onClick={signOut} className="text-muted-foreground">
              <LogOut className="h-4 w-4" aria-hidden="true" />
              Sign out
            </Button>
          </div>

          {settings.admin.mustChangePassword && (
            <div className="rounded-xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
              You are using the default admin password. Change it below before
              editing any other setting.
            </div>
          )}

          <form onSubmit={changeCredentials} className={CARD}>
            <h2 className="mb-4 text-lg font-semibold">Admin account</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className={LABEL} htmlFor="current-password">
                  Current password
                </label>
                <input
                  id="current-password"
                  className={FIELD}
                  type="password"
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                  autoComplete="current-password"
                  required
                />
              </div>
              <div>
                <label className={LABEL} htmlFor="new-username">
                  Username
                </label>
                <input
                  id="new-username"
                  className={FIELD}
                  value={newUsername}
                  onChange={(event) => setNewUsername(event.target.value)}
                  autoComplete="username"
                  required
                />
              </div>
              <div>
                <label className={LABEL} htmlFor="new-password">
                  New password
                </label>
                <input
                  id="new-password"
                  className={FIELD}
                  type="password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  autoComplete="new-password"
                  minLength={8}
                  required
                />
              </div>
              <div>
                <label className={LABEL} htmlFor="confirm-password">
                  Confirm new password
                </label>
                <input
                  id="confirm-password"
                  className={FIELD}
                  type="password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  autoComplete="new-password"
                  minLength={8}
                  required
                />
              </div>
              <div className="flex items-end">
                <Button type="submit" disabled={saving} className="h-11 bg-[#3A5A98] text-white">
                  Change credentials
                </Button>
              </div>
            </div>
          </form>

          <form
            onSubmit={(event) => {
              event.preventDefault()
              void save()
            }}
            className={`${CARD} flex flex-col gap-6`}
          >
            <section className="space-y-4">
              <h2 className="text-lg font-semibold">Short links</h2>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className={LABEL} htmlFor="short-mode">
                    Code style
                  </label>
                  <select
                    id="short-mode"
                    className={FIELD}
                    value={settings.shortLinks.mode}
                    onChange={(event) =>
                      change('shortLinks', {
                        mode: event.target.value as AdminSettings['shortLinks']['mode'],
                      })
                    }
                  >
                    <option value="numeric">Four digits (standard)</option>
                    <option value="alphanumeric">Letters and digits</option>
                  </select>
                </div>
                <div>
                  <label className={LABEL} htmlFor="short-length">
                    Code length
                  </label>
                  <select
                    id="short-length"
                    className={FIELD}
                    value={settings.shortLinks.length}
                    onChange={(event) =>
                      change('shortLinks', {
                        length: numberValue(event.target.value, 4),
                      })
                    }
                  >
                    <option value={4}>4</option>
                    <option value={5}>5</option>
                    <option value={6}>6</option>
                  </select>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Existing links keep resolving after a mode change. The four-digit
                numeric space has 10,000 possible codes; longer alphanumeric codes
                have a much larger space.
              </p>
            </section>

            <section className="space-y-4 border-t border-white/10 pt-6">
              <h2 className="text-lg font-semibold">Sessions</h2>
              <div className="grid gap-4 sm:grid-cols-2">
                {(
                  [
                    ['ttlSeconds', 'Initial TTL (seconds)'],
                    ['refreshTtlSeconds', 'Refresh TTL (seconds)'],
                    ['maxLifetimeSeconds', 'Maximum lifetime (seconds)'],
                    ['expiryWarningSeconds', 'Expiry warning (seconds)'],
                    ['completedTtlSeconds', 'Post-completion TTL (seconds)'],
                  ] as const
                ).map(([key, label]) => (
                  <div key={key}>
                    <label className={LABEL} htmlFor={`session-${key}`}>
                      {label}
                    </label>
                    <input
                      id={`session-${key}`}
                      className={FIELD}
                      type="number"
                      min={0}
                      value={settings.sessions[key]}
                      onChange={(event) =>
                        change('sessions', {
                          [key]: numberValue(event.target.value, settings.sessions[key]),
                        })
                      }
                    />
                  </div>
                ))}
              </div>
            </section>

            <section className="space-y-4 border-t border-white/10 pt-6">
              <h2 className="text-lg font-semibold">Limits</h2>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className={LABEL} htmlFor="max-sessions">
                    Sessions per peer
                  </label>
                  <input
                    id="max-sessions"
                    className={FIELD}
                    type="number"
                    min={1}
                    value={settings.limits.maxActiveSessionsPerPeer}
                    onChange={(event) =>
                      change('limits', {
                        maxActiveSessionsPerPeer: numberValue(
                          event.target.value,
                          settings.limits.maxActiveSessionsPerPeer,
                        ),
                      })
                    }
                  />
                </div>
                <div>
                  <label className={LABEL} htmlFor="max-sockets">
                    Sockets per IP
                  </label>
                  <input
                    id="max-sockets"
                    className={FIELD}
                    type="number"
                    min={1}
                    value={settings.limits.maxSocketsPerIp}
                    onChange={(event) =>
                      change('limits', {
                        maxSocketsPerIp: numberValue(
                          event.target.value,
                          settings.limits.maxSocketsPerIp,
                        ),
                      })
                    }
                  />
                </div>
                <div>
                  <label className={LABEL} htmlFor="max-file-size">
                    Max file size (bytes, 0 = no cap)
                  </label>
                  <input
                    id="max-file-size"
                    className={FIELD}
                    type="number"
                    min={0}
                    value={settings.limits.maxFileSizeBytes}
                    onChange={(event) =>
                      change('limits', {
                        maxFileSizeBytes: numberValue(
                          event.target.value,
                          settings.limits.maxFileSizeBytes,
                        ),
                      })
                    }
                  />
                </div>
                <div>
                  <label className={LABEL} htmlFor="short-attempts">
                    Short-code attempts / minute
                  </label>
                  <input
                    id="short-attempts"
                    className={FIELD}
                    type="number"
                    min={1}
                    value={settings.limits.shortCodeAttemptsPerMinute}
                    onChange={(event) =>
                      change('limits', {
                        shortCodeAttemptsPerMinute: numberValue(
                          event.target.value,
                          settings.limits.shortCodeAttemptsPerMinute,
                        ),
                      })
                    }
                  />
                </div>
              </div>
            </section>

            <section className="space-y-4 border-t border-white/10 pt-6">
              <h2 className="text-lg font-semibold">Network</h2>
              <div>
                <label className={LABEL} htmlFor="stun-urls">
                  STUN URLs (one per line)
                </label>
                <textarea
                  id="stun-urls"
                  className={`${FIELD} min-h-24 py-2 font-mono`}
                  value={settings.network.stunUrls.join('\n')}
                  onChange={(event) =>
                    change('network', {
                      stunUrls: event.target.value
                        .split('\n')
                        .map((entry) => entry.trim())
                        .filter(Boolean),
                    })
                  }
                />
              </div>
              <div>
                <label className={LABEL} htmlFor="turn-urls">
                  TURN URLs (one per line)
                </label>
                <textarea
                  id="turn-urls"
                  className={`${FIELD} min-h-24 py-2 font-mono`}
                  value={settings.network.turnUrls.join('\n')}
                  onChange={(event) =>
                    change('network', {
                      turnUrls: event.target.value
                        .split('\n')
                        .map((entry) => entry.trim())
                        .filter(Boolean),
                    })
                  }
                />
              </div>
              <div className="sm:w-1/2">
                <label className={LABEL} htmlFor="turn-ttl">
                  TURN credential TTL (seconds)
                </label>
                <input
                  id="turn-ttl"
                  className={FIELD}
                  type="number"
                  min={60}
                  value={settings.network.turnCredentialTtlSeconds}
                  onChange={(event) =>
                    change('network', {
                      turnCredentialTtlSeconds: numberValue(
                        event.target.value,
                        settings.network.turnCredentialTtlSeconds,
                      ),
                    })
                  }
                />
              </div>
              <p className="text-xs text-muted-foreground">
                TURN_SECRET, the Redis password and the DuckDNS token stay in the
                deployment environment and are never shown here. Frontend
                build-time values need a rebuild.
              </p>
            </section>

            <div className="flex flex-wrap items-center gap-3 border-t border-white/10 pt-6">
              <Button
                type="submit"
                disabled={saving || settings.admin.mustChangePassword}
                className="h-11 bg-[#2E8B73] text-white"
              >
                {saving ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Save className="h-4 w-4" aria-hidden="true" />
                )}
                Save settings
              </Button>
              {settings.admin.mustChangePassword && (
                <span className="text-xs text-amber-200">
                  Change the default password first.
                </span>
              )}
            </div>
          </form>
        </>
      ) : (
        <div className="space-y-3">
          <ErrorAlert message="Settings could not be loaded." />
          <Button type="button" variant="ghost" onClick={signOut}>
            Back to sign in
          </Button>
        </div>
      )}
    </div>
  )
}
