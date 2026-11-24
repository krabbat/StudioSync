'use client'

import {
    useCallback, useEffect, useMemo, useRef, useState,
    type CSSProperties, type PointerEvent as ReactPointerEvent,
} from 'react'
import {
    Archive, CheckCheck, ChevronDown, ChevronRight, FileText, Filter, Forward,
    Inbox, Mail, MailOpen, Menu, MoreHorizontal, Paperclip, Pencil, RefreshCw, Reply,
    Search, Send, ShieldAlert, Star, Trash2, Upload, X,
} from 'lucide-react'
import api from '@/services/api'
import { toast } from 'react-hot-toast'

type FolderId = 'inbox' | 'sent' | 'drafts' | 'outbox' | 'archive' | 'spam' | 'trash'
type RecipientMode = 'single' | 'all' | 'group'

interface StudentMailRecipient {
    id: string
    name: string
    email: string
    contact_type: 'Schüler' | 'Elternkontakt'
    instruments: string[]
    selectable: boolean
}

interface SendMailResult {
    sent: number
    failed: number
    student_ids_sent: string[]
    manual_sent: boolean
    copies_failed: number
}
type MailAction = 'read' | 'unread' | 'spam' | 'archive' | 'delete' | 'restore'

interface MailPreview {
    id: string
    folder: FolderId
    from: string
    email: string
    subject: string
    preview: string
    body: string
    date: string
    student: string
    instrument: string
    unread: boolean
    starred: boolean
    attachments: string[]
    has_attachment: boolean
    bodyLoaded?: boolean
}

interface InboxApiMessage {
    id: string
    from: string
    email: string
    subject: string
    date: string | null
    unread: boolean
    starred: boolean
    preview: string
    attachments: string[]
    has_attachment: boolean
}

interface InboxPage {
    messages: InboxApiMessage[]
    total: number
    has_more: boolean
    offset: number
    limit: number
    uidvalidity: string | null
}

const normalizeMessage = (message: InboxApiMessage, folder: FolderId): MailPreview => ({
    ...message,
    folder,
    date: message.date || '',
    body: '',
    student: '',
    instrument: '',
    attachments: message.attachments || [],
    has_attachment: Boolean(message.has_attachment),
})

const FOLDERS: { id: FolderId; name: string; icon: typeof Inbox }[] = [
    { id: 'inbox', name: 'Posteingang', icon: Inbox },
    { id: 'sent', name: 'Gesendet', icon: Send },
    { id: 'drafts', name: 'Entwürfe', icon: Pencil },
    { id: 'outbox', name: 'Postausgang', icon: Mail },
    { id: 'archive', name: 'Archiv', icon: Archive },
    { id: 'spam', name: 'Spam', icon: Filter },
    { id: 'trash', name: 'Papierkorb', icon: Trash2 },
]

const dateLabel = (iso: string) => iso ? new Intl.DateTimeFormat('de-DE', {
    day: '2-digit', month: '2-digit', year: 'numeric',
}).format(new Date(iso)) : 'Ohne Datum'

const timeLabel = (iso: string) => iso ? new Intl.DateTimeFormat('de-DE', {
    hour: '2-digit', minute: '2-digit',
}).format(new Date(iso)) : ''

const localDateKey = (iso: string) => {
    if (!iso) return ''
    const date = new Date(iso)
    if (Number.isNaN(date.getTime())) return ''
    return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'),
        String(date.getDate()).padStart(2, '0')].join('-')
}

export default function MailWorkspace() {
    const areaRef = useRef<HTMLElement>(null)
    const fileInputRef = useRef<HTMLInputElement>(null)
    const [listWidth, setListWidth] = useState(32)
    const [widthLoaded, setWidthLoaded] = useState(false)
    const [resizing, setResizing] = useState(false)

    useEffect(() => {
        try {
            const saved = Number(window.localStorage.getItem('studiosync-mail-list-width'))
            if (Number.isFinite(saved) && saved >= 27 && saved <= 52) setListWidth(saved)
        } catch {
            // Private browsing or storage restrictions must not block the workspace.
        }
        setWidthLoaded(true)
    }, [])

    useEffect(() => {
        if (!widthLoaded) return
        try {
            window.localStorage.setItem('studiosync-mail-list-width', String(listWidth))
        } catch {
            // Layout still works without browser storage.
        }
    }, [listWidth, widthLoaded])
    const [folder, setFolder] = useState<FolderId>('inbox')
    const [folderMenuOpen, setFolderMenuOpen] = useState(false)
    const [searchOpen, setSearchOpen] = useState(false)
    const [filterOpen, setFilterOpen] = useState(false)
    const [query, setQuery] = useState('')
    const [studentFilter, setStudentFilter] = useState('')
    const [instrumentFilter, setInstrumentFilter] = useState('')
    const [dateFrom, setDateFrom] = useState('')
    const [dateTo, setDateTo] = useState('')
    const [unreadOnly, setUnreadOnly] = useState(false)
    const [attachmentOnly, setAttachmentOnly] = useState(false)
    const [messages, setMessages] = useState<MailPreview[]>([])
    const [selectedId, setSelectedId] = useState<string | null>(null)
    const [mailLoading, setMailLoading] = useState(false)
    const [mailActionBusy, setMailActionBusy] = useState(false)
    const [detailLoading, setDetailLoading] = useState(false)
    const [mailError, setMailError] = useState('')
    const [detailError, setDetailError] = useState('')
    const [total, setTotal] = useState(0)
    const [nextOffset, setNextOffset] = useState(0)
    const [hasMore, setHasMore] = useState(false)
    const [uidvalidity, setUidvalidity] = useState<string | null>(null)
    const [lastFetched, setLastFetched] = useState<Date | null>(null)
    const requestGeneration = useRef(0)
    const [selectedMailIds, setSelectedMailIds] = useState<string[]>([])
    const [composing, setComposing] = useState(false)
    const [recipientMode, setRecipientMode] = useState<RecipientMode>('single')
    const [recipient, setRecipient] = useState('')
    const [group, setGroup] = useState('')
    const [subject, setSubject] = useState('')
    const [body, setBody] = useState('')
    const [localFiles, setLocalFiles] = useState<File[]>([])
    const [studentRecipients, setStudentRecipients] = useState<StudentMailRecipient[]>([])
    const [recipientsLoading, setRecipientsLoading] = useState(false)
    const [recipientsReloadKey, setRecipientsReloadKey] = useState(0)
    const [recipientsError, setRecipientsError] = useState('')
    const [recipientSearch, setRecipientSearch] = useState('')
    const [recipientOverrides, setRecipientOverrides] = useState<Record<string, boolean>>({})
    const [mailSending, setMailSending] = useState(false)
    const sendBusyRef = useRef(false)
    const detailGeneration = useRef(0)

    useEffect(() => {
        if (!composing) return
        let active = true
        setRecipientsLoading(true)
        setRecipientsError('')
        setStudentRecipients([])
        void api.get<{ students: StudentMailRecipient[] }>('/core/mail/recipients/')
            .then(({ data }) => {
                if (active) setStudentRecipients(data.students)
            })
            .catch((error: any) => {
                if (active) setRecipientsError(error?.response?.data?.detail ||
                    'Die aktive Schülerliste konnte nicht geladen werden.')
            })
            .finally(() => {
                if (active) setRecipientsLoading(false)
            })
        return () => { active = false }
    }, [composing, recipientsReloadKey])

    const loadFolder = useCallback(async (currentFolder: FolderId, reset = true, offset = 0) => {
        const generation = ++requestGeneration.current
        if (reset) {
            detailGeneration.current += 1
            setDetailLoading(false)
            setDetailError('')
        }
        setMailLoading(true)
        setMailError('')
        try {
            if (currentFolder === 'outbox') {
                if (generation === requestGeneration.current) {
                    setMessages([])
                    setTotal(0)
                    setHasMore(false)
                    setUidvalidity(null)
                    setSelectedId(null)
                    setSelectedMailIds([])
                }
                return
            }
            const response = await api.get<InboxPage>(
                `/core/mail/folders/${currentFolder}/`,
                { params: { offset: reset ? 0 : offset, limit: 40 } },
            )
            if (generation !== requestGeneration.current) return
            const fresh = response.data.messages.map((item) => normalizeMessage(item, currentFolder))
            setMessages((previous) => reset
                ? fresh
                : [...previous, ...fresh.filter((m) => !previous.some(
                    (old) => old.id === m.id && old.folder === currentFolder
                ))])
            setTotal(response.data.total)
            setHasMore(response.data.has_more)
            setNextOffset(response.data.offset + response.data.limit)
            setUidvalidity(response.data.uidvalidity)
            setLastFetched(new Date())
            if (reset) {
                setSelectedId(null)
                setSelectedMailIds([])
            }
        } catch (error: any) {
            if (generation !== requestGeneration.current) return
            setMailError(error?.response?.data?.detail ||
                'Der Posteingang konnte nicht geladen werden. Bitte die IMAP-Einstellungen prüfen.')
        } finally {
            if (generation === requestGeneration.current) setMailLoading(false)
        }
    }, [])

    useEffect(() => {
        void loadFolder(folder)
        return () => { requestGeneration.current += 1 }
    }, [folder, loadFolder])

    const activeFolder = FOLDERS.find((item) => item.id === folder) || FOLDERS[0]

    const visible = useMemo(() => messages.filter((m) => {
        if (m.folder !== folder) return false
        if (query) {
            const text = [m.from, m.email, m.subject, m.preview, m.body, m.student].join(' ').toLowerCase()
            if (!text.includes(query.toLowerCase())) return false
        }
        if (studentFilter && m.student !== studentFilter) return false
        if (instrumentFilter && m.instrument !== instrumentFilter) return false
        if (dateFrom && (!localDateKey(m.date) || localDateKey(m.date) < dateFrom)) return false
        if (dateTo && (!localDateKey(m.date) || localDateKey(m.date) > dateTo)) return false
        if (unreadOnly && !m.unread) return false
        if (attachmentOnly && !m.has_attachment && m.attachments.length === 0) return false
        return true
    }).sort((a, b) => b.date.localeCompare(a.date)), [
        messages, folder, query, studentFilter, instrumentFilter, dateFrom, dateTo, unreadOnly, attachmentOnly,
    ])

    // Keep the opened message in the reader when auto-read hides it from an Unread filter.
    const selected = messages.find((m) => m.id === selectedId && m.folder === folder)
    const visibleIds = visible.map((m) => m.id)
    const selectedVisibleIds = visibleIds.filter((id) => selectedMailIds.includes(id))
    const allVisibleSelected = visible.length > 0 && selectedVisibleIds.length === visible.length
    const partiallySelected = selectedVisibleIds.length > 0 && !allVisibleSelected

    // An action never silently applies to hidden messages in another folder/filter.
    useEffect(() => {
        setSelectedMailIds([])
    }, [folder, query, studentFilter, instrumentFilter, dateFrom, dateTo, unreadOnly, attachmentOnly])

    const toggleMessageSelection = (id: string) => {
        setSelectedMailIds((ids) => ids.includes(id)
            ? ids.filter((item) => item !== id) : [...ids, id])
    }
    const toggleAllVisible = () => {
        setSelectedMailIds(allVisibleSelected ? [] : visibleIds)
    }

    const runMailAction = async (action: MailAction, uids: string[], silent = false) => {
        if (mailActionBusy || uids.length === 0) return
        if (!uidvalidity) {
            toast.error('Bitte zuerst die Mails mit „Abrufen“ aktualisieren.')
            return
        }
        if (uids.length > 200) {
            toast.error('Bitte höchstens 200 Nachrichten gleichzeitig auswählen.')
            return
        }
        setMailActionBusy(true)
        try {
            const response = await api.post<{ updated: number }>(
                `/core/mail/folders/${folder}/actions/`,
                { action, uids, uidvalidity },
            )
            const updated = new Set(uids)
            if (action === 'read' || action === 'unread') {
                setMessages((items) => items.map((item) => updated.has(item.id)
                    ? { ...item, unread: action === 'unread' } : item))
            } else {
                // MOVE succeeds on the IMAP server before any local row disappears.
                setMessages((items) => items.filter((item) => !updated.has(item.id)))
                if (selectedId && updated.has(selectedId)) setSelectedId(null)
            }
            if (!silent) setSelectedMailIds([])
            const names: Record<MailAction, string> = {
                read: 'als gelesen markiert',
                unread: 'als ungelesen markiert',
                spam: 'in Spam verschoben',
                archive: 'archiviert',
                delete: 'in den Papierkorb verschoben',
                restore: 'in den Posteingang zurückgelegt',
            }
            if (!silent) toast.success(`${response.data.updated} Nachricht(en) ${names[action]}.`)
            if (action !== 'read' && action !== 'unread') {
                // Refill the selected folder only after confirmed IMAP MOVE.
                await loadFolder(folder, true)
            }
        } catch (error: any) {
            toast.error(error?.response?.data?.detail ||
                'Die IMAP-Aktion ist fehlgeschlagen. Bitte erneut versuchen.')
        } finally {
            setMailActionBusy(false)
        }
    }

    const instrumentGroups = useMemo(() => Array.from(
        new Set(studentRecipients.flatMap((s) => s.instruments)),
    ).sort((a, b) => a.localeCompare(b, 'de')), [studentRecipients])
    const effectiveGroup = instrumentGroups.includes(group)
        ? group : instrumentGroups[0] || ''

    const isRecipientSelected = (student: StudentMailRecipient) => {
        if (!student.selectable) return false
        if (recipientOverrides[student.id] !== undefined) {
            return recipientOverrides[student.id]
        }
        return recipientMode === 'all' || (recipientMode === 'group' &&
            student.instruments.some((name) => name.toLocaleLowerCase('de') ===
                effectiveGroup.toLocaleLowerCase('de')))
    }
    const selectedStudents = studentRecipients.filter(isRecipientSelected)
    const studentAddresses = new Set(
        selectedStudents.map((s) => s.email.trim().toLocaleLowerCase('de'))
    )
    const manualTarget = recipientMode === 'single' ? recipient.trim() : ''
    const distinctRecipientCount = studentAddresses.size + (
        manualTarget && !studentAddresses.has(manualTarget.toLocaleLowerCase('de')) ? 1 : 0
    )
    const visibleStudents = studentRecipients.filter((student) => {
        const q = recipientSearch.trim().toLocaleLowerCase('de')
        return !q || [student.name, student.email, ...student.instruments]
            .some((value) => value.toLocaleLowerCase('de').includes(q))
    })

    const switchRecipientMode = (next: RecipientMode) => {
        setRecipientMode(next)
        setRecipientOverrides({})
        setRecipientSearch('')
    }

    const sendMail = async () => {
        if (sendBusyRef.current || mailSending || recipientsLoading || recipientsError) return
        if (!distinctRecipientCount || !subject.trim() || !body.trim()) {
            toast.error('Bitte Empfänger, Betreff und Nachrichtentext angeben.')
            return
        }
        if (distinctRecipientCount > 1 && !window.confirm(
            `Diese Nachricht wirklich an ${distinctRecipientCount} unterschiedliche E-Mail-Adressen senden?`
        )) return
        sendBusyRef.current = true
        setMailSending(true)
        try {
            const form = new FormData()
            form.append('student_ids', JSON.stringify(selectedStudents.map((s) => s.id)))
            form.append('manual_recipient', manualTarget)
            form.append('subject', subject)
            form.append('body', body)
            for (const file of localFiles) form.append('attachments', file)
            const { data } = await api.post<SendMailResult>('/core/mail/send/', form)
            if (data.student_ids_sent.length > 0) {
                setRecipientOverrides((current) => {
                    const next = { ...current }
                    for (const id of data.student_ids_sent) next[id] = false
                    return next
                })
            }
            if (data.manual_sent) setRecipient('')
            if (data.sent > 0 && data.failed === 0) {
                toast.success(`${data.sent} E-Mail(s) erfolgreich versendet.`)
                if (data.copies_failed > 0) {
                    toast.error(`${data.copies_failed} Kopie(n) konnten nicht im Gesendet-Ordner gespeichert werden.`)
                }
                setComposing(false)
                setSubject('')
                setBody('')
                setLocalFiles([])
                setSelectedId(null)
                if (folder === 'sent') {
                    void loadFolder('sent', true)
                } else {
                    setFolder('sent')
                }
            } else if (data.sent > 0) {
                toast.error(`${data.sent} zugestellt, ${data.failed} fehlgeschlagen. Die erfolgreichen Empfänger wurden aus der Auswahl entfernt.`)
            } else {
                toast.error('Der SMTP-Server hat keine der Nachrichten angenommen.')
            }
        } catch (error: any) {
            toast.error(error?.response?.data?.detail ||
                'Der E-Mail-Versand ist fehlgeschlagen. Bitte SMTP-Einstellungen prüfen.')
        } finally {
            sendBusyRef.current = false
            setMailSending(false)
        }
    }

    const activeFilters = !!(studentFilter || instrumentFilter || dateFrom || dateTo || unreadOnly || attachmentOnly)
    const resetFilters = () => {
        setStudentFilter('')
        setInstrumentFilter('')
        setDateFrom('')
        setDateTo('')
        setUnreadOnly(false)
        setAttachmentOnly(false)
    }
    const selectFolder = (next: FolderId) => {
        if (mailActionBusy) return
        if (next === folder) { setFolderMenuOpen(false); return }
        setFolder(next)
        setSelectedId(null)
        detailGeneration.current += 1
        setDetailLoading(false)
        setDetailError('')
        setComposing(false)
        setFolderMenuOpen(false)
        setSelectedMailIds([])
    }
    const selectMessage = async (message: MailPreview) => {
        setSelectedId(message.id)
        setComposing(false)
        setDetailError('')
        const generation = ++detailGeneration.current
        if (message.bodyLoaded) {
            setDetailLoading(false)
            if (message.unread && !mailActionBusy) {
                await runMailAction('read', [message.id], true)
            }
            return
        }
        setDetailLoading(true)
        try {
            const response = await api.get<InboxApiMessage & { body: string }>(
                `/core/mail/folders/${folder}/${message.id}/`,
                { params: uidvalidity ? { uidvalidity } : {} },
            )
            if (detailGeneration.current !== generation) return
            setMessages((items) => items.map((item) => item.id === message.id
                ? { ...item, body: response.data.body, preview: response.data.preview,
                    attachments: response.data.attachments, has_attachment: response.data.has_attachment,
                    bodyLoaded: true } : item))
            // A message displayed in the preview is now read on the server.
            if (message.unread && !mailActionBusy) {
                await runMailAction('read', [message.id], true)
            }
        } catch (error: any) {
            if (detailGeneration.current !== generation) return
            setDetailError(error?.response?.data?.detail || 'Diese Nachricht konnte nicht geladen werden.')
        } finally {
            if (detailGeneration.current === generation) setDetailLoading(false)
        }
    }
    const compose = (mode: 'new' | 'reply' | 'forward' = 'new') => {
        if (mode === 'new') {
            setRecipient('')
            setSubject('')
            setBody('')
            setLocalFiles([])
        } else if (selected) {
            setRecipient(mode === 'reply' ? selected.email : '')
            setSubject((mode === 'reply' ? 'Re: ' : 'Fw: ') + selected.subject)
            setBody(mode === 'forward' ? '\n\n--- Weitergeleitete Nachricht ---\n' + selected.body : '')
            setLocalFiles([])
        }
        setRecipientMode('single')
        setRecipientOverrides({})
        setRecipientSearch('')
        setComposing(true)
        setFolderMenuOpen(false)
    }
    const resizeToPointer = (e: ReactPointerEvent<HTMLDivElement>) => {
        const bounds = areaRef.current?.getBoundingClientRect()
        if (!bounds) return
        const value = ((e.clientX - bounds.left) / bounds.width) * 100
        setListWidth(Math.min(52, Math.max(27, value)))
    }
    const startResizing = (e: ReactPointerEvent<HTMLDivElement>) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        setResizing(true)
        resizeToPointer(e)
    }
    const stopResizing = (e: ReactPointerEvent<HTMLDivElement>) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
            e.currentTarget.releasePointerCapture(e.pointerId)
        }
        setResizing(false)
    }

    return (
        <section
            className="mail-workspace"
            ref={areaRef}
            aria-label="StudioSync E-Mail-Zentrale"
            style={{ '--mail-list-width': String(listWidth) + '%' } as CSSProperties}
        >
            <div className="mail-list-pane">
                <div className="mail-toolbar mail-list-toolbar">
                    <div className="mail-folder-anchor">
                        <button type="button" className="mail-folder-button"
                            onClick={() => setFolderMenuOpen(!folderMenuOpen)}
                            disabled={mailActionBusy}
                            aria-expanded={folderMenuOpen} aria-label="Postfach auswählen">
                            <Menu size={18} />
                            <span>{activeFolder.name}</span>
                            <ChevronDown size={14} />
                        </button>
                        {folderMenuOpen && (
                            <>
                                <button type="button" className="mail-popover-dismiss" aria-label="Postfachmenü schließen"
                                    onClick={() => setFolderMenuOpen(false)} />
                                <div className="mail-folder-popover" role="navigation" aria-label="Mailordner">
                                    {FOLDERS.map((item) => {
                                        const Icon = item.icon
                                        return (
                                            <button key={item.id} type="button"
                                                className={item.id === folder ? 'mail-folder-option is-active' : 'mail-folder-option'}
                                                onClick={() => selectFolder(item.id)}
                                                disabled={mailActionBusy}>
                                                <Icon size={17} />
                                                <span>{item.name}</span>
                                                <span className="mail-folder-count">
                                                    {messages.filter((m) => m.folder === item.id).length || ''}
                                                </span>
                                            </button>
                                        )
                                    })}
                                </div>
                            </>
                        )}
                    </div>
                    <div className="mail-toolbar-actions">
                        <button type="button" className={searchOpen ? 'mail-icon is-active' : 'mail-icon'}
                            aria-label="Suche einblenden" title="Nachrichten durchsuchen"
                            onClick={() => setSearchOpen(!searchOpen)}>
                            <Search size={18} />
                        </button>
                        <button type="button" className={filterOpen || activeFilters ? 'mail-icon is-active' : 'mail-icon'}
                            aria-label="Filter einblenden" title="Filter"
                            onClick={() => setFilterOpen(!filterOpen)}>
                            <Filter size={18} />
                        </button>
                        <button type="button" className="mail-fetch-button"
                            onClick={() => void loadFolder(folder, true)}
                            disabled={mailLoading || mailActionBusy}
                            aria-label="Mails abrufen" title="Aktuellen IMAP-Ordner abrufen">
                            <RefreshCw size={16} className={mailLoading ? 'animate-spin' : ''} />
                            <span>Abrufen</span>
                        </button>
                        <button type="button" className="mail-primary-icon" aria-label="Neue E-Mail"
                            title="Neue E-Mail entwerfen" onClick={() => compose()}>
                            <Pencil size={18} />
                        </button>
                    </div>
                </div>

                {searchOpen && (
                    <div className="mail-search-bar">
                        <Search size={16} aria-hidden="true" />
                        <input autoFocus type="search" value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            placeholder="Absender, Betreff …" aria-label="Geladene Nachrichten durchsuchen" />
                        {query && <button type="button" className="mail-icon" onClick={() => setQuery('')}
                            aria-label="Suche löschen"><X size={16} /></button>}
                    </div>
                )}

                {filterOpen && (
                    <div className="mail-filters">
                        <div className="mail-filter-fields">
                            <label>Schüler
                                <select value={studentFilter} disabled title="Schülerzuordnung folgt im nächsten Schritt">
                                    <option value="">Zuordnung folgt</option>
                                </select>
                            </label>
                            <label>Instrument
                                <select value={instrumentFilter} disabled title="Instrumentzuordnung folgt im nächsten Schritt">
                                    <option value="">Zuordnung folgt</option>
                                </select>
                            </label>
                            <label>Von
                                <input type="date" value={dateFrom} max={dateTo || undefined}
                                    onChange={(e) => setDateFrom(e.target.value)} />
                            </label>
                            <label>Bis
                                <input type="date" value={dateTo} min={dateFrom || undefined}
                                    onChange={(e) => setDateTo(e.target.value)} />
                            </label>
                        </div>
                        <div className="mail-filter-bottom">
                            <label><input type="checkbox" checked={unreadOnly}
                                onChange={(e) => setUnreadOnly(e.target.checked)} /> Ungelesen</label>
                            <label><input type="checkbox" checked={attachmentOnly}
                                onChange={(e) => setAttachmentOnly(e.target.checked)} /> Mit Anhang</label>
                            <button type="button" onClick={resetFilters}>Zurücksetzen</button>
                        </div>
                    </div>
                )}

                <div className="mail-list-summary">
                    <label className="mail-select-all" title="Alle sichtbaren Nachrichten auswählen">
                        <input type="checkbox"
                            checked={allVisibleSelected}
                            ref={(element) => { if (element) element.indeterminate = partiallySelected }}
                            onChange={toggleAllVisible}
                            disabled={visible.length === 0 || mailActionBusy}
                            aria-label="Alle sichtbaren Nachrichten auswählen"
                        />
                        <span>{selectedVisibleIds.length > 0
                            ? `${selectedVisibleIds.length} ausgewählt`
                            : `${activeFolder.name} · IMAP`}</span>
                    </label>
                    <span>{folder === 'outbox' ? '0' : `${messages.length} / ${total}`} Mails</span>
                </div>
                {selectedVisibleIds.length > 0 && (
                    <div className="mail-bulk-toolbar" role="toolbar"
                        aria-label="Aktionen für ausgewählte Nachrichten">
                        <button type="button" disabled={mailActionBusy}
                            onClick={() => void runMailAction('read', selectedVisibleIds)}
                            title="Ausgewählte als gelesen markieren">
                            <CheckCheck size={16} /> <span>Gelesen</span>
                        </button>
                        <button type="button" disabled={mailActionBusy}
                            onClick={() => void runMailAction('unread', selectedVisibleIds)}
                            title="Ausgewählte als ungelesen markieren">
                            <Mail size={16} /> <span>Ungelesen</span>
                        </button>
                        {folder !== 'spam' && <button type="button" disabled={mailActionBusy}
                            onClick={() => void runMailAction('spam', selectedVisibleIds)}
                            title="Ausgewählte in Spam verschieben">
                            <ShieldAlert size={16} /> <span>Spam</span>
                        </button>}
                        {folder !== 'archive' && <button type="button" disabled={mailActionBusy}
                            onClick={() => void runMailAction('archive', selectedVisibleIds)}
                            title="Ausgewählte archivieren">
                            <Archive size={16} /> <span>Archiv</span>
                        </button>}
                        {folder !== 'trash' && <button type="button" disabled={mailActionBusy}
                            onClick={() => void runMailAction('delete', selectedVisibleIds)}
                            title="Ausgewählte in den Papierkorb verschieben">
                            <Trash2 size={16} /> <span>Löschen</span>
                        </button>}
                        {(['trash', 'archive', 'spam'] as FolderId[]).includes(folder) &&
                            <button type="button" disabled={mailActionBusy}
                                onClick={() => void runMailAction('restore', selectedVisibleIds)}
                                title="Ausgewählte in den Posteingang zurücklegen">
                                <Inbox size={16} /> <span>Zurück</span>
                            </button>}
                        <button type="button" className="mail-bulk-clear"
                            disabled={mailActionBusy}
                            onClick={() => setSelectedMailIds([])}
                            title="Auswahl aufheben" aria-label="Auswahl aufheben">
                            <X size={16} />
                        </button>
                    </div>
                )}
                {mailError && (
                    <div className="mail-fetch-error" role="alert">{mailError}</div>
                )}
                {lastFetched && folder !== 'outbox' && (
                    <div className="mail-fetch-status">
                        Letzter Abruf: {lastFetched.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}
                        {mailLoading && ' · Aktualisierung läuft'}
                    </div>
                )}
                <div className="mail-list-scroll">
                    {visible.length === 0 && (
                        <div className="mail-list-empty">
                            <Mail size={24} />
                            <p>{mailLoading ? 'Nachrichten werden geladen …' :
                                folder === 'outbox' ? 'Postausgang wird später angebunden.' :
                                mailError ? 'Abruf fehlgeschlagen.' : 'Keine Nachrichten in dieser Ansicht.'}</p>
                            <span>{folder === 'outbox'
                                ? 'Hier werden später wartende Nachrichten angezeigt.'
                                : 'Mit „Abrufen“ kannst du diesen Ordner aktualisieren.'}</span>
                        </div>
                    )}
                    {visible.map((message, index) => {
                        const showDate = index === 0 || dateLabel(visible[index - 1].date) !== dateLabel(message.date)
                        return (
                            <div key={message.id}>
                                {showDate && <div className="mail-day-heading">{dateLabel(message.date)}</div>}
                                <div
                                    className={[
                                        'mail-message-row',
                                        message.id === selectedId && !composing ? 'is-selected' : '',
                                        selectedMailIds.includes(message.id) ? 'is-checked' : '',
                                        message.unread ? 'is-unread' : '',
                                    ].filter(Boolean).join(' ')}>
                                    <label className="mail-message-select" title="Nachricht für mehrere Aktionen auswählen">
                                        <input type="checkbox"
                                            checked={selectedMailIds.includes(message.id)}
                                            disabled={mailActionBusy}
                                            onChange={() => toggleMessageSelection(message.id)}
                                            aria-label={`${message.from}: ${message.subject} auswählen`} />
                                    </label>
                                    <button type="button" className="mail-message-content"
                                        disabled={mailActionBusy}
                                        onClick={() => selectMessage(message)}>
                                        <div className="mail-message-topline">
                                            <span className="mail-message-sender">
                                                {message.unread && <span className="mail-unread-dot" />}
                                                {message.from}
                                            </span>
                                            <span className="mail-message-date">{timeLabel(message.date)}</span>
                                        </div>
                                        <div className="mail-message-subject">{message.subject}</div>
                                        <div className="mail-message-preview">{message.preview || message.email}</div>
                                        <div className="mail-message-bottom">
                                            <span>{message.student || 'Nicht zugeordnet'}</span>
                                            <div>
                                                {message.starred && <Star size={13} aria-label="Markiert" />}
                                                {(message.has_attachment || message.attachments.length > 0) &&
                                                <Paperclip size={13} aria-label="Mit Anhang" />}
                                            </div>
                                        </div>
                                    </button>
                                </div>
                            </div>
                        )
                    })}
                    {folder !== 'outbox' && hasMore && (
                        <button type="button" className="mail-load-more" disabled={mailLoading}
                            onClick={() => void loadFolder(folder, false, nextOffset)}>
                            {mailLoading ? 'Lädt …' : 'Weitere Nachrichten laden'}
                        </button>
                    )}
                </div>
            </div>

            <div className={resizing ? 'mail-divider is-resizing' : 'mail-divider'}
                role="separator" tabIndex={0} aria-orientation="vertical"
                aria-label="Breite der Nachrichtenliste" aria-valuenow={Math.round(listWidth)}
                aria-valuemin={27} aria-valuemax={52}
                onPointerDown={startResizing}
                onPointerMove={(e) => { if (resizing) resizeToPointer(e) }}
                onPointerUp={stopResizing}
                onPointerCancel={stopResizing}
                onKeyDown={(e) => {
                    if (e.key === 'ArrowLeft') { e.preventDefault(); setListWidth((w) => Math.max(27, w - 2)) }
                    if (e.key === 'ArrowRight') { e.preventDefault(); setListWidth((w) => Math.min(52, w + 2)) }
                }}>
                <div className="mail-divider-grip" />
            </div>

            <div className="mail-reader-pane">
                {composing ? (
                    <>
                        <div className="mail-toolbar mail-reader-toolbar">
                            <div className="mail-reader-title"><Pencil size={18} /> Neue Nachricht</div>
                            <button type="button" className="mail-icon" onClick={() => setComposing(false)}
                                aria-label="Editor schließen" title="Editor ausblenden, Eingaben in dieser Ansicht erhalten">
                                <X size={19} />
                            </button>
                        </div>
                        <div className="mail-compose-scroll">
                            <div className="mail-compose-note">
                                Jede ausgewählte E-Mail-Adresse erhält eine eigene Nachricht.
                                Entwürfe werden noch nicht dauerhaft gespeichert.
                            </div>
                            <div className="mail-compose-line">
                                <span>Empfänger</span>
                                <div className="mail-recipient-modes" aria-label="Empfängerart">
                                    {([
                                        ['single', 'Einzeln'],
                                        ['all', 'Alle'],
                                        ['group', 'Gruppe'],
                                    ] as [RecipientMode, string][]).map(([id, label]) => (
                                        <button key={id} type="button"
                                            disabled={mailSending}
                                            className={recipientMode === id ? 'is-active' : ''}
                                            onClick={() => switchRecipientMode(id)}>{label}</button>
                                    ))}
                                </div>
                            </div>
                            {recipientMode === 'group' && (
                                <div className="mail-compose-line">
                                    <label htmlFor="mail-group">Instrument</label>
                                    <select id="mail-group" value={effectiveGroup}
                                        disabled={mailSending || recipientsLoading}
                                        onChange={(e) => { setGroup(e.target.value); setRecipientOverrides({}) }}>
                                        {instrumentGroups.map((name) => (
                                            <option key={name} value={name}>{name}</option>
                                        ))}
                                    </select>
                                </div>
                            )}
                            {recipientMode === 'single' && (
                                <div className="mail-compose-line">
                                    <label htmlFor="mail-to">Weitere Adresse</label>
                                    <input id="mail-to" type="email" value={recipient}
                                        disabled={mailSending}
                                        onChange={(e) => setRecipient(e.target.value)}
                                        placeholder="Optional: direkte E-Mail-Adresse" />
                                </div>
                            )}
                            <div className="mail-recipient-panel">
                                <div className="mail-recipient-panel-header">
                                    <strong>Aktive Schüler</strong>
                                    <span>{selectedStudents.length} von {studentRecipients.length} gewählt
                                        {' · '}{distinctRecipientCount} E-Mail-Adresse(n)</span>
                                </div>
                                <input className="mail-recipient-search" type="search"
                                    placeholder="Schüler oder Instrument suchen …"
                                    aria-label="Schüler in der Empfängerliste suchen"
                                    value={recipientSearch}
                                    disabled={mailSending}
                                    onChange={(e) => setRecipientSearch(e.target.value)} />
                                {recipientsLoading && (
                                    <p className="mail-compose-hint">Aktive Schüler werden geladen …</p>
                                )}
                                {recipientsError && (
                                    <div className="mail-fetch-error" role="alert">
                                        {recipientsError}
                                        <button type="button"
                                            onClick={() => setRecipientsReloadKey((value) => value + 1)}>
                                            Erneut versuchen
                                        </button>
                                    </div>
                                )}
                                {!recipientsLoading && !recipientsError && (
                                    <div className="mail-recipient-grid" role="group"
                                        aria-label="Aktive Schüler als E-Mail-Empfänger auswählen">
                                        {visibleStudents.map((student) => (
                                            <label className="mail-recipient-card" key={student.id}
                                                title={student.selectable ? student.email : 'Keine gültige Kontaktadresse'}>
                                                <input type="checkbox"
                                                    checked={isRecipientSelected(student)}
                                                    disabled={!student.selectable || mailSending}
                                                    onChange={(e) => setRecipientOverrides((current) => ({
                                                        ...current, [student.id]: e.target.checked,
                                                    }))} />
                                                <span className="mail-recipient-info">
                                                    <strong>{student.name}</strong>
                                                    <small>{student.email || 'Keine gültige E-Mail-Adresse'}
                                                        {student.contact_type === 'Elternkontakt' ? ' · Elternkontakt' : ''}
                                                    </small>
                                                    {student.instruments.length > 0 && (
                                                        <small>{student.instruments.join(', ')}</small>
                                                    )}
                                                </span>
                                            </label>
                                        ))}
                                        {visibleStudents.length === 0 && (
                                            <p className="mail-compose-hint">Keine passenden aktiven Schüler gefunden.</p>
                                        )}
                                    </div>
                                )}
                                {recipientMode === 'all' && (
                                    <p className="mail-compose-hint">
                                        Alle Schüler mit E-Mail-Adresse sind vorausgewählt. Einzelne Haken können entfernt werden.
                                    </p>
                                )}
                                {recipientMode === 'group' && (
                                    <p className="mail-compose-hint">
                                        Schüler mit dem Instrument {effectiveGroup || '–'} sind vorausgewählt. Die Auswahl lässt sich ändern.
                                    </p>
                                )}
                            </div>
                            <div className="mail-compose-line">
                                <label htmlFor="mail-subject">Betreff</label>
                                <input id="mail-subject" type="text" value={subject}
                                    onChange={(e) => setSubject(e.target.value)} placeholder="Betreff eingeben" />
                            </div>
                            <textarea className="mail-compose-body" aria-label="Nachrichtentext" value={body}
                                placeholder="Nachricht verfassen …" onChange={(e) => setBody(e.target.value)} />
                            {localFiles.length > 0 && (
                                <div className="mail-file-chips">
                                    {localFiles.map((file, index) => (
                                        <span key={String(index) + file.name}>
                                            <Paperclip size={13} /> {file.name}
                                            <button type="button" aria-label={file.name + ' entfernen'}
                                                onClick={() => setLocalFiles((files) => files.filter((_, i) => i !== index))}>
                                                <X size={13} />
                                            </button>
                                        </span>
                                    ))}
                                </div>
                            )}
                        </div>
                        <div className="mail-compose-footer">
                            <input ref={fileInputRef} hidden multiple type="file" onChange={(e) => {
                                setLocalFiles((items) => [...items, ...Array.from(e.target.files || [])])
                                e.target.value = ''
                            }} />
                            <button type="button" className="mail-secondary-button" onClick={() => fileInputRef.current?.click()}
                                title="Dateien zur E-Mail hinzufügen">
                                <Upload size={17} /> Datei auswählen
                            </button>
                            <button type="button" className="mail-secondary-button" disabled
                                title="Die Ressourcen-Auswahl wird mit dem Backend verbunden">
                                <FileText size={17} /> StudioSync-Datei
                            </button>
                            <div className="mail-compose-spacer" />
                            <button type="button" className="mail-secondary-button" disabled
                                title="Dauerhafte Entwürfe folgen mit dem Mail-Backend">Entwurf speichern</button>
                            <button type="button" className="mail-send-button"
                                disabled={mailSending || recipientsLoading || !!recipientsError ||
                                    !distinctRecipientCount || !subject.trim() || !body.trim()}
                                onClick={() => void sendMail()}
                                title="Ausgewählte Empfänger über SMTP anschreiben">
                                <Send size={16} /> {mailSending ? 'Sendet …' : `Senden (${distinctRecipientCount})`}
                            </button>
                        </div>
                    </>
                ) : selected ? (
                    <>
                        <div className="mail-toolbar mail-reader-toolbar">
                            <div className="mail-reader-actions">
                                <button type="button" className="mail-icon" title="Antworten" aria-label="Antworten"
                                    onClick={() => compose('reply')}><Reply size={19} /></button>
                                <button type="button" className="mail-icon" title="Weiterleiten" aria-label="Weiterleiten"
                                    onClick={() => compose('forward')}><Forward size={19} /></button>
                                <button type="button" className="mail-icon"
                                    disabled={mailActionBusy}
                                    onClick={() => void runMailAction(
                                        selected.unread ? 'read' : 'unread', [selected.id]
                                    )}
                                    title={selected.unread ? 'Als gelesen markieren' : 'Als ungelesen markieren'}
                                    aria-label={selected.unread ? 'Als gelesen markieren' : 'Als ungelesen markieren'}>
                                    {selected.unread ? <MailOpen size={19} /> : <Mail size={19} />}
                                </button>
                                {folder !== 'spam' && <button type="button" className="mail-icon"
                                    disabled={mailActionBusy}
                                    title="In Spam verschieben" aria-label="In Spam verschieben"
                                    onClick={() => void runMailAction('spam', [selected.id])}>
                                    <ShieldAlert size={19} /></button>}
                                {folder !== 'archive' && <button type="button" className="mail-icon"
                                    disabled={mailActionBusy}
                                    title="Archivieren" aria-label="Archivieren"
                                    onClick={() => void runMailAction('archive', [selected.id])}>
                                    <Archive size={19} /></button>}
                                {folder !== 'trash' && <button type="button" className="mail-icon"
                                    disabled={mailActionBusy}
                                    title="In Papierkorb verschieben" aria-label="Löschen"
                                    onClick={() => void runMailAction('delete', [selected.id])}>
                                    <Trash2 size={19} /></button>}
                                {(['trash', 'archive', 'spam'] as FolderId[]).includes(folder) &&
                                    <button type="button" className="mail-icon"
                                        disabled={mailActionBusy} title="In Posteingang zurücklegen"
                                        aria-label="Wiederherstellen"
                                        onClick={() => void runMailAction('restore', [selected.id])}>
                                        <Inbox size={19} /></button>}
                                <button type="button" className="mail-icon" disabled
                                    title="Stern-Markierung folgt im nächsten Schritt" aria-label="Markieren">
                                    <Star size={19} fill={selected.starred ? 'currentColor' : 'none'} /></button>
                            </div>
                            <button type="button" className="mail-icon" disabled title="Weitere Aktionen folgen"
                                aria-label="Weitere Aktionen"><MoreHorizontal size={19} /></button>
                        </div>
                        <div className="mail-reader-scroll">
                            <h2 className="mail-reader-subject">{selected.subject}</h2>
                            <div className="mail-reader-from">
                                <div className="mail-sender-avatar">{selected.from.slice(0, 1)}</div>
                                <div className="mail-sender-details">
                                    <strong>{selected.from}</strong>
                                    <span>{selected.email}</span>
                                </div>
                                <span className="mail-reader-date">{dateLabel(selected.date)} · {timeLabel(selected.date)}</span>
                            </div>
                            <div className="mail-association">
                                {selected.student ? (
                                    <><span>{selected.student}</span><ChevronRight size={13} /><span>{selected.instrument}</span></>
                                ) : (
                                    <span>Nicht zugeordnet · Schülerzuordnung folgt</span>
                                )}
                            </div>
                            {detailLoading ? <div className="mail-body-text">Nachricht wird geladen …</div> :
                                detailError ? <div className="mail-fetch-error" role="alert">{detailError}</div> :
                                <div className="mail-body-text">{selected.body || 'Zum Lesen öffnen'}</div>}
                            {selected.bodyLoaded && selected.attachments.length > 0 && (
                                <div className="mail-reader-attachments">
                                    <strong>Anhänge</strong>
                                    {selected.attachments.map((filename) => (
                                        <span key={filename}><Paperclip size={15} /> {filename} (Download folgt)</span>
                                    ))}
                                </div>
                            )}
                        </div>
                    </>
                ) : (
                    <div className="mail-reader-empty">
                        <Mail size={36} strokeWidth={1.5} />
                        <strong>Nachricht auswählen</strong>
                        <span>Nachrichten werden hier gelesen und beantwortet.</span>
                        <span className="mail-reader-note">Nachrichten werden über den IMAP-Posteingang geladen.</span>
                    </div>
                )}
            </div>
        </section>
    )
}
