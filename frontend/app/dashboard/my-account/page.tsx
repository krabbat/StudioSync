'use client'

import { useEffect, useState, type FormEvent, type ChangeEvent } from 'react'
import { useTranslations } from 'next-intl'
import { UserRound, Camera, KeyRound } from 'lucide-react'
import { toast } from 'react-hot-toast'
import { useUser, type User } from '@/contexts/UserContext'
import api from '@/services/api'
import ImageCropper from '@/components/ImageCropper'
import { proxyFileUrl } from '@/lib/utils'
import StudentPersonalFields, { emptyStudentPersonal, type StudentPersonalData } from '@/components/StudentPersonalFields'
import TeachingContractCard from '@/components/TeachingContractCard'
import StudentAccountTabs, { type AccountSection } from '@/components/StudentAccountTabs'
import StudentLessonAccountCard from '@/components/StudentLessonAccountCard'

type Personal = StudentPersonalData & { bio: string; instrument: string }

function userFields(user: User | null): Personal {
    return {
        ...emptyStudentPersonal,
        first_name: user?.first_name || '',
        last_name: user?.last_name || '',
        email: user?.email || '',
        phone: user?.phone || '',
        bio: user?.bio || '',
        instrument: user?.instrument || '',
    }
}

export default function MyAccountPage() {
    const t = useTranslations('MyAccount')
    const { currentUser, setCurrentUser } = useUser()
    const [section, setSection] = useState<AccountSection>('personal')
    const [personal, setPersonal] = useState<Personal>(() => userFields(currentUser))
    const [studentId, setStudentId] = useState('')
    const [ready, setReady] = useState(false)
    const [fetchError, setFetchError] = useState(false)
    const [busy, setBusy] = useState(false)
    const [photoBusy, setPhotoBusy] = useState(false)
    const [passwordBusy, setPasswordBusy] = useState(false)
    const [cropImage, setCropImage] = useState<string | null>(null)
    useEffect(() => {
        if (currentUser?.role !== 'student' || !currentUser.id) return
        let alive = true
        setReady(false)
        setFetchError(false)
        // auth/me omits student_profile; fetch the complete account first.
        api.get('/core/users/me/').then(async response => {
            const me = response.data
            const id = me.student_profile?.id
            if (!id) throw new Error('Student profile missing')
            const result = await api.get('/students/' + encodeURIComponent(id) + '/')
            if (!alive) return
            const student = result.data
            setStudentId(id)
            setCurrentUser(me)
            setPersonal({
                ...userFields(me),
                birth_date: student.birth_date || '',
                address_line1: student.address_line1 || '',
                postal_code: student.postal_code || '',
                city: student.city || '',
                emergency_contact_name: student.emergency_contact_name || '',
                emergency_contact_phone: student.emergency_contact_phone || '',
                instrument: me.instrument || student.instrument || '',
            })
            setReady(true)
        }).catch(() => { if (alive) setFetchError(true) })
        return () => { alive = false }
    }, [currentUser?.id, currentUser?.role, setCurrentUser])

    async function savePersonal(e: FormEvent<HTMLFormElement>) {
        e.preventDefault()
        if (!studentId) return
        setBusy(true)
        try {
            await api.patch('/students/' + encodeURIComponent(studentId) + '/', {
                first_name: personal.first_name,
                last_name: personal.last_name,
                email: personal.email,
                phone: personal.phone,
                birth_date: personal.birth_date || null,
                address_line1: personal.address_line1,
                postal_code: personal.postal_code,
                city: personal.city,
                emergency_contact_name: personal.emergency_contact_name,
                emergency_contact_phone: personal.emergency_contact_phone,
            })
            try {
                await api.patch('/core/users/me/', { bio: personal.bio, instrument: personal.instrument })
            } catch {
                toast.error(t('extraSaveFailed'))
                return
            }
            const response = await api.get('/core/users/me/')
            setCurrentUser(response.data)
            toast.success(t('saved'))
        } catch (error: any) {
            const message = error.response?.data?.email?.[0] || error.response?.data?.detail || t('saveFailed')
            toast.error(String(message))
        } finally {
            setBusy(false)
        }
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

    const photo = proxyFileUrl(currentUser.avatar || null)
    return (
        <div className="max-w-5xl mx-auto space-y-6 pb-12">
            <header>
                <h1 className="text-3xl font-black text-gray-900">{t('title')}</h1>
                <p className="mt-2 text-gray-500">{t('description')}</p>
            </header>
            <StudentAccountTabs section={section} onChange={setSection} />
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
                        {fetchError ? (
                            <p role="alert" className="text-red-600">{t('detailError')}</p>
                        ) : !ready ? (
                            <p className="text-gray-500">{t('loading')}</p>
                        ) : (
                            <form onSubmit={savePersonal} className="space-y-6">
                                <StudentPersonalFields value={personal} onChange={patch => setPersonal(prev => ({ ...prev, ...patch }))} />
                                <label className="block space-y-1 text-sm font-medium">{t('instrument')}
                                    <input value={personal.instrument}
                                        onChange={event => setPersonal(prev => ({ ...prev, instrument: event.target.value }))}
                                        className="block w-full rounded-xl border border-gray-200 px-4 py-3" />
                                </label>
                                <label className="block space-y-1 text-sm font-medium">{t('bio')}
                                    <textarea rows={3} value={personal.bio}
                                        onChange={event => setPersonal(prev => ({ ...prev, bio: event.target.value }))}
                                        className="block w-full rounded-xl border border-gray-200 px-4 py-3" />
                                </label>
                                <button type="submit" disabled={busy}
                                    className="rounded-xl bg-primary px-5 py-3 font-bold text-white disabled:opacity-50">
                                    {busy ? t('saving') : t('save')}
                                </button>
                            </form>
                        )}
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
            ) : section === 'contract' ? (
                <TeachingContractCard studentId={studentId} readOnly />
            ) : (
                <StudentLessonAccountCard studentId={studentId} readOnly />
            )}
            {cropImage && <ImageCropper imageSrc={cropImage} onCropComplete={savePhoto} onCancel={() => setCropImage(null)} />}
        </div>
    )
}
