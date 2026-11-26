'use client'

import { useState, useEffect } from 'react'
import FamilyManagement from '@/components/FamilyManagement'
import { useRouter } from 'next/navigation'
import { useUser } from '@/contexts/UserContext'
import { useStudents, useTeachers, useStudentStats, useInstruments } from '@/hooks/useDashboardData'
import api from '@/services/api'
import { proxyFileUrl } from '@/lib/utils'
import { toast } from 'react-hot-toast'
import {
    Loader2, UserPlus, Music,
    Link as LinkIcon, Edit, UserCog,
    Search, Filter, ChevronRight, Eye,
    GraduationCap, User, Calendar,
    MoreHorizontal, Mail, Phone,
    CheckCircle2, XCircle, AlertCircle,
    Plus, Trophy, Target, Star,
    BookOpen, ChevronLeft
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useLocale, useTranslations } from 'next-intl'

// --- Types ---
interface TeacherProfile {
    id: string
    first_name: string
    last_name: string
    email?: string
}

interface StudentData {
    id: string
    name: string
    email: string
    instrument: string | null
    instruments: string[]
    teacher_name: string | null
    primary_teacher?: TeacherProfile | string | null
    next_lesson: string | null
    next_lesson_date?: string | null
    status: string
    is_active: boolean
    first_name?: string
    last_name?: string
    avatar?: string | null
    enrollment_date?: string | null
    address_line1?: string
    postal_code?: string
    city?: string
}

// --- Helper Functions ---
const getTeacherName = (student: StudentData, teachers: any[], fallback: string): string => {
    if (student.teacher_name) return student.teacher_name
    if (student.primary_teacher && typeof student.primary_teacher === 'object') {
        const t = student.primary_teacher as TeacherProfile
        if (t.first_name || t.last_name) {
            return `${t.first_name || ''} ${t.last_name || ''}`.trim()
        }
    }
    if (typeof student.primary_teacher === 'string') {
        const teacher = teachers.find((t: any) => t.id === student.primary_teacher)
        if (teacher) {
            return `${teacher.first_name} ${teacher.last_name}`
        }
    }
    return fallback
}

const getNextLessonDate = (student: StudentData): Date | null => {
    const d = student.next_lesson_date || student.next_lesson
    return d ? new Date(d) : null
}

const formatDate = (date: Date | null, locale: string, fallback: string): string => {
    if (!date) return fallback
    return date.toLocaleDateString(locale, { month: 'short', day: 'numeric', year: '2-digit' })
}

export default function StudentsPage() {
    const t = useTranslations('Students')
    const locale = useLocale()
    const router = useRouter()
    const { currentUser } = useUser()
    const [rosterTab, setRosterTab] = useState<'students' | 'families'>('students')
    const { teachers } = useTeachers()

    // --- State ---
    const [assignTeacherId, setAssignTeacherId] = useState('')
    const [assigningStudentId, setAssigningStudentId] = useState<string | null>(null)

    useEffect(() => {
        const teacherId = new URLSearchParams(window.location.search).get('assign')
        setAssignTeacherId(teacherId || '')
    }, [])
    // Filter state
    const [searchQuery, setSearchQuery] = useState('')
    const [filterInstrument, setFilterInstrument] = useState('all')
    const [showAllStudents, setShowAllStudents] = useState(false)
    const [page, setPage] = useState(1)

    // Data Fetching
    const { students, meta, loading, refresh } = useStudents({
        page,
        search: searchQuery,
        instrument: filterInstrument !== 'all' ? filterInstrument : undefined,
        teacher_id: (currentUser?.role === 'teacher' && !showAllStudents && (currentUser as any).teacher_profile?.id)
            ? (currentUser as any).teacher_profile.id
            : undefined
    })

    const { stats: studentStats, loading: statsLoading } = useStudentStats()
    const { instruments: allInstruments } = useInstruments()


    // --- Event Handlers ---
    // Legacy ?edit=<student-id> URLs should open the same editor as the lists.
    useEffect(() => {
        const editId = new URLSearchParams(window.location.search).get('edit')
        if (editId) router.replace(`/dashboard/students/${encodeURIComponent(editId)}/edit`)
    }, [router])

    const assignmentTeacher = teachers.find((teacher: any) => teacher.id === assignTeacherId)

    const assignStudent = async (student: StudentData) => {
        if (!assignmentTeacher) return
        const currentId = typeof student.primary_teacher === 'object'
            ? student.primary_teacher?.id
            : student.primary_teacher
        const nextId = currentId === assignmentTeacher.id ? null : assignmentTeacher.id
        setAssigningStudentId(student.id)
        try {
            await api.patch(`/students/${student.id}/`, { primary_teacher: nextId })
            toast.success(nextId ? t('assignmentSaved') : t('assignmentRemoved'))
            refresh()
        } catch (error: any) {
            console.error('Teacher assignment failed:', error)
            toast.error(error.response?.data?.detail || t('assignmentFailed'))
        } finally {
            setAssigningStudentId(null)
        }
    }

    const renderStatusBadge = (isActive: boolean) => {
        return isActive ? (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest bg-emerald-50 text-emerald-600 border border-emerald-100">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]" />
                {t('active')}
            </span>
        ) : (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest bg-gray-50 text-gray-400 border border-gray-100">
                <div className="w-1.5 h-1.5 rounded-full bg-gray-300" />
                {t('inactive')}
            </span>
        )
    }

    const rosterTabs = currentUser?.role === 'admin' ? (
        <nav className="flex gap-4 border-b border-gray-200" aria-label="Schülerverwaltung">
            {(['students','families'] as const).map(tab => <button key={tab} onClick={() => { setRosterTab(tab); if (tab === 'students') refresh() }} className={'px-4 py-3 font-semibold border-b-2 '+(rosterTab===tab?'border-primary text-primary':'border-transparent text-gray-500')}>{tab==='students'?'Schüler':'Familien'}</button>)}
        </nav>
    ) : null
    if (rosterTab === 'families' && currentUser?.role === 'admin') return (
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 pb-12 space-y-6 pt-4">
            {rosterTabs}<FamilyManagement/>
        </div>
    )
    if (loading && students.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-4 animate-in fade-in duration-500">
                <Loader2 className="w-10 h-10 text-primary animate-spin" />
                <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">{t('loading')}</p>
            </div>
        )
    }

    return (
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 pb-12 space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
            {rosterTabs}
            {/* Header */}
            <header className="flex flex-col md:flex-row md:items-end justify-between gap-6 pt-4">
                <div className="space-y-2">
                    <h1 className="text-2xl md:text-4xl font-black text-gray-900 tracking-tight flex items-center gap-3">
                        {t('rosterTitle')}
                        <div className="bg-primary/10 px-3 py-1 rounded-full text-xs font-black text-primary uppercase tracking-widest">
                            {t('studentCount', {count: meta?.count || 0})}
                        </div>
                    </h1>
                    <p className="text-gray-500 font-medium max-w-lg">{t('rosterDescription')}</p>
                </div>
                <Button
                    onClick={() => router.push('/dashboard/students/add')}
                    className="gap-2 hover:scale-105 shadow-lg shadow-primary/20 transition-all py-6 px-8"
                >
                    <Plus className="w-4 h-4" />
                    {t('addStudent')}
                </Button>
            </header>

            {/* Teacher-centered assignment, opened from the faculty list. */}
            {assignTeacherId && (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-primary/20 bg-primary/5 p-5">
                    <div>
                        <h2 className="font-bold text-gray-900">{t('assigningToTeacher')}</h2>
                        <p className="text-sm text-gray-600">
                            {assignmentTeacher
                                ? `${assignmentTeacher.first_name} ${assignmentTeacher.last_name} – ${t('assignTeacherHint')}`
                                : t('teacherNotFound')}
                        </p>
                    </div>
                    <Button
                        variant="ghost"
                        onClick={() => {
                            setAssignTeacherId('')
                            router.replace('/dashboard/students')
                        }}
                    >
                        {t('closeAssignment')}
                    </Button>
                </div>
            )}

            {/* Stats */}
            <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                {[
                    { label: t('totalStudents'), value: statsLoading ? '-' : (studentStats?.total_students || 0), icon: GraduationCap, color: 'blue' },
                    { label: t('activeStudents'), value: statsLoading ? '-' : (studentStats?.active_students || 0), icon: Target, color: 'purple' },
                    { label: t('engagementRate'), value: statsLoading ? '-' : (studentStats?.total_students ? Math.round((studentStats.active_students / studentStats.total_students) * 100) + '%' : '0%'), icon: Star, color: 'emerald' },
                    { label: t('unassigned'), value: statsLoading ? '-' : (studentStats?.unassigned_students || 0), icon: UserCog, color: 'orange' }
                ].map((stat, i) => (
                    <div key={i} className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm hover:shadow-md transition-shadow">
                        <div className="flex items-center justify-between mb-4">
                            <div className={`w-10 h-10 bg-${stat.color}-50 rounded-xl flex items-center justify-center text-${stat.color}-600`}>
                                <stat.icon className="w-5 h-5" />
                            </div>
                        </div>
                        <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">{stat.label}</p>
                        <h3 className="text-2xl font-black text-gray-900 tracking-tight uppercase tracking-tighter">{stat.value}</h3>
                    </div>
                ))}
            </div>

            {/* Filters */}
            <div className="flex flex-col md:flex-row gap-4 items-center justify-between bg-white p-4 rounded-3xl border border-gray-100 shadow-xl">
                <div className="flex items-center gap-3 overflow-x-auto w-full md:w-auto no-scrollbar">
                    <select
                        value={filterInstrument}
                        onChange={(e) => setFilterInstrument(e.target.value)}
                        className="px-4 py-3 bg-white border-2 border-transparent focus:border-primary/20 focus:ring-2 focus:ring-primary/20 focus:ring-inset rounded-2xl text-[10px] font-black uppercase tracking-widest text-gray-700 outline-none transition-all shadow-sm appearance-none min-w-[140px] text-center"
                    >
                        <option value="all">{t('allInstruments')}</option>
                        {allInstruments.map(inst => <option key={inst} value={inst}>{inst}</option>)}
                    </select>

                    {currentUser?.role === 'teacher' && (
                        <div className="flex p-1 bg-gray-50 rounded-2xl border border-gray-100">
                            <Button
                                variant={!showAllStudents ? 'secondary' : 'ghost'}
                                size="sm"
                                onClick={() => setShowAllStudents(false)}
                                className={`px-6 rounded-xl text-[10px] font-black uppercase tracking-widest ${!showAllStudents ? 'bg-white shadow-sm' : 'text-gray-400'}`}
                            >
                                {t('myStudents')}
                            </Button>
                            <Button
                                variant={showAllStudents ? 'secondary' : 'ghost'}
                                size="sm"
                                onClick={() => setShowAllStudents(true)}
                                className={`px-6 rounded-xl text-[10px] font-black uppercase tracking-widest ${showAllStudents ? 'bg-white shadow-sm' : 'text-gray-400'}`}
                            >
                                {t('allStudio')}
                            </Button>
                        </div>
                    )}
                </div>

                <div className="relative flex-1 w-full max-w-xl">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input
                        type="text"
                        placeholder={t('searchPlaceholder')}
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full pl-12 pr-4 py-3.5 bg-gray-50 border-transparent focus:bg-white border-2 focus:border-primary rounded-2xl font-bold text-sm text-gray-700 outline-none transition-all shadow-sm"
                    />
                </div>
            </div>

            {/* List */}
            <div className="bg-white rounded-[2rem] border border-gray-100 shadow-2xl overflow-hidden">
                <div className="overflow-x-auto custom-scrollbar">
                    <table className="w-full border-separate border-spacing-0">
                        <thead className="bg-gray-50/50">
                            <tr>
                                <th className="px-8 py-5 text-left text-[10px] font-black text-gray-400 uppercase tracking-widest">{t('studentColumn')}</th>
                                <th className="px-8 py-5 text-center text-[10px] font-black text-gray-400 uppercase tracking-widest">{t('statusColumn')}</th>
                                <th className="px-8 py-5 text-left text-[10px] font-black text-gray-400 uppercase tracking-widest">{t('focusColumn')}</th>
                                <th className="px-8 py-5 text-left text-[10px] font-black text-gray-400 uppercase tracking-widest">{t('teacherColumn')}</th>
                                <th className="px-8 py-5 text-right text-[10px] font-black text-gray-400 uppercase tracking-widest">{t('nextColumn')}</th>
                                <th className="px-8 py-5 text-right text-[10px] font-black text-gray-400 uppercase tracking-widest">{t('actionsColumn')}</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                            {students.length > 0 ? students.map((student: any) => (
                                <tr key={student.id} className="group hover:bg-gray-50/30 transition-all">
                                    <td className="px-8 py-6">
                                        <div className="flex items-center gap-4">
                                            <div className="w-12 h-12 rounded-2xl bg-gray-50 flex items-center justify-center border-2 border-white shadow-sm overflow-hidden group-hover:scale-105 transition-all">
                                                {student.avatar || student.user?.avatar ? (
                                                    <img
                                                        src={proxyFileUrl(student.avatar || student.user?.avatar) || undefined}
                                                        alt={t('studentPhoto', { name: student.name || '' })}
                                                        className="w-full h-full object-cover"
                                                    />
                                                ) : (
                                                    <div className="w-full h-full bg-gray-100 flex items-center justify-center text-gray-500 font-black text-xs uppercase">
                                                        {student.name?.trim().split(/\s+/).slice(0, 2).map((part: string) => part[0]).join('') || '?'}
                                                    </div>
                                                )}
                                            </div>
                                            <div className="flex flex-col">
                                                <span className="font-black text-gray-900 uppercase tracking-tighter leading-tight">{student.name}</span>
                                                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{student.email}</span>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-8 py-6 text-center">
                                        {renderStatusBadge(student.is_active)}
                                    </td>
                                    <td className="px-8 py-6">
                                        <div className="flex flex-wrap items-center gap-2">
                                            {(student.instruments?.length > 0 ? student.instruments : [student.instrument || t('foundation')]).map((inst: string) => (
                                                <div key={inst} className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-blue-50 text-blue-600 border border-blue-100/50">
                                                    <Music className="w-3 h-3" />
                                                    <span className="text-[9px] font-black uppercase tracking-wider">{inst}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </td>
                                    <td className="px-8 py-6">
                                        <div className="flex items-center gap-3">
                                            <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center border border-gray-200">
                                                <User className="w-4 h-4 text-gray-400" />
                                            </div>
                                            <span className="text-sm font-bold text-gray-600">
                                                {getTeacherName(student, teachers, t('unassigned'))}
                                            </span>
                                        </div>
                                    </td>
                                    <td className="px-8 py-6 text-right">
                                        <div className="flex flex-col items-end">
                                            <span className={`text-[10px] font-black uppercase tracking-widest ${getNextLessonDate(student) ? 'text-primary' : 'text-gray-300'}`}>
                                                {formatDate(getNextLessonDate(student), locale, t('datePending'))}
                                            </span>
                                            {getNextLessonDate(student) && (
                                                <span className="text-[9px] font-bold text-gray-400 uppercase">{t('confirmed')}</span>
                                            )}
                                        </div>
                                    </td>
                                    <td className="px-8 py-6 text-right">
                                        <div className="flex items-center justify-end gap-2 opacity-100">
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                onClick={() => router.push(`/dashboard/students/${student.id}`)}
                                                className="text-gray-400 hover:text-primary rounded-xl"
                                                aria-label={t('viewProfile')}
                                                title={t('viewProfile')}
                                            >
                                                <Eye className="w-5 h-5" />
                                            </Button>
                                            {assignmentTeacher && currentUser?.role === 'admin' && (
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={() => assignStudent(student)}
                                                    disabled={assigningStudentId === student.id}
                                                    className="text-xs whitespace-nowrap"
                                                >
                                                    {assigningStudentId === student.id
                                                        ? t('assigning')
                                                        : (typeof student.primary_teacher === 'object'
                                                            ? student.primary_teacher?.id
                                                            : student.primary_teacher) === assignmentTeacher.id
                                                            ? t('removeAssignment')
                                                            : t('assignNow')}
                                                </Button>
                                            )}
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                onClick={() => router.push(`/dashboard/students/${student.id}/edit`)}
                                                className="text-gray-400 hover:text-primary rounded-xl"
                                            >
                                                <Edit className="w-4 h-4" />
                                            </Button>
                                        </div>
                                    </td>
                                </tr>
                            )) : (
                                <tr>
                                    <td colSpan={6} className="px-8 py-24 text-center">
                                        <div className="flex flex-col items-center gap-4">
                                            <div className="w-20 h-20 bg-gray-50 rounded-[2.5rem] flex items-center justify-center border-2 border-dashed border-gray-100">
                                                <BookOpen className="w-10 h-10 text-gray-200" />
                                            </div>
                                            <p className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">{t('emptyRoster')}</p>
                                        </div>
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Pagination */}
                <div className="p-6 bg-gray-50/30 border-t border-gray-50 flex items-center justify-between">
                    <div className="text-[10px] font-black text-gray-400 uppercase tracking-widest">
                        {t('pagination', {page, total: Math.max(1, Math.ceil((meta?.count || 0) / 20))})}
                    </div>
                    <div className="flex items-center gap-3">
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setPage(p => Math.max(1, p - 1))}
                            disabled={!meta?.previous}
                            className="rounded-xl"
                        >
                            <ChevronLeft className="w-5 h-5" />
                        </Button>
                        <div className="px-6 py-2 bg-white border border-gray-100 rounded-2xl text-xs font-black text-gray-700 shadow-sm">
                            {page} / {Math.max(1, Math.ceil((meta?.count || 0) / 20))}
                        </div>
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setPage(p => p + 1)}
                            disabled={!meta?.next}
                            className="rounded-xl"
                        >
                            <ChevronRight className="w-5 h-5" />
                        </Button>
                    </div>
                </div>
            </div>

        </div>
    )
}
