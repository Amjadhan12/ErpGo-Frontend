import axios from 'axios'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { api, AUTH_TOKEN_KEY, getPublicStorageUrl, SESSION_EXPIRED_EVENT } from '@/lib/api'

export type UserRole = 'Secretary' | 'Customer' | 'Supplier'

export interface AuthUser {
  id: number | string
  name: string
  email: string
  role: UserRole
  is_active: boolean
  business_partner_id: number | string | null
}

interface LoginResponse {
  message: string
  user: unknown
  token: string
  token_type: string
}

interface AuthUserResponse {
  user: unknown
}

interface SettingsResponse {
  data: Array<{
    title_en?: unknown
    title_pa?: unknown
    image_path?: unknown
  }>
}

export interface CompanyBranding {
  titleEn?: string
  titlePa?: string
  logoUrl?: string
}

interface AuthContextValue {
  user: AuthUser | null
  isCheckingSession: boolean
  sessionNotice: string | null
  companyBranding: CompanyBranding | null
  signIn: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

const validRoles: UserRole[] = ['Secretary', 'Customer', 'Supplier']

export const portalLabels: Record<UserRole, string> = {
  Secretary: 'Secretary portal',
  Customer: 'Customer portal',
  Supplier: 'Supplier portal',
}

export const portalPaths: Record<UserRole, string> = {
  Secretary: '/secretary',
  Customer: '/customer',
  Supplier: '/supplier',
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parseUser(value: unknown): AuthUser {
  if (!isRecord(value)) {
    throw new Error('The server returned an invalid user profile.')
  }

  const { id, name, email, role, is_active, business_partner_id } = value
  const validId = typeof id === 'number' || typeof id === 'string'

  if (
    !validId ||
    typeof name !== 'string' ||
    typeof email !== 'string' ||
    typeof role !== 'string' ||
    !validRoles.includes(role as UserRole) ||
    typeof is_active !== 'boolean' ||
    (business_partner_id !== null &&
      business_partner_id !== undefined &&
      typeof business_partner_id !== 'number' &&
      typeof business_partner_id !== 'string')
  ) {
    throw new Error('The server returned an incomplete or unsupported user profile.')
  }

  return {
    id,
    name,
    email,
    role: role as UserRole,
    is_active,
    business_partner_id:
      typeof business_partner_id === 'number' || typeof business_partner_id === 'string'
        ? business_partner_id
        : null,
  }
}

function isLoginResponse(value: unknown): value is LoginResponse {
  return (
    isRecord(value) &&
    typeof value.message === 'string' &&
    typeof value.token === 'string' &&
    value.token.length > 0 &&
    typeof value.token_type === 'string' &&
    value.token_type.toLowerCase() === 'bearer' &&
    'user' in value
  )
}

function isAuthUserResponse(value: unknown): value is AuthUserResponse {
  return isRecord(value) && 'user' in value
}

function clearStoredSession(): void {
  window.sessionStorage.removeItem(AUTH_TOKEN_KEY)
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [isCheckingSession, setIsCheckingSession] = useState(true)
  const [sessionNotice, setSessionNotice] = useState<string | null>(null)
  const [companyBranding, setCompanyBranding] = useState<CompanyBranding | null>(null)

  const clearSession = useCallback(() => {
    clearStoredSession()
    setUser(null)
    setCompanyBranding(null)
  }, [])

  const loadCompanyBranding = useCallback(async () => {
    try {
      const { data } = await api.get<SettingsResponse>('/api/settings')
      const setting = Array.isArray(data.data) ? data.data[0] : undefined
      const branding: CompanyBranding = {}

      if (typeof setting?.title_en === 'string') {
        branding.titleEn = setting.title_en
      }

      if (typeof setting?.title_pa === 'string') {
        branding.titlePa = setting.title_pa
      }

      if (typeof setting?.image_path === 'string' && setting.image_path.trim()) {
        branding.logoUrl = getPublicStorageUrl(setting.image_path)
      }

      setCompanyBranding(branding)
    } catch {
      setCompanyBranding(null)
      console.warn('Company branding could not be loaded.')
    }
  }, [])

  const acceptUser = useCallback(
    (nextUser: AuthUser) => {
      if (!nextUser.is_active) {
        clearSession()
        throw new Error('This account is inactive. Please contact your administrator.')
      }

      setUser(nextUser)
      setSessionNotice(null)
      setCompanyBranding(null)

      if (nextUser.role === 'Secretary') {
        void loadCompanyBranding()
      }
    },
    [clearSession, loadCompanyBranding],
  )

  const signIn = useCallback(
    async (email: string, password: string) => {
      clearSession()
      setSessionNotice(null)

      const response = await api.post<unknown>('/api/auth/login', { email, password })

      if (!isLoginResponse(response.data)) {
        throw new Error('The server returned an unexpected sign-in response.')
      }

      const nextUser = parseUser(response.data.user)

      if (!nextUser.is_active) {
        throw new Error('This account is inactive. Please contact your administrator.')
      }

      window.sessionStorage.setItem(AUTH_TOKEN_KEY, response.data.token)
      acceptUser(nextUser)
    },
    [acceptUser, clearSession],
  )

  const signOut = useCallback(async () => {
    try {
      if (window.sessionStorage.getItem(AUTH_TOKEN_KEY)) {
        await api.post('/api/auth/logout')
      }
    } finally {
      clearSession()
    }
  }, [clearSession])

  useEffect(() => {
    const handleExpiredSession = () => {
      clearSession()
      setSessionNotice('Your session expired. Please sign in again.')
    }

    window.addEventListener(SESSION_EXPIRED_EVENT, handleExpiredSession)

    const token = window.sessionStorage.getItem(AUTH_TOKEN_KEY)

    if (!token) {
      setIsCheckingSession(false)
      return () => window.removeEventListener(SESSION_EXPIRED_EVENT, handleExpiredSession)
    }

    let active = true

    void api
      .get<unknown>('/api/auth/user')
      .then(({ data }) => {
        if (!active) return

        if (!isAuthUserResponse(data)) {
          throw new Error('The server returned an unexpected user response.')
        }

        acceptUser(parseUser(data.user))
      })
      .catch((error: unknown) => {
        if (!active) return

        if (axios.isAxiosError(error) && error.response?.status === 401) {
          clearSession()
          setSessionNotice('Your session expired. Please sign in again.')
        } else if (axios.isAxiosError(error) && error.response?.status === 403) {
          clearSession()
          setSessionNotice('Your account is inactive or is not allowed to continue.')
        } else if (error instanceof Error) {
          clearSession()
          setSessionNotice(error.message)
        } else {
          setSessionNotice(
            'We could not restore your previous session. You can sign in again below.',
          )
        }
      })
      .finally(() => {
        if (active) setIsCheckingSession(false)
      })

    return () => {
      active = false
      window.removeEventListener(SESSION_EXPIRED_EVENT, handleExpiredSession)
    }
  }, [acceptUser, clearSession])

  const value = useMemo(
    () => ({
      user,
      isCheckingSession,
      sessionNotice,
      companyBranding,
      signIn,
      signOut,
    }),
    [user, isCheckingSession, sessionNotice, companyBranding, signIn, signOut],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)

  if (!context) {
    throw new Error('useAuth must be used inside an AuthProvider.')
  }

  return context
}

export function getSignInError(error: unknown): {
  message: string
  fields: Partial<Record<'email' | 'password', string>>
} {
  if (axios.isAxiosError(error)) {
    const responseData: unknown = error.response?.data

    if (isRecord(responseData)) {
      const fieldErrors = isRecord(responseData.errors) ? responseData.errors : {}
      const fields: Partial<Record<'email' | 'password', string>> = {}

      for (const field of ['email', 'password'] as const) {
        const messages = fieldErrors[field]
        if (Array.isArray(messages) && typeof messages[0] === 'string') {
          fields[field] = messages[0]
        }
      }

      if (error.response?.status === 401) {
        return {
          message:
            "We couldn't sign you in. Check your email and password, or contact your administrator if your account may be inactive.",
          fields,
        }
      }

      if (error.response?.status === 422) {
        return {
          message: 'Please check the highlighted fields and try again.',
          fields,
        }
      }

      if (!error.response) {
        return {
          message: "We can't connect to ERPGO right now. Check your connection and try again.",
          fields,
        }
      }
    }
  }

  if (error instanceof Error) {
    return { message: error.message, fields: {} }
  }

  return {
    message: 'Something went wrong while signing in. Please try again.',
    fields: {},
  }
}
