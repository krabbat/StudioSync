'use client'

import { useTranslations, useLocale } from 'next-intl'
import { useState, type FormEvent } from 'react'
import { addMinutes, format, parseISO, isWithinInterval, startOfDay, endOfDay } from 'date-fns'
import { useUser } from '@/contexts/UserContext'
import { useLessons, useStudents, useTeachers, useStudios, useBands, useLessonPlans, useResources } from '@/hooks/useDashboardData'
import ResourceSelector from '@/components/ResourceSelector'
import LessonDeleteDialog, { type LessonDeleteTarget, type LessonDeleteScope } from '@/components/LessonDeleteDialog'
import LessonBookingDialog, { type LessonBookingData, type LessonBookingMode } from '@/components/LessonBookingDialog'
import api from '@/services/api'
import { toast } from 'react-hot-toast'
import type { LessonPlan, LessonPlanFormData } from '@/types/lessonPlan'
import {
    Search,
    Calendar,
    Filter,
    ChevronLeft,
    ChevronRight,
    MoreHorizontal,
    Plus,
    FileText,
    Users,
    User,
    Loader2,
    X,
    Clock,
    CheckCircle2,
    BookOpen,
    Target,
    Activity,
    Sparkles,
    Trash2,
    Edit,
    Package,
    Tag
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogHeader, DialogContent, DialogFooter } from '@/components/ui/dialog'

interface Lesson {
    id: string
    student?: string
    teacher?: string
    student_profile_id?: string
    band?: string
    room?: string
    duration_minutes?: number
    online_meeting_url?: string
    cancellation_reason?: string
    student_name: string
    teacher_name: string
    student_instrument: string
    scheduled_start: string
    scheduled_end: string
    lesson_type: 'private' | 'group' | 'workshop' | 'recital' | 'makeup'
    status: 'scheduled' | 'in_progress' | 'completed' | 'cancelled' | 'no_show'
    location: string
    student_address?: string
    is_online?: boolean
    is_paid: boolean
    is_recurring?: boolean
    guest_name?: string
    guest_address?: string
    summary?: string
}

export default function LessonsPage() {
  const tr = useTranslations('Lessons')
  const locale = useLocale()
    const { currentUser } = useUser()
    const { lessons, loading, refetch: refetchLessons } = useLessons()
    const typedLessons = lessons as Lesson[]
    const { students: studentProfiles } = useStudents({ page_size: 100 })
    const { teachers } = useTeachers()
    const { studios } = useStudios()
    const preferredTeacherId = teachers.find((item: any) => [item.first_name, item.last_name].filter(Boolean).join(' ').toLocaleLowerCase('de-DE') === 'peter sartori')?.id || teachers[0]?.id || ''

    const { bands } = useBands({ page_size: 100 })

    const [selectedLessons, setSelectedLessons] = useState<string[]>([])
    const [filterStatus, setFilterStatus] = useState('all')
    const [searchQuery, setSearchQuery] = useState('')
    const [dateRange, setDateRange] = useState<{ start: string; end: string }>({ start: '', end: '' })
    const [viewMode, setViewMode] = useState<'all' | 'my_lessons'>('all')
    const currentTeacherName = currentUser ? `${currentUser.first_name} ${currentUser.last_name}` : ''

    // Pagination
    const [currentPage, setCurrentPage] = useState(1)
    const itemsPerPage = 10

    // Lesson Plan State
    const { plans, loading: plansLoading, createPlan, updatePlan, deletePlan } = useLessonPlans()
    const [showPlanModal, setShowPlanModal] = useState(false)
    const [editingPlan, setEditingPlan] = useState<LessonPlan | null>(null)
    const [showResourceSelector, setShowResourceSelector] = useState(false)
    const [formData, setFormData] = useState<LessonPlanFormData>({
        title: '',
        description: '',
        content: '',
        estimated_duration_minutes: 60,
        tags: [],
        is_public: false,
        resource_ids: []
    })
    const [tagInput, setTagInput] = useState('')
    const [submitting, setSubmitting] = useState(false)

    // Both screens use the exact same booking form, including recurrence and
    // contract-based duration behaviour.
    const [showLessonModal, setShowLessonModal] = useState(false)
    const [editingLessonId, setEditingLessonId] = useState<string | null>(null)
    const [lessonSubmitting, setLessonSubmitting] = useState(false)
    const [bookingMode, setBookingMode] = useState<LessonBookingMode>('individual')
    const [deletingLessonId, setDeletingLessonId] = useState<string | null>(null)
    const [deleteTarget, setDeleteTarget] = useState<LessonDeleteTarget | null>(null)
    const blankLesson = (teacher = preferredTeacherId): LessonBookingData => ({
        student: '', teacher, band: '', room: '', date: '', time: '13:00',
        duration: 60, lesson_type: 'private', is_online: false,
        online_meeting_url: '', status: 'scheduled',
        cancellation_reason: '', summary: '', guest_name: '', guest_address: '',
        recurrence: 'none', recurrence_until: '',
    })
    const [newBooking, setNewBooking] = useState<LessonBookingData>(() => blankLesson(''))

    const openNewLesson = () => {
        setEditingLessonId(null)
        setBookingMode('individual')
        setNewBooking({
            ...blankLesson(), date: format(new Date(), 'yyyy-MM-dd'),
        })
        setShowLessonModal(true)
    }

    const openExistingLesson = (lesson: Lesson) => {
        const start = parseISO(lesson.scheduled_start)
        const isGuest = Boolean(lesson.guest_name)
        setEditingLessonId(lesson.id)
        setBookingMode(
            isGuest ? 'special' : lesson.band ? 'band'
            : (lesson.lesson_type === 'workshop' || lesson.lesson_type === 'recital') ? 'event' : 'individual'
        )
        setNewBooking({
            ...blankLesson(lesson.teacher || preferredTeacherId),
            student: lesson.student_profile_id || lesson.student || '',
            band: lesson.band || '',
            room: lesson.room || '',
            date: format(start, 'yyyy-MM-dd'),
            time: format(start, 'HH:mm'),
            duration: lesson.duration_minutes || Math.round(
                (parseISO(lesson.scheduled_end).getTime() - start.getTime()) / 60000
            ),
            lesson_type: lesson.lesson_type || 'private',
            status: lesson.status || 'scheduled',
            is_online: Boolean(lesson.is_online),
            online_meeting_url: lesson.online_meeting_url || '',
            cancellation_reason: lesson.cancellation_reason || '',
            guest_name: lesson.guest_name || '',
            guest_address: lesson.guest_address || '',
            summary: lesson.summary || '',
        })
        setShowLessonModal(true)
    }

    const saveLessonBooking = async (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault()
        if (!newBooking.date || !newBooking.time ||
            (bookingMode === 'individual' && !newBooking.student) ||
            (bookingMode === 'band' && !newBooking.band) ||
            (bookingMode === 'special' && !newBooking.guest_name.trim())
        ) {
            toast.error('Bitte die erforderlichen Termindaten ausfüllen.')
            return
        }
        setLessonSubmitting(true)
        try {
            const start = new Date(`${newBooking.date}T${newBooking.time}`)
            const end = addMinutes(start, newBooking.duration)
            const payload: Record<string, any> = {
                studio: currentUser?.studio?.id || studios?.[0]?.id,
                teacher: newBooking.teacher || currentUser?.teacher_profile?.id || preferredTeacherId,
                scheduled_start: start.toISOString(),
                scheduled_end: end.toISOString(),
                lesson_type: newBooking.lesson_type,
                status: newBooking.status,
                summary: newBooking.summary,
                guest_name: bookingMode === 'special' ? newBooking.guest_name.trim() : '',
                guest_address: bookingMode === 'special' ? newBooking.guest_address.trim() : '',
                is_online: newBooking.is_online,
                online_meeting_url: newBooking.is_online ? newBooking.online_meeting_url : '',
            }
            if (newBooking.status === 'cancelled') {
                payload.cancellation_reason = newBooking.cancellation_reason
            }
            if (bookingMode === 'special') {
                payload.student = null
                payload.band = null
                payload.room = null
            } else if (bookingMode === 'band') {
                payload.band = newBooking.band
                payload.student = null
            } else if (bookingMode === 'individual') {
                payload.student = newBooking.student
                payload.band = null
            } else {
                payload.student = newBooking.student || null
                payload.band = newBooking.band || null
            }

            if (!editingLessonId && newBooking.recurrence !== 'none') {
                if (bookingMode !== 'individual' || currentUser?.role !== 'admin') {
                    toast.error('Wiederholungen sind nur für Schülertermine durch Administratoren vorgesehen.')
                    return
                }
                await api.post('/core/calendar/icloud/series/create/', {
                    ...payload, frequency: newBooking.recurrence,
                    until: newBooking.recurrence_until || null,
                })
                toast.success('Wiederholungstermin in iCloud und StudioSync angelegt.')
            } else if (editingLessonId) {
                await api.patch(`/lessons/${editingLessonId}/`, payload)
                toast.success('Unterrichtstermin aktualisiert.')
            } else {
                await api.post('/lessons/', payload)
                toast.success('Unterrichtstermin angelegt.')
            }
            setShowLessonModal(false)
            setEditingLessonId(null)
            await refetchLessons()
            if (currentUser?.role === 'admin' && currentUser?.preferences?.technical?.icloud_calendar_url) {
                void api.post('/core/calendar/icloud/sync/')
                    .then(() => refetchLessons())
                    .catch(() => toast.error('Der anschließende iCloud-Abgleich ist fehlgeschlagen.'))
            }
        } catch (error: any) {
            const detail = error?.response?.data?.detail || Object.values(error?.response?.data || {})[0]
            toast.error(typeof detail === 'string' ? detail : 'Unterrichtstermin konnte nicht gespeichert werden.')
        } finally {
            setLessonSubmitting(false)
        }
    }

    const statusLabels: Record<string, string> = {
        all: tr('all'), scheduled: tr('statusScheduled'),
        in_progress: tr('statusInProgress'), completed: tr('statusCompleted'),
        cancelled: tr('statusCancelled'), no_show: tr('statusNoShow')
    }
    const typeLabels: Record<string, string> = {
        private: tr('typePrivate'), group: tr('typeGroup'),
        workshop: tr('typeWorkshop'), recital: tr('typeRecital'),
        makeup: tr('typeMakeup')
    }
    const getStatusBadge = (status: string) => {
        const styles = {
            scheduled: 'bg-blue-50 text-blue-700 border-blue-200',
            in_progress: 'bg-purple-50 text-purple-700 border-purple-200',
            completed: 'bg-green-50 text-green-700 border-green-200',
            cancelled: 'bg-red-50 text-red-700 border-red-200',
            no_show: 'bg-gray-50 text-gray-700 border-gray-200',
        }

        const key = status?.toLowerCase() || 'scheduled'
        const style = styles[key as keyof typeof styles] || styles.scheduled

        return (
            <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border ${style}`}>
                {status ? statusLabels[key] || status : tr('unknown')}
            </span>
        )
    }

    const getTypeBadge = (type: string) => {
        const styles = {
            private: 'bg-indigo-50 text-indigo-700 border-indigo-200',
            group: 'bg-teal-50 text-teal-700 border-teal-200',
            workshop: 'bg-orange-50 text-orange-700 border-orange-200',
            recital: 'bg-pink-50 text-pink-700 border-pink-200',
            makeup: 'bg-yellow-50 text-yellow-700 border-yellow-200',
        }
        const key = type?.toLowerCase() || 'private'
        const style = styles[key as keyof typeof styles] || styles.private

        return (
            <span className={`px-2.5 py-1 rounded-lg text-[10px] font-bold border uppercase tracking-tighter ${style}`}>
                {type ? typeLabels[key] || type : tr('unknown')}
            </span>
        )
    }

    const toggleLesson = (id: string) => {
        setSelectedLessons(prev =>
            prev.includes(id) ? prev.filter(lid => lid !== id) : [...prev, id]
        )
    }

    // Filter Logic
    const filteredLessons = typedLessons.filter(lesson => {
        if (viewMode === 'my_lessons' && lesson.teacher_name !== currentTeacherName) return false
        if (filterStatus !== 'all' && lesson.status !== filterStatus) return false

        const searchLower = searchQuery.toLowerCase()
        if (searchQuery && !lesson.student_name?.toLowerCase().includes(searchLower) &&
            !lesson.teacher_name?.toLowerCase().includes(searchLower)) {
            return false
        }

        if (dateRange.start && dateRange.end) {
            const lessonDate = parseISO(lesson.scheduled_start)
            const start = startOfDay(parseISO(dateRange.start))
            const end = endOfDay(parseISO(dateRange.end))
            if (!isWithinInterval(lessonDate, { start, end })) return false
        }

        return true
    })

    // Pagination Logic
    const totalPages = Math.ceil(filteredLessons.length / itemsPerPage)
    const startIndex = (currentPage - 1) * itemsPerPage
    const currentItems = filteredLessons.slice(startIndex, startIndex + itemsPerPage)

    const handleDeleteLesson = (lesson: Lesson) => {
        setDeleteTarget({
            id: lesson.id,
            label: `${lesson.student_name || lesson.guest_name || 'Unterricht'} am ${format(parseISO(lesson.scheduled_start), 'dd.MM.yyyy HH:mm')}`,
            isRecurring: Boolean(lesson.is_recurring),
            canPermanentlyDelete: currentUser?.role === 'admin'
                && !lesson.is_paid
                && !['completed', 'in_progress', 'no_show'].includes(lesson.status),
        })
    }

    const confirmDeleteLesson = async (scope: LessonDeleteScope) => {
        if (!deleteTarget) return
        if (scope === 'permanent' && !window.confirm(
            'Diesen Unterrichtstermin wirklich ENDGÜLTIG aus StudioSync und iCloud löschen? Die Unterrichtsdaten werden dabei unwiderruflich entfernt.'
        )) return
        if (scope === 'future' && !window.confirm(
            'Diesen Termin UND ALLE zukünftigen Serientermine wirklich ENDGÜLTIG löschen? Diese Einträge werden nicht rot als abgesagt erhalten.'
        )) return
        const lessonId = deleteTarget.id
        setDeletingLessonId(lessonId)
        try {
            const response = await api.delete(`/lessons/${lessonId}/`, { params: { scope } })
            toast.success(response.data?.detail || 'Unterrichtstermin gelöscht.')
            if (response.data?.icloud_synced === false) {
                toast.error('iCloud ist noch nicht aktualisiert. Bitte den Kalenderabgleich prüfen.')
            }
            setSelectedLessons(previous => previous.filter(id => id !== lessonId))
            setDeleteTarget(null)
            setShowLessonModal(false)
            setEditingLessonId(null)
            setCurrentPage(page => currentItems.length === 1 && page > 1 ? page - 1 : page)
            await refetchLessons()
        } catch (error: any) {
            toast.error(error?.response?.data?.detail || 'Unterrichtstermin konnte nicht gelöscht werden.')
        } finally {
            setDeletingLessonId(null)
        }
    }

    const handlePageChange = (newPage: number) => {
        if (newPage >= 1 && newPage <= totalPages) {
            setCurrentPage(newPage)
        }
    }

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-4 animate-in fade-in duration-500">
                <Loader2 className="w-10 h-10 text-primary animate-spin" />
                <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">{tr('synchronizingLessons')}</p>
            </div>
        )
    }

    return (
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 pb-12 space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
            {/* Header */}
            <header className="flex flex-col md:flex-row md:items-end justify-between gap-6 pt-4">
                <div className="space-y-2">
                    <h1 className="text-3xl md:text-4xl font-black text-gray-900 tracking-tight">{tr('lessonsPlans')}</h1>
                    <p className="text-gray-500 font-medium max-w-lg">{tr('orchestrateYourPedagogicalWorkflowAndTrackStudentEvolution')}</p>
                </div>
                {currentUser && ['admin', 'teacher'].includes(currentUser.role) && (
                    <div className="grid grid-cols-2 sm:flex sm:flex-row gap-3">
                        <Button
                            onClick={openNewLesson}
                            className="gap-2 shadow-lg shadow-primary/20 transition-all hover:scale-105 h-12 sm:h-auto"
                        >
                            <Calendar className="w-4 h-4" />
                            <span className="text-xs sm:text-sm">{tr('newLesson')}</span>
                        </Button>
                        <Button
                            variant="secondary"
                            onClick={() => setShowPlanModal(true)}
                            className="gap-2 transition-all hover:scale-105 text-primary border-primary/20 bg-primary/5 hover:bg-primary/10 h-12 sm:h-auto"
                        >
                            <Plus className="w-4 h-4" />
                            <span className="text-xs sm:text-sm">{tr('newTemplate')}</span>
                        </Button>
                    </div>
                )}
            </header>

            {/* Controls */}
            <div className="bg-white p-2 sm:p-4 rounded-3xl border border-gray-100 shadow-xl space-y-4">
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                    <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
                        <div className="flex bg-gray-50 rounded-2xl p-1 border border-gray-100 w-full sm:w-auto overflow-hidden">
                            <Button
                                variant={viewMode === 'all' ? 'secondary' : 'ghost'}
                                size="sm"
                                onClick={() => { setViewMode('all'); setCurrentPage(1); }}
                                className={`flex-1 sm:px-4 rounded-xl text-[10px] font-black uppercase tracking-widest ${viewMode === 'all' ? 'bg-white shadow-sm' : 'text-gray-400'}`}
                            >
                                {tr('all')}
                            </Button>
                            <Button
                                variant={viewMode === 'my_lessons' ? 'secondary' : 'ghost'}
                                size="sm"
                                onClick={() => { setViewMode('my_lessons'); setCurrentPage(1); }}
                                className={`flex-1 sm:px-4 rounded-xl text-[10px] font-black uppercase tracking-widest ${viewMode === 'my_lessons' ? 'bg-white shadow-sm' : 'text-gray-400'}`}
                            >
                                {tr('myLessons')}
                            </Button>
                        </div>
                        <div className="flex p-1 bg-gray-50 rounded-2xl border border-gray-100 overflow-x-auto no-scrollbar w-full sm:w-auto">
                            {['all', 'scheduled', 'completed', 'cancelled'].map(status => (
                                <button
                                    key={status}
                                    onClick={() => { setFilterStatus(status); setCurrentPage(1); }}
                                    className={`flex-1 sm:flex-none px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all whitespace-nowrap ${filterStatus === status
                                            ? 'bg-white text-primary shadow-sm'
                                            : 'text-gray-400 hover:text-gray-600'
                                        }`}
                                >
                                    {statusLabels[status] || status}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="flex flex-col sm:flex-row gap-3">
                        <div className="relative flex-1">
                            <Search className="w-4 h-4 absolute left-4 top-1/2 transform -translate-y-1/2 text-gray-400" />
                            <input
                                type="text"
                                placeholder={tr('search')}
                                className="pl-12 pr-4 py-3 bg-gray-50 border-transparent focus:bg-white border-2 focus:border-primary rounded-2xl font-bold text-sm text-gray-700 outline-none transition-all w-full"
                                value={searchQuery}
                                onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1); }}
                            />
                        </div>
                        <input
                            type="date"
                            className="px-4 py-3 bg-gray-50 border-transparent focus:bg-white border-2 focus:border-primary rounded-2xl font-bold text-sm text-gray-700 outline-none transition-all"
                            value={dateRange.start}
                            onChange={(e) => { setDateRange(prev => ({ ...prev, start: e.target.value })); setCurrentPage(1); }}
                        />
                    </div>
                </div>
            </div>

            {/* Table / Card View Area */}
            <div className="bg-white rounded-[2rem] border border-gray-100 shadow-2xl overflow-hidden">
                {/* Desktop View Table */}
                <div className="hidden md:block overflow-x-auto custom-scrollbar">
                    <table className="w-full border-separate border-spacing-0">
                        <thead className="bg-gray-50/50">
                            <tr>
                                <th className="px-6 py-5 text-left w-4">
                                    <input
                                        type="checkbox"
                                        checked={selectedLessons.length === currentItems.length && currentItems.length > 0}
                                        onChange={() => {
                                            if (selectedLessons.length === currentItems.length) {
                                                setSelectedLessons([])
                                            } else {
                                                setSelectedLessons(currentItems.map(l => l.id))
                                            }
                                        }}
                                        className="rounded border-gray-300 text-primary focus:ring-primary w-4 h-4"
                                    />
                                </th>
                                <th className="px-6 py-5 text-left text-[10px] font-black text-gray-400 uppercase tracking-widest">{tr('dateSchedule')}</th>
                                <th className="px-6 py-5 text-left text-[10px] font-black text-gray-400 uppercase tracking-widest">{tr('studentGroup')}</th>
                                <th className="px-6 py-5 text-left text-[10px] font-black text-gray-400 uppercase tracking-widest">{tr('instructor')}</th>
                                <th className="px-6 py-5 text-left text-[10px] font-black text-gray-400 uppercase tracking-widest">{tr('type')}</th>
                                <th className="px-6 py-5 text-left text-[10px] font-black text-gray-400 uppercase tracking-widest">{tr('status')}</th>
                                <th className="px-6 py-5 text-right text-[10px] font-black text-gray-400 uppercase tracking-widest">{tr('actions')}</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                            {currentItems.length > 0 ? (
                                currentItems.map((lesson) => {
                                    const start = parseISO(lesson.scheduled_start)
                                    const end = parseISO(lesson.scheduled_end)
                                    const duration = (end.getTime() - start.getTime()) / (1000 * 60)

                                    return (
                                        <tr key={lesson.id} className="hover:bg-gray-50/30 transition-all group">
                                            <td className="px-6 py-6">
                                                <input
                                                    type="checkbox"
                                                    checked={selectedLessons.includes(lesson.id)}
                                                    onChange={() => toggleLesson(lesson.id)}
                                                    className="rounded border-gray-300 text-primary focus:ring-primary w-4 h-4"
                                                />
                                            </td>
                                            <td className="px-6 py-6">
                                                <div className="flex flex-col gap-1">
                                                    <span className="text-sm font-black text-gray-900 tracking-tight">{new Intl.DateTimeFormat(locale, { weekday: 'short', month: 'short', day: 'numeric' }).format(start)}</span>
                                                    <span className="text-[10px] text-gray-400 flex items-center gap-1.5 font-black uppercase tracking-widest">
                                                        <Clock className="w-3 h-3 text-primary" />
                                                        {new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(start)} • {duration}m
                                                    </span>
                                                </div>
                                            </td>
                                            <td className="px-6 py-6">
                                                <div className="flex items-center gap-4">
                                                    <div className="h-10 w-10 shrink-0 rounded-2xl bg-primary/5 flex items-center justify-center text-primary text-xs font-black border border-primary/10">
                                                        {lesson.student_name?.split(' ').map(n => n[0]).join('') || '?'}
                                                    </div>
                                                    <div>
                                                        <div className="text-sm font-black text-gray-900 tracking-tight uppercase tracking-tighter">{lesson.student_name}</div>
                                                        <div className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">{lesson.student_instrument}</div>
                                                        {lesson.student_address && (
                                                            <div className="text-xs text-gray-600 mt-1">{lesson.student_address}</div>
                                                        )}
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="px-6 py-6 font-bold text-gray-600 text-sm">
                                                {lesson.teacher_name}
                                            </td>
                                            <td className="px-6 py-6">
                                                {getTypeBadge(lesson.lesson_type)}
                                            </td>
                                            <td className="px-6 py-6">
                                                {getStatusBadge(lesson.status)}
                                            </td>
                                            <td className="px-6 py-6 text-right">
                                                <div className="flex justify-end gap-2">
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        onClick={() => openExistingLesson(lesson)}
                                                        className="text-gray-400 hover:text-primary hover:bg-primary/5 active:scale-95"
                                                    >
                                                        <Edit className="w-4 h-4" />
                                                    </Button>
                                                    {currentUser && ['admin', 'teacher'].includes(currentUser.role) && (
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            title="Unterrichtstermin löschen"
                                                            aria-label={`Termin ${lesson.student_name} löschen`}
                                                            disabled={deletingLessonId !== null}
                                                            onClick={() => void handleDeleteLesson(lesson)}
                                                            className="text-red-500 hover:text-red-700 hover:bg-red-50"
                                                        >
                                                            {deletingLessonId === lesson.id
                                                                ? <Loader2 className="w-4 h-4 animate-spin" />
                                                                : <Trash2 className="w-4 h-4" />}
                                                        </Button>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    )
                                })
                            ) : null}
                        </tbody>
                    </table>
                </div>

                {/* Mobile Card-Based View */}
                <div className="md:hidden divide-y divide-gray-50">
                    {currentItems.length > 0 ? (
                        currentItems.map((lesson) => {
                            const start = parseISO(lesson.scheduled_start)
                            const end = parseISO(lesson.scheduled_end)
                            const duration = (end.getTime() - start.getTime()) / (1000 * 60)

                            return (
                                <div key={lesson.id} className="p-4 space-y-4 hover:bg-gray-50/30 transition-all">
                                    <div className="flex items-start justify-between">
                                        <div className="flex items-center gap-3">
                                            <div className="h-10 w-10 shrink-0 rounded-2xl bg-primary/5 flex items-center justify-center text-primary text-xs font-black border border-primary/10">
                                                {lesson.student_name?.split(' ').map(n => n[0]).join('') || '?'}
                                            </div>
                                            <div>
                                                <div className="text-sm font-black text-gray-900 tracking-tight uppercase">{lesson.student_name}</div>
                                                <div className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">{lesson.student_instrument}</div>
                                                        {lesson.student_address && (
                                                            <div className="text-xs text-gray-600 mt-1">{lesson.student_address}</div>
                                                        )}
                                            </div>
                                        </div>
                                        <div className="flex flex-col items-end gap-1">
                                            {getStatusBadge(lesson.status)}
                                            {getTypeBadge(lesson.lesson_type)}
                                        </div>
                                    </div>

                                    <div className="flex items-center justify-between text-xs font-bold text-gray-600 bg-gray-50 rounded-xl p-3">
                                        <div className="flex items-center gap-2">
                                            <Calendar className="w-3.5 h-3.5 text-primary" />
                                            {new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(start)}
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <Clock className="w-3.5 h-3.5 text-gray-400" />
                                            {duration}m
                                        </div>
                                    </div>

                                    <div className="flex items-center justify-between pt-1">
                                        <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest truncate max-w-[150px]">
                                            {tr('instructor')} <span className="text-gray-600">{lesson.teacher_name}</span>
                                        </span>
                                        <div className="flex items-center gap-1">
                                        {currentUser && ['admin', 'teacher'].includes(currentUser.role) && (
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                title="Unterrichtstermin löschen"
                                                aria-label={`Termin ${lesson.student_name} löschen`}
                                                disabled={deletingLessonId !== null}
                                                onClick={() => void handleDeleteLesson(lesson)}
                                                className="text-red-600 hover:bg-red-50"
                                            >
                                                {deletingLessonId === lesson.id
                                                    ? <Loader2 className="w-4 h-4 animate-spin" />
                                                    : <Trash2 className="w-4 h-4" />}
                                                Löschen
                                            </Button>
                                        )}
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => openExistingLesson(lesson)}
                                            className="text-primary font-black uppercase text-[10px] tracking-widest h-8 px-2"
                                        >
                                            <Edit className="w-3 h-3 mr-1" />
                                            {tr('edit')}
                                        </Button>
                                        </div>
                                    </div>
                                </div>
                            )
                        })
                    ) : null}
                </div>

                {currentItems.length === 0 && (
                    <div className="px-6 py-20 text-center">
                        <div className="flex flex-col items-center justify-center gap-4">
                            <div className="w-20 h-20 bg-gray-50 rounded-[2.5rem] flex items-center justify-center border-2 border-dashed border-gray-100">
                                <BookOpen className="w-10 h-10 text-gray-200" />
                            </div>
                            <div>
                                <p className="text-xs font-black text-gray-400 uppercase tracking-widest">{tr('noMatchingLessonsFound')}</p>
                            </div>
                        </div>
                    </div>
                )}

                {/* Pagination */}
                <div className="p-4 sm:p-6 bg-gray-50/30 flex flex-col sm:flex-row items-center justify-between gap-4">
                    <div className="text-[10px] font-black text-gray-400 uppercase tracking-widest order-2 sm:order-1">
                        {tr('showingRange', {from: filteredLessons.length ? startIndex + 1 : 0, to: Math.min(startIndex + itemsPerPage, filteredLessons.length), count: filteredLessons.length})}
                    </div>
                    <div className="flex items-center gap-3 order-1 sm:order-2">
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handlePageChange(currentPage - 1)}
                            disabled={currentPage === 1}
                            className="rounded-xl h-10 w-10 sm:h-12 sm:w-12 bg-white border border-gray-100 shadow-sm disabled:opacity-30"
                        >
                            <ChevronLeft className="w-5 h-5 text-gray-600" />
                        </Button>
                        <div className="h-10 sm:h-12 px-6 flex items-center justify-center bg-white border border-gray-100 rounded-2xl text-[10px] font-black text-gray-700 shadow-sm uppercase tracking-widest">
                            {currentPage} / {totalPages || 1}
                        </div>
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handlePageChange(currentPage + 1)}
                            disabled={currentPage === totalPages || totalPages === 0}
                            className="rounded-xl h-10 w-10 sm:h-12 sm:w-12 bg-white border border-gray-100 shadow-sm disabled:opacity-30"
                        >
                            <ChevronRight className="w-5 h-5 text-gray-600" />
                        </Button>
                    </div>
                </div>
            </div>

            {/* Lesson Plans Section */}
            <div className="bg-white rounded-3xl border border-gray-100 shadow-xl p-6 space-y-6">
                <div className="flex items-center justify-between">
                    <div>
                        <h2 className="text-xl font-black text-gray-900">{tr('lessonPlanTemplates')}</h2>
                        <p className="text-sm text-gray-600 mt-1">{tr('reusableCurriculumFrameworksWithAttachedResources')}</p>
                    </div>
                    <div className="text-sm text-gray-500">
                        {tr('templateCount', {count: plans.length})}
                    </div>
                </div>

                {plansLoading ? (
                    <div className="flex items-center justify-center py-12">
                        <Loader2 className="w-8 h-8 text-primary animate-spin" />
                    </div>
                ) : plans.length === 0 ? (
                    <div className="text-center py-12 space-y-3">
                        <BookOpen className="w-12 h-12 text-gray-300 mx-auto" />
                        <p className="text-gray-500">{tr('noLessonPlansYet')}</p>
                        <p className="text-sm text-gray-400">{tr('createYourFirstTemplateToGetStarted')}</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {plans.map((plan: LessonPlan) => (
                            <div key={plan.id} className="border border-gray-200 rounded-2xl p-4 hover:shadow-lg transition-shadow">
                                <div className="flex items-start justify-between mb-3">
                                    <div className="flex-1">
                                        <h3 className="font-bold text-gray-900 line-clamp-1">{plan.title}</h3>
                                        <p className="text-xs text-gray-500 mt-1">{plan.created_by_name}</p>
                                    </div>
                                    <div className="flex gap-1">
                                        <button
                                            onClick={() => {
                                                setEditingPlan(plan)
                                                setFormData({
                                                    title: plan.title,
                                                    description: plan.description || '',
                                                    content: plan.content,
                                                    estimated_duration_minutes: plan.estimated_duration_minutes,
                                                    tags: plan.tags,
                                                    is_public: plan.is_public,
                                                    resource_ids: plan.resources?.map(r => r.id) || []
                                                })
                                                setShowPlanModal(true)
                                            }}
                                            className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors"
                                        >
                                            <Edit className="w-4 h-4 text-gray-600" />
                                        </button>
                                        <button
                                            onClick={async () => {
                                                if (confirm(tr('messageDeleteThisLessonPlan'))) {
                                                    await deletePlan(plan.id)
                                                }
                                            }}
                                            className="p-1.5 hover:bg-red-50 rounded-lg transition-colors"
                                        >
                                            <Trash2 className="w-4 h-4 text-red-600" />
                                        </button>
                                    </div>
                                </div>
                                {(plan.description || plan.content) && (
                                    <p className="text-sm text-gray-600 line-clamp-2 mb-3">
                                        {plan.description || plan.content}
                                    </p>
                                )}
                                <div className="flex items-center gap-2 flex-wrap mb-3">

                                    <span className="text-xs text-gray-500">{plan.estimated_duration_minutes} min</span>
                                    {plan.resources && plan.resources.length > 0 && (
                                        <span className="text-xs text-gray-500 flex items-center gap-1">
                                            <Package className="w-3 h-3" />
                                            {plan.resources.length}
                                        </span>
                                    )}
                                </div>
                                {plan.tags && plan.tags.length > 0 && (
                                    <div className="flex gap-1 flex-wrap">
                                        {plan.tags.slice(0, 3).map((tag, idx) => (
                                            <span key={idx} className="text-xs px-2 py-0.5 bg-gray-100 text-gray-600 rounded">
                                                {tag}
                                            </span>
                                        ))}
                                        {plan.tags.length > 3 && (
                                            <span className="text-xs text-gray-400">+{plan.tags.length - 3}</span>
                                        )}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Create/Edit Lesson Plan Modal */}
            <Dialog
                open={showPlanModal}
                onOpenChange={(open) => {
                    setShowPlanModal(open)
                    if (!open) {
                        setEditingPlan(null)
                        setFormData({
                            title: '',
                            description: '',
                            content: '',
                            estimated_duration_minutes: 60,
                            tags: [],
                            is_public: false,
                            resource_ids: []
                        })
                    }
                }}
                size="lg"
            >
                <DialogHeader title={editingPlan ? tr('editPlan') : tr('createPlan')} />
                <DialogContent>
                    <div className="space-y-6 max-h-[60vh] overflow-y-auto">
                        {/* Title */}
                        <div className="space-y-2">
                            <label className="text-xs font-bold text-gray-700 uppercase tracking-wide flex items-center gap-2">
                                <Sparkles className="w-3 h-3" />
                                {tr('planTitle')}
                            </label>
                            <input
                                type="text"
                                value={formData.title}
                                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                                className="w-full px-4 py-3 bg-gray-50 border-2 border-transparent focus:bg-white focus:border-primary rounded-xl font-semibold text-gray-900 outline-none transition-all"
                                placeholder={tr('eGTheoryFundamentalsWeek1')}
                                required
                            />
                        </div>

                        {/* Content */}
                        <div className="space-y-2">
                            <label className="text-xs font-bold text-gray-700 uppercase tracking-wide flex items-center gap-2">
                                <Activity className="w-3 h-3" />
                                {tr('lessonContent')}
                            </label>
                            <textarea
                                value={formData.content}
                                onChange={(e) => setFormData({ ...formData, content: e.target.value })}
                                rows={6}
                                className="w-full px-4 py-3 bg-gray-50 border-2 border-transparent focus:bg-white focus:border-primary rounded-xl font-medium text-gray-900 outline-none transition-all resize-none"
                                placeholder={tr('detailedLessonStructureExercisesGoals')}
                                required
                            />
                        </div>

                        {/* Duration */}
                        <div className="grid grid-cols-1 gap-4">
                            <div className="space-y-2">
                                <label className="text-xs font-bold text-gray-700 uppercase tracking-wide flex items-center gap-2">
                                    <Clock className="w-3 h-3 text-primary" />
                                    {tr('durationMin')}
                                </label>
                                <input
                                    type="number"
                                    value={formData.estimated_duration_minutes}
                                    onChange={(e) => setFormData({ ...formData, estimated_duration_minutes: parseInt(e.target.value) || 0 })}
                                    className="w-full px-4 py-3 bg-gray-50 border-2 border-transparent focus:bg-white focus:border-primary rounded-xl font-semibold text-gray-900 outline-none transition-all"
                                    min="1"
                                    required
                                />
                            </div>
                        </div>

                        {/* Tags */}
                        <div className="space-y-2">
                            <label className="text-xs font-bold text-gray-700 uppercase tracking-wide flex items-center gap-2">
                                <Tag className="w-3 h-3" />
                                {tr('tags')}
                            </label>
                            <div className="flex gap-2">
                                <input
                                    type="text"
                                    value={tagInput}
                                    onChange={(e) => setTagInput(e.target.value)}
                                    onKeyPress={(e) => {
                                        if (e.key === 'Enter' && tagInput.trim()) {
                                            e.preventDefault()
                                            if (!formData.tags.includes(tagInput.trim())) {
                                                setFormData({ ...formData, tags: [...formData.tags, tagInput.trim()] })
                                            }
                                            setTagInput('')
                                        }
                                    }}
                                    className="flex-1 px-4 py-2 bg-gray-50 border-2 border-transparent focus:bg-white focus:border-primary rounded-xl font-medium text-gray-900 outline-none transition-all"
                                    placeholder={tr('typeAndPressEnter')}
                                />
                            </div>
                            {formData.tags.length > 0 && (
                                <div className="flex gap-2 flex-wrap">
                                    {formData.tags.map((tag, idx) => (
                                        <span key={idx} className="px-3 py-1 bg-primary/10 text-primary rounded-lg text-sm font-semibold flex items-center gap-2">
                                            {tag}
                                            <button
                                                onClick={() => setFormData({ ...formData, tags: formData.tags.filter((_, i) => i !== idx) })}
                                                className="hover:text-red-600"
                                            >
                                                <X className="w-3 h-3" />
                                            </button>
                                        </span>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Resources */}
                        <div className="space-y-2">
                            <label className="text-xs font-bold text-gray-700 uppercase tracking-wide flex items-center gap-2">
                                <Package className="w-3 h-3" />
                                {tr('attachedResources')}
                            </label>
                            <button
                                type="button"
                                onClick={() => setShowResourceSelector(true)}
                                className="w-full px-4 py-3 bg-gray-50 border-2 border-dashed border-gray-300 hover:border-primary rounded-xl font-semibold text-gray-600 hover:text-primary transition-all flex items-center justify-center gap-2"
                            >
                                <Plus className="w-4 h-4" />
                                {formData.resource_ids.length > 0 ? tr('resourceCount', {count: formData.resource_ids.length}) : tr('selectResources')}
                            </button>
                        </div>

                        {/* Public Toggle */}
                        <div className="flex items-center justify-between p-4 bg-gray-50 rounded-xl">
                            <div>
                                <div className="font-bold text-gray-900">{tr('makePublic')}</div>
                                <div className="text-sm text-gray-600">{tr('shareWithOtherTeachersInYourStudio')}</div>
                            </div>
                            <button
                                type="button"
                                onClick={() => setFormData({ ...formData, is_public: !formData.is_public })}
                                className={`relative w-12 h-6 rounded-full transition-colors ${formData.is_public ? 'bg-primary' : 'bg-gray-300'
                                    }`}
                            >
                                <div className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${formData.is_public ? 'translate-x-6' : 'translate-x-0'
                                    }`} />
                            </button>
                        </div>
                    </div>
                </DialogContent>
                <DialogFooter>
                    <Button
                        variant="ghost"
                        onClick={() => setShowPlanModal(false)}
                        disabled={submitting}
                    >
                        {tr('cancel')}
                    </Button>
                    <Button
                        onClick={async () => {
                            if (!formData.title.trim() || !formData.content.trim()) {
                                alert(tr('missingTitleOrContent'))
                                return
                            }
                            setSubmitting(true)
                            try {
                                if (editingPlan) {
                                    await updatePlan(editingPlan.id, formData)
                                } else {
                                    await createPlan(formData)
                                }
                                setShowPlanModal(false)
                                setEditingPlan(null)
                                setFormData({
                                    title: '',
                                    description: '',
                                    content: '',
                                    estimated_duration_minutes: 60,
                                    tags: [],
                                    is_public: false,
                                    resource_ids: []
                                })
                            } catch (err) {
                                console.error(err)
                            } finally {
                                setSubmitting(false)
                            }
                        }}
                        disabled={submitting}
                        className="gap-2"
                    >
                        {submitting ? (
                            <>
                                <Loader2 className="w-4 h-4 animate-spin" />
                                {tr('saving')}
                            </>
                        ) : (
                            <>
                                <CheckCircle2 className="w-4 h-4" />
                                {editingPlan ? tr('updatePlan') : tr('createPlan')}
                            </>
                        )}
                    </Button>
                </DialogFooter>
            </Dialog>

            <LessonBookingDialog
                open={showLessonModal}
                onOpenChange={(open) => { setShowLessonModal(open); if (!open) setEditingLessonId(null) }}
                editingLessonId={editingLessonId}
                newBooking={newBooking}
                setNewBooking={setNewBooking}
                bookingMode={bookingMode}
                setBookingMode={setBookingMode}
                bookingLoading={lessonSubmitting}
                deletingLessonId={deletingLessonId}
                onSubmit={saveLessonBooking}
                onDelete={(id) => {
                    const lesson = typedLessons.find(item => item.id === id)
                    if (lesson) handleDeleteLesson(lesson)
                }}
                students={studentProfiles}
                teachers={teachers}
                bands={bands}
                preferredTeacherId={preferredTeacherId}
                use24Hour={true}
            />

            <LessonDeleteDialog
                target={deleteTarget}
                busy={deletingLessonId !== null}
                onClose={() => setDeleteTarget(null)}
                onConfirm={(scope) => void confirmDeleteLesson(scope)}
            />

            {/* Resource Selector Modal */}
            <ResourceSelector
                selectedIds={formData.resource_ids}
                onSelectionChange={(ids) => setFormData({ ...formData, resource_ids: ids })}
                isOpen={showResourceSelector}
                onClose={() => setShowResourceSelector(false)}
            />
        </div>
    )
}
