'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowUpRight, Mail, MailOpen, Paperclip, RefreshCw, Send } from 'lucide-react'
import api from '@/services/api'

interface MailOverviewItem {
    folder: string
    uid: string
    from: string
    email: string
    subject: string
    date: string
    preview: string
    unread: boolean
    has_attachment: boolean
}

export default function StudentCommunicationPanel({ studentId }: { studentId: string }) {
    const [messages, setMessages] = useState<MailOverviewItem[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState('')
    const [revision, setRevision] = useState(0)

    useEffect(() => {
        let active = true
        setLoading(true)
        setError('')
        void api.get<{ messages: MailOverviewItem[] }>(
            `/core/mail/cache/students/${studentId}/overview/`,
        ).then(({ data }) => {
            if (active) setMessages(data.messages)
        }).catch((failure: any) => {
            if (active) setError(failure?.response?.data?.detail ||
                'Der Schriftverkehr konnte nicht geladen werden.')
        }).finally(() => {
            if (active) setLoading(false)
        })
        return () => { active = false }
    }, [studentId, revision])

    const filterUrl = `/dashboard/messages?student=${encodeURIComponent(studentId)}`

    return (
        <section className="bg-white rounded-3xl border border-gray-100 p-5 md:p-8 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
                <div>
                    <h2 className="text-xl font-bold text-gray-900">Kommunikation</h2>
                    <p className="text-sm text-gray-500 mt-1">
                        Zugeordnete E-Mails im Überblick. Lesen und Antworten im Mailclient.
                    </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <button type="button" onClick={() => setRevision(value => value + 1)}
                        className="inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm"
                        aria-label="Kommunikationsübersicht aktualisieren">
                        <RefreshCw size={16} /> Aktualisieren
                    </button>
                    <Link href={filterUrl + '&compose=1'}
                        className="inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm">
                        <Send size={16} /> Neue E-Mail
                    </Link>
                    <Link href={filterUrl}
                        className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">
                        Mailclient öffnen <ArrowUpRight size={16} />
                    </Link>
                </div>
            </div>

            {loading && <p className="text-sm text-gray-500">Schriftverkehr wird geladen …</p>}
            {error && <p className="text-sm text-red-700" role="alert">{error}</p>}
            {!loading && !error && messages.length === 0 && (
                <p className="rounded-xl bg-gray-50 p-5 text-sm text-gray-500">
                    Noch keine E-Mails zugeordnet. Der Mailclient kann weitere Ordner
                    synchronisieren und Nachrichten einem Schüler zuordnen.
                </p>
            )}
            {!loading && !error && messages.length > 0 && (
                <div className="divide-y divide-gray-100">
                    {messages.map(item => (
                        <Link key={item.folder + '-' + item.uid}
                            href={filterUrl + '&folder=' + encodeURIComponent(item.folder) +
                                '&uid=' + encodeURIComponent(item.uid)}
                            className="flex items-start gap-3 py-4 hover:bg-gray-50 rounded-xl px-2">
                            <div className="mt-1 text-gray-400 shrink-0">
                                {item.unread ? <Mail size={18} /> : <MailOpen size={18} />}
                            </div>
                            <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                    <strong className="truncate text-sm text-gray-900">
                                        {item.subject || '(Ohne Betreff)'}
                                    </strong>
                                    {item.has_attachment && <Paperclip size={14}
                                        className="text-gray-400" aria-label="Mit Anhang" />}
                                    <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                                        {item.folder === 'sent' ? 'Gesendet' :
                                            item.folder === 'inbox' ? 'Posteingang' : item.folder}
                                    </span>
                                </div>
                                <div className="truncate text-xs text-gray-500 mt-1">{item.from || item.email}</div>
                                {item.preview && (
                                    <p className="mt-1 truncate text-sm text-gray-500">{item.preview}</p>
                                )}
                            </div>
                            <span className="shrink-0 text-xs text-gray-400">
                                {item.date && !Number.isNaN(Date.parse(item.date))
                                    ? new Date(item.date).toLocaleDateString('de-DE') : ''}
                            </span>
                            <ArrowUpRight size={15} className="mt-1 shrink-0 text-gray-400" />
                        </Link>
                    ))}
                </div>
            )}
        </section>
    )
}
