'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useTranslations, useLocale } from 'next-intl'
import {
    ArrowDown, ArrowUpRight, FilePenLine, Mail, MailOpen,
    Paperclip, RefreshCw, Send,
} from 'lucide-react'
import api from '@/services/api'

const PAGE_SIZE = 40

type MailKind = 'received' | 'sent' | 'draft'

interface MailOverviewItem {
    folder: string
    uid: string
    category: MailKind
    from: string
    email: string
    subject: string
    date: string
    preview: string
    unread: boolean
    has_attachment: boolean
}

interface MailOverviewPage {
    messages: MailOverviewItem[]
    total: number
    offset: number
    has_more: boolean
    syncing: boolean
    counts: { received: number; sent: number; draft: number }
}

const dateText = (iso: string, locale: string) => {
    const timestamp = Date.parse(iso)
    return Number.isNaN(timestamp) ? '' : new Date(timestamp).toLocaleString(
        locale, { day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit' },
    )
}

export default function StudentCommunicationPanel({ studentId, familyId, contactIndex, composeUrl }: { studentId?: string; familyId?: string; contactIndex?: number; composeUrl?: string }) {
    const t = useTranslations('FamilyCommunication')
    const locale = useLocale()
    const scope = familyId ? familyId + ':' + (contactIndex ?? 'all') : studentId || ''
    const endpoint = familyId ? '/core/mail/cache/families/'+familyId+'/overview/' : '/core/mail/cache/students/'+studentId+'/overview/'
    const contactParams = contactIndex === undefined ? {} : {contact:contactIndex}
    const [messages, setMessages] = useState<MailOverviewItem[]>([])
    const [total, setTotal] = useState(0)
    const [counts, setCounts] = useState({ received: 0, sent: 0, draft: 0 })
    const [hasMore, setHasMore] = useState(false)
    const [nextOffset, setNextOffset] = useState(0)
    const lastLoadedStudent = useRef<string | null>(null)
    const generationRef = useRef(0)
    const [loading, setLoading] = useState(true)
    const [loadingMore, setLoadingMore] = useState(false)
    const [error, setError] = useState('')
    const [pageError, setPageError] = useState('')
    const [syncing, setSyncing] = useState(false)
    const [revision, setRevision] = useState(0)

    useEffect(() => {
        let active = true
        const generation = ++generationRef.current
        const newStudent = lastLoadedStudent.current !== scope
        if (newStudent) {
            setMessages([])
            setTotal(0)
            setCounts({ received: 0, sent: 0, draft: 0 })
            setHasMore(false)
            setNextOffset(0)
            setSyncing(false)
            setLoading(true)
        }
        setError('')
        setPageError('')
        void api.get<MailOverviewPage>(
            endpoint,
            { params: { ...contactParams, offset: 0, limit: PAGE_SIZE } },
        ).then(({ data }) => {
            if (!active || generation !== generationRef.current) return
            lastLoadedStudent.current = scope
            setMessages(data.messages)
            setTotal(data.total)
            setCounts(data.counts)
            setHasMore(data.has_more)
            setNextOffset(data.offset + data.messages.length)
            setSyncing(Boolean(data.syncing))
        }).catch((failure: any) => {
            if (active && generation === generationRef.current) {
                setError(failure?.response?.data?.detail ||
                    t('loadError'))
                setSyncing(false)
            }
        }).finally(() => {
            if (active && generation === generationRef.current) setLoading(false)
        })
        return () => { active = false }
    }, [scope, revision])

    useEffect(() => {
        // Refresh the first page while the server populates the mail cache.
        // Once the user pages through old mail, don't reset their progress.
        if (!syncing || loading || loadingMore || messages.length > PAGE_SIZE) return
        const timeout = window.setTimeout(() => setRevision(value => value + 1), 2500)
        return () => window.clearTimeout(timeout)
    }, [syncing, loading, loadingMore, messages.length, revision])

    const loadMore = async () => {
        if (loading || loadingMore || !hasMore) return
        const generation = generationRef.current
        setLoadingMore(true)
        setPageError('')
        try {
            const { data } = await api.get<MailOverviewPage>(
                endpoint,
                { params: { ...contactParams, offset: nextOffset, limit: PAGE_SIZE } },
            )
            if (generation !== generationRef.current) return
            setMessages(existing => {
                const known = new Set(existing.map(item => item.folder + ':' + item.uid))
                return [...existing, ...data.messages.filter(item =>
                    !known.has(item.folder + ':' + item.uid))]
            })
            setNextOffset(data.offset + data.messages.length)
            setTotal(data.total)
            setCounts(data.counts)
            setHasMore(data.has_more)
            setSyncing(Boolean(data.syncing))
        } catch (failure: any) {
            if (generation === generationRef.current) {
                setPageError(failure?.response?.data?.detail ||
                    t('moreError'))
            }
        } finally {
            if (generation === generationRef.current) setLoadingMore(false)
        }
    }

    const filterUrl = studentId ? '/dashboard/messages?student='+encodeURIComponent(studentId) : '/dashboard/messages?view=mail'
    const messageUrl = (item: MailOverviewItem) => {
        const base = filterUrl + '&folder=' + encodeURIComponent(item.folder)
        return item.category === 'draft'
            ? base + '&draft=' + encodeURIComponent(item.uid)
            : base + '&uid=' + encodeURIComponent(item.uid)
    }

    return (
        <section className="bg-white rounded-3xl border border-gray-100 p-5 md:p-8 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-4 mb-5">
                <div>
                    <h2 className="text-xl font-bold text-gray-900">{t('title')}</h2>
                    <p className="text-sm text-gray-500 mt-1">
                        {t('description')}
                    </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <button type="button" onClick={() => setRevision(value => value + 1)}
                        className="inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm"
                        aria-label={t('refresh')}>
                        <RefreshCw size={16} /> {t('refresh')}
                    </button>
                    <Link href={composeUrl || filterUrl + '&compose=1'}
                        className="inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm">
                        <Send size={16} /> {t('compose')}
                    </Link>
                    <Link href={filterUrl}
                        className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">
                        {t('openMail')} <ArrowUpRight size={16} />
                    </Link>
                </div>
            </div>

            <div className="flex flex-wrap gap-x-5 gap-y-2 border-b border-gray-100 pb-4 mb-2 text-sm"
                aria-label={t('counts')}>
                <span className="font-semibold text-gray-800">{t('total',{count:total})}</span>
                <span className="text-gray-600">{t('receivedCount',{count:counts.received})}</span>
                <span className="text-gray-600">{t('sentCount',{count:counts.sent})}</span>
                <span className="text-gray-600">{t('draftCount',{count:counts.draft})}</span>
            </div>

            {loading && <p className="py-5 text-sm text-gray-500">{t('loading')}</p>}
            {syncing && <p className="py-2 text-xs text-gray-500" role="status">
                {t('syncing')}
            </p>}
            {error && <p className="py-4 text-sm text-red-700" role="alert">{error}</p>}
            {!loading && !error && messages.length === 0 && (
                <p className="rounded-xl bg-gray-50 p-5 text-sm text-gray-500">
                    {t('empty')}
                </p>
            )}
            {!loading && !error && messages.length > 0 && (
                <>
                    <div className="divide-y divide-gray-100">
                        {messages.map(item => (
                            <Link key={item.folder + '-' + item.uid}
                                href={messageUrl(item)}
                                className="flex items-start gap-3 py-4 hover:bg-gray-50 rounded-xl px-2">
                                <div className="mt-1 text-gray-400 shrink-0">
                                    {item.category === 'draft' ? <FilePenLine size={18} /> :
                                        item.unread ? <Mail size={18} /> : <MailOpen size={18} />}
                                </div>
                                <div className="min-w-0 flex-1">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <strong className="truncate text-sm text-gray-900">
                                            {item.subject || t('noSubject')}
                                        </strong>
                                        {item.has_attachment && <Paperclip size={14}
                                            className="text-gray-400" aria-label={t('attachment')} />}
                                        <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                                            {t(item.category)}
                                        </span>
                                        {item.folder !== 'inbox' && item.folder !== 'sent' &&
                                            item.folder !== 'drafts' && (
                                            <span className="text-xs text-gray-500">
                                                {item.folder === 'archive' ? t('archive') : item.folder}
                                            </span>
                                        )}
                                    </div>
                                    <div className="truncate text-xs text-gray-500 mt-1">
                                        {item.from || item.email}
                                    </div>
                                    {item.preview && (
                                        <p className="mt-1 truncate text-sm text-gray-500">{item.preview}</p>
                                    )}
                                </div>
                                <span className="shrink-0 text-xs text-gray-400">
                                    {dateText(item.date,locale)}
                                </span>
                                <ArrowUpRight size={15} className="mt-1 shrink-0 text-gray-400" />
                            </Link>
                        ))}
                    </div>
                    {pageError && <p className="py-3 text-sm text-red-700" role="alert">{pageError}</p>}
                    {hasMore && (
                        <button type="button" onClick={() => void loadMore()}
                            disabled={loadingMore}
                            className="mt-5 flex w-full justify-center items-center gap-2 rounded-xl border border-gray-200 px-4 py-3 text-sm font-semibold text-gray-700 disabled:opacity-50">
                            <ArrowDown size={16} />
                            {loadingMore ? t('loadingMore')
                                : t('more',{shown:messages.length,total})}
                        </button>
                    )}
                </>
            )}
        </section>
    )
}
