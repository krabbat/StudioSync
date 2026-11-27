'use client'

import {
    useCallback, useEffect, useMemo, useRef, useState,
    type CSSProperties, type PointerEvent as ReactPointerEvent,
} from 'react'
import { createPortal } from 'react-dom'
import {
    Archive, CheckCheck, ChevronDown, ChevronRight, FileText, Filter, Forward,
    File as FileIcon, FileAudio, FileImage, FileVideo, Inbox, Mail, MailOpen, Menu, MoreHorizontal,
    Paperclip, Pencil, RefreshCw, Reply, Search, Send, Share2, ShieldAlert, Star, Trash2, Upload, X,
} from 'lucide-react'
import api from '@/services/api'
import { INTERNATIONAL_EMAIL_PATTERN, INTERNATIONAL_EMAIL_HINT } from '@/lib/internationalEmail'
import { toast } from 'react-hot-toast'
import { shareFilesOrDownload } from '@/lib/shareFile'

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

interface SavedMailDraft {
    id: string
    recipient: string
    additional_recipient: string
    student_ids: string[]
    resources: StudioMailResource[]
    subject: string
    body: string
    local_attachments: Array<{
        id: string; filename: string; mime_type: string; size: number
    }>
}

interface MailStudent {
    id: string
    name: string
    instruments: string[]
}

interface StudioMailResource {
    id: string
    title: string
    filename: string
    size: number | null
    mime_type: string
    folder_name: string
}

interface SendMailResult {
    sent: number
    failed: number
    student_ids_sent: string[]
    manual_sent: boolean
    additional_sent?: boolean
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
    instruments: string[]
    student_ids: string[]
    student_names: string[]
    assignment_manual: boolean
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
    student?: string
    instrument?: string
    instruments?: string[]
    student_ids?: string[]
    student_names?: string[]
    assignment_manual?: boolean
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
    syncing?: boolean
    cached_ids?: string[]
    synced?: boolean
    sync_error?: string
    last_synced_at?: string | null
}

const normalizeMessage = (message: InboxApiMessage, folder: FolderId): MailPreview => ({
    ...message,
    folder,
    date: message.date || '',
    body: '',
    student: message.student || '',
    instrument: message.instrument || '',
    instruments: message.instruments || [],
    student_ids: message.student_ids || [],
    student_names: message.student_names || [],
    assignment_manual: Boolean(message.assignment_manual),
    attachments: message.attachments || [],
    has_attachment: Boolean(message.has_attachment),
})

const attachmentIcon = (name: string, mime = '') => {
    const ext = name.toLowerCase().split('.').pop() || ''
    if (mime.startsWith('image/') || ['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext)) return FileImage
    if (mime.startsWith('audio/') || ['mp3', 'wav', 'm4a', 'flac'].includes(ext)) return FileAudio
    if (mime.startsWith('video/') || ['mp4', 'mov', 'mkv'].includes(ext)) return FileVideo
    if (ext === 'pdf' || ['doc', 'docx', 'txt', 'odt'].includes(ext)) return FileText
    return FileIcon
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
    const [mailStudents, setMailStudents] = useState<MailStudent[]>([])
    const [associationEditorOpen, setAssociationEditorOpen] = useState(false)
    const [associationSelection, setAssociationSelection] = useState<string[]>([])
    const [associationSaving, setAssociationSaving] = useState(false)
    const [linkedMessageUid, setLinkedMessageUid] = useState('')
    const [linkedMessageFolder, setLinkedMessageFolder] = useState<FolderId | null>(null)
    const [linkedDraftId, setLinkedDraftId] = useState('')
    const [loadedMailFolder, setLoadedMailFolder] = useState<FolderId | null>(null)
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
    const [cacheSyncing, setCacheSyncing] = useState(false)
    const [pendingPageOffset, setPendingPageOffset] = useState<number | null>(null)
    const requestGeneration = useRef(0)
    const lastFolderUidvalidity = useRef<string | null>(null)
    const [selectedMailIds, setSelectedMailIds] = useState<string[]>([])
    const [composing, setComposing] = useState(false)
    const [recipientMode, setRecipientMode] = useState<RecipientMode>('single')
    const [recipient, setRecipient] = useState('')
    const [replyRecipientName, setReplyRecipientName] = useState('')
    const [additionalRecipient, setAdditionalRecipient] = useState('')
    const [showAdditionalRecipient, setShowAdditionalRecipient] = useState(false)
    const [group, setGroup] = useState('')
    const [subject, setSubject] = useState('')
    const [body, setBody] = useState('')
    const [draftId, setDraftId] = useState<string | null>(null)
    const [draftSaving, setDraftSaving] = useState(false)
    const [draftLoading, setDraftLoading] = useState(false)
    const [localFiles, setLocalFiles] = useState<File[]>([])
    const [studioFiles, setStudioFiles] = useState<StudioMailResource[]>([])
    const [resourcePickerOpen, setResourcePickerOpen] = useState(false)
    const [resourceQuery, setResourceQuery] = useState('')
    const [resourceResults, setResourceResults] = useState<StudioMailResource[]>([])
    const [resourceHasMore, setResourceHasMore] = useState(false)
    const [resourcesLoading, setResourcesLoading] = useState(false)
    const [resourcesError, setResourcesError] = useState('')
    const resourceSearchRef = useRef<HTMLInputElement>(null)
    const [studentRecipients, setStudentRecipients] = useState<StudentMailRecipient[]>([])
    const [recipientsLoading, setRecipientsLoading] = useState(false)
    const [recipientsReloadKey, setRecipientsReloadKey] = useState(0)
    const [recipientsError, setRecipientsError] = useState('')
    const [recipientSearch, setRecipientSearch] = useState('')
    const [recipientPickerOpen, setRecipientPickerOpen] = useState(false)
    const recipientDialogRef = useRef<HTMLDivElement>(null)
    const recipientSearchRef = useRef<HTMLInputElement>(null)
    const [recipientOverrides, setRecipientOverrides] = useState<Record<string, boolean>>({})
    const [mailSending, setMailSending] = useState(false)
    const sendBusyRef = useRef(false)
    const detailGeneration = useRef(0)

    useEffect(() => {
        let active = true
        void api.get<{ students: MailStudent[] }>('/core/mail/cache/students/')
            .then(({ data }) => {
                if (active) setMailStudents(data.students)
            }).catch(() => {
                if (active) setMailStudents([])
            })
        // Deep links from an individual student profile share one mail workspace.
        const params = new URLSearchParams(window.location.search)
        const sid = params.get('student')
        if (sid) {
            setStudentFilter(sid)
            setFilterOpen(true)
        }
        const targetFolder = params.get('folder')
        if (targetFolder && FOLDERS.some(item => item.id === targetFolder)) {
            setFolder(targetFolder as FolderId)
            setLinkedMessageFolder(targetFolder as FolderId)
        }
        const uid = params.get('uid')
        if (uid && /^[1-9][0-9]{0,19}$/.test(uid)) setLinkedMessageUid(uid)
        const draft = params.get('draft')
        if (targetFolder === 'drafts' && draft &&
            /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(draft)) {
            setLinkedDraftId(draft)
        }
        if (params.get('compose') === '1') {
            setComposing(true)
            setRecipientMode('single')
            if (sid) setRecipientOverrides({ [sid]: true })
            const familyStudents=(params.get('students')||'').split(',').filter(id=>/^[a-f0-9-]{36}$/i.test(id)).slice(0,100)
            if(familyStudents.length) setRecipientOverrides(Object.fromEntries(familyStudents.map(id=>[id,true])))
            const contactRecipient=params.get('recipient')
            if(contactRecipient) setRecipient(contactRecipient.slice(0,254))
            const resourceId = params.get('resource')
            if (resourceId && /^[a-f0-9-]{36}$/i.test(resourceId)) {
                void api.get<{ resources: StudioMailResource[] }>(
                    '/core/mail/attachments/resources/',
                    { params: { id: resourceId } },
                ).then(({ data }) => {
                    if (active && data.resources.length) setStudioFiles(data.resources)
                }).catch(() => {
                    if (active) toast.error('Anhang aus StudioSync konnte nicht geladen werden.')
                })
            }
        }
        return () => { active = false }
    }, [])

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

    useEffect(() => {
        if (!recipientPickerOpen || !composing) return
        recipientSearchRef.current?.focus()
        const onPickerKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault()
                if (!mailSending) setRecipientPickerOpen(false)
                return
            }
            if (event.key !== 'Tab') return
            const focusables = recipientDialogRef.current?.querySelectorAll<HTMLElement>(
                'button:not([disabled]), input:not([disabled]), select:not([disabled])'
            )
            if (!focusables || focusables.length === 0) return
            const first = focusables[0]
            const last = focusables[focusables.length - 1]
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault()
                last.focus()
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault()
                first.focus()
            }
        }
        document.addEventListener('keydown', onPickerKeyDown)
        return () => document.removeEventListener('keydown', onPickerKeyDown)
    }, [recipientPickerOpen, composing, mailSending])

    useEffect(() => {
        if (!composing || !resourcePickerOpen) return
        let active = true
        setResourcesLoading(true)
        setResourcesError('')
        const handle = window.setTimeout(() => {
            void api.get<{ resources: StudioMailResource[]; has_more: boolean }>(
                '/core/mail/attachments/resources/',
                { params: { q: resourceQuery.trim() } },
            ).then(({ data }) => {
                if (!active) return
                setResourceResults(data.resources)
                setResourceHasMore(data.has_more)
            }).catch((error: any) => {
                if (active) setResourcesError(error?.response?.data?.detail ||
                    'StudioSync-Dateien konnten nicht geladen werden.')
            }).finally(() => {
                if (active) setResourcesLoading(false)
            })
        }, 200)
        return () => { active = false; window.clearTimeout(handle) }
    }, [composing, resourcePickerOpen, resourceQuery])

    useEffect(() => {
        if (!resourcePickerOpen || !composing) return
        resourceSearchRef.current?.focus()
        const handleEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape' && !mailSending) {
                event.preventDefault()
                setResourcePickerOpen(false)
            }
        }
        document.addEventListener('keydown', handleEscape)
        return () => document.removeEventListener('keydown', handleEscape)
    }, [resourcePickerOpen, composing, mailSending])

    const loadFolder = useCallback(async (
        currentFolder: FolderId, reset = true, offset = 0, silent = false,
    ) => {
        const generation = ++requestGeneration.current
        if (reset && !silent) {
            detailGeneration.current += 1
            setDetailLoading(false)
            setDetailError('')
            setPendingPageOffset(null)
        }
        if (!silent) {
            setMailLoading(true)
            setMailError('')
        }
        try {
            if (currentFolder === 'outbox') {
                if (generation === requestGeneration.current) {
                    setMessages([])
                    setTotal(0)
                    setHasMore(false)
                    setUidvalidity(null)
                    setCacheSyncing(false)
                    setSelectedId(null)
                    setSelectedMailIds([])
                }
                return
            }
            const response = await api.get<InboxPage>(
                currentFolder === 'drafts' ? '/core/mail/drafts/' :
                    '/core/mail/cache/folders/' + currentFolder + '/',
                { params: { offset: reset ? 0 : offset, limit: 40 } },
            )
            if (generation !== requestGeneration.current) return
            setLoadedMailFolder(currentFolder)
            const fresh = response.data.messages.map((item) => normalizeMessage(item, currentFolder))
            const generationChanged = Boolean(
                lastFolderUidvalidity.current && response.data.uidvalidity &&
                lastFolderUidvalidity.current !== response.data.uidvalidity
            )
            lastFolderUidvalidity.current = response.data.uidvalidity
            if (generationChanged) {
                detailGeneration.current += 1
                setSelectedId(null)
                setSelectedMailIds([])
            }
            setMessages((previous) => {
                // Keep already opened bodies when refreshing cached headers.
                const oldMessages = new Map(previous
                    .filter((item) => item.folder === currentFolder)
                    .map((item): [string, MailPreview] => [item.id, item]))
                const keepBody = (item: MailPreview) => {
                    const old = oldMessages.get(item.id)
                    return old?.bodyLoaded ? {
                        ...item, body: old.body, bodyLoaded: true,
                        preview: old.preview, attachments: old.attachments,
                    } : item
                }
                if (reset) {
                    if (generationChanged || !silent) return fresh.map(keepBody)
                    // Silent background refresh must not hide paginated rows.
                    const fetchedIds = new Set(fresh.map((item) => item.id))
                    const liveIds = new Set(response.data.cached_ids || [])
                    return [
                        ...fresh.map(keepBody),
                        ...previous.filter((item) =>
                            item.folder === currentFolder &&
                            liveIds.has(item.id) && !fetchedIds.has(item.id)
                        ),
                    ]
                }
                const existingIds = new Set(previous.map((item) => item.id))
                return [...previous, ...fresh.filter((item) => !existingIds.has(item.id)).map(keepBody)]
            })
            setTotal(response.data.total)
            setHasMore(response.data.has_more)
            setCacheSyncing(Boolean(response.data.syncing))
            setMailError(response.data.sync_error || '')
            setNextOffset((current) => reset
                ? silent && !generationChanged ? Math.max(current, fresh.length) : fresh.length
                : offset + fresh.length)
            if (!reset && !fresh.length && response.data.syncing) {
                setPendingPageOffset(offset)
            } else if (!reset) {
                setPendingPageOffset(null)
            }
            setUidvalidity(response.data.uidvalidity)
            if (response.data.last_synced_at) {
                setLastFetched(new Date(response.data.last_synced_at))
            }
            if (reset && !silent) {
                setSelectedId(null)
                setSelectedMailIds([])
            }
        } catch (error: any) {
            if (generation !== requestGeneration.current) return
            setMailError(error?.response?.data?.detail ||
                'Der Nachrichten-Cache konnte nicht geladen werden.')
            setCacheSyncing(false)
        } finally {
            if (generation === requestGeneration.current) setMailLoading(false)
        }
    }, [])

    useEffect(() => {
        void loadFolder(folder)
        return () => { requestGeneration.current += 1 }
    }, [folder, loadFolder])

    // Poll PostgreSQL only while the asynchronous IMAP update runs.
    useEffect(() => {
        if (!cacheSyncing || folder === 'outbox') return
        const timer = window.setInterval(() => {
            void loadFolder(folder, true, 0, true)
        }, 1600)
        return () => window.clearInterval(timer)
    }, [folder, cacheSyncing, loadFolder])

    // If an older page wasn't cached, finish pagination once the worker has it.
    useEffect(() => {
        if (cacheSyncing || pendingPageOffset === null) return
        const offset = pendingPageOffset
        setPendingPageOffset(null)
        void loadFolder(folder, false, offset, true)
    }, [folder, cacheSyncing, pendingPageOffset, loadFolder])

    useEffect(() => {
        if (folder === 'outbox' || folder === 'drafts') return
        const timer = window.setInterval(() => {
            if (!cacheSyncing && !mailLoading) {
                void loadFolder(folder, true, 0, true)
            }
        }, 60_000)
        return () => window.clearInterval(timer)
    }, [folder, cacheSyncing, mailLoading, loadFolder])

    const refreshFolder = async () => {
        if (folder === 'outbox') return
        if (folder === 'drafts') {
            await loadFolder('drafts', true)
            return
        }
        try {
            await api.post('/core/mail/cache/folders/' + folder + '/sync/')
            await loadFolder(folder, true, 0, true)
        } catch (error: any) {
            setMailError(error?.response?.data?.detail ||
                'Der Hintergrundabgleich konnte nicht gestartet werden.')
        }
    }

    const activeFolder = FOLDERS.find((item) => item.id === folder) || FOLDERS[0]

    const visible = useMemo(() => messages.filter((m) => {
        if (m.folder !== folder) return false
        if (query) {
            const text = [m.from, m.email, m.subject, m.preview, m.body, m.student].join(' ').toLowerCase()
            if (!text.includes(query.toLowerCase())) return false
        }
        if (studentFilter && !m.student_ids.includes(studentFilter)) return false
        if (instrumentFilter && !m.instruments.includes(instrumentFilter)) return false
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
    const extraTarget = recipientMode === 'single' ? additionalRecipient.trim() : ''
    const recipientAddresses = new Set([
        ...studentAddresses,
        ...(manualTarget ? [manualTarget.toLocaleLowerCase('de')] : []),
        ...(extraTarget ? [extraTarget.toLocaleLowerCase('de')] : []),
    ])
    const distinctRecipientCount = recipientAddresses.size
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

    const setVisibleRecipientSelection = (checked: boolean) => {
        setRecipientOverrides((previous) => {
            const next = { ...previous }
            for (const student of visibleStudents) {
                if (student.selectable) next[student.id] = checked
            }
            return next
        })
    }

    const toggleStudioFile = (resource: StudioMailResource) => {
        setStudioFiles((current) => {
            if (current.some((file) => file.id === resource.id)) {
                return current.filter((file) => file.id !== resource.id)
            }
            if (current.length + localFiles.length >= 8) {
                toast.error('Maximal acht Anhänge pro Nachricht.')
                return current
            }
            return [...current, resource]
        })
    }

    const sendMail = async () => {
        if (sendBusyRef.current || mailSending || draftSaving || recipientsLoading || recipientsError) return
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
            form.append('additional_recipient', extraTarget)
            form.append('resource_ids', JSON.stringify(studioFiles.map((file) => file.id)))
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
            if (data.additional_sent) setAdditionalRecipient('')
            if (data.sent > 0 && data.failed === 0) {
                if (draftId) {
                    try {
                        await api.delete('/core/mail/drafts/' + draftId + '/')
                    } catch {
                        toast.error('Mail versendet, gespeicherter Entwurf konnte nicht gelöscht werden.')
                    }
                    setDraftId(null)
                }
                toast.success(`${data.sent} E-Mail(s) erfolgreich versendet.`)
                if (data.copies_failed > 0) {
                    toast.error(`${data.copies_failed} Kopie(n) konnten nicht im Gesendet-Ordner gespeichert werden.`)
                }
                setComposing(false)
                setRecipientPickerOpen(false)
                setSubject('')
                setBody('')
                setLocalFiles([])
                setStudioFiles([])
                setResourcePickerOpen(false)
                setSelectedId(null)
                if (folder === 'sent') {
                    void loadFolder('sent', true)
                } else {
                    setFolder('sent')
                }
            } else if (data.sent > 0) {
                toast.error(`${data.sent} vom Mailserver angenommen, ${data.failed} fehlgeschlagen. Erfolgreiche Empfänger wurden aus der Auswahl entfernt.`)
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
        setLoadedMailFolder(null)
        setLastFetched(null)
        setCacheSyncing(false)
        setPendingPageOffset(null)
        lastFolderUidvalidity.current = null
        setSelectedId(null)
        detailGeneration.current += 1
        setDetailLoading(false)
        setDetailError('')
        setComposing(false)
        setRecipientPickerOpen(false)
        setFolderMenuOpen(false)
        setSelectedMailIds([])
    }
    const selectMessage = async (message: MailPreview) => {
        setSelectedId(message.id)
        setAssociationEditorOpen(false)
        setComposing(false)
        setRecipientPickerOpen(false)
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
                `/core/mail/cache/folders/${folder}/${message.id}/`,
                { params: uidvalidity ? { uidvalidity } : {} },
            )
            if (detailGeneration.current !== generation) return
            setMessages((items) => items.map((item) => item.id === message.id
                ? { ...item, body: response.data.body, preview: response.data.preview,
                    attachments: response.data.attachments, has_attachment: response.data.has_attachment,
                    student: response.data.student || item.student,
                    instrument: response.data.instrument || item.instrument,
                    student_ids: response.data.student_ids || item.student_ids,
                    student_names: response.data.student_names || item.student_names,
                    instruments: response.data.instruments || item.instruments,
                    assignment_manual: response.data.assignment_manual ?? item.assignment_manual,
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
    useEffect(() => {
        if (!linkedMessageUid || loadedMailFolder !== folder ||
            folder === 'outbox' || folder === 'drafts' ||
            (linkedMessageFolder && linkedMessageFolder !== folder)) return
        let active = true
        const existing = messages.find((item) =>
            item.id === linkedMessageUid && item.folder === folder)
        if (existing) {
            setLinkedMessageUid('')
            void selectMessage(existing)
        } else {
            // A deep-linked message can be older than the first cached page.
            void api.get<InboxApiMessage & { body: string }>(
                `/core/mail/cache/folders/${folder}/${linkedMessageUid}/`,
            ).then(({ data }) => {
                if (!active) return
                const opened = {
                    ...normalizeMessage(data, folder), body: data.body,
                    bodyLoaded: true,
                }
                setMessages((items) => items.some((item) =>
                    item.id === opened.id && item.folder === folder)
                    ? items : [opened, ...items])
                setSelectedId(opened.id)
                setLinkedMessageUid('')
            }).catch(() => {
                if (active) setLinkedMessageUid('')
            })
        }
        return () => { active = false }
        // Deliberately reacts only when a new URL-selected UID or folder arrives.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [linkedMessageUid, linkedMessageFolder, folder, loadedMailFolder])

    const editMailAssociation = () => {
        if (!selected) return
        setAssociationSelection(selected.student_ids)
        setAssociationEditorOpen(true)
    }

    const saveMailAssociation = async (automatic = false) => {
        if (!selected || associationSaving || !uidvalidity) return
        setAssociationSaving(true)
        try {
            const { data } = await api.post<{
                student: string; instrument: string; student_ids: string[];
                student_names: string[]; instruments: string[]; assignment_manual: boolean
            }>(
                `/core/mail/cache/folders/${folder}/${selected.id}/students/`,
                { uidvalidity, automatic, student_ids: associationSelection },
            )
            setMessages((items) => items.map((item) =>
                item.id === selected.id && item.folder === folder
                    ? { ...item, ...data } : item))
            setAssociationEditorOpen(false)
            toast.success(automatic ? 'Automatische Zuordnung wiederhergestellt.' :
                'Schülerzuordnung gespeichert.')
        } catch (error: any) {
            toast.error(error?.response?.data?.detail ||
                'Die Schülerzuordnung konnte nicht gespeichert werden.')
        } finally {
            setAssociationSaving(false)
        }
    }

    const shareComposedMail = async () => {
        if (!subject.trim() && !body.trim() && !localFiles.length && !studioFiles.length) {
            toast.error('Bitte zuerst Nachricht oder Datei auswählen.')
            return
        }
        try {
            const files: File[] = [...localFiles]
            for (const resource of studioFiles) {
                const { data: blob } = await api.get<Blob>(
                    '/core/mail/attachments/resources/' + resource.id + '/download/',
                    { responseType: 'blob' },
                )
                files.push(new File([blob], resource.filename,
                    { type: resource.mime_type || blob.type || 'application/octet-stream' }))
            }
            const outcome = await shareFilesOrDownload(files, subject, body)
            if (outcome === 'downloaded') {
                toast(files.length
                    ? 'Dateien heruntergeladen. In WhatsApp manuell anhängen.'
                    : 'WhatsApp wurde für die Textnachricht geöffnet.')
            }
        } catch (error: any) {
            toast.error(error?.response?.data?.detail ||
                'Teilen war nicht möglich.')
        }
    }

    const saveDraft = async () => {
        if (draftSaving || mailSending || recipientsLoading) return
        setDraftSaving(true)
        try {
            const form = new FormData()
            if (draftId) form.append('draft_id', draftId)
            form.append('student_ids', JSON.stringify(selectedStudents.map(student => student.id)))
            form.append('manual_recipient', manualTarget)
            form.append('additional_recipient', extraTarget)
            form.append('resource_ids', JSON.stringify(studioFiles.map(file => file.id)))
            form.append('subject', subject)
            form.append('body', body)
            for (const file of localFiles) form.append('attachments', file)
            const { data } = await api.post<SavedMailDraft>('/core/mail/drafts/', form)
            setDraftId(data.id)
            toast.success('Entwurf mit Anhängen gespeichert.')
            setComposing(false)
            setRecipientPickerOpen(false)
            if (folder === 'drafts') {
                void loadFolder('drafts', true)
            } else {
                setFolder('drafts')
            }
        } catch (error: any) {
            toast.error(error?.response?.data?.detail ||
                'Der Entwurf konnte nicht gespeichert werden.')
        } finally {
            setDraftSaving(false)
        }
    }

    const openDraft = async (id: string) => {
        if (draftLoading) return
        setDraftLoading(true)
        try {
            const { data } = await api.get<SavedMailDraft>(
                '/core/mail/drafts/' + id + '/',
            )
            // Files are private in PostgreSQL. Recreate the same File objects
            // so saving again or sending from another device still works.
            const retrieved: File[] = []
            for (const file of data.local_attachments) {
                const { data: blob } = await api.get<Blob>(
                    '/core/mail/drafts/' + id + '/attachments/' + file.id + '/',
                    { responseType: 'blob' },
                )
                retrieved.push(new File([blob], file.filename, {
                    type: file.mime_type || 'application/octet-stream',
                }))
            }
            setDraftId(data.id)
            setRecipientMode('single')
            setRecipient(data.recipient)
            setReplyRecipientName('')
            setAdditionalRecipient(data.additional_recipient)
            setShowAdditionalRecipient(Boolean(data.additional_recipient))
            setRecipientOverrides(Object.fromEntries(
                data.student_ids.map(studentId => [studentId, true]),
            ))
            setStudioFiles(data.resources)
            setLocalFiles(retrieved)
            setSubject(data.subject)
            setBody(data.body)
            setComposing(true)
            setSelectedId(null)
            setRecipientPickerOpen(false)
        } catch (error: any) {
            toast.error(error?.response?.data?.detail ||
                'Entwurf oder gespeicherte Anhänge konnten nicht geladen werden.')
        } finally {
            setDraftLoading(false)
        }
    }

    useEffect(() => {
        if (folder !== 'drafts' || !linkedDraftId) return
        const id = linkedDraftId
        setLinkedDraftId('')
        void openDraft(id)
        // Opens only once when navigating from the student communication tab.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [folder, linkedDraftId])

    const deleteDraft = async (id: string) => {
        if (!window.confirm('Diesen gespeicherten Entwurf endgültig löschen?')) return
        try {
            await api.delete('/core/mail/drafts/' + id + '/')
            if (draftId === id) setDraftId(null)
            setMessages(items => items.filter(item => item.id !== id))
            toast.success('Entwurf gelöscht.')
            void loadFolder('drafts', true)
        } catch (error: any) {
            toast.error(error?.response?.data?.detail ||
                'Entwurf konnte nicht gelöscht werden.')
        }
    }

    const compose = (mode: 'new' | 'reply' | 'forward' = 'new') => {
        setDraftId(null)
        if (mode === 'new') {
            setRecipient('')
            setReplyRecipientName('')
            setSubject('')
            setBody('')
            setLocalFiles([])
        } else if (selected) {
            setRecipient(mode === 'reply' ? selected.email : '')
            setReplyRecipientName(mode === 'reply' ? selected.from : '')
            setSubject((mode === 'reply' ? 'Re: ' : 'Fw: ') + selected.subject)
            setBody(mode === 'forward' ? '\n\n--- Weitergeleitete Nachricht ---\n' + selected.body : '')
            setLocalFiles([])
        }
        setAdditionalRecipient('')
        setShowAdditionalRecipient(false)
        setStudioFiles([])
        setResourcePickerOpen(false)
        setResourceQuery('')
        setRecipientMode('single')
        setRecipientOverrides({})
        setRecipientSearch('')
        setRecipientPickerOpen(false)
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
                            onClick={() => void refreshFolder()}
                            disabled={mailLoading || mailActionBusy || cacheSyncing}
                            aria-label="Mails abrufen" title="IMAP-Abgleich im Hintergrund starten">
                            <RefreshCw size={16} className={mailLoading || cacheSyncing ? 'animate-spin' : ''} />
                            <span>{cacheSyncing ? 'Gleicht ab …' : 'Abrufen'}</span>
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
                                <select value={studentFilter} onChange={(event) => setStudentFilter(event.target.value)}>
                                    <option value="">Alle Schüler</option>
                                    {mailStudents.map((student) => (
                                        <option key={student.id} value={student.id}>{student.name}</option>
                                    ))}
                                </select>
                            </label>
                            <label>Instrument
                                <select value={instrumentFilter} onChange={(event) => setInstrumentFilter(event.target.value)}>
                                    <option value="">Alle Instrumente</option>
                                    {Array.from(new Set(mailStudents.flatMap(student => student.instruments)))
                                        .sort((a, b) => a.localeCompare(b, 'de')).map((name) => (
                                            <option key={name} value={name}>{name}</option>
                                        ))}
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
                            disabled={visible.length === 0 || mailActionBusy || folder === 'drafts'}
                            aria-label="Alle sichtbaren Nachrichten auswählen"
                        />
                        <span>{selectedVisibleIds.length > 0
                            ? `${selectedVisibleIds.length} ausgewählt`
                            : `${activeFolder.name} · IMAP`}</span>
                    </label>
                    <span>{folder === 'outbox' ? '0' : `${messages.length} / ${total}`} Mails</span>
                </div>
                {folder !== 'drafts' && selectedVisibleIds.length > 0 && (
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
                {cacheSyncing && !lastFetched && (
                    <div className="mail-fetch-status" role="status">
                        Nachrichten werden erstmals im Hintergrund übernommen …
                    </div>
                )}
                {lastFetched && folder !== 'outbox' && (
                    <div className="mail-fetch-status">
                        Letzter Abruf: {lastFetched.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}
                        {cacheSyncing && ' · Abgleich im Hintergrund'}
                    </div>
                )}
                <div className="mail-list-scroll">
                    {visible.length === 0 && (
                        <div className="mail-list-empty">
                            <Mail size={24} />
                            <p>{mailLoading || (cacheSyncing && !lastFetched) ?
                                'Nachrichten werden synchronisiert …' :
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
                                    {folder !== 'drafts' && <label className="mail-message-select"
                                        title="Nachricht für mehrere Aktionen auswählen">
                                        <input type="checkbox"
                                            checked={selectedMailIds.includes(message.id)}
                                            disabled={mailActionBusy}
                                            onChange={() => toggleMessageSelection(message.id)}
                                            aria-label={`${message.from}: ${message.subject} auswählen`} />
                                    </label>}
                                    <button type="button" className="mail-message-content"
                                        disabled={mailActionBusy}
                                        onClick={() => folder === 'drafts'
                                            ? void openDraft(message.id) : void selectMessage(message)}>
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
                                    {folder === 'drafts' && (
                                        <button type="button" className="mail-icon"
                                            aria-label={'Entwurf ' + message.subject + ' löschen'}
                                            title="Entwurf löschen"
                                            onClick={() => void deleteDraft(message.id)}>
                                            <Trash2 size={16} />
                                        </button>
                                    )}
                                </div>
                            </div>
                        )
                    })}
                    {folder !== 'outbox' && hasMore && (
                        <button type="button" className="mail-load-more"
                            disabled={mailLoading || pendingPageOffset !== null}
                            onClick={() => void loadFolder(folder, false, nextOffset)}>
                            {mailLoading || pendingPageOffset !== null
                                ? 'Wird nachgeladen …' : 'Weitere Nachrichten laden'}
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
                            <button type="button" className="mail-icon"
                                onClick={() => { setRecipientPickerOpen(false); setComposing(false) }}
                                aria-label="Editor schließen" title="Editor ausblenden, Eingaben in dieser Ansicht erhalten">
                                <X size={19} />
                            </button>
                        </div>
                        <div className="mail-compose-scroll">
                            <div className="mail-compose-to-row">
                                <span className="mail-compose-to-label">An:</span>
                                <button type="button" className="mail-compose-to-selection"
                                    disabled={mailSending}
                                    onClick={() => setRecipientPickerOpen(true)}
                                    title="Ausgewählte Schüler und Empfänger bearbeiten"
                                    aria-label={`Empfängerauswahl öffnen: ${distinctRecipientCount} E-Mail-Adressen`}>
                                    <span className="mail-compose-to-chips">
                                        {selectedStudents.map((student) => (
                                            <span className="mail-compose-to-chip" key={student.id}
                                                title={`${student.name} · ${student.email}`}>
                                                {student.name}
                                            </span>
                                        ))}
                                        {manualTarget && (
                                            <span className="mail-compose-to-chip" title={manualTarget}>
                                                {replyRecipientName || manualTarget}
                                            </span>
                                        )}
                                        {extraTarget && (
                                            <span className="mail-compose-to-chip" title={extraTarget}>
                                                {extraTarget}
                                            </span>
                                        )}
                                        {!selectedStudents.length && !manualTarget && !extraTarget && (
                                            <span className="mail-compose-to-placeholder">
                                                Empfänger auswählen …
                                            </span>
                                        )}
                                    </span>
                                </button>
                                <span className="mail-compose-to-count"
                                    title={`${distinctRecipientCount} unterschiedliche E-Mail-Adressen`}>
                                    {distinctRecipientCount}
                                </span>
                                <button type="button" className="mail-compose-to-edit"
                                    disabled={mailSending}
                                    aria-label="Empfänger auswählen oder ändern"
                                    onClick={() => setRecipientPickerOpen(true)}>
                                    Auswählen <ChevronDown size={14} />
                                </button>
                            </div>
                            <div className="mail-compose-line">
                                <label htmlFor="mail-subject">Betreff</label>
                                <input id="mail-subject" type="text" value={subject}
                                    onChange={(e) => setSubject(e.target.value)} placeholder="Betreff eingeben" />
                            </div>
                            <textarea className="mail-compose-body" aria-label="Nachrichtentext" value={body}
                                placeholder="Nachricht verfassen …" onChange={(e) => setBody(e.target.value)} />
                            <div className="mail-compose-signature"
                                aria-label="Automatische MUSart E-Mail-Signatur">
                                <img src="https://musart.de/images/yootheme/favicon.png"
                                    alt="MUSart-Logo" width={48} height={48} />
                                <div className="mail-compose-signature-details">
                                    <strong>Musikunterricht Sartori</strong>
                                    <span>Peter Müller</span>
                                    <a href="https://musart.de" target="_blank"
                                        rel="noopener noreferrer">https://musart.de</a>
                                    <a href="mailto:musikunterricht@musart.de">
                                        musikunterricht@musart.de
                                    </a>
                                </div>
                            </div>
                        </div>
                        {(localFiles.length > 0 || studioFiles.length > 0) && (
                            <div className="mail-compose-attachments-strip"
                                aria-label="Angehängte Dateien">
                                {localFiles.map((file, index) => {
                                    const Icon = attachmentIcon(file.name, file.type)
                                    return (
                                        <span className="mail-attachment-chip"
                                            key={String(index) + file.name}
                                            title={`Gerät: ${file.name}`}>
                                            <Icon size={16} />
                                            <span>{file.name}</span>
                                            <button type="button" disabled={mailSending}
                                                aria-label={file.name + ' entfernen'}
                                                onClick={() => setLocalFiles((items) => items.filter((_, i) => i !== index))}>
                                                <X size={13} />
                                            </button>
                                        </span>
                                    )
                                })}
                                {studioFiles.map((file) => {
                                    const Icon = attachmentIcon(file.filename, file.mime_type)
                                    return (
                                        <span className="mail-attachment-chip" key={file.id}
                                            title={`StudioSync: ${file.title} (${file.filename})`}>
                                            <Icon size={16} />
                                            <span>{file.title}</span>
                                            <button type="button" disabled={mailSending}
                                                aria-label={file.title + ' entfernen'}
                                                onClick={() => setStudioFiles((items) =>
                                                    items.filter((item) => item.id !== file.id))}>
                                                <X size={13} />
                                            </button>
                                        </span>
                                    )
                                })}
                            </div>
                        )}
                        <div className="mail-compose-footer">
                            <input ref={fileInputRef} hidden multiple type="file" onChange={(e) => {
                                const additions = Array.from(e.target.files || [])
                                if (additions.length + localFiles.length + studioFiles.length > 8) {
                                    toast.error('Maximal acht Anhänge pro Nachricht.')
                                } else {
                                    setLocalFiles((items) => [...items, ...additions])
                                }
                                e.target.value = ''
                            }} />
                            <button type="button" className="mail-secondary-button"
                                disabled={mailSending}
                                onClick={() => fileInputRef.current?.click()}
                                title="Dateien vom aktuellen Gerät auswählen">
                                <Upload size={17} /> Vom Gerät
                            </button>
                            <button type="button" className="mail-secondary-button"
                                disabled={mailSending}
                                onClick={() => { setResourceQuery(''); setResourcePickerOpen(true) }}
                                title="Vorhandene StudioSync-Datei anhängen">
                                <FileText size={17} /> Aus StudioSync
                            </button>
                            <button type="button" className="mail-secondary-button"
                                disabled={mailSending || draftSaving}
                                onClick={() => void shareComposedMail()}
                                title="Nachricht oder Anhänge über das Teilen-Menü versenden (z. B. WhatsApp)">
                                <Share2 size={17} /> Teilen
                            </button>
                            <div className="mail-compose-spacer" />
                            <button type="button" className="mail-secondary-button"
                                disabled={draftSaving || mailSending || recipientsLoading}
                                onClick={() => void saveDraft()}
                                title="Entwurf mit Anlagen in PostgreSQL speichern">
                                {draftSaving ? 'Speichert …' : 'Entwurf speichern'}
                            </button>
                            <button type="button" className="mail-send-button"
                                disabled={mailSending || draftSaving || recipientsLoading || !!recipientsError ||
                                    !distinctRecipientCount || !subject.trim() || !body.trim()}
                                onClick={() => void sendMail()}
                                title="Ausgewählte Empfänger über SMTP anschreiben">
                                <Send size={16} /> {mailSending ? 'Sendet …' : `Senden (${distinctRecipientCount})`}
                            </button>
                        </div>
                        {recipientPickerOpen && createPortal((
                            <div className="mail-recipient-overlay">
                                <button type="button" className="mail-recipient-backdrop"
                                    aria-label="Empfängerauswahl schließen"
                                    disabled={mailSending}
                                    onClick={() => setRecipientPickerOpen(false)} />
                                <div className="mail-recipient-dialog" ref={recipientDialogRef}
                                    role="dialog" aria-modal="true"
                                    aria-labelledby="mail-recipient-dialog-title">
                                    <div className="mail-recipient-dialog-header">
                                        <div>
                                            <strong id="mail-recipient-dialog-title">Empfänger auswählen</strong>
                                            <span>{selectedStudents.length} Schüler · {distinctRecipientCount} E-Mail-Adressen</span>
                                        </div>
                                        <button type="button" className="mail-icon"
                                            disabled={mailSending}
                                            onClick={() => setRecipientPickerOpen(false)}
                                            aria-label="Auswahlfenster schließen" title="Fenster schließen">
                                            <X size={19} />
                                        </button>
                                    </div>
                                    <div className="mail-recipient-dialog-controls">
                                        <div className="mail-recipient-modes" aria-label="Empfängerart">
                                            {([
                                                ['single', 'Einzeln'],
                                                ['all', 'Alle'],
                                                ['group', 'Gruppe'],
                                            ] as [RecipientMode, string][]).map(([id, label]) => (
                                                <button key={id} type="button"
                                                    className={recipientMode === id ? 'is-active' : ''}
                                                    disabled={mailSending}
                                                    aria-pressed={recipientMode === id}
                                                    onClick={() => switchRecipientMode(id)}>{label}</button>
                                            ))}
                                        </div>
                                        {recipientMode === 'group' && (
                                            <div className="mail-recipient-dialog-field">
                                                <label htmlFor="mail-group">Instrument</label>
                                                <select id="mail-group" value={effectiveGroup}
                                                    disabled={mailSending || recipientsLoading}
                                                    onChange={(e) => {
                                                        setGroup(e.target.value)
                                                        setRecipientOverrides({})
                                                    }}>
                                                    {instrumentGroups.map((name) => (
                                                        <option key={name} value={name}>{name}</option>
                                                    ))}
                                                </select>
                                            </div>
                                        )}
                                        {recipientMode === 'single' && (
                                            <>
                                                <div className="mail-recipient-dialog-field">
                                                    <label htmlFor="mail-to">Direkte Adresse</label>
                                                    <input id="mail-to" type="text" inputMode="email" pattern={INTERNATIONAL_EMAIL_PATTERN} title={INTERNATIONAL_EMAIL_HINT} value={recipient}
                                                        disabled={mailSending}
                                                        onChange={(e) => {
                                                            setRecipient(e.target.value)
                                                            setReplyRecipientName('')
                                                        }}
                                                        placeholder="Optional: eine E-Mail-Adresse" />
                                                </div>
                                                {!showAdditionalRecipient && !additionalRecipient ? (
                                                    <button type="button" className="mail-recipient-extra-toggle"
                                                        disabled={mailSending}
                                                        onClick={() => setShowAdditionalRecipient(true)}>
                                                        + Weitere Adresse (z. B. Studio oder Lehrkraft)
                                                    </button>
                                                ) : (
                                                    <div className="mail-recipient-dialog-field">
                                                        <label htmlFor="mail-extra">Weitere Adresse</label>
                                                        <input id="mail-extra" type="text" inputMode="email" pattern={INTERNATIONAL_EMAIL_PATTERN} title={INTERNATIONAL_EMAIL_HINT}
                                                            value={additionalRecipient} disabled={mailSending}
                                                            placeholder="Nur bei Bedarf"
                                                            onChange={(e) => setAdditionalRecipient(e.target.value)} />
                                                        <button type="button" className="mail-recipient-extra-clear"
                                                            disabled={mailSending} aria-label="Weitere Adresse entfernen"
                                                            onClick={() => {
                                                                setAdditionalRecipient('')
                                                                setShowAdditionalRecipient(false)
                                                            }}>
                                                            <X size={15} />
                                                        </button>
                                                    </div>
                                                )}
                                            </>
                                        )}
                                        <div className="mail-recipient-dialog-search">
                                            <Search size={17} aria-hidden="true" />
                                            <input ref={recipientSearchRef} type="search"
                                                placeholder="Schüler, E-Mail oder Instrument suchen …"
                                                aria-label="Schüler im Auswahlfenster suchen"
                                                value={recipientSearch}
                                                disabled={mailSending}
                                                onChange={(e) => setRecipientSearch(e.target.value)} />
                                            {recipientSearch && (
                                                <button type="button" className="mail-icon"
                                                    disabled={mailSending}
                                                    title="Suche löschen" aria-label="Suche löschen"
                                                    onClick={() => setRecipientSearch('')}>
                                                    <X size={16} />
                                                </button>
                                            )}
                                        </div>
                                        <div className="mail-recipient-dialog-select-actions">
                                            <span>{visibleStudents.length} von {studentRecipients.length} aktiven Schülern</span>
                                            <button type="button" disabled={mailSending || recipientsLoading || !!recipientsError}
                                                onClick={() => setVisibleRecipientSelection(true)}>
                                                Angezeigte auswählen
                                            </button>
                                            <button type="button" disabled={mailSending || recipientsLoading || !!recipientsError}
                                                onClick={() => setVisibleRecipientSelection(false)}>
                                                Angezeigte abwählen
                                            </button>
                                        </div>
                                    </div>
                                    <div className="mail-recipient-dialog-list">
                                        {recipientsLoading && (
                                            <p className="mail-compose-hint">Aktive Schüler werden geladen …</p>
                                        )}
                                        {recipientsError && (
                                            <div className="mail-fetch-error" role="alert">
                                                {recipientsError}
                                                <button type="button" onClick={() =>
                                                    setRecipientsReloadKey((value) => value + 1)}>
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
                                    </div>
                                    <div className="mail-recipient-dialog-footer">
                                        <span>{distinctRecipientCount} Empfängeradressen ausgewählt</span>
                                        <button type="button" className="mail-recipient-dialog-done"
                                            disabled={mailSending}
                                            onClick={() => setRecipientPickerOpen(false)}>
                                            Fertig
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ), document.body)}
                        {resourcePickerOpen && createPortal((
                            <div className="mail-recipient-overlay">
                                <button type="button" className="mail-recipient-backdrop"
                                    aria-label="Dateiauswahl schließen" disabled={mailSending}
                                    onClick={() => setResourcePickerOpen(false)} />
                                <div className="mail-resource-dialog" role="dialog" aria-modal="true"
                                    aria-labelledby="mail-resource-dialog-title">
                                    <div className="mail-recipient-dialog-header">
                                        <div>
                                            <strong id="mail-resource-dialog-title">
                                                Datei aus StudioSync anhängen
                                            </strong>
                                            <span>{studioFiles.length + localFiles.length} von 8 Anhängen ausgewählt</span>
                                        </div>
                                        <button type="button" className="mail-icon"
                                            disabled={mailSending} aria-label="Dateiauswahl schließen"
                                            onClick={() => setResourcePickerOpen(false)}>
                                            <X size={19} />
                                        </button>
                                    </div>
                                    <div className="mail-resource-search-row">
                                        <Search size={16} />
                                        <input ref={resourceSearchRef} type="search"
                                            value={resourceQuery} disabled={mailSending}
                                            aria-label="StudioSync-Dateien suchen"
                                            placeholder="Dateiname, Titel, Instrument oder Ordner suchen …"
                                            onChange={(e) => setResourceQuery(e.target.value)} />
                                    </div>
                                    <div className="mail-resource-dialog-list">
                                        {resourcesLoading && <p>StudioSync-Dateien werden geladen …</p>}
                                        {resourcesError && <p role="alert">{resourcesError}</p>}
                                        {!resourcesLoading && !resourcesError && (
                                            <>
                                                {resourceResults.map((item) => {
                                                    const Icon = attachmentIcon(item.filename, item.mime_type)
                                                    const checked = studioFiles.some((file) => file.id === item.id)
                                                    return (
                                                        <label className="mail-resource-option" key={item.id}>
                                                            <input type="checkbox" checked={checked}
                                                                disabled={mailSending || (!checked &&
                                                                    studioFiles.length + localFiles.length >= 8)}
                                                                onChange={() => toggleStudioFile(item)} />
                                                            <Icon size={21} />
                                                            <span className="mail-resource-option-info">
                                                                <strong>{item.title || item.filename}</strong>
                                                                <small>{item.filename}
                                                                    {item.folder_name ? ` · ${item.folder_name}` : ''}
                                                                    {typeof item.size === 'number'
                                                                        ? ` · ${Math.round(item.size / 1024)} KB` : ''}
                                                                </small>
                                                            </span>
                                                        </label>
                                                    )
                                                })}
                                                {resourceResults.length === 0 && (
                                                    <p>Keine passenden gespeicherten Dateien gefunden.</p>
                                                )}
                                                {resourceHasMore && (
                                                    <p>Weitere Dateien vorhanden. Bitte die Suche eingrenzen.</p>
                                                )}
                                            </>
                                        )}
                                    </div>
                                    <div className="mail-recipient-dialog-footer">
                                        <span>{studioFiles.length} StudioSync-Datei(en) ausgewählt</span>
                                        <button type="button" className="mail-recipient-dialog-done"
                                            disabled={mailSending}
                                            onClick={() => setResourcePickerOpen(false)}>
                                            Fertig
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ), document.body)}
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
                                    <strong>{folder === 'sent' ? 'An: ' + selected.from : selected.from}</strong>
                                    <span>{selected.email}</span>
                                </div>
                                <span className="mail-reader-date">{dateLabel(selected.date)} · {timeLabel(selected.date)}</span>
                            </div>
                            <div className="mail-association">
                                {selected.student ? (
                                    <><span>{selected.student}</span><ChevronRight size={13} /><span>{selected.instrument}</span></>
                                ) : (
                                    <span>Nicht zugeordnet</span>
                                )}
                                {selected.assignment_manual && <small>Manuell</small>}
                                <button type="button" className="mail-association-edit"
                                    onClick={editMailAssociation}>Zuordnen</button>
                            </div>
                            {associationEditorOpen && (
                                <div className="mail-association-editor">
                                    <strong>Schüler zuordnen</strong>
                                    <p>Eine Familienadresse kann mehreren Kindern gehören.</p>
                                    <div className="mail-association-options">
                                        {mailStudents.map((student) => (
                                            <label key={student.id}>
                                                <input type="checkbox"
                                                    checked={associationSelection.includes(student.id)}
                                                    disabled={associationSaving}
                                                    onChange={(event) => setAssociationSelection((items) =>
                                                        event.target.checked
                                                            ? [...items, student.id]
                                                            : items.filter(id => id !== student.id))} />
                                                {student.name}
                                            </label>
                                        ))}
                                    </div>
                                    <div className="mail-association-controls">
                                        <button type="button" disabled={associationSaving}
                                            onClick={() => void saveMailAssociation(false)}>Speichern</button>
                                        <button type="button" disabled={associationSaving}
                                            onClick={() => void saveMailAssociation(true)}>Automatisch</button>
                                        <button type="button" disabled={associationSaving}
                                            onClick={() => setAssociationEditorOpen(false)}>Schließen</button>
                                    </div>
                                </div>
                            )}
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
