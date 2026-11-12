import axios from 'axios'

const configuredApiUrl = import.meta.env.VITE_API_URL?.trim().replace(/\/+$/, '')
const apiRoot = configuredApiUrl?.replace(/\/api$/i, '') ?? ''

export const api = axios.create({
  baseURL: apiRoot,
  headers: {
    Accept: 'application/json',
  },
})

export const AUTH_TOKEN_KEY = 'erpgO.auth.token'
export const SESSION_EXPIRED_EVENT = 'erpgO:session-expired'

api.interceptors.request.use((config) => {
  const token = window.sessionStorage.getItem(AUTH_TOKEN_KEY)

  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }

  return config
})

api.interceptors.response.use(
  (response) => response,
  (error: unknown) => {
    if (
      axios.isAxiosError(error) &&
      error.response?.status === 401 &&
      !error.config?.url?.endsWith('/api/auth/login')
    ) {
      window.sessionStorage.removeItem(AUTH_TOKEN_KEY)
      window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT))
    }

    return Promise.reject(error)
  },
)

export function getPublicStorageUrl(imagePath: string): string {
  const normalizedPath = imagePath
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/')
  const backendOrigin = apiRoot
    ? new URL(apiRoot, window.location.origin).origin
    : window.location.origin

  return new URL(`/storage/${normalizedPath}`, backendOrigin).toString()
}
