import axios from 'axios'
import { refreshAccessToken } from './tokenRefresh.mjs'

const API_URL = process.env.NEXT_PUBLIC_API_URL || '/api'

const api = axios.create({
    baseURL: API_URL,
    headers: {
        // 'Content-Type': 'application/json', // Let axios set this automatically
    },
})

// Add a request interceptor to add the auth token
api.interceptors.request.use(
    (config) => {
        const token = localStorage.getItem('accessToken')
        if (token) {
            config.headers.Authorization = `Bearer ${token}`
        }
        return config
    },
    (error) => Promise.reject(error)
)

// Add a response interceptor to handle 401s (token expiration)
api.interceptors.response.use(
    (response) => response,
    async (error) => {
        const originalRequest = error.config

        // If 401 and not already retrying
        if (error.response?.status === 401 && !originalRequest._retry) {
            originalRequest._retry = true

            const failedAccess = String(originalRequest.headers?.Authorization || '').replace(/^Bearer /i, '')
            try {
                const access = await refreshAccessToken(failedAccess)
                originalRequest.headers.Authorization = `Bearer ${access}`
                return api(originalRequest)
            } catch (refreshError: any) {
                // A network/server error is not a reason to destroy a valid session.
                if (refreshError?.status === 401 || refreshError?.status === 403) {
                    localStorage.removeItem('accessToken')
                    localStorage.removeItem('refreshToken')
                    window.location.href = '/login'
                }
                return Promise.reject(refreshError)
            }
        }
        return Promise.reject(error)
    }
)

export default api
