'use client'

import {
    useEffect, useMemo, useRef, useState,
    type CSSProperties, type PointerEvent as ReactPointerEvent,
} from 'react'
import {
    Archive, ChevronDown, ChevronRight, FileText, Filter, Forward,
    Inbox, Mail, Menu, MoreHorizontal, Paperclip, Pencil, RefreshCw, Reply,
    Search, Send, Star, Trash2, Upload, X,
} from 'lucide-react'

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
}

const FOLDERS: { id: FolderId; name: string; icon: typeof Inbox }[] = [
    { id: 'inbox', name: 'Posteingang', icon: Inbox },
    { id: 'sent', name: 'Gesendet', icon: Send },
    { id: 'drafts', name: 'Entwürfe', icon: Pencil },
    { id: 'outbox', name: 'Postausgang', icon: Mail },
    { id: 'archive', name: 'Archiv', icon: Archive },
    { id: 'spam', name: 'Spam', icon: Filter },
    { id: 'trash', name: 'Papierkorb', icon: Trash2 },
]

// These are explicitly labelled sample messages. No mail is fetched or sent
// until the IMAP/SMTP message endpoints have been implemented.
const SAMPLE_MESSAGES: MailPreview[] = [
    {
        id: 'sample-1', folder: 'inbox', from: 'Familie Beispiel',
        email: 'familie@example.invalid', subject: 'Unterricht am Donnerstag',
        preview: 'Können wir den Termin am Donnerstag etwas verschieben?',
        body: 'Guten Morgen,\n\nkönnen wir den Unterricht am Donnerstag etwas verschieben?\n\nViele Grüße\nFamilie Beispiel',
        date: '2026-11-23T09:42:00', student: 'Clara Beispiel', instrument: 'Klavier',
        unread: true, starred: false, attachments: [],
    },
    {
        id: 'sample-2', folder: 'inbox', from: 'Alex Muster',
        email: 'alex@example.invalid', subject: 'Neue Gitarrennoten',
        preview: 'Ich habe eine Frage zu den Noten aus der letzten Stunde.',
        body: 'Hallo,\n\nich habe eine Frage zu den Noten aus der letzten Stunde.\nKönnen Sie mir das Blatt noch einmal schicken?\n\nViele Grüße\nAlex Muster',
        date: '2026-11-22T14:30:00', student: 'Alex Muster', instrument: 'Gitarre',
        unread: false, starred: true, attachments: ['Noten.pdf'],
    },
    {
        id: 'sample-3', folder: 'inbox', from: 'Interessent',
        email: 'anfrage@example.invalid', subject: 'Anfrage zum Klavierunterricht',
        preview: 'Bieten Sie auch Unterricht für Erwachsene an?',
        body: 'Guten Tag,\n\nbieten Sie auch Klavierunterricht für Erwachsene an?\n\nMit freundlichen Grüßen',
        date: '2026-11-21T11:15:00', student: '', instrument: '',
        unread: false, starred: false, attachments: [],
    },
    {
        id: 'sample-4', folder: 'sent', from: 'MUSart',
        email: 'familie@example.invalid', subject: 'Unterrichtsmaterial',
        preview: 'Anbei finden Sie das vereinbarte Unterrichtsmaterial.',
        body: 'Guten Tag,\n\nanbei finden Sie das vereinbarte Unterrichtsmaterial.\n\nViele Grüße\nMUSart',
        date: '2026-11-21T08:15:00', student: 'Clara Beispiel', instrument: 'Klavier',
        unread: false, starred: false, attachments: ['Übungen.pdf'],
    },
]

const dateLabel = (iso: string) => new Intl.DateTimeFormat('de-DE', {
    day: '2-digit', month: '2-digit', year: 'numeric',
}).format(new Date(iso))

const timeLabel = (iso: string) => new Intl.DateTimeFormat('de-DE', {
    hour: '2-digit', minute: '2-digit',
}).format(new Date(iso))

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
    const [messages, setMessages] = useState<MailPreview[]>(SAMPLE_MESSAGES)
    const [selectedId, setSelectedId] = useState<string | null>('sample-1')
    const [composing, setComposing] = useState(false)
    const [recipientMode, setRecipientMode] = useState<RecipientMode>('single')
    const [recipient, setRecipient] = useState('')
    const [group, setGroup] = useState('Klavier')
    const [subject, setSubject] = useState('')
    const [body, setBody] = useState('')
    const [localFiles, setLocalFiles] = useState<File[]>([])

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
        if (attachmentOnly && m.attachments.length === 0) return false
        return true
    }).sort((a, b) => b.date.localeCompare(a.date)), [
        messages, folder, query, studentFilter, instrumentFilter, dateFrom, dateTo, unreadOnly, attachmentOnly,
    ])

    const selected = visible.find((m) => m.id === selectedId)
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
    }
    const selectMessage = (message: MailPreview) => {
        setSelectedId(message.id)
        setComposing(false)
        if (message.unread) {
            setMessages((items) => items.map((m) => m.id === message.id ? { ...m, unread: false } : m))
        }
    }
    const moveSelected = (target: FolderId) => {
        if (!selected) return
        setMessages((items) => items.map((m) => m.id === selected.id ? { ...m, folder: target } : m))
        setSelectedId(null)
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
                    <span>Vorschau · Beispieldaten</span>
                    <span>{visible.length} Nachrichten</span>
                </div>
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
                                <button type="button"
                                    onClick={() => selectMessage(message)}
                                    className={[
                                        'mail-message-row',
                                        message.id === selectedId && !composing ? 'is-selected' : '',
                                        message.unread ? 'is-unread' : '',
                                    ].filter(Boolean).join(' ')}>
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
