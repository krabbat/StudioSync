/** Native sharing on iPad and supported Windows browsers.
 * WhatsApp is selected by the user from the OS share sheet; there is no
 * WhatsApp account integration, automatic send or external file upload.
 */

import { isPublicMediaPath, proxyFileUrl } from '@/lib/utils'

export type ShareOutcome = 'shared' | 'downloaded' | 'cancelled'

function downloadBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export async function shareFilesOrDownload(
    files: File[], title: string, text: string,
): Promise<ShareOutcome> {
    if (files.length > 0 && navigator.share && navigator.canShare?.({ files })) {
        try {
            await navigator.share({ title, text, files })
            return 'shared'
        } catch (error: any) {
            if (error?.name === 'AbortError') return 'cancelled'
            // Unsupported share targets can reject a file after canShare succeeds.
        }
    }
    if (files.length === 0 && navigator.share) {
        try {
            await navigator.share({ title, text })
            return 'shared'
        } catch (error: any) {
            if (error?.name === 'AbortError') return 'cancelled'
        }
    }
    for (const file of files) downloadBlob(file, file.name)
    if (!files.length) {
        window.open('https://wa.me/?text=' + encodeURIComponent(
            [title, text].filter(Boolean).join('\n\n'),
        ), '_blank', 'noopener,noreferrer')
    }
    return 'downloaded'
}

export async function shareProtectedResource(
    url: string, filename: string, title: string,
): Promise<ShareOutcome> {
    const path = proxyFileUrl(url)
    if (!path) throw new Error('Datei nicht verfügbar')
    const headers: Record<string, string> = {}
    if (!isPublicMediaPath(path)) {
        const token = localStorage.getItem('accessToken')
        if (token) headers.Authorization = 'Bearer ' + token
    }
    const response = await fetch(path, { headers })
    if (!response.ok) throw new Error('Datei konnte nicht abgerufen werden')
    const blob = await response.blob()
    return shareFilesOrDownload([
        new File([blob], filename, { type: blob.type || 'application/octet-stream' }),
    ], title, '')
}
