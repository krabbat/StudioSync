import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs))
}
/** Keep phone numbers exactly as entered (including +49, leading zero and separators).
 * The previous US formatter stripped the prefix and rewrote numbers as +1.
 * Preserve this function for existing form callers, but do not transform input.
 */
export function formatPhoneNumber(value: string): string {
    return value
}
export function proxyFileUrl(url: string | null): string | null {
    if (!url) return null
    try {
        const parsed = new URL(url)
        // Extract just the path (e.g. /media/resources/2026/02/file.pdf)
        // and serve it through Next.js which proxies /media/* → backend container
        if (parsed.pathname.startsWith('/media/')) {
            return parsed.pathname
        }
        return url
    } catch {
        // If it's already a relative path or unparseable, return as-is
        return url
    }
}

const PUBLIC_MEDIA_PREFIXES = ['/media/avatars/', '/media/studio_logos/', '/media/studio_covers/', '/media/bands/']

export function isPublicMediaPath(url: string): boolean {
    return PUBLIC_MEDIA_PREFIXES.some((prefix) => url.startsWith(prefix))
}

/** Download a private upload with the session token. <img> tags cannot send it. */
export async function downloadAuthenticatedFile(url: string, filename?: string): Promise<void> {
    const path = proxyFileUrl(url)
    if (!path) throw new Error('Missing file URL')
    const headers: Record<string, string> = {}
    if (!isPublicMediaPath(path) && typeof window !== 'undefined') {
        const token = localStorage.getItem('accessToken')
        if (token) headers.Authorization = `Bearer ${token}`
    }
    const response = await fetch(path, { headers })
    if (!response.ok) throw new Error('Download failed')
    const blob = await response.blob()
    const objectUrl = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = objectUrl
    link.download = filename || path.split('/').pop() || 'download'
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(objectUrl)
}
