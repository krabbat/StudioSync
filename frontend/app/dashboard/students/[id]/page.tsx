'use client'

import { useTranslations, useLocale } from 'next-intl'
import { useEffect, useState, use } from 'react'
import { useRouter } from 'next/navigation'
import {
    ArrowLeft, User, Mail, Phone, Music,
    Calendar, Edit, Trash2, Clock, GraduationCap,
    CheckCircle2, AlertCircle, MapPin, Save, X
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import api from '@/services/api'
import { toast } from 'react-hot-toast'
import { formatPhoneNumber, proxyFileUrl } from '@/lib/utils'
import { useUser } from '@/contexts/UserContext'
import StudentCommunicationPanel from '@/components/StudentCommunicationPanel'
import FamilyAssignment from '@/components/FamilyAssignment'

export default function StudentProfilePage({ params: paramsPromise }: { params: Promise<{ id: string }> }) {
    const tr = useTranslations('StudentProfile')
    const locale = useLocale()
    const { currentUser } = useUser()
    const params = use(paramsPromise)
    const studentId = params.id
    const router = useRouter()
    const [student, setStudent] = useState<any>(null)
    const [loading, setLoading] = useState(true)
    const [editingTotal, setEditingTotal] = useState(false)
    const [totalDraft, setTotalDraft] = useState('')
    const [savingTotal, setSavingTotal] = useState(false)
    const [newPassword, setNewPassword] = useState('')
    const [loginEmail,setLoginEmail]=useState('')
    const accessT=useTranslations('FamilyAccess')
    const [confirmNewPassword, setConfirmNewPassword] = useState('')
    const [passwordSaving, setPasswordSaving] = useState(false)
    const [editingLogin, setEditingLogin] = useState(false)
    const [profileTab, setProfileTab] = useState<'profile' | 'communication' | 'family'>('profile')

    useEffect(() => {
        const fetchStudent = async () => {
            try {
                const response = await api.get(`/students/${studentId}/`)
                setStudent(response.data)
                setLoginEmail(response.data.login_email || "")
            } catch (error) {
                console.error('Failed to load student:', error)
                toast.error(tr('loadFailed'))
                router.push('/dashboard/students')
            } finally {
                setLoading(false)
            }
        }
        if (studentId) fetchStudent()
    }, [studentId, router])

    const saveLessonTotal = async () => {
        const total = Number(totalDraft)
        if (!totalDraft.trim() || !Number.isInteger(total) || total < 0 || total > 999999) {
            toast.error(tr('invalidLessonTotal'))
            return
        }
        setSavingTotal(true)
        try {
            const { data } = await api.post(`/students/${studentId}/lesson-history/`, { shared_lessons_total: total })
            setStudent((previous: any) => previous ? { ...previous, ...data } : previous)
            setEditingTotal(false)
            toast.success(tr('lessonTotalSaved'))
        } catch {
            toast.error(tr('lessonTotalSaveFailed'))
        } finally {
            setSavingTotal(false)
        }
    }

    const saveLoginPassword = async () => {
        if (!newPassword || newPassword !== confirmNewPassword) {
            toast.error(tr('passwordMismatch'))
            return
        }
        setPasswordSaving(true)
        try {
            await api.post(`/students/${studentId}/set-password/`, {
                login_email: loginEmail,
                password: newPassword,
                confirm_password: confirmNewPassword
            })
            setNewPassword('')
            setConfirmNewPassword('')
            setEditingLogin(false)
            setStudent((previous: any) => previous ? { ...previous, login_enabled: true, login_email:loginEmail } : previous)
            toast.success(tr('passwordSaved'))
        } catch (error: any) {
            const message = error?.response?.data?.password?.[0] ||
                error?.response?.data?.confirm_password?.[0] ||
                error?.response?.data?.detail || tr('passwordSaveFailed')
            toast.error(message)
        } finally {
            setPasswordSaving(false)
        }
    }

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-screen bg-gray-50/30">
                <div className="flex flex-col items-center gap-6">
                    <div className="relative">
                        <div className="w-16 h-16 border-4 border-primary/10 border-t-primary rounded-full animate-spin" />
                        <div className="absolute inset-0 flex items-center justify-center">
                            <User className="w-6 h-6 text-primary animate-pulse" />
                        </div>
                    </div>
                    <div className="space-y-1 text-center">
                        <p className="text-[10px] font-black text-gray-400 uppercase tracking-[0.3em]">{tr('profileAccess')}</p>
                        <p className="text-sm font-bold text-gray-900">{tr('gatheringTheStudentDetails')}</p>
                    </div>
                </div>
            </div>
        )
    }

    if (!student) return null

    const firstName = student.first_name || student.user?.first_name || (student.name ? student.name.split(' ')[0] : 'Member')
    const lastName = student.last_name || student.user?.last_name || (student.name ? student.name.split(' ').slice(1).join(' ') : '')
    const email = student.email || student.user?.email || 'No email provided'
    const phone = student.phone || student.user?.phone || 'No phone provided'
    const fullName = `${firstName} ${lastName}`.trim()
    const instruments = student.instruments || (student.instrument ? [student.instrument] : [])
    const nextLesson = student.next_lesson ? new Date(student.next_lesson) : null
    const photoUrl = proxyFileUrl(student.avatar || student.user?.avatar)

    const openPhoto = () => {
        if (!photoUrl) return
        const popup = window.open('', '_blank', `popup=yes,width=${window.screen.availWidth},height=${window.screen.availHeight},left=0,top=0`)
        if (!popup) {
            toast.error(tr('photoPopupBlocked'))
            return
        }
        popup.opener = null
        popup.document.title = tr('studentPhoto', { name: fullName })
        popup.document.body.style.cssText = 'margin:0;background:#111;display:flex;align-items:center;justify-content:center;width:100vw;height:100vh;overflow:hidden'
        const image = popup.document.createElement('img')
        image.src = photoUrl
        image.alt = tr('studentPhoto', { name: fullName })
        image.style.cssText = 'width:100%;height:100%;object-fit:contain'
        popup.document.body.appendChild(image)
        popup.focus()
    }

    return (
        <div className="min-h-screen bg-gray-50/50 p-6 md:p-12">
            <div className="max-w-5xl mx-auto space-y-10">
                {/* Navigation & Actions */}
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                    <button
                        onClick={() => router.push('/dashboard/students')}
                        className="flex items-center gap-2 group"
                    >
                        <div className="w-8 h-8 rounded-full bg-white border border-gray-200 flex items-center justify-center group-hover:bg-primary group-hover:border-primary transition-all duration-300">
                            <ArrowLeft className="w-4 h-4 text-gray-400 group-hover:text-white" />
                        </div>
                        <span className="text-[10px] font-black text-gray-400 group-hover:text-gray-900 uppercase tracking-[0.2em] transition-colors">
                            {tr('returnToStudentRoster')}
                        </span>
                    </button>
                    <div className="flex items-center gap-4">
                        <Button
                            variant="outline"
                            onClick={() => router.push(`/dashboard/students/${studentId}/edit`)}
                            className="h-12 rounded-2xl gap-3 font-bold px-8 border-gray-200 hover:border-primary hover:text-primary transition-all shadow-sm"
                        >
                            <Edit className="w-4 h-4" />
                            {tr('updateProfile')}
                        </Button>
                    </div>
                </div>

                {/* Profile Header Card */}
                <div className="bg-white rounded-[3rem] border border-gray-100 shadow-2xl shadow-gray-200/50 overflow-hidden group">
                    <div className="h-64 bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 relative overflow-hidden">
                        {/* Decorative background elements */}
                        <div className="absolute top-0 right-0 w-96 h-96 bg-white/10 rounded-full -mr-48 -mt-48 blur-3xl" />
                        <div className="absolute bottom-0 left-0 w-64 h-64 bg-black/10 rounded-full -ml-32 -mb-32 blur-2xl" />

                        <div className="absolute bottom-6 left-10 md:left-12 p-2 bg-white rounded-[2.5rem] shadow-2xl transition-transform duration-500 group-hover:scale-105">
                            <div className="w-36 h-36 rounded-[2rem] bg-gray-100 flex items-center justify-center border-4 border-white overflow-hidden shadow-inner">
                                {student.avatar || student.user?.avatar ? (
                                    <button type="button" onClick={openPhoto} title={tr('openPhoto')} aria-label={tr('openPhoto')} className="w-full h-full cursor-zoom-in">
                                        <img src={photoUrl || undefined} alt={tr('studentPhoto', { name: fullName })} className="w-full h-full object-cover" />
                                    </button>
                                ) : (
                                    <span className="text-4xl font-black text-gray-400 uppercase tracking-tighter">
                                        {firstName[0]}{lastName[0]}
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>

                    <div className="pt-12 pb-12 px-12 space-y-8">
                        <div className="flex flex-col md:flex-row md:items-end justify-between gap-8">
                            <div className="space-y-4">
                                <div className="flex items-center gap-4 flex-wrap">
                                    <h1 className="text-4xl md:text-5xl font-black text-gray-900 tracking-tight uppercase leading-none">
                                        {fullName}
                                    </h1>
                                    {student.is_active ? (
                                        <div className="flex items-center gap-1.5 px-4 py-1.5 bg-emerald-50 text-emerald-600 text-[10px] font-black uppercase tracking-widest rounded-full border border-emerald-100 shadow-sm shadow-emerald-100/50">
                                            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                                            {tr('activeMember')}
                                        </div>
                                    ) : (
                                        <span className="px-4 py-1.5 bg-gray-50 text-gray-400 text-[10px] font-black uppercase tracking-widest rounded-full border border-gray-200">
                                            {tr('currentlyAway')}
                                        </span>
                                    )}
                                </div>
                                <div className="flex flex-wrap gap-2">
                                    {instruments.length > 0 ? (
                                        instruments.map((inst: string, idx: number) => (
                                            <div key={idx} className="flex items-center gap-2 px-4 py-2 bg-indigo-50 text-indigo-700 rounded-xl border border-indigo-100/50 shadow-sm">
                                                <Music className="w-4 h-4 text-indigo-400" />
                                                <span className="text-sm font-bold uppercase tracking-wider">{inst}</span>
                                            </div>
                                        ))
                                    ) : (
                                        <div className="flex items-center gap-2 px-4 py-2 bg-gray-50 text-gray-500 rounded-xl border border-gray-100">
                                            <Music className="w-4 h-4 text-gray-300" />
                                            <span className="text-sm font-bold uppercase tracking-wider">{tr('foundationScholar')}</span>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {currentUser?.role === 'admin' && (
                    <nav aria-label="Schülerprofil-Bereiche" className="flex flex-wrap gap-2">
                        <button type="button" aria-pressed={profileTab === 'profile'}
                            className={profileTab === 'profile'
                                ? 'rounded-xl bg-primary text-primary-foreground px-5 py-3 font-bold'
                                : 'rounded-xl bg-white border border-gray-200 px-5 py-3 font-bold'}
                            onClick={() => setProfileTab('profile')}>Profil</button>
                        <button type="button" aria-pressed={profileTab === 'communication'}
                            className={profileTab === 'communication'
                                ? 'rounded-xl bg-primary text-primary-foreground px-5 py-3 font-bold'
                                : 'rounded-xl bg-white border border-gray-200 px-5 py-3 font-bold'}
                            onClick={() => setProfileTab('communication')}>
                            <Mail className="w-4 h-4 inline mr-2" />Kommunikation
                        </button>
                        <button type="button" aria-pressed={profileTab === 'family'}
                            className={profileTab === 'family'
                                ? 'rounded-xl bg-primary text-primary-foreground px-5 py-3 font-bold'
                                : 'rounded-xl bg-white border border-gray-200 px-5 py-3 font-bold'}
                            onClick={() => setProfileTab('family')}>Familie</button>
                    </nav>
                )}

                {profileTab === 'communication' && currentUser?.role === 'admin' ? (
                    <StudentCommunicationPanel studentId={studentId} />
                ) : profileTab === 'family' && currentUser?.role === 'admin' ? (
                    <FamilyAssignment studentId={studentId} familyId={student.family || null} onSaved={(family, family_name) => setStudent((old: any) => ({...old, family, family_name}))}/>
                ) : (
                <>
                {/* Detailed Info Grid */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    {/* Contact & Identity */}
                    <div className="lg:col-span-2 space-y-8">
                        <section className="bg-white p-12 rounded-[3rem] border border-gray-100 shadow-xl shadow-gray-200/30 space-y-10">
                            <h2 className="text-xs font-black text-gray-400 uppercase tracking-[0.3em] flex items-center gap-4">
                                <span className="w-10 h-10 bg-blue-50/50 rounded-2xl flex items-center justify-center text-blue-600 shadow-sm">
                                    <User className="w-5 h-5" />
                                </span>
                                {tr('theEssentials')}
                            </h2>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-10">
                                <div className="space-y-2 group">
                                    <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest group-hover:text-primary transition-colors">{tr('reachOutAt')}</p>
                                    <div className="font-bold text-lg text-gray-900 flex items-center gap-3">
                                        <div className="w-8 h-8 rounded-full bg-gray-50 flex items-center justify-center group-hover:bg-blue-50 transition-colors">
                                            <Mail className="w-4 h-4 text-gray-300 group-hover:text-blue-400" />
                                        </div>
                                        {email}
                                    </div>
                                </div>
                                <div className="space-y-2 group">
                                    <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest group-hover:text-primary transition-colors">{tr('callOrText')}</p>
                                    <div className="font-bold text-lg text-gray-900 flex items-center gap-3">
                                        <div className="w-8 h-8 rounded-full bg-gray-50 flex items-center justify-center group-hover:bg-blue-50 transition-colors">
                                            <Phone className="w-4 h-4 text-gray-300 group-hover:text-blue-400" />
                                        </div>
                                        {formatPhoneNumber(phone)}
                                    </div>
                                </div>
                                <div className="space-y-2 group">
                                    <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest group-hover:text-primary transition-colors">{tr('celebrationDay')}</p>
                                    <div className="font-bold text-lg text-gray-900 flex items-center gap-3">
                                        <div className="w-8 h-8 rounded-full bg-gray-50 flex items-center justify-center group-hover:bg-blue-50 transition-colors">
                                            <Calendar className="w-4 h-4 text-gray-300 group-hover:text-blue-400" />
                                        </div>
                                        {student.birth_date ? new Date(`${student.birth_date}T00:00:00`).toLocaleDateString(locale, { year: 'numeric', month: 'long', day: 'numeric' }) : tr('notProvided')}
                                    </div>
                                </div>
                                <div className="space-y-2 group">
                                    <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{tr('assignedTeacher')}</p>
                                    <div className="font-bold text-lg text-gray-900 flex items-center gap-3">
                                        <div className="w-8 h-8 rounded-full bg-gray-50 flex items-center justify-center">
                                            <GraduationCap className="w-4 h-4 text-gray-400" />
                                        </div>
                                        {student.teacher?.name || tr('notProvided')}
                                    </div>
                                </div>
                            </div>
                        </section>

                        {/* Student address / home-lesson destination */}
                        <section className="bg-white p-8 rounded-[2rem] border border-gray-100 shadow-sm space-y-4">
                            <h2 className="text-xs font-black uppercase tracking-widest text-gray-500">{tr('teachingAddress')}</h2>
                            <p className="text-lg font-bold text-gray-900">
                                {student.address_line1 || tr('notProvided')}
                            </p>
                            <p className="text-gray-600">{[student.postal_code, student.city].filter(Boolean).join(' ') || tr('notProvided')}</p>
                        </section>

                        {currentUser?.role === 'admin' && (
                            <section className="bg-white p-8 rounded-[2rem] border border-gray-100 shadow-sm space-y-4">
                                <div className="flex items-center justify-between gap-3">
                                    <div>
                                        <h2 className="text-xs font-black uppercase tracking-widest text-gray-500">{tr('studentLogin')}</h2>
                                        <p className="text-sm text-gray-600">
                                            {student.login_enabled ? tr('loginReady') : tr('loginNotReady')}
                                        </p>
                                    </div>
                                    <Button type="button" variant="outline" onClick={() => {
                                        if (editingLogin) {
                                            setNewPassword('')
                                            setConfirmNewPassword('')
                                        }
                                        setEditingLogin(!editingLogin)
                                    }}>
                                        {tr('setPassword')}
                                    </Button>
                                </div>
                                {editingLogin && (
                                    <div className="space-y-3">
                                        <p className="text-xs text-gray-500">{tr('loginPasswordInfo')}</p>
                                        <label className="block text-sm">{accessT('loginEmail')}<input type="text" inputMode="email" className="w-full px-4 py-3 border rounded-xl" value={loginEmail} onChange={e=>setLoginEmail(e.target.value)}/></label>
                                        <input type="password" autoComplete="new-password"
                                            aria-label={tr('newPassword')} placeholder={tr('newPassword')}
                                            value={newPassword} onChange={e => setNewPassword(e.target.value)}
                                            className="w-full px-4 py-3 border rounded-xl" />
                                        <input type="password" autoComplete="new-password"
                                            aria-label={tr('confirmPassword')} placeholder={tr('confirmPassword')}
                                            value={confirmNewPassword} onChange={e => setConfirmNewPassword(e.target.value)}
                                            className="w-full px-4 py-3 border rounded-xl" />
                                        <Button type="button" disabled={passwordSaving} onClick={saveLoginPassword}>
                                            {passwordSaving ? tr('passwordSaving') : tr('savePassword')}
                                        </Button>
                                    </div>
                                )}
                            </section>
                        )}

                        {/* Emergency Contact */}
                        {(student.emergency_contact_name || student.emergency_contact_phone || student.additional_guardians?.length > 0) && (
                            <section className="bg-gradient-to-br from-amber-50/80 to-orange-50/50 p-12 rounded-[3rem] border border-amber-100/50 space-y-10 shadow-lg shadow-amber-100/20">
                                <div className="flex items-center justify-between">
                                    <h2 className="text-xs font-black text-amber-700/60 uppercase tracking-[0.3em] flex items-center gap-4">
                                        <span className="w-10 h-10 bg-white rounded-2xl flex items-center justify-center text-amber-600 shadow-sm">
                                            <AlertCircle className="w-5 h-5" />
                                        </span>
                                        {tr('familySafety')}
                                    </h2>
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
                                    <div className="space-y-2">
                                        <p className="text-[10px] font-black text-amber-700/50 uppercase tracking-widest">{tr('primaryGuardian')}</p>
                                        <p className="text-xl font-black text-gray-900">{student.emergency_contact_name || tr('notProvided')}</p>
                                    </div>
                                    <div className="space-y-2">
                                        <p className="text-[10px] font-black text-amber-700/50 uppercase tracking-widest">{tr('emergencyLine')}</p>
                                        <p className="text-xl font-black text-gray-900">{formatPhoneNumber(student.emergency_contact_phone) || tr('notProvided')}</p>
                                    </div>
                                </div>
                                {(student.additional_guardians || []).map((guardian: {first_name: string; last_name: string; phone: string; email?: string}, i: number) => (
                                    <div key={i} className="grid grid-cols-1 md:grid-cols-2 gap-4 border-t border-amber-100 pt-4">
                                        <div><p className="text-sm text-amber-700">Ansprechpartner {i + 2}</p><p className="font-semibold">{guardian.first_name} {guardian.last_name}</p></div>
                                        <div><p>{formatPhoneNumber(guardian.phone)}</p>{guardian.email && <p className="break-all">{guardian.email}</p>}</div>
                                    </div>
                                ))}
                            </section>
                        )}
                    </div>

                    {/* Sidebar / Stats */}
                    <div className="space-y-8">
                        <section className="bg-gray-900 p-10 rounded-[3rem] text-white space-y-10 overflow-hidden relative group">
                            {/* Decorative element */}
                            <div className="absolute -top-12 -right-12 w-32 h-32 bg-primary/20 rounded-full blur-2xl group-hover:bg-primary/30 transition-all duration-700" />

                            <h2 className="text-[10px] font-black text-gray-500 uppercase tracking-[0.3em] relative z-10">{tr('studioJourney')}</h2>
                            <div className="space-y-8 relative z-10">
                                <div className="space-y-2">
                                    <span className="text-gray-500 text-[10px] font-black uppercase tracking-widest">{tr('partOfTheFamilySince')}</span>
                                    <p className="text-xl font-black">{student.contract_start_date
                                        ? new Date(`${student.contract_start_date}T00:00:00`).toLocaleDateString(locale, { year: 'numeric', month: 'long', day: 'numeric' })
                                        : tr('notProvided')}</p>
                                </div>
                                <div className="space-y-2">
                                    <div className="flex items-center gap-3">
                                        <span className="text-gray-500 text-[10px] font-black uppercase tracking-widest">{tr('lessonTotal')}</span>
                                        {currentUser?.role === 'admin' && student.contract_start_date && !editingTotal && (
                                            <button type="button" onClick={() => { setTotalDraft(String(student.shared_lessons_total ?? 0)); setEditingTotal(true) }}
                                                aria-label={tr('editLessonTotal')} title={tr('editLessonTotal')} className="text-gray-400 hover:text-white">
                                                <Edit className="w-4 h-4" />
                                            </button>
                                        )}
                                    </div>
                                    {editingTotal ? (
                                        <div className="flex flex-wrap items-center gap-2">
                                            <input type="number" min={0} max={999999} step={1} inputMode="numeric" value={totalDraft}
                                                onChange={e => setTotalDraft(e.target.value)} aria-label={tr('lessonTotal')}
                                                className="min-w-0 w-24 flex-1 rounded-lg bg-gray-800 text-white p-2 border border-gray-600 outline-none" />
                                            <button type="button" onClick={saveLessonTotal} disabled={savingTotal} aria-label={tr('saveLessonTotal')} title={tr('saveLessonTotal')} className="p-2 rounded-lg bg-primary text-white disabled:opacity-60"><Save className="w-5 h-5" /></button>
                                            <button type="button" onClick={() => setEditingTotal(false)} disabled={savingTotal} aria-label={tr('cancelEnrollment')} title={tr('cancelEnrollment')} className="p-2 rounded-lg bg-gray-700 text-white disabled:opacity-60"><X className="w-5 h-5" /></button>
                                        </div>
                                    ) : (
                                        <div className="flex items-baseline gap-2">
                                            <span className="text-4xl font-black text-primary">{student.shared_lessons_total ?? '–'}</span>
                                            <span className="text-xs font-bold text-gray-400 lowercase tracking-normal italic">{tr('sharedLessons')}</span>
                                        </div>
                                    )}
                                </div>
                                <div className="pt-8 border-t border-white/5 space-y-4">
                                    <div className="flex items-center gap-3">
                                        <div className="w-8 h-8 rounded-xl bg-primary/20 flex items-center justify-center text-primary">
                                            <Clock className="w-4 h-4" />
                                        </div>
                                        <span className="text-[10px] font-black text-gray-500 uppercase tracking-[0.2em]">{tr('upcomingLesson')}</span>
                                    </div>
                                    <div className="bg-white/5 p-5 rounded-2xl border border-white/5 group-hover:border-primary/20 transition-all">
                                        {nextLesson ? (
                                            <>
                                                <p className="font-semibold text-sm text-gray-400">{nextLesson.toLocaleDateString(locale, {weekday:'long', timeZone:'Europe/Berlin'})}</p>
                                                <p className="font-black text-lg whitespace-nowrap tabular-nums">{nextLesson.toLocaleDateString(locale, {day:'2-digit', month:'2-digit', year:'numeric', timeZone:'Europe/Berlin'})}</p>
                                                <p className="text-primary text-sm font-bold">{tr('lessonTime', {time: nextLesson.toLocaleTimeString(locale, {hour:'2-digit', minute:'2-digit', timeZone:'Europe/Berlin'})})}</p>
                                            </>
                                        ) : <p className="font-black text-lg">{tr('noUpcomingLesson')}</p>}
                                    </div>
                                </div>
                            </div>
                        </section>
                    </div>
                </div>
                </>
                )}
            </div>
        </div>
    )
}
