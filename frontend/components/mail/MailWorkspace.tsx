'use client'

import {
    useCallback, useEffect, useMemo, useRef, useState,
    type CSSProperties, type PointerEvent as ReactPointerEvent,
} from 'react'
import {
    Archive, CheckCheck, ChevronDown, ChevronRight, FileText, Filter, Forward,
    Inbox, Mail, Menu, MoreHorizontal, Paperclip, Pencil, RefreshCw, Reply,
    Search, Send, Star, Trash2, Upload, X,
} from 'lucide-react'
import api from '@/services/api'

type FolderId = 'inbox' | 'sent' | 'drafts' | 'outbox' | 'archive' | 'spam' | 'trash'
type RecipientMode = 'single' | 'all' | 'group'

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

const normalizeMessage = (message: InboxApiMessage): MailPreview => ({
    ...message,
    folder: 'inbox',
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
    const [group, setGroup] = useState('Klavier')
    const [subject, setSubject] = useState('')
    const [body, setBody] = useState('')
    const [localFiles, setLocalFiles] = useState<File[]>([])
    const detailGeneration = useRef(0)

    const loadInbox = useCallback(async (reset = true, offset = 0) => {
        const generation = ++requestGeneration.current
        setMailLoading(true)
        setMailError('')
        try {
            const response = await api.get<InboxPage>('/core/mail/inbox/', {
                params: { offset: reset ? 0 : offset, limit: 40 },
            })
            if (generation !== requestGeneration.current) return
            const fresh = response.data.messages.map(normalizeMessage)
            setMessages((previous) => reset
                ? fresh
                : [...previous, ...fresh.filter((m) => !previous.some((old) => old.id === m.id))])
            setTotal(response.data.total)
            setHasMore(response.data.has_more)
            setNextOffset(response.data.offset + response.data.messages.length)
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
        void loadInbox()
        return () => { requestGeneration.current += 1 }
    }, [loadInbox])

    const activeFolder = FOLDERS.find((item) => item.id === folder) || FOLDERS[0]
    const availableStudents = Array.from(new Set(messages.map((m) => m.student).filter(Boolean))).sort()
    const availableInstruments = Array.from(new Set(messages.map((m) => m.instrument).filter(Boolean))).sort()

    const visible = useMemo(() => messages.filter((m) => {
        if (m.folder !== folder) return false
        if (query) {
            const text = [m.from, m.email, m.subject, m.preview, m.body, m.student].join(' ').toLowerCase()
            if (!text.includes(query.toLowerCase())) return false
        }
        if (studentFilter && m.student !== studentFilter) return false
        if (instrumentFilter && m.instrument !== instrumentFilter) return false
        if (dateFrom && m.date.slice(0, 10) < dateFrom) return false
        if (dateTo && m.date.slice(0, 10) > dateTo) return false
        if (unreadOnly && !m.unread) return false
        if (attachmentOnly && !m.has_attachment && m.attachments.length === 0) return false
        return true
    }).sort((a, b) => b.date.localeCompare(a.date)), [
        messages, folder, query, studentFilter, instrumentFilter, dateFrom, dateTo, unreadOnly, attachmentOnly,
    ])

    const selected = visible.find((m) => m.id === selectedId)
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
        setFolder(next)
        setSelectedId(null)
        setComposing(false)
        setFolderMenuOpen(false)
        setSelectedMailIds([])
    }
    const selectMessage = async (message: MailPreview) => {
        setSelectedId(message.id)
        setComposing(false)
        setDetailError('')
        if (message.bodyLoaded) return
        const generation = ++detailGeneration.current
        setDetailLoading(true)
        try {
            const response = await api.get<InboxApiMessage & { body: string }>(
                `/core/mail/inbox/${message.id}/`,
                { params: uidvalidity ? { uidvalidity } : {} },
            )
            if (detailGeneration.current !== generation) return
            setMessages((items) => items.map((item) => item.id === message.id
                ? { ...item, body: response.data.body, preview: response.data.preview,
                    attachments: response.data.attachments, has_attachment: response.data.has_attachment,
                    bodyLoaded: true } : item))
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
            aria-label="StudioSync E-Mail-Zentrale – Oberflächenvorschau"
            style={{ '--mail-list-width': String(listWidth) + '%' } as CSSProperties}
        >
            <div className="mail-list-pane">
                <div className="mail-toolbar mail-list-toolbar">
                    <div className="mail-folder-anchor">
                        <button type="button" className="mail-folder-button"
                            onClick={() => setFolderMenuOpen(!folderMenuOpen)}
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
                                                onClick={() => selectFolder(item.id)}>
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
                        <button type="button" className="mail-icon" disabled
                            aria-label="Nachrichten aktualisieren" title="IMAP-Abruf wird als Nächstes integriert">
                            <RefreshCw size={18} />
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
                            placeholder="Absender, Betreff, Inhalt …" aria-label="Nachrichten durchsuchen" />
                        {query && <button type="button" className="mail-icon" onClick={() => setQuery('')}
                            aria-label="Suche löschen"><X size={16} /></button>}
                    </div>
                )}

                {filterOpen && (
                    <div className="mail-filters">
                        <div className="mail-filter-fields">
                            <label>Schüler
                                <select value={studentFilter} onChange={(e) => setStudentFilter(e.target.value)}>
                                    <option value="">Alle</option>
                                    {availableStudents.map((name) => <option key={name} value={name}>{name}</option>)}
                                </select>
                            </label>
                            <label>Instrument
                                <select value={instrumentFilter} onChange={(e) => setInstrumentFilter(e.target.value)}>
                                    <option value="">Alle</option>
                                    {availableInstruments.map((name) => <option key={name} value={name}>{name}</option>)}
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
                            disabled={visible.length === 0}
                            aria-label="Alle sichtbaren Nachrichten auswählen"
                        />
                        <span>{selectedVisibleIds.length > 0
                            ? `${selectedVisibleIds.length} ausgewählt`
                            : 'Vorschau · Beispieldaten'}</span>
                    </label>
                    <span>{visible.length} Nachrichten</span>
                </div>
                {selectedVisibleIds.length > 0 && (
                    <div className="mail-bulk-toolbar" role="toolbar"
                        aria-label="Aktionen für ausgewählte Nachrichten">
                        <button type="button" onClick={() => bulkMarkRead(true)}
                            title="Ausgewählte als gelesen markieren">
                            <CheckCheck size={16} /> <span>Gelesen</span>
                        </button>
                        <button type="button" onClick={() => bulkMarkRead(false)}
                            title="Ausgewählte als ungelesen markieren">
                            <Mail size={16} /> <span>Ungelesen</span>
                        </button>
                        <button type="button" onClick={() => bulkMove('spam')}
                            title="Ausgewählte in Spam verschieben">
                            <Filter size={16} /> <span>Spam</span>
                        </button>
                        <button type="button" onClick={() => bulkMove('archive')}
                            title="Ausgewählte archivieren">
                            <Archive size={16} /> <span>Archiv</span>
                        </button>
                        <button type="button" className="mail-bulk-clear"
                            onClick={() => setSelectedMailIds([])}
                            title="Auswahl aufheben" aria-label="Auswahl aufheben">
                            <X size={16} />
                        </button>
                    </div>
                )}
                <div className="mail-list-scroll">
                    {visible.length === 0 && (
                        <div className="mail-list-empty">
                            <Mail size={24} />
                            <p>Keine Nachrichten in dieser Ansicht.</p>
                            <span>Der echte Postfachabruf folgt im nächsten Entwicklungsschritt.</span>
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
                                            onChange={() => toggleMessageSelection(message.id)}
                                            aria-label={`${message.from}: ${message.subject} auswählen`} />
                                    </label>
                                    <button type="button" className="mail-message-content"
                                        onClick={() => selectMessage(message)}>
                                        <div className="mail-message-topline">
                                            <span className="mail-message-sender">
                                                {message.unread && <span className="mail-unread-dot" />}
                                                {message.from}
                                            </span>
                                            <span className="mail-message-date">{timeLabel(message.date)}</span>
                                        </div>
                                        <div className="mail-message-subject">{message.subject}</div>
                                        <div className="mail-message-preview">{message.preview}</div>
                                        <div className="mail-message-bottom">
                                            <span>{message.student || 'Nicht zugeordnet'}</span>
                                            <div>
                                                {message.starred && <Star size={13} aria-label="Markiert" />}
                                                {message.attachments.length > 0 && <Paperclip size={13} aria-label="Mit Anhang" />}
                                            </div>
                                        </div>
                                    </button>
                                </div>
                            </div>
                        )
                    })}
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
                            <div className="mail-preview-warning">
                                Oberflächenvorschau: Noch kein Versand und keine dauerhafte Entwurfsspeicherung.
                            </div>
                            <div className="mail-compose-line">
                                <span>Empfänger</span>
                                <div className="mail-recipient-modes" aria-label="Empfängerart">
                                    {([
                                        ['single', 'Einzeln'],
                                        ['all', 'Alle'],
                                        ['group', 'Gruppen'],
                                    ] as [RecipientMode, string][]).map(([id, label]) => (
                                        <button key={id} type="button"
                                            className={recipientMode === id ? 'is-active' : ''}
                                            onClick={() => setRecipientMode(id)}>{label}</button>
                                    ))}
                                </div>
                            </div>
                            {recipientMode === 'single' && (
                                <div className="mail-compose-line">
                                    <label htmlFor="mail-to">An</label>
                                    <input id="mail-to" type="email" value={recipient}
                                        onChange={(e) => setRecipient(e.target.value)}
                                        placeholder="E-Mail-Adresse oder später Schüler auswählen" />
                                </div>
                            )}
                            {recipientMode === 'group' && (
                                <div className="mail-compose-line">
                                    <label htmlFor="mail-group">Gruppe</label>
                                    <select id="mail-group" value={group} onChange={(e) => setGroup(e.target.value)}>
                                        {['Klavier', 'Gitarre', 'Akkordeon', 'Geige', 'Saxophon', 'Blockflöte', 'Querflöte'].map(
                                            (name) => <option key={name}>{name}</option>
                                        )}
                                    </select>
                                </div>
                            )}
                            {recipientMode === 'all' && <p className="mail-compose-hint">Empfänger: alle aktiven Schüler (Auswahl wird angebunden).</p>}
                            {recipientMode === 'group' && <p className="mail-compose-hint">Instrumentengruppe: {group} (Empfängerliste wird angebunden).</p>}
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
                                title="Dateien lokal für die Vorschau auswählen">
                                <Upload size={17} /> Datei auswählen
                            </button>
                            <button type="button" className="mail-secondary-button" disabled
                                title="Die Ressourcen-Auswahl wird mit dem Backend verbunden">
                                <FileText size={17} /> StudioSync-Datei
                            </button>
                            <div className="mail-compose-spacer" />
                            <button type="button" className="mail-secondary-button" disabled
                                title="Dauerhafte Entwürfe folgen mit dem Mail-Backend">Entwurf speichern</button>
                            <button type="button" className="mail-send-button" disabled
                                title="SMTP-Versand wird in der nächsten Phase angebunden">
                                <Send size={16} /> Senden
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
                                <button type="button" className="mail-icon" title="Archivieren" aria-label="Archivieren"
                                    onClick={() => moveSelected('archive')}><Archive size={19} /></button>
                                <button type="button" className="mail-icon" title="In Papierkorb verschieben" aria-label="Löschen"
                                    onClick={() => moveSelected('trash')}><Trash2 size={19} /></button>
                                <button type="button" className="mail-icon" title="Markierung umschalten" aria-label="Markieren"
                                    onClick={() => setMessages((items) => items.map((m) => m.id === selected.id
                                        ? { ...m, starred: !m.starred } : m))}><Star size={19} fill={selected.starred ? 'currentColor' : 'none'} /></button>
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
                            <div className="mail-body-text">{selected.body}</div>
                            {selected.attachments.length > 0 && (
                                <div className="mail-reader-attachments">
                                    <strong>Anhänge</strong>
                                    {selected.attachments.map((filename) => (
                                        <span key={filename}><Paperclip size={15} /> {filename} (Beispieldatei)</span>
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
                        <span className="mail-reader-note">Der echte IMAP-Abruf folgt nach Freigabe der Oberfläche.</span>
                    </div>
                )}
            </div>
        </section>
    )
}
