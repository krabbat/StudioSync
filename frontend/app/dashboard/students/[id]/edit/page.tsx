'use client'

import { useTranslations } from 'next-intl'
import { useState, useEffect, use } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, User, Music, Info, Trash2, Plus, Camera } from 'lucide-react'
import { toast } from 'react-hot-toast'
import api from '@/services/api'
import { proxyFileUrl } from '@/lib/utils'
import { useTeachers } from '@/hooks/useDashboardData'
import ImageCropper from '@/components/ImageCropper'
import StudentPersonalFields from '@/components/StudentPersonalFields'
import TeachingContractCard from '@/components/TeachingContractCard'
import StudentAccountTabs, { type AccountSection } from '@/components/StudentAccountTabs'
import StudentLessonAccountCard from '@/components/StudentLessonAccountCard'
import { useUser } from '@/contexts/UserContext'

export default function EditStudentPage({ params: paramsPromise }: { params: Promise<{ id: string }> }) {
    const tr = useTranslations('StudentAdd')
    const ts = useTranslations('Students')
    const te = useTranslations('StudentEdit')
    const { teachers } = useTeachers()
    const { currentUser } = useUser()
    const params = use(paramsPromise)
    const studentId = params.id
    const router = useRouter()
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [section, setSection] = useState<AccountSection>('personal')
    const [studentAccountId, setStudentAccountId] = useState('')
    const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
    const [cropImage, setCropImage] = useState<string | null>(null)
    const [avatarBlob, setAvatarBlob] = useState<Blob | null>(null)
    const [avatarPreview, setAvatarPreview] = useState<string | null>(null)
    const [formData, setFormData] = useState({
        first_name: '',
        last_name: '',
        email: '',
        phone: '',
        address_line1: '',
        postal_code: '',
        city: '',
        instrument: '',
        instruments: [] as string[],
        birth_date: '',
        emergency_contact_name: '',
        emergency_contact_phone: '',
        enrollment_date: '',
        primary_teacher: '',
        is_active: true,
    })

    useEffect(() => {
        const fetchStudent = async () => {
            try {
                const response = await api.get(`/students/${studentId}/`)
                const student = response.data
                setStudentAccountId(typeof student.user === 'string' ? student.user : student.user?.id || '')
                setAvatarUrl(student.avatar || null)

                // Fallback logic for fields that might be either top-level or on the nested 'user' object
                const firstName = student.first_name || student.user?.first_name || (student.name ? student.name.split(' ')[0] : '')
                const lastName = student.last_name || student.user?.last_name || (student.name ? student.name.split(' ').slice(1).join(' ') : '')
                const email = student.email || student.user?.email || ''
                const phone = student.phone || student.user?.phone || ''

                setFormData({
                    first_name: firstName,
                    last_name: lastName,
                    email: email,
                    phone: phone,
                    address_line1: student.address_line1 || '',
                    postal_code: student.postal_code || '',
                    city: student.city || '',
                    instrument: '', // Used for input only
                    instruments: Array.isArray(student.instruments) && student.instruments.length > 0
                        ? student.instruments
                        : (student.instrument ? [student.instrument] : []),
                    birth_date: student.birth_date || '',
                    emergency_contact_name: student.emergency_contact_name || '',
                    emergency_contact_phone: student.emergency_contact_phone || '',
                    enrollment_date: student.enrollment_date || '',
                    primary_teacher: typeof student.primary_teacher === 'string' ? student.primary_teacher : student.primary_teacher?.id || '',
                    is_active: student.is_active ?? true,
                })
            } catch (error) {
                console.error('Failed to load student:', error)
                toast.error(te('loadFailed'))
                router.push('/dashboard/students')
            } finally {
                setLoading(false)
            }
        }
        if (studentId) fetchStudent()
    }, [studentId, router])

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setSaving(true)
        try {
            await api.patch(`/students/${studentId}/`, {
                first_name: formData.first_name,
                last_name: formData.last_name,
                email: formData.email,
                phone: formData.phone,
                address_line1: formData.address_line1,
                postal_code: formData.postal_code,
                city: formData.city,
                // "instrument" is the current primary instrument; "instruments" is the complete list.
                instrument: formData.instruments[0] || '',
                instruments: formData.instruments,
                birth_date: formData.birth_date || null,
                emergency_contact_name: formData.emergency_contact_name,
                emergency_contact_phone: formData.emergency_contact_phone,
                primary_teacher: formData.primary_teacher || null,
                is_active: formData.is_active,
                ...(formData.enrollment_date ? { enrollment_date: formData.enrollment_date } : {})
            })

            // Account photo is saved on User, not Student. A photo failure must not
            // pretend the already saved student changes were rolled back.
            if (avatarBlob) {
                try {
                    if (!studentAccountId) throw new Error('Missing linked student account ID')
                    const upload = new FormData()
                    upload.append('avatar', avatarBlob, 'student-avatar.jpg')
                    await api.patch(`/core/users/${studentAccountId}/`, upload)
                } catch (photoError) {
                    console.error('Student details saved; avatar upload failed', photoError)
                    toast.error('Stammdaten gespeichert, aber das Profilfoto konnte nicht hochgeladen werden.')
                    router.push(`/dashboard/students/${studentId}`)
                    return
                }
            }
            toast.success('Schülerprofil gespeichert.')
            router.push(`/dashboard/students/${studentId}`)
        } catch (error: any) {
            console.error('Failed to update student:', error)
            const errorMsg = error.response?.data?.email?.[0] || error.response?.data?.detail || te('saveFailed')
            toast.error(errorMsg)
        } finally {
            setSaving(false)
        }
    }

    const handlePhotoSelection = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0]
        event.target.value = ''
        if (!file) return
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
            toast.error(tr('invalidPhoto'))
            return
        }
        if (file.size > 5 * 1024 * 1024) {
            toast.error(tr('photoTooLarge'))
            return
        }
        const reader = new FileReader()
        reader.onload = () => setCropImage(reader.result as string)
        reader.readAsDataURL(file)
    }

    const handlePhotoCrop = (blob: Blob) => {
        setCropImage(null)
        setAvatarBlob(blob)
        const reader = new FileReader()
        reader.onload = () => setAvatarPreview(reader.result as string)
        reader.readAsDataURL(blob)
    }

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        let value = e.target.value
        setFormData(prev => ({ ...prev, [e.target.name]: value }))
    }

    const handleDelete = async () => {
        if (!confirm(te('deleteConfirm'))) return
        try {
            await api.delete(`/students/${studentId}/`)
            toast.success(te('deleted'))
            router.push('/dashboard/students')
        } catch (error) {
            toast.error(te('deleteFailed'))
        }
    }

    if (currentUser && currentUser.role !== 'admin' && currentUser.role !== 'teacher') {
        return <p className="p-8 text-red-600">{te('unauthorized')}</p>
    }

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-4">
                <Music className="w-10 h-10 text-primary animate-bounce" />
                <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">{te('loading')}</p>
            </div>
        )
    }

    const inputClass = 'w-full px-4 py-3 bg-gray-50 border-2 border-transparent focus:bg-white focus:border-primary rounded-2xl font-bold text-gray-700 outline-none transition-all'

    return (
        <div className="min-h-screen bg-gray-50/50 p-6 md:p-12">
            <div className="max-w-5xl mx-auto space-y-8">
                {/* Header */}
                <div className="flex flex-col md:flex-row md:items-start justify-between gap-6">
                    <div className="space-y-2">
                        <button
                            onClick={() => router.back()}
                            className="flex items-center gap-2 group mb-4"
                        >
                            <div className="w-8 h-8 rounded-full bg-white border border-gray-200 flex items-center justify-center group-hover:bg-primary group-hover:border-primary transition-all duration-300">
                                <ArrowLeft className="w-4 h-4 text-gray-400 group-hover:text-white" />
                            </div>
                            <span className="text-[10px] font-black text-gray-400 group-hover:text-gray-900 uppercase tracking-[0.2em]">{te('back')}</span>
                        </button>
                        <h1 className="text-3xl font-black text-gray-900 tracking-tight uppercase">{te('title')}</h1>
                        <p className="text-gray-500 font-medium">{te('subtitle')}</p>
                    </div>
                    {currentUser?.role === 'admin' && <button
                        onClick={handleDelete}
                        className="text-red-600 hover:text-red-700 p-3 hover:bg-red-50 rounded-2xl flex items-center gap-2 font-bold text-xs uppercase tracking-widest border border-transparent hover:border-red-100 transition-all"
                    >
                        <Trash2 className="w-4 h-4" />
                        {te('remove')}
                    </button>}
                </div>

                <StudentAccountTabs section={section} onChange={setSection}
                    allowed={currentUser?.role === 'admin' ? undefined : ['personal']} />
                {section === 'personal' ? (
                <div className="bg-card text-card-foreground rounded-[2.5rem] shadow-xl border border-border p-6 sm:p-10">
                    <div className="flex flex-wrap items-center gap-5 mb-8">
                        <div className="h-20 w-20 overflow-hidden rounded-2xl border border-gray-200 bg-gray-100 flex items-center justify-center">
                            {avatarPreview || avatarUrl ? (
                                <img src={avatarPreview || proxyFileUrl(avatarUrl) || undefined} alt="Profilfoto" className="h-full w-full object-cover" />
                            ) : <User className="h-9 w-9 text-gray-400" />}
                        </div>
                        <div className="space-y-2">
                            <label htmlFor="edit-student-avatar" className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-gray-300 px-4 py-2 font-medium text-gray-700">
                                <Camera className="h-4 w-4" /> Profilfoto ändern
                            </label>
                            <input id="edit-student-avatar" type="file" accept="image/png,image/jpeg,image/webp" onChange={handlePhotoSelection} className="hidden" />
                            {avatarBlob && (
                                <button type="button" className="block text-sm text-gray-500 underline" onClick={() => { setAvatarBlob(null); setAvatarPreview(null) }}>
                                    Fotoänderung verwerfen
                                </button>
                            )}
                        </div>
                    </div>
                    <form onSubmit={handleSubmit} className="space-y-10">

                        <StudentPersonalFields value={formData} onChange={patch => setFormData(prev => ({ ...prev, ...patch }))} />

                        {/* ── Musical Details ── */}
                        <section className="space-y-6">
                            <h2 className="text-xs font-black text-gray-400 uppercase tracking-[0.3em] flex items-center gap-3">
                                <div className="w-8 h-8 bg-indigo-50 rounded-xl flex items-center justify-center text-indigo-600">
                                    <Music className="w-4 h-4" />
                                </div>
                                {te('curriculum')}
                            </h2>
                            <div className="p-8 bg-indigo-50/50 rounded-3xl border border-indigo-100/50 space-y-6">
                                <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{te('focus')}</label>
                                <div className="flex flex-wrap gap-2 mb-3">
                                    {formData.instruments.map(inst => (
                                        <div key={inst} className="flex items-center gap-2 px-4 py-2 bg-white border-2 border-primary/10 rounded-2xl text-xs font-black text-primary uppercase tracking-widest cursor-pointer hover:bg-red-50 hover:text-red-500 hover:border-red-200 transition-all group scale-in" onClick={() => {
                                            setFormData({ ...formData, instruments: formData.instruments.filter(i => i !== inst) })
                                        }}>
                                            {inst}
                                            <Plus className="w-3 h-3 rotate-45" />
                                        </div>
                                    ))}
                                </div>
                                <div className="relative">
                                    <input
                                        type="text"
                                        name="instrument"
                                        value={formData.instrument}
                                        onChange={handleChange}
                                        onKeyDown={e => {
                                            if (e.key === 'Enter' && formData.instrument) {
                                                e.preventDefault()
                                                if (!formData.instruments.includes(formData.instrument)) {
                                                    setFormData({ ...formData, instruments: [...formData.instruments, formData.instrument], instrument: '' })
                                                }
                                            }
                                        }}
                                        className="w-full px-6 py-4 bg-white border-2 border-transparent focus:border-primary rounded-2xl font-bold text-gray-700 outline-none transition-all shadow-inner"
                                        placeholder={te('addFocus')}
                                    />
                                    <p className="text-[10px] font-black text-indigo-400 uppercase tracking-widest mt-3 flex items-center gap-2">
                                        <Info className="w-3 h-3" />
                                        {te('pressEnter')}
                                    </p>
                                </div>
                            </div>
                        </section>

                        {/* Enrollment data and teacher assignment were previously editable only in the list modal. */}
                        <section className="space-y-6">
                            <h2 className="text-xs font-black text-gray-400 uppercase tracking-[0.3em]">{ts('enrollment')}</h2>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div className="space-y-2">
                                    <label htmlFor="edit-student-enrollment-date" className="text-xs font-bold text-gray-500">{ts('enrollmentDate')}</label>
                                    <input
                                        id="edit-student-enrollment-date"
                                        type="date"
                                        name="enrollment_date"
                                        value={formData.enrollment_date}
                                        onChange={handleChange}
                                        className={inputClass}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <label htmlFor="edit-student-teacher" className="text-xs font-bold text-gray-500">{ts('teacherColumn')}</label>
                                    <select
                                        id="edit-student-teacher"
                                        name="primary_teacher"
                                        value={formData.primary_teacher}
                                        onChange={handleChange}
                                        className={inputClass}
                                    >
                                        <option value="">{ts('unassigned')}</option>
                                        {teachers.map((teacher: any) => (
                                            <option key={teacher.id} value={teacher.id}>{teacher.first_name} {teacher.last_name}</option>
                                        ))}
                                    </select>
                                </div>
                                <label className="flex items-center gap-3 text-sm font-bold text-gray-700">
                                    <input
                                        type="checkbox"
                                        checked={formData.is_active}
                                        onChange={e => setFormData(prev => ({ ...prev, is_active: e.target.checked }))}
                                    />
                                    {formData.is_active ? ts('active') : ts('inactive')}
                                </label>
                            </div>
                        </section>

                        {/* ── Actions ── */}
                        <div className="flex flex-col sm:flex-row gap-4 pt-8 border-t border-gray-100">
                            <button
                                type="button"
                                onClick={() => router.back()}
                                className="px-10 py-4 bg-white border-2 border-gray-100 text-gray-500 rounded-2xl hover:bg-gray-50 font-black text-[10px] uppercase tracking-[0.2em] transition-all"
                            >
                                {te('cancel')}
                            </button>
                            <button
                                type="submit"
                                disabled={saving}
                                className="flex-1 px-10 py-4 bg-primary text-white rounded-2xl hover:scale-105 shadow-xl shadow-primary/20 font-black text-[10px] uppercase tracking-[0.2em] transition-all disabled:opacity-50 disabled:scale-100"
                            >
                                {saving ? te('saving') : te('save')}
                            </button>
                        </div>
                    </form>
                </div>
                ) : section === 'contract' && currentUser?.role === 'admin' ? (
                    <TeachingContractCard studentId={studentId} readOnly={false} />
                ) : (
                    <StudentLessonAccountCard studentId={studentId} readOnly={currentUser?.role !== 'admin'} />
                )}
            </div>
            {cropImage && (
                <ImageCropper imageSrc={cropImage} onCropComplete={handlePhotoCrop} onCancel={() => setCropImage(null)} />
            )}
        </div>
    )
}
