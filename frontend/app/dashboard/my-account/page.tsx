'use client'

import { useEffect, useState, type FormEvent, type ChangeEvent } from 'react'
import { useTranslations } from 'next-intl'
import { UserRound, FileText, CalendarDays, Eye, Camera, KeyRound } from 'lucide-react'
import { toast } from 'react-hot-toast'
import { useUser, type User } from '@/contexts/UserContext'
import api from '@/services/api'
import ImageCropper from '@/components/ImageCropper'
import { proxyFileUrl } from '@/lib/utils'

type Section = 'personal' | 'contract' | 'lessons'
type Personal = { first_name: string; last_name: string; phone: string; bio: string; instrument: string }
type StudentDetails = { birth_date?: string; address_line1?: string; postal_code?: string; city?: string; emergency_contact_name?: string; emergency_contact_phone?: string }

function userFields(user: User | null): Personal {
    return {
        first_name: user?.first_name || '', last_name: user?.last_name || '',
        phone: user?.phone || '', bio: user?.bio || '', instrument: user?.instrument || ''
    }
}

export default function MyAccountPage() {
    const t = useTranslations('MyAccount')
    const { currentUser, setCurrentUser } = useUser()
    const [section, setSection] = useState<Section>('personal')
    const [personal, setPersonal] = useState<Personal>(() => userFields(currentUser))
    const [student, setStudent] = useState<StudentDetails | null>(null)
    const [fetchError, setFetchError] = useState(false)
    const [busy, setBusy] = useState(false)
    const [photoBusy, setPhotoBusy] = useState(false)
    const [passwordBusy, setPasswordBusy] = useState(false)
    const [cropImage, setCropImage] = useState<string | null>(null)
    const studentId = currentUser?.student_profile?.id

    useEffect(() => {
        if (currentUser) setPersonal(userFields(currentUser))
    }, [currentUser?.id])

    useEffect(() => {
        if (currentUser?.role !== 'student') return
        if (!studentId) { setFetchError(true); return }
        let mounted = true
        setFetchError(false)
        api.get('/students/' + encodeURIComponent(studentId) + '/')
            .then(r => { if (mounted) setStudent(r.data) })
            .catch(() => { if (mounted) setFetchError(true) })
        return () => { mounted = false }
    }, [currentUser?.role, studentId])

    async function savePersonal(e: FormEvent<HTMLFormElement>) {
        e.preventDefault()
        setBusy(true)
        try {
            const r = await api.patch('/core/users/me/', personal)
            setCurrentUser(r.data)
            toast.success(t('saved'))
        } catch { toast.error(t('saveFailed')) }
        finally { setBusy(false) }
    }

    function choosePhoto(e: ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0]
        e.target.value = ''
        if (!file) return
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) {
            toast.error(t('invalidPhoto'))
            return
        }
        const reader = new FileReader()
        reader.onload = () => setCropImage(reader.result as string)
        reader.readAsDataURL(file)
    }

    async function savePhoto(blob: Blob) {
        setCropImage(null)
        setPhotoBusy(true)
        try {
            const data = new FormData()
            data.append('avatar', blob, 'avatar.jpg')
            const r = await api.patch('/core/users/me/', data)
            if (r.data.avatar) r.data.avatar += (r.data.avatar.includes('?') ? '&' : '?') + 't=' + Date.now()
            setCurrentUser(r.data)
            toast.success(t('photoSaved'))
        } catch { toast.error(t('photoFailed')) }
        finally { setPhotoBusy(false) }
    }

    async function removePhoto() {
        setPhotoBusy(true)
        try {
            await api.post('/core/users/remove_avatar/')
            const r = await api.get('/core/users/me/')
            setCurrentUser(r.data)
            toast.success(t('photoRemoved'))
        } catch { toast.error(t('photoFailed')) }
        finally { setPhotoBusy(false) }
    }

    async function savePassword(e: FormEvent<HTMLFormElement>) {
        e.preventDefault()
        const form = e.currentTarget
        const data = new FormData(form)
        const current_password = String(data.get('current_password') || '')
        const new_password = String(data.get('new_password') || '')
        if (new_password !== data.get('confirm_password')) { toast.error(t('passwordMismatch')); return }
        setPasswordBusy(true)
        try {
            await api.post('/core/users/change_password/', { current_password, new_password })
            form.reset()
            toast.success(t('passwordSaved'))
        } catch { toast.error(t('passwordFailed')) }
        finally { setPasswordBusy(false) }
    }

    if (!currentUser || currentUser.role !== 'student') {
        return <p className="max-w-3xl mx-auto py-12">{t('studentOnly')}</p>
    }

    const sections = [
        { id: 'personal' as const, label: t('personal'), icon: UserRound },
        { id: 'contract' as const, label: t('contract'), icon: FileText },
        { id: 'lessons' as const, label: t('lessons'), icon: CalendarDays }
    ]
    const photo = proxyFileUrl(currentUser.avatar || null)
    const fields = [
        { label: t('birthDate'), value: student?.birth_date },
        { label: t('street'), value: student?.address_line1 },
        { label: t('postalCode'), value: student?.postal_code },
        { label: t('city'), value: student?.city },
        { label: t('emergencyContact'), value: student?.emergency_contact_name },
        { label: t('emergencyPhone'), value: student?.emergency_contact_phone }
    ]

    return (
        <div className="max-w-5xl mx-auto space-y-6 pb-12">
            <header>
                <h1 className="text-3xl font-black text-gray-900">{t('title')}</h1>
                <p className="mt-2 text-gray-500">{t('description')}</p>
            </header>
            <nav aria-label={t('title')} className="flex flex-wrap gap-2">
                {sections.map(item => {
                    const Icon = item.icon
                    return <button type="button" key={item.id} aria-pressed={section === item.id}
                        onClick={() => setSection(item.id)}
                        className={section === item.id
                            ? 'inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-3 font-bold text-white'
                            : 'inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-5 py-3 font-bold text-gray-700'}>
                        <Icon className="w-4 h-4" />{item.label}
                    </button>
                })}
            </nav>
            {section === 'personal' ? (
                <div className="space-y-6">
                    <section className="rounded-2xl border border-gray-100 bg-white p-6 sm:p-8 space-y-6">
                        <h2 className="text-xl font-bold">{t('personal')}</h2>
                        <div className="flex flex-wrap items-center gap-5">
                            <div className="h-20 w-20 overflow-hidden rounded-2xl bg-gray-100 flex items-center justify-center">
                                {photo ? <img src={photo} alt={t('photo')} className="w-full h-full object-cover" /> :
                                    <UserRound className="h-9 w-9 text-gray-400" />}
                            </div>
                            <div className="space-y-2">
                                <label htmlFor="account-photo" className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-gray-300 px-4 py-2 text-sm font-bold">
                                    <Camera className="w-4 h-4" />{t('changePhoto')}
                                </label>
                                <input id="account-photo" type="file" accept="image/png,image/jpeg,image/webp" className="hidden"
                                    disabled={photoBusy} onChange={choosePhoto} />
                                {photo && <button type="button" disabled={photoBusy} onClick={removePhoto}
                                    className="block text-sm text-gray-500 underline">{t('removePhoto')}</button>}
                            </div>
                        </div>
                        <form onSubmit={savePersonal} className="space-y-4">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                {(['first_name', 'last_name'] as const).map(key =>
                                    <label key={key} className="block space-y-1 text-sm font-medium">{t(key)}
                                        <input required value={personal[key]} onChange={e => setPersonal(prev => ({ ...prev, [key]: e.target.value }))}
                                            className="block w-full rounded-xl border border-gray-200 px-4 py-3" />
                                    </label>
                                )}
                            </div>
                            <label className="block space-y-1 text-sm font-medium">{t('email')}
                                <input type="email" disabled value={currentUser.email} className="block w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-gray-500" />
                            </label>
                            <label className="block space-y-1 text-sm font-medium">{t('phone')}
                                <input type="tel" value={personal.phone} onChange={e => setPersonal(prev => ({ ...prev, phone: e.target.value }))}
                                    className="block w-full rounded-xl border border-gray-200 px-4 py-3" />
                            </label>
                            <label className="block space-y-1 text-sm font-medium">{t('instrument')}
                                <input value={personal.instrument} onChange={e => setPersonal(prev => ({ ...prev, instrument: e.target.value }))}
                                    className="block w-full rounded-xl border border-gray-200 px-4 py-3" />
                            </label>
                            <label className="block space-y-1 text-sm font-medium">{t('bio')}
                                <textarea rows={3} value={personal.bio} onChange={e => setPersonal(prev => ({ ...prev, bio: e.target.value }))}
                                    className="block w-full rounded-xl border border-gray-200 px-4 py-3" />
                            </label>
                            <button type="submit" disabled={busy} className="rounded-xl bg-primary px-5 py-3 font-bold text-white disabled:opacity-50">
                                {busy ? t('saving') : t('save')}
                            </button>
                        </form>
                    </section>
                    <section className="rounded-2xl border border-gray-100 bg-white p-6 sm:p-8 space-y-4">
                        <h2 className="text-lg font-bold flex items-center gap-2"><Eye className="w-5 h-5" />{t('adminManaged')}</h2>
                        <p className="text-sm text-gray-500">{t('adminManagedInfo')}</p>
                        {fetchError ? <p role="alert" className="text-red-600">{t('detailError')}</p> :
                            !student ? <p className="text-gray-500">{t('loading')}</p> :
                            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                {fields.map(f => <div key={f.label}>
                                    <dt className="text-xs text-gray-500">{f.label}</dt>
                                    <dd className="text-sm font-medium text-gray-900">{f.value || '–'}</dd>
                                </div>)}
                            </dl>}
                    </section>
                    <section className="rounded-2xl border border-gray-100 bg-white p-6 sm:p-8 space-y-4">
                        <h2 className="text-lg font-bold flex items-center gap-2"><KeyRound className="w-5 h-5" />{t('security')}</h2>
                        <form onSubmit={savePassword} className="max-w-md space-y-4">
                            {(['current_password', 'new_password', 'confirm_password'] as const).map(key =>
                                <label key={key} className="block space-y-1 text-sm font-medium">{t(key)}
                                    <input type="password" name={key} required minLength={key === 'current_password' ? undefined : 8}
                                        autoComplete={key === 'current_password' ? 'current-password' : 'new-password'}
                                        className="block w-full rounded-xl border border-gray-200 px-4 py-3" />
                                </label>
                            )}
                            <button type="submit" disabled={passwordBusy} className="rounded-xl bg-primary px-5 py-3 font-bold text-white disabled:opacity-50">
                                {passwordBusy ? t('saving') : t('changePassword')}
                            </button>
                        </form>
                    </section>
                </div>
            ) : (
                <section className="rounded-2xl border border-gray-100 bg-white p-8 space-y-3">
                    <h2 className="text-xl font-bold">{section === 'contract' ? t('contract') : t('lessons')}</h2>
                    <p className="text-gray-500">{t('notImplemented')}</p>
                </section>
            )}
            {cropImage && <ImageCropper imageSrc={cropImage} onCropComplete={savePhoto} onCancel={() => setCropImage(null)} />}
        </div>
    )
}
