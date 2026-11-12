import { useEffect, useState, type FormEvent } from 'react'
import {
  ArrowRight,
  Bird,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Leaf,
  LockKeyhole,
  Mail,
  ShieldCheck,
  Sprout,
} from 'lucide-react'
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from 'react-router-dom'
import {
  AuthProvider,
  getSignInError,
  portalLabels,
  useAuth,
  type UserRole,
} from '@/auth/AuthContext'
import SecretaryLayout from '@/app/SecretaryLayout'
import SecretaryOverview from '@/app/SecretaryOverview'
import PurchaseList from '@/app/PurchaseList'
import CreatePurchase from '@/app/CreatePurchase'

function BrandMark({ imageUrl, compact = false }: { imageUrl?: string; compact?: boolean }) {
  const [imageFailed, setImageFailed] = useState(false)

  return (
    <span className={`brand-mark${compact ? ' brand-mark--compact' : ''}`}>
      {imageUrl && !imageFailed && (
        <img src={imageUrl} alt="Company logo" onError={() => setImageFailed(true)} />
      )}
      {(!imageUrl || imageFailed) && <Bird aria-hidden="true" />}
    </span>
  )
}

function RoleLabel({ role }: { role: UserRole }) {
  return (
    <span className="role-label">
      <ShieldCheck aria-hidden="true" size={15} />
      {role}
    </span>
  )
}

function getRouteNotice(value: unknown): {
  secretaryAccessDenied: boolean
  logoutWarning: boolean
} {
  if (typeof value !== 'object' || value === null) {
    return {
      secretaryAccessDenied: false,
      logoutWarning: false,
    }
  }

  const state = value as Record<string, unknown>

  return {
    secretaryAccessDenied: state.secretaryAccessDenied === true,
    logoutWarning: state.logoutWarning === true,
  }
}

function LoginExperience() {
  const { user, isCheckingSession, sessionNotice, companyBranding, signIn, signOut } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<
    Partial<Record<'email' | 'password', string>>
  >({})
  const [signOutError, setSignOutError] = useState<string | null>(null)
  const routeNotice = getRouteNotice(location.state)

  useEffect(() => {
    if (!isCheckingSession && user?.role === 'Secretary') {
      navigate('/secretary', { replace: true, state: null })
    }
  }, [isCheckingSession, navigate, user])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (isSubmitting) return

    setIsSubmitting(true)
    setSignOutError(null)
    setErrorMessage(null)
    setFieldErrors({})

    try {
      await signIn(email.trim(), password)
      setPassword('')
    } catch (error: unknown) {
      const result = getSignInError(error)
      setErrorMessage(result.message)
      setFieldErrors(result.fields)
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleSignOut() {
    setSignOutError(null)
    try {
      await signOut()
      setEmail('')
      setPassword('')
      navigate('/', { replace: true, state: null })
    } catch {
      setSignOutError('Your local session was cleared, but the server could not confirm sign-out.')
    }
  }

  const companyTitle = companyBranding?.titleEn || 'ERPGO'

  return (
    <main className="login-shell">
      <section className="brand-panel" aria-label="ERPGO company information">
        <div className="brand-panel__texture" aria-hidden="true" />
        <header className="brand-header">
          <BrandMark imageUrl={companyBranding?.logoUrl} />
          <div className="brand-header__wordmark">
            <span>{companyTitle}</span>
            <small>POULTRY · OPERATIONS · GROWTH</small>
          </div>
        </header>

        <div className="brand-story">
          <div className="eyebrow"><span /> ONE CONNECTED BUSINESS</div>
          <h1>Better business<br />starts <em>together.</em></h1>
          <p>
            A clearer view of your poultry business, from the first flock to the final delivery.
          </p>
          <div className="brand-story__illustration" aria-hidden="true">
            <span className="illustration-halo" />
            <span className="illustration-egg"><Bird /></span>
            <span className="illustration-leaf illustration-leaf--one"><Leaf /></span>
            <span className="illustration-leaf illustration-leaf--two"><Sprout /></span>
            <span className="illustration-sun" />
            <span className="illustration-ground" />
            <span className="illustration-stats">
              <span className="illustration-stats__icon"><CheckCircle2 /></span>
              <span><b>Everything in sync</b><small>One workspace for your team</small></span>
            </span>
          </div>
        </div>

        <footer className="brand-footer">
          <span><ShieldCheck size={15} aria-hidden="true" /> Secure access for your team</span>
          <span>Built for better operations</span>
        </footer>
      </section>

      <section className="login-panel">
        <div className="login-panel__topline">
          <div className="mobile-brand">
            <BrandMark imageUrl={companyBranding?.logoUrl} compact />
            <span>{companyTitle}</span>
          </div>
          <span className="secure-note"><LockKeyhole size={14} aria-hidden="true" /> Secure sign in</span>
        </div>

        <div className="login-content">
          {isCheckingSession ? (
            <div className="session-loading" role="status">
              <span className="loading-spinner" />
              <span>Checking your secure session…</span>
            </div>
          ) : user ? (
            <div className="signed-in-card">
              <div className="signed-in-icon"><CheckCircle2 aria-hidden="true" /></div>
              <p className="form-eyebrow">ACCESS CONFIRMED</p>
              <h2>Welcome, {user.name.split(' ')[0]}.</h2>
              <p className="signed-in-copy">
                You’re signed in to ERPGO. Your account is recognized for the
                {' '}{portalLabels[user.role]}.
              </p>
              {routeNotice.secretaryAccessDenied && (
                <p className="form-alert form-alert--error" role="alert">
                  Secretary access is restricted to Secretary accounts.
                </p>
              )}
              {routeNotice.logoutWarning && (
                <p className="form-alert form-alert--notice" role="status">
                  Your local session ended, but the server could not confirm sign-out.
                </p>
              )}
              <RoleLabel role={user.role} />
              {signOutError && <p className="form-alert form-alert--error" role="alert">{signOutError}</p>}
              <button className="secondary-button" type="button" onClick={handleSignOut}>
                Sign out
              </button>
            </div>
          ) : (
            <>
              <div className="form-heading">
                <p className="form-eyebrow">WELCOME TO ERPGO</p>
                <h2>Sign in to your<br /><span>workspace.</span></h2>
                <p>Use your work email and password to continue.</p>
              </div>

              {routeNotice.logoutWarning && (
                <div className="form-alert form-alert--notice" role="status">
                  Your local session ended, but the server could not confirm sign-out.
                </div>
              )}
              {sessionNotice && (
                <div className="form-alert form-alert--notice" role="status">
                  {sessionNotice}
                </div>
              )}
              {signOutError && (
                <div className="form-alert form-alert--error" role="alert">
                  {signOutError}
                </div>
              )}
              {errorMessage && (
                <div className="form-alert form-alert--error" role="alert">
                  <span>{errorMessage}</span>
                </div>
              )}

              <form className="login-form" onSubmit={handleSubmit}>
                <div className="form-field">
                  <label htmlFor="email">Work email</label>
                  <div className={`input-wrap${fieldErrors.email ? ' input-wrap--invalid' : ''}`}>
                    <Mail className="input-icon" size={18} aria-hidden="true" />
                    <input
                      id="email"
                      name="email"
                      type="email"
                      autoComplete="email"
                      placeholder="name@company.com"
                      value={email}
                      onChange={(event) => {
                        setEmail(event.target.value)
                        setFieldErrors((previous) => ({ ...previous, email: undefined }))
                      }}
                      aria-invalid={Boolean(fieldErrors.email)}
                      aria-describedby={fieldErrors.email ? 'email-error' : undefined}
                      required
                      disabled={isSubmitting}
                    />
                  </div>
                  {fieldErrors.email && <span className="field-error" id="email-error">{fieldErrors.email}</span>}
                </div>

                <div className="form-field">
                  <label htmlFor="password">Password</label>
                  <div className={`input-wrap${fieldErrors.password ? ' input-wrap--invalid' : ''}`}>
                    <KeyRound className="input-icon" size={18} aria-hidden="true" />
                    <input
                      id="password"
                      name="password"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="current-password"
                      placeholder="Enter your password"
                      value={password}
                      onChange={(event) => {
                        setPassword(event.target.value)
                        setFieldErrors((previous) => ({ ...previous, password: undefined }))
                      }}
                      aria-invalid={Boolean(fieldErrors.password)}
                      aria-describedby={fieldErrors.password ? 'password-error' : undefined}
                      required
                      disabled={isSubmitting}
                    />
                    <button
                      className="password-toggle"
                      type="button"
                      onClick={() => setShowPassword((visible) => !visible)}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      aria-pressed={showPassword}
                      disabled={isSubmitting}
                    >
                      {showPassword
                        ? <EyeOff size={18} aria-hidden="true" />
                        : <Eye size={18} aria-hidden="true" />}
                    </button>
                  </div>
                  {fieldErrors.password && <span className="field-error" id="password-error">{fieldErrors.password}</span>}
                </div>

                <button className="primary-button" type="submit" disabled={isSubmitting}>
                  {isSubmitting ? (
                    <>
                      <span className="button-spinner" aria-hidden="true" />
                      Signing in…
                    </>
                  ) : (
                    <>
                      Sign in
                      <ArrowRight size={18} aria-hidden="true" />
                    </>
                  )}
                </button>
              </form>

              <p className="form-footnote">
                <ShieldCheck size={15} aria-hidden="true" />
                Your account access is managed by your ERPGO administrator.
              </p>
            </>
          )}
        </div>

        <footer className="login-footer">
          <span>© {new Date().getFullYear()} ERPGO</span>
          <span>One business. One clear view.</span>
        </footer>
      </section>
    </main>
  )
}

function ProtectedSecretaryRoute() {
  const { user, isCheckingSession } = useAuth()

  if (isCheckingSession) {
    return (
      <div className="secretary-route-loading" role="status">
        <span className="loading-spinner" />
        <span>Checking your secure session…</span>
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/" replace />
  }

  if (user.role !== 'Secretary') {
    return <Navigate to="/" replace state={{ secretaryAccessDenied: true }} />
  }

  return <SecretaryLayout />
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<LoginExperience />} />
          <Route path="/secretary" element={<ProtectedSecretaryRoute />}>
            <Route index element={<SecretaryOverview />} />
            <Route path="purchases" element={<PurchaseList />} />
            <Route path="purchases/create" element={<CreatePurchase />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
