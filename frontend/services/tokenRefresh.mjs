// Both fetch-based auth checks and Axios requests must use the same refresh
// operation because SimpleJWT rotates and blacklists each used refresh token.
export function createTokenRefresher({ storage, request, lock }) {
    let inFlight = null
    async function perform(failedAccess) {
        const currentAccess = storage.getItem('accessToken')
        const refresh = storage.getItem('refreshToken')
        if (!refresh) throw Object.assign(new Error('Keine gültige Sitzung'), { status: 401 })
        if (failedAccess && currentAccess && currentAccess !== failedAccess) return currentAccess
        try {
            const data = await request(refresh)
            if (!data?.access || !data?.refresh) throw new Error('Unvollständige Token-Antwort')
            // Do not overwrite a different login or restore a logged-out session.
            if (storage.getItem('refreshToken') !== refresh) {
                const latest = storage.getItem('accessToken')
                if (latest && storage.getItem('refreshToken')) return latest
                throw Object.assign(new Error('Sitzung beendet'), { status: 401 })
            }
            storage.setItem('refreshToken', data.refresh)
            storage.setItem('accessToken', data.access)
            return data.access
        } catch (error) {
            // Another tab may already have completed rotation.
            const latest = storage.getItem('accessToken')
            if (latest && storage.getItem('refreshToken') && storage.getItem('refreshToken') !== refresh) return latest
            throw error
        }
    }
    return function refreshAccessToken(failedAccess) {
        if (!inFlight) {
            inFlight = Promise.resolve().then(() => lock
                ? lock(() => perform(failedAccess))
                : perform(failedAccess)).finally(() => { inFlight = null })
        }
        return inFlight
    }
}

let refresh
export function refreshAccessToken(failedAccess) {
    if (!refresh) {
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || '/api'
        refresh = createTokenRefresher({
            storage: window.localStorage,
            request: async token => {
                const response = await fetch(apiUrl + '/auth/token/refresh/', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ refresh: token })
                })
                if (!response.ok) throw Object.assign(new Error('Token-Erneuerung fehlgeschlagen'), { status: response.status })
                return response.json()
            },
            lock: navigator.locks ? callback => navigator.locks.request('studiosync-token-refresh', callback) : undefined
        })
    }
    return refresh(failedAccess)
}
