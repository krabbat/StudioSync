'use client'

import { useTranslations } from 'next-intl'
import { useState, useRef, useEffect, KeyboardEvent } from 'react'
import { User, Building2, Bell, Palette, Mail, Camera, Wand2, Check, Server, Eye, EyeOff, Save, Loader2, Music, X, Plus, Download, Upload, ShieldAlert, Database, Globe, DollarSign, MapPin, ChevronLeft } from 'lucide-react'
import { useUser } from '@/contexts/UserContext'
import api from '@/services/api'
import { toast } from 'react-hot-toast'
import ImageCropper from '@/components/ImageCropper'
import { formatPhoneNumber } from '@/lib/utils'
import { TIMEZONES, CURRENCIES } from '@/types/setup'
import { detectLocation } from '@/lib/geolocate'
import Link from 'next/link'

export default function GeneralSettingsPage() {
  const t = useTranslations('GeneralSettings')
    const { currentUser, setCurrentUser } = useUser()
    const [activeTab, setActiveTab] = useState('appearance')
    const [loading, setLoading] = useState(false)
    const [isExporting, setIsExporting] = useState(false)
    const [isImporting, setIsImporting] = useState(false)
    const [justSaved, setJustSaved] = useState(false)
    const fileInputRef = useRef<HTMLInputElement>(null)
    const [showSmtpPassword, setShowSmtpPassword] = useState(false)
    const [showImapPassword, setShowImapPassword] = useState(false)
    const [testingImap, setTestingImap] = useState(false)
    const [smtpPasswordEditing, setSmtpPasswordEditing] = useState(false)
    const [imapPasswordEditing, setImapPasswordEditing] = useState(false)
    const [cropImage, setCropImage] = useState<string | null>(null)
    const [geoDetecting, setGeoDetecting] = useState(false)

    // Read ?tab= from URL on mount
    useEffect(() => {
        const params = new URLSearchParams(window.location.search)
        const tab = params.get('tab')
        if (currentUser?.role === 'student') {
            setActiveTab(tab && ['appearance', 'notifications', 'communication'].includes(tab) ? tab : 'appearance')
        } else {
            setActiveTab(tab || 'profile')
        }
    }, [currentUser?.role])

    const handleDetectTimezone = async () => {
        setGeoDetecting(true)
        try {
            const geo = await detectLocation()
            const updates: Partial<typeof studioSettings> = { timezone: geo.timezone }
            if (geo.city && !studioSettings.city) updates.city = geo.city
            if (geo.country && !studioSettings.country) updates.country = geo.country
            setStudioSettings(prev => ({ ...prev, ...updates }))
            const label = geo.city && geo.country_name ? `${geo.city}, ${geo.country_name}` : geo.timezone
            toast.success(t("locationDetected", {location: label}))
        } catch {
            toast.error(t('msgCouldNotDetectLocationCheckYourConnectionAndTryAgain'))
        } finally {
            setGeoDetecting(false)
        }
    }

    const updateCurrentUserSafe = (userData: any) => {
        if (userData?.avatar && currentUser?.avatar) {
            const baseIncoming = userData.avatar.split('?')[0]
            const baseCurrent = currentUser.avatar.split('?')[0]
            if (baseIncoming === baseCurrent) {
                userData.avatar = currentUser.avatar
            }
        }
        setCurrentUser(userData)
    }

    // Form state
    const [formData, setFormData] = useState({
        first_name: currentUser?.first_name || '',
        last_name: currentUser?.last_name || '',
        email: currentUser?.email || '',
        phone: currentUser?.phone || '',
        bio: currentUser?.bio || '',
        instrument: currentUser?.instrument || ''
    })

    // Track original values to detect changes
    const [originalFormData, setOriginalFormData] = useState({
        first_name: currentUser?.first_name || '',
        last_name: currentUser?.last_name || '',
        phone: currentUser?.phone || '',
        bio: currentUser?.bio || '',
        instrument: currentUser?.instrument || ''
    })

    // Check if form has changed
    const hasChanges = () => {
        return formData.first_name !== originalFormData.first_name ||
            formData.last_name !== originalFormData.last_name ||
            formData.phone !== originalFormData.phone ||
            formData.bio !== originalFormData.bio ||
            formData.instrument !== originalFormData.instrument
    }

    // Communication settings
    const [commSettings, setCommSettings] = useState({
        email_lessons: currentUser?.preferences?.communication?.email_lessons ?? true,
        email_messages: currentUser?.preferences?.communication?.email_messages ?? true,
        email_payments: currentUser?.preferences?.communication?.email_payments ?? true,
        sms_reminders: currentUser?.preferences?.communication?.sms_reminders ?? true,
        reminder_hours: currentUser?.preferences?.communication?.reminder_hours ?? 24,
        auto_confirm_lessons: currentUser?.preferences?.communication?.auto_confirm_lessons ?? false
    })

    // Notification settings
    const [notifSettings, setNotifSettings] = useState({
        push_enabled: currentUser?.preferences?.notifications?.push_enabled ?? true,
        email_enabled: currentUser?.preferences?.notifications?.email_enabled ?? true,
        sms_enabled: currentUser?.preferences?.notifications?.sms_enabled ?? false,
        lesson_reminders: currentUser?.preferences?.notifications?.lesson_reminders ?? true,
        payment_alerts: currentUser?.preferences?.notifications?.payment_alerts ?? true,
        new_messages: currentUser?.preferences?.notifications?.new_messages ?? true,
        student_updates: currentUser?.preferences?.notifications?.student_updates ?? true,
        quiet_hours_enabled: currentUser?.preferences?.notifications?.quiet_hours_enabled ?? false,
        quiet_start: currentUser?.preferences?.notifications?.quiet_start ?? '22:00',
        quiet_end: currentUser?.preferences?.notifications?.quiet_end ?? '08:00'
    })

    // Appearance settings
    const [appearanceSettings, setAppearanceSettings] = useState({
        theme: currentUser?.preferences?.appearance?.theme ?? 'light',
        compact_mode: currentUser?.preferences?.appearance?.compact_mode ?? false,
        font_size: currentUser?.preferences?.appearance?.font_size ?? 'medium',
        color_scheme: currentUser?.preferences?.appearance?.color_scheme ?? 'default'
    })

    // Studio settings
    const [studioSettings, setStudioSettings] = useState({
        studio_name: '',
        studio_email: '',
        studio_phone: '',
        studio_website: '',
        address_line1: '',
        address_line2: '',
        city: '',
        state: '',
        postal_code: '',
        country: 'US',
        timezone: 'UTC',
        currency: 'USD',
        default_lesson_duration: '60',
        cancellation_notice: '24',
        studio_description: ''
    })

    // Instrument list (curated by the studio admin)
    const [instrumentList, setInstrumentList] = useState<string[]>([])
    const [newInstrument, setNewInstrument] = useState('')
    const [instrumentLoading, setInstrumentLoading] = useState(false)

    // Load instruments from studio settings on mount
    useEffect(() => {
        if (currentUser?.studio) {
            const s = currentUser.studio
            setStudioSettings({
                studio_name: s.name || '',
                studio_email: s.email || '',
                studio_phone: s.phone || '',
                studio_website: s.website || '',
                address_line1: s.address_line1 || '',
                address_line2: s.address_line2 || '',
                city: s.city || '',
                state: s.state || '',
                postal_code: s.postal_code || '',
                country: s.country || 'US',
                timezone: s.timezone || 'UTC',
                currency: s.currency || 'USD',
                default_lesson_duration: s.settings?.default_lesson_duration?.toString() || '60',
                cancellation_notice: s.settings?.cancellation_notice_period?.toString() || '24',
                studio_description: s.settings?.studio_description || ''
            })
            setInstrumentList(Array.isArray(s.settings?.instruments) ? s.settings.instruments : [])
        }
    }, [currentUser])

    const handleAddInstrument = () => {
        const trimmed = newInstrument.trim()
        if (!trimmed) return
        const normalised = trimmed.charAt(0).toUpperCase() + trimmed.slice(1)
        if (instrumentList.includes(normalised)) {
            toast.error(t("instrumentAlreadyListed", {instrument: normalised}))
            return
        }
        setInstrumentList(prev => [...prev, normalised].sort())
        setNewInstrument('')
    }

    const handleInstrumentKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') { e.preventDefault(); handleAddInstrument() }
    }

    const handleRemoveInstrument = (name: string) => {
        setInstrumentList(prev => prev.filter(i => i !== name))
    }

    const handleSaveInstruments = async () => {
        setInstrumentLoading(true)
        try {
            const currentStudioRes = await api.get('/core/studios/current/')
            const currentSettings = currentStudioRes.data.settings || {}
            await api.patch('/core/studios/current/', {
                settings: { ...currentSettings, instruments: instrumentList }
            })
            toast.success(t('msgInstrumentListSaved'))
        } catch (err) {
            toast.error(t('msgFailedToSaveInstrumentList'))
        } finally {
            setInstrumentLoading(false)
        }
    }

    // Technical settings (SMTP/IMAP) - Admin only
    const [technicalSettings, setTechnicalSettings] = useState({
        smtp_host: currentUser?.preferences?.technical?.smtp_host ?? '',
        smtp_port: currentUser?.preferences?.technical?.smtp_port ?? '587',
        smtp_username: currentUser?.preferences?.technical?.smtp_username ?? '',
        smtp_password: '',
        smtp_from_email: currentUser?.preferences?.technical?.smtp_from_email ?? '',
        smtp_from_name: currentUser?.preferences?.technical?.smtp_from_name ?? 'StudioSync',
        smtp_use_tls: currentUser?.preferences?.technical?.smtp_use_tls ?? true,
        imap_host: currentUser?.preferences?.technical?.imap_host ?? 'mail.manitu.de',
        imap_port: currentUser?.preferences?.technical?.imap_port ?? '993',
        imap_security: currentUser?.preferences?.technical?.imap_security ?? 'ssl',
        imap_username: currentUser?.preferences?.technical?.imap_username ?? 'musikunterricht@musart.de',
        imap_password: ''
    })

    // The admin profile may be fetched after the first render.
    // Populate all saved SMTP and IMAP values once the admin profile arrives.
    // Passwords are deliberately never returned by the API.
    useEffect(() => {
        const t = currentUser?.preferences?.technical
        if (currentUser?.role !== 'admin' || !t) return
        setTechnicalSettings(prev => ({
            ...prev,
            smtp_host: t.smtp_host ?? '',
            smtp_port: String(t.smtp_port ?? '587'),
            smtp_username: t.smtp_username ?? '',
            smtp_password: '',
            smtp_from_email: t.smtp_from_email ?? '',
            smtp_from_name: t.smtp_from_name ?? 'StudioSync',
            smtp_use_tls: t.smtp_use_tls ?? true,
            imap_host: t.imap_host ?? 'mail.manitu.de',
            imap_port: String(t.imap_port ?? '993'),
            imap_security: t.imap_security ?? 'ssl',
            imap_username: t.imap_username ?? 'musikunterricht@musart.de',
            imap_password: '',
        }))
    }, [currentUser?.role, currentUser?.preferences?.technical])

    const tabs = [
        { id: 'profile', label: t('tabProfile'), icon: User },
        { id: 'security', label: t('tabSecurity'), icon: ShieldAlert },
        { id: 'studio', label: t('tabStudio'), icon: Building2, roles: ['admin'] },
        { id: 'communication', label: t('tabCommunication'), icon: Mail },
        { id: 'appearance', label: t('tabAppearance'), icon: Palette },
        { id: 'notifications', label: t('tabNotifications'), icon: Bell },
        { id: 'technical', label: t('tabTechnical'), icon: Server, roles: ['admin'] },
        { id: 'maintenance', label: t('tabMaintenance'), icon: Database, roles: ['admin'] },
    ].filter(tab => currentUser?.role !== 'student' || ['appearance', 'notifications', 'communication'].includes(tab.id))

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (!file) return

        const reader = new FileReader()
        reader.addEventListener('load', () => {
            setCropImage(reader.result as string)
        })
        reader.readAsDataURL(file)
        e.target.value = ''
    }

    const handleCropComplete = async (croppedImageBlob: Blob) => {
        setCropImage(null)
        setLoading(true)

        const uploadData = new FormData()
        uploadData.append('avatar', croppedImageBlob, 'avatar.jpg')

        try {
            const response = await api.patch('/core/users/me/', uploadData)
            const updatedUser = response.data
            if (updatedUser.avatar) {
                updatedUser.avatar = `${updatedUser.avatar}${updatedUser.avatar.includes('?') ? '&' : '?'}t=${Date.now()}`
            }
            setCurrentUser(updatedUser)
            toast.success(t('msgAvatarUpdatedSuccessfully'))
        } catch (error: any) {
            console.error('Avatar upload failed:', error)
            const errorMessage = error.response?.data?.avatar?.[0] ||
                error.response?.data?.detail ||
                'Failed to upload avatar'
            toast.error(errorMessage)
        } finally {
            setLoading(false)
        }
    }

    const handleRemoveAvatar = async () => {
        setLoading(true)
        try {
            await api.post('/core/users/remove_avatar/')
            const meResponse = await api.get('/core/users/me/')
            updateCurrentUserSafe(meResponse.data)
            toast.success(t('msgAvatarRemovedSuccessfully'))
        } catch (error) {
            console.error('Failed to remove avatar:', error)
            toast.error(t('msgFailedToRemoveAvatar'))
        } finally {
            setLoading(false)
        }
    }

    const handleAutoSelectAvatar = async () => {
        const instrument = formData.instrument || 'Music'
        const color = instrument.toLowerCase().includes('piano') ? '000000' :
            instrument.toLowerCase().includes('guitar') ? '8B4513' : 'F39C12'

        const autoAvatarUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(formData.first_name)}+${encodeURIComponent(formData.last_name)}&background=${color}&color=fff&size=256`

        setLoading(true)
        try {
            const response = await fetch(autoAvatarUrl)
            const blob = await response.blob()

            const uploadData = new FormData()
            uploadData.append('avatar', blob, 'avatar.png')

            const apiResponse = await api.patch('/core/users/me/', uploadData)
            const updatedUser = apiResponse.data
            if (updatedUser.avatar) {
                updatedUser.avatar = `${updatedUser.avatar}${updatedUser.avatar.includes('?') ? '&' : '?'}t=${Date.now()}`
            }
            setCurrentUser(updatedUser)
            toast.success(t("avatarSetForInstrument", {instrument}))
        } catch (error) {
            console.error('Auto-select failed:', error)
            toast.error(t('msgFailedToSetAvatarAutomatically'))
        } finally {
            setLoading(false)
        }
    }

    const [testingEmail, setTestingEmail] = useState(false)

    const handleTestEmail = async () => {
        setTestingEmail(true)
        try {
            const payload = {
                smtp_host: technicalSettings.smtp_host,
                smtp_port: technicalSettings.smtp_port,
                smtp_username: technicalSettings.smtp_username,
                smtp_password: technicalSettings.smtp_password,
                smtp_from_email: technicalSettings.smtp_from_email,
                smtp_from_name: technicalSettings.smtp_from_name,
                smtp_use_tls: technicalSettings.smtp_use_tls,
            }
            const res = await api.post('/core/users/send_test_email/', payload)
            toast.success(res.data.detail || t('testEmailSent'))
        } catch (error: any) {
            console.error(error)
            toast.error(error.response?.data?.detail || t('testEmailFailed'))
        } finally {
            setTestingEmail(false)
        }
    }

    const handleTestImap = async () => {
        setTestingImap(true)
        try {
            const response = await api.post('/core/users/test_imap_connection/', {
                imap_host: technicalSettings.imap_host,
                imap_port: technicalSettings.imap_port,
                imap_security: technicalSettings.imap_security,
                imap_username: technicalSettings.imap_username,
                imap_password: technicalSettings.imap_password,
            })
            toast.success(response.data.detail || 'IMAP-Verbindung erfolgreich.')
        } catch (error: any) {
            toast.error(error.response?.data?.detail || 'IMAP-Verbindung konnte nicht hergestellt werden.')
        } finally {
            setTestingImap(false)
        }
    }

    const handleExportSystem = async () => {
        setIsExporting(true)
        try {
            const response = await api.get('/core/system/export/', {
                responseType: 'blob'
            })

            const url = window.URL.createObjectURL(new Blob([response.data]))
            const link = document.createElement('a')
            link.href = url
            const timestamp = new Date().toISOString().split('T')[0]
            link.setAttribute('download', `studiosync_backup_${timestamp}.zip`)
            document.body.appendChild(link)
            link.click()
            link.remove()
            toast.success(t('msgSystemExportStarted'))
        } catch (error) {
            console.error('Export failed:', error)
            toast.error(t('msgFailedToExportSystemData'))
        } finally {
            setIsExporting(false)
        }
    }

    const handleImportSystem = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (!file) return

        if (!confirm(t('msgWarningThisWillOverwriteExistingDataAreYouSureYouWantToProceed'))) {
            e.target.value = ''
            return
        }

        setIsImporting(true)
        const formData = new FormData()
        formData.append('file', file)

        try {
            await api.post('/core/system/import/', formData)
            toast.success(t('msgSystemRestoredSuccessfullyReloading'))
            setTimeout(() => window.location.reload(), 2000)
        } catch (error: any) {
            console.error('Import failed:', error)
            toast.error(error.response?.data?.error || t('importFailed'))
        } finally {
            setIsImporting(false)
            e.target.value = ''
        }
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setLoading(true)
        setJustSaved(false)
        try {
            const response = await api.patch('/core/users/me/', formData)
            updateCurrentUserSafe(response.data)
            setOriginalFormData({
                first_name: response.data.first_name,
                last_name: response.data.last_name,
                phone: response.data.phone,
                bio: response.data.bio,
                instrument: response.data.instrument
            })
            toast.success(t('msgProfileUpdated'))
            setJustSaved(true)
            setTimeout(() => setJustSaved(false), 3000)
        } catch (error) {
            console.error(error)
            toast.error(t('msgFailedToUpdateProfile'))
        } finally {
            setLoading(false)
        }
    }

    const handleSaveSettings = async (settingsType: string, settings: any) => {
        setLoading(true)
        try {
            if (settingsType === 'Studio') {
                let currentSettings = {}
                let method: 'post' | 'patch' = 'patch'

                try {
                    const currentStudioRes = await api.get('/core/studios/current/')
                    currentSettings = currentStudioRes.data.settings || {}
                    method = 'patch'
                } catch (err: any) {
                    if (err.response?.status === 404) {
                        method = 'post'
                    } else {
                        throw err
                    }
                }

                const updatePayload = {
                    name: settings.studio_name,
                    email: settings.studio_email,
                    phone: settings.studio_phone,
                    website: settings.studio_website,
                    address_line1: settings.address_line1,
                    address_line2: settings.address_line2,
                    city: settings.city,
                    state: settings.state,
                    postal_code: settings.postal_code,
                    country: settings.country,
                    timezone: settings.timezone,
                    currency: settings.currency,
                    settings: {
                        ...currentSettings,
                        default_lesson_duration: parseInt(settings.default_lesson_duration),
                        cancellation_notice_period: parseInt(settings.cancellation_notice),
                        studio_description: settings.studio_description
                    }
                }

                if (method === 'post') {
                    await api.post('/core/studios/current/', updatePayload)
                } else {
                    await api.patch('/core/studios/current/', updatePayload)
                }

                toast.success(t('msgStudioSettingsSavedSuccessfully'))

                const userRes = await api.get('/core/users/me/')
                const userData = userRes.data

                if (userData.role === 'admin' && userData.timezone !== settings.timezone) {
                    await api.patch('/core/users/me/', { timezone: settings.timezone })
                    const updatedUserRes = await api.get('/core/users/me/')
                    updateCurrentUserSafe(updatedUserRes.data)
                } else {
                    updateCurrentUserSafe(userData)
                }

            } else {
                const updatedPreferences = {
                    ...currentUser?.preferences,
                    [settingsType.toLowerCase()]: settings
                }

                const response = await api.patch('/core/users/me/', {
                    preferences: updatedPreferences
                })

                updateCurrentUserSafe(response.data)
                if (settingsType === 'Technical') {
                    // Never retain newly entered mailbox passwords after a successful save.
                    setTechnicalSettings(prev => ({ ...prev, smtp_password: '', imap_password: '' }))
                    setSmtpPasswordEditing(false)
                    setImapPasswordEditing(false)
                }
                toast.success(t("sectionSettingsSaved", {section: settingsType}))
            }
        } catch (error) {
            console.error(`Failed to save ${settingsType} settings:`, error)
            toast.error(t("sectionSettingsFailed", {section: settingsType}))
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 pb-12 space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
            {/* Back to settings hub */}
            <div className="pt-4">
                <Link
                    href="/dashboard/settings/"
                    className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 transition-colors"
                >
                    <ChevronLeft className="w-4 h-4" />
                    {t('settings')}
                </Link>
            </div>

            {/* Header */}
            <header className="space-y-2">
                <h1 className="text-2xl md:text-4xl font-black text-gray-900 tracking-tight">
                    {tabs.find(tab => tab.id === activeTab)?.label ?? t('settings')}
                </h1>
            </header>

            {/* Mobile Tab Selector */}
            <div className="lg:hidden bg-white rounded-2xl border border-gray-100 p-2 shadow-sm">
                <div className="grid grid-cols-2 gap-2">
                    {tabs.map((tab) => {
                        if (tab.roles && !tab.roles.includes(currentUser?.role as any)) return null
                        const Icon = tab.icon
                        return (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id)}
                                className={`flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-sm font-bold transition-all active:scale-95 ${activeTab === tab.id
                                    ? 'bg-primary text-white shadow-md'
                                    : 'bg-gray-50 text-gray-700 hover:bg-gray-100'
                                    }`}
                            >
                                <Icon className="w-4 h-4" />
                                <span>{tab.label}</span>
                            </button>
                        )
                    })}
                </div>
            </div>

            <div className="flex flex-col lg:flex-row gap-6">
                {/* Desktop Sidebar */}
                <div className="hidden lg:block lg:w-64 shrink-0">
                    <div className="bg-white rounded-2xl border border-gray-100 p-4 sticky top-6 shadow-sm">
                        <nav className="space-y-1">
                            {tabs.map((tab) => {
                                if (tab.roles && !tab.roles.includes(currentUser?.role as any)) return null
                                const Icon = tab.icon
                                return (
                                    <button
                                        key={tab.id}
                                        onClick={() => setActiveTab(tab.id)}
                                        className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-bold transition-all active:scale-95 ${activeTab === tab.id
                                            ? 'bg-primary text-white shadow-md'
                                            : 'text-gray-700 hover:bg-gray-50'
                                            }`}
                                    >
                                        <Icon className="w-5 h-5" />
                                        <span>{tab.label}</span>
                                    </button>
                                )
                            })}
                        </nav>
                    </div>
                </div>

                {/* Image Cropper Modal */}
                {cropImage && (
                    <ImageCropper
                        imageSrc={cropImage}
                        onCropComplete={handleCropComplete}
                        onCancel={() => setCropImage(null)}
                    />
                )}

                {/* Main Content */}
                <div className="flex-1 bg-white rounded-2xl border border-gray-100 p-6 sm:p-8 shadow-sm">
                    {/* Profile Tab */}
                    {activeTab === 'profile' && currentUser?.role !== 'student' && (
                        <div className="max-w-2xl">
                            <h2 className="text-2xl font-black text-gray-900 mb-6">{t('profileSettings')}</h2>

                            {/* Avatar Section */}
                            <div className="flex flex-col sm:flex-row sm:items-center gap-4 mb-6 pb-6 border-b border-gray-200">
                                <div className="relative group">
                                    <div className="w-20 h-20 rounded-full overflow-hidden bg-gray-100 border-2 border-gray-200">
                                        {currentUser?.avatar ? (
                                            <img src={currentUser.avatar} alt={t('avatarAlt')} className="w-full h-full object-cover" />
                                        ) : (
                                            <div className="w-full h-full flex items-center justify-center text-gray-400 text-xl font-bold">
                                                {currentUser?.first_name?.[0]}{currentUser?.last_name?.[0]}
                                            </div>
                                        )}
                                    </div>
                                    <button
                                        onClick={() => fileInputRef.current?.click()}
                                        className="absolute bottom-0 right-0 p-1.5 bg-white border border-gray-200 rounded-full shadow-sm hover:bg-gray-50"
                                    >
                                        <Camera className="w-3.5 h-3.5 text-gray-600" />
                                    </button>
                                    <input
                                        type="file"
                                        ref={fileInputRef}
                                        onChange={handleFileChange}
                                        className="hidden"
                                        accept="image/*"
                                    />
                                </div>
                                <div className="flex-1">
                                    <h3 className="font-medium text-gray-900 text-sm">{t('profilePicture')}</h3>
                                    <p className="text-xs text-gray-500 mb-2">{t('pngJPGUpTo5MB')}</p>
                                    <div className="flex flex-wrap gap-2 text-xs">
                                        <button
                                            onClick={() => fileInputRef.current?.click()}
                                            className="text-primary hover:text-primary-hover font-medium"
                                        >
                                            {t('upload')}
                                        </button>
                                        <span className="text-gray-300">|</span>
                                        <button
                                            onClick={handleAutoSelectAvatar}
                                            className="text-gray-600 hover:text-gray-900 flex items-center gap-1"
                                        >
                                            <Wand2 className="w-3 h-3" /> {t('auto')}
                                        </button>
                                        {currentUser?.avatar && (
                                            <>
                                                <span className="text-gray-300">|</span>
                                                <button
                                                    onClick={handleRemoveAvatar}
                                                    className="text-red-600 hover:text-red-700"
                                                >
                                                    {t('remove')}
                                                </button>
                                            </>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {/* Form */}
                            <form onSubmit={handleSubmit} className="space-y-4">
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">{t('firstName')}</label>
                                        <input
                                            type="text"
                                            value={formData.first_name}
                                            onChange={e => setFormData({ ...formData, first_name: e.target.value })}
                                            className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">{t('lastName')}</label>
                                        <input
                                            type="text"
                                            value={formData.last_name}
                                            onChange={e => setFormData({ ...formData, last_name: e.target.value })}
                                            className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                                        />
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">{t('email')}</label>
                                    <input
                                        type="email"
                                        value={formData.email}
                                        disabled
                                        className="w-full px-3 py-2 border border-gray-200 rounded-lg bg-gray-50 text-gray-500"
                                    />
                                    <p className="text-xs text-gray-500 mt-1">{t('emailCannotBeChanged')}</p>
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">{t('phone')}</label>
                                    <input
                                        type="tel"
                                        value={formData.phone}
                                        onChange={e => setFormData({ ...formData, phone: formatPhoneNumber(e.target.value) })}
                                        className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                                        placeholder={t('examplePhone')}
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">{t('bio')}</label>
                                    <textarea
                                        rows={3}
                                        value={formData.bio}
                                        onChange={e => setFormData({ ...formData, bio: e.target.value })}
                                        className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                                        placeholder={t('detailTellUsAboutYourself')}
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">{t('primaryInstrument')}</label>
                                    <input
                                        type="text"
                                        value={formData.instrument}
                                        onChange={e => setFormData({ ...formData, instrument: e.target.value })}
                                        placeholder={t('detailEGPianoViolinVoice')}
                                        className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                                    />
                                    <p className="text-xs text-gray-500 mt-1">{t('usedForPersonalization')}</p>
                                </div>

                                <div className="pt-4 border-t border-gray-200 flex flex-col sm:flex-row items-start sm:items-center gap-3">
                                    <button
                                        type="submit"
                                        disabled={loading || !hasChanges()}
                                        className={`flex items-center justify-center gap-2 px-6 py-2 rounded-lg font-medium transition-colors ${!hasChanges()
                                            ? 'bg-gray-200 text-gray-500 cursor-not-allowed'
                                            : 'bg-primary text-white hover:bg-primary-hover'
                                            } disabled:opacity-50`}
                                    >
                                        {loading ? (
                                            <><Loader2 className="w-4 h-4 animate-spin" />{t('saving')}</>
                                        ) : justSaved ? (
                                            <><Check className="w-4 h-4" />{t('saved')}</>
                                        ) : (
                                            <><Save className="w-4 h-4" />{t('saveChanges')}</>
                                        )}
                                    </button>
                                    {!hasChanges() && !justSaved && (
                                        <span className="text-xs text-gray-500">{t('noChangesToSave')}</span>
                                    )}
                                </div>
                            </form>
                        </div>
                    )}

                    {/* Security Tab */}
                    {activeTab === 'security' && currentUser?.role !== 'student' && (
                        <div className="max-w-2xl">
                            <h2 className="text-2xl font-black text-gray-900 mb-6">{t('securitySettings')}</h2>
                            <form onSubmit={async (e) => {
                                e.preventDefault()
                                const form = e.currentTarget
                                const current_password = (form.elements.namedItem('current_password') as HTMLInputElement).value
                                const new_password = (form.elements.namedItem('new_password') as HTMLInputElement).value
                                const confirm_password = (form.elements.namedItem('confirm_password') as HTMLInputElement).value

                                if (new_password !== confirm_password) {
                                    toast.error(t('msgNewPasswordsDoNotMatch'))
                                    return
                                }
                                setLoading(true)
                                try {
                                    await api.post('/core/users/change_password/', {
                                        current_password,
                                        new_password
                                    })
                                    toast.success(t('msgPasswordChangedSuccessfully'))
                                    form.reset()
                                } catch (error: any) {
                                    toast.error(error.response?.data?.detail || t('changePasswordFailed'))
                                } finally {
                                    setLoading(false)
                                }
                            }} className="space-y-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">{t('currentPassword')}</label>
                                    <input type="password" name="current_password" required className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">{t('newPassword')}</label>
                                    <input type="password" name="new_password" required minLength={8} className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">{t('confirmNewPassword')}</label>
                                    <input type="password" name="confirm_password" required minLength={8} className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" />
                                </div>
                                <div className="pt-4 border-t border-gray-200">
                                    <button
                                        type="submit"
                                        disabled={loading}
                                        className="flex items-center justify-center gap-2 px-6 py-2 bg-primary text-white rounded-lg font-medium hover:bg-primary-hover transition-colors disabled:opacity-50"
                                    >
                                        {loading ? (
                                            <><Loader2 className="w-4 h-4 animate-spin" />{t('updating')}</>
                                        ) : (
                                            <><ShieldAlert className="w-4 h-4" />{t('changePassword')}</>
                                        )}
                                    </button>
                                </div>
                            </form>
                        </div>
                    )}

                    {/* Studio Tab */}
                    {activeTab === 'studio' && (
                        <div className="max-w-2xl">
                            <h2 className="text-lg font-semibold text-gray-900 mb-6">{t('studioSettings')}</h2>
                            <div className="space-y-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">{t('studioName')}</label>
                                    <input type="text" value={studioSettings.studio_name} onChange={e => setStudioSettings({ ...studioSettings, studio_name: e.target.value })} placeholder={t('detailMyMusicStudio')} className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" />
                                </div>

                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">{t('studioEmail')}</label>
                                        <input type="email" value={studioSettings.studio_email} onChange={e => setStudioSettings({ ...studioSettings, studio_email: e.target.value })} placeholder="contact@studio.com" className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">{t('studioPhone')}</label>
                                        <input type="tel" value={studioSettings.studio_phone} onChange={e => setStudioSettings({ ...studioSettings, studio_phone: formatPhoneNumber(e.target.value) })} placeholder={t('exampleStudioPhone')} className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" />
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">{t('website')}</label>
                                    <input type="url" value={studioSettings.studio_website} onChange={e => setStudioSettings({ ...studioSettings, studio_website: e.target.value })} placeholder="https://mystudio.com" className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" />
                                </div>

                                <div className="space-y-3">
                                    <label className="block text-sm font-medium text-gray-700">{t('address')}</label>
                                    <input type="text" value={studioSettings.address_line1} onChange={e => setStudioSettings({ ...studioSettings, address_line1: e.target.value })} placeholder={t('detailAddressLine1')} className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" />
                                    <input type="text" value={studioSettings.address_line2} onChange={e => setStudioSettings({ ...studioSettings, address_line2: e.target.value })} placeholder={t('detailAddressLine2Optional')} className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" />
                                    <div className="grid grid-cols-2 gap-4">
                                        <input type="text" value={studioSettings.city} onChange={e => setStudioSettings({ ...studioSettings, city: e.target.value })} placeholder={t('detailCity')} className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" />
                                        <input type="text" value={studioSettings.state} onChange={e => setStudioSettings({ ...studioSettings, state: e.target.value })} placeholder={t('detailState')} className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" />
                                    </div>
                                    <div className="grid grid-cols-2 gap-4">
                                        <input type="text" value={studioSettings.postal_code} onChange={e => setStudioSettings({ ...studioSettings, postal_code: e.target.value })} placeholder={t('detailPostalCode')} className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" />
                                        <input type="text" value={studioSettings.country} onChange={e => setStudioSettings({ ...studioSettings, country: e.target.value })} placeholder={t('detailCountryISO')} className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" />
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    <div>
                                        <div className="flex items-center justify-between mb-1">
                                            <label className="block text-sm font-medium text-gray-700 flex items-center gap-2">
                                                <Globe className="w-3.5 h-3.5" /> {t('timezone')}
                                            </label>
                                            <button type="button" onClick={handleDetectTimezone} disabled={geoDetecting} className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 disabled:opacity-50 transition-colors">
                                                {geoDetecting ? <><Loader2 className="w-3 h-3 animate-spin" /> {t('detecting')}</> : <><MapPin className="w-3 h-3" /> {t('detect')}</>}
                                            </button>
                                        </div>
                                        <select value={studioSettings.timezone} onChange={e => setStudioSettings({ ...studioSettings, timezone: e.target.value })} className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary">
                                            {!TIMEZONES.some(t => t.value === studioSettings.timezone) && (
                                                <option value={studioSettings.timezone}>{studioSettings.timezone}</option>
                                            )}
                                            {TIMEZONES.map(tz => (
                                                <option key={tz.value} value={tz.value}>{tz.label}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-2">
                                            <DollarSign className="w-3.5 h-3.5" /> {t('currency')}
                                        </label>
                                        <select value={studioSettings.currency} onChange={e => setStudioSettings({ ...studioSettings, currency: e.target.value })} className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary">
                                            {CURRENCIES.map(c => (
                                                <option key={c.value} value={c.value}>{c.label}</option>
                                            ))}
                                        </select>
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">{t('defaultLessonDuration')}</label>
                                        <select value={studioSettings.default_lesson_duration} onChange={e => setStudioSettings({ ...studioSettings, default_lesson_duration: e.target.value })} className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary">
                                            <option value="30">{t('durationMinutes', {count: 30})}</option>
                                            <option value="45">{t('durationMinutes', {count: 45})}</option>
                                            <option value="60">{t('durationMinutes', {count: 60})}</option>
                                            <option value="90">{t('durationMinutes', {count: 90})}</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">{t('cancellationNotice')}</label>
                                        <select value={studioSettings.cancellation_notice} onChange={e => setStudioSettings({ ...studioSettings, cancellation_notice: e.target.value })} className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary">
                                            <option value="12">{t('durationHours', {count: 12})}</option>
                                            <option value="24">{t('durationHours', {count: 24})}</option>
                                            <option value="48">{t('durationHours', {count: 48})}</option>
                                            <option value="168">{t('durationOneWeek')}</option>
                                        </select>
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">{t('studioDescription')}</label>
                                    <textarea rows={4} value={studioSettings.studio_description} onChange={e => setStudioSettings({ ...studioSettings, studio_description: e.target.value })} placeholder={t('detailTellStudentsAboutYourStudio')} className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" />
                                </div>

                                {/* Instrument List */}
                                <div className="pt-6 border-t border-gray-100">
                                    <div className="flex items-center gap-2 mb-1">
                                        <Music className="w-4 h-4 text-[var(--color-primary)]" />
                                        <h3 className="text-sm font-semibold text-gray-900">{t('instrumentCourseList')}</h3>
                                    </div>
                                    <p className="text-xs text-gray-500 mb-4">{t('theseInstrumentsAppearInStudentDropdownsAcrossTheApp')}</p>
                                    <div className="flex flex-wrap gap-2 mb-3 min-h-[36px]">
                                        {instrumentList.length === 0 && <span className="text-xs text-gray-400 italic">{t('noInstrumentsAddedYet')}</span>}
                                        {instrumentList.map(name => (
                                            <span key={name} className="inline-flex items-center gap-1.5 px-3 py-1 bg-indigo-50 border border-indigo-200 text-indigo-700 text-xs font-semibold rounded-full">
                                                {name}
                                                <button type="button" onClick={() => handleRemoveInstrument(name)} className="hover:text-red-500 transition-colors" aria-label={t('removeInstrument', {name})}>
                                                    <X className="w-3 h-3" />
                                                </button>
                                            </span>
                                        ))}
                                    </div>
                                    <div className="flex gap-2">
                                        <input type="text" value={newInstrument} onChange={e => setNewInstrument(e.target.value)} onKeyDown={handleInstrumentKeyDown} placeholder={t('detailEGDrumsCelloVoice')} className="flex-1 px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary text-sm" />
                                        <button type="button" onClick={handleAddInstrument} className="flex items-center gap-1.5 px-4 py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-semibold text-sm rounded-lg border border-indigo-200 transition-colors">
                                            <Plus className="w-4 h-4" /> {t('add')}
                                        </button>
                                    </div>
                                    <div className="mt-3">
                                        <button type="button" onClick={handleSaveInstruments} disabled={instrumentLoading} className="flex items-center gap-2 px-5 py-2 bg-primary text-white rounded-lg hover:bg-primary-hover transition-colors font-medium text-sm disabled:opacity-50">
                                            {instrumentLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                                            {instrumentLoading ? t('instrumentSaving') : t('instrumentSave')}
                                        </button>
                                    </div>
                                </div>

                                <div className="pt-4 border-t border-gray-200">
                                    <button onClick={() => handleSaveSettings('Studio', studioSettings)} disabled={loading} className="flex items-center gap-2 px-6 py-2 bg-primary text-white rounded-lg hover:bg-primary-hover transition-colors font-medium disabled:opacity-50">
                                        {loading ? <><Loader2 className="w-4 h-4 animate-spin" />{t('saving')}</> : <><Save className="w-4 h-4" />{t('saveChanges')}</>}
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Communication Tab */}
                    {activeTab === 'communication' && (
                        <div className="max-w-2xl">
                            <h2 className="text-lg font-semibold text-gray-900 mb-6">{t('communicationSettings')}</h2>
                            <div className="space-y-6">
                                <div>
                                    <h3 className="text-sm font-semibold text-gray-900 mb-3">{t('emailNotifications')}</h3>
                                    <div className="space-y-2">
                                        {[
                                            { key: 'email_lessons', label: t('commLessonChanges') },
                                            { key: 'email_messages', label: t('commNewMessages') },
                                            { key: 'email_payments', label: t('commPaymentMessages') }
                                        ].map(item => (
                                            <label key={item.key} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg cursor-pointer hover:bg-gray-100 transition-colors">
                                                <span className="text-sm text-gray-700">{item.label}</span>
                                                <input type="checkbox" checked={commSettings[item.key as keyof typeof commSettings] as boolean} onChange={e => setCommSettings({ ...commSettings, [item.key]: e.target.checked })} className="w-4 h-4 text-primary rounded focus:ring-primary" />
                                            </label>
                                        ))}
                                    </div>
                                </div>

                                <div>
                                    <h3 className="text-sm font-semibold text-gray-900 mb-3">{t('smsSettings')}</h3>
                                    <label className="flex items-center justify-between p-3 bg-gray-50 rounded-lg cursor-pointer hover:bg-gray-100 transition-colors mb-3">
                                        <span className="text-sm text-gray-700">{t('sendSMSReminders')}</span>
                                        <input type="checkbox" checked={commSettings.sms_reminders} onChange={e => setCommSettings({ ...commSettings, sms_reminders: e.target.checked })} className="w-4 h-4 text-primary rounded focus:ring-primary" />
                                    </label>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">{t('reminderTiming')}</label>
                                        <select value={commSettings.reminder_hours} onChange={e => setCommSettings({ ...commSettings, reminder_hours: Number(e.target.value) })} className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary">
                                            <option value={1}>{t('reminderHoursBefore', {count: 1})}</option>
                                            <option value={3}>{t('reminderHoursBefore', {count: 3})}</option>
                                            <option value={24}>{t('reminderHoursBefore', {count: 24})}</option>
                                            <option value={48}>{t('reminderHoursBefore', {count: 48})}</option>
                                        </select>
                                    </div>
                                </div>

                                <div>
                                    <h3 className="text-sm font-semibold text-gray-900 mb-3">{t('automation')}</h3>
                                    <label className="flex items-start justify-between p-3 bg-gray-50 rounded-lg cursor-pointer hover:bg-gray-100 transition-colors">
                                        <div className="flex-1 pr-4">
                                            <span className="text-sm text-gray-700 block">{t('autoConfirmLessonRequests')}</span>
                                            <span className="text-xs text-gray-500">{t('automaticallyAcceptLessonRequestsFromExistingStudents')}</span>
                                        </div>
                                        <input type="checkbox" checked={commSettings.auto_confirm_lessons} onChange={e => setCommSettings({ ...commSettings, auto_confirm_lessons: e.target.checked })} className="w-4 h-4 text-primary rounded focus:ring-primary mt-0.5" />
                                    </label>
                                </div>

                                <div className="pt-4 border-t border-gray-200">
                                    <button onClick={() => handleSaveSettings('Communication', commSettings)} disabled={loading} className="flex items-center gap-2 px-6 py-2 bg-primary text-white rounded-lg hover:bg-primary-hover transition-colors font-medium disabled:opacity-50">
                                        {loading ? <><Loader2 className="w-4 h-4 animate-spin" />{t('saving')}</> : <><Save className="w-4 h-4" />{t('saveChanges')}</>}
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Appearance Tab */}
                    {activeTab === 'appearance' && (
                        <div className="max-w-2xl">
                            <h2 className="text-lg font-semibold text-gray-900 mb-6">{t('appearanceSettings')}</h2>
                            <div className="space-y-6">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-3">{t('theme')}</label>
                                    <div className="grid grid-cols-3 gap-3">
                                        {['light', 'dark', 'auto'].map(theme => (
                                            <button key={theme} onClick={() => setAppearanceSettings({ ...appearanceSettings, theme })} className={`p-4 border-2 rounded-lg capitalize transition-all text-sm font-medium ${appearanceSettings.theme === theme ? 'border-primary bg-orange-50 text-primary' : 'border-gray-200 hover:border-gray-300 text-gray-700'}`}>
                                                {theme === 'light' ? t('themeLight') : theme === 'dark' ? t('themeDark') : t('themeAuto')}
                                                {appearanceSettings.theme === theme && <Check className="w-4 h-4 mx-auto mt-2" />}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">{t('fontSize')}</label>
                                    <select value={appearanceSettings.font_size} onChange={e => setAppearanceSettings({ ...appearanceSettings, font_size: e.target.value })} className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary">
                                        <option value="small">{t('small')}</option>
                                        <option value="medium">{t('medium')}</option>
                                        <option value="large">{t('large')}</option>
                                    </select>
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-3">{t('primaryColor')}</label>
                                    <p className="text-xs text-gray-500 mb-4">{t('chooseYourPreferredAccentColorForButtonsLinksAndHighlights')}</p>
                                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                                        {[
                                            { value: 'orange', color: '#F39C12', name: t('colorOrange') },
                                            { value: 'blue', color: '#3498DB', name: t('colorBlue') },
                                            { value: 'green', color: '#2ECC71', name: t('colorGreen') },
                                            { value: 'purple', color: '#9B59B6', name: t('colorPurple') },
                                            { value: 'red', color: '#E74C3C', name: t('colorRed') },
                                            { value: 'teal', color: '#1ABC9C', name: t('colorTeal') },
                                            { value: 'indigo', color: '#34495E', name: t('colorIndigo') },
                                            { value: 'pink', color: '#EC7063', name: t('colorPink') }
                                        ].map(scheme => (
                                            <button key={scheme.value} type="button" onClick={() => { const s = { ...appearanceSettings, color_scheme: scheme.value }; setAppearanceSettings(s); handleSaveSettings('Appearance', s); }} className={`p-3 border-2 rounded-lg transition-all hover:scale-105 ${appearanceSettings.color_scheme === scheme.value ? 'border-gray-900 shadow-md' : 'border-gray-200 hover:border-gray-400'}`}>
                                                <div className="w-12 h-12 rounded-full mx-auto mb-2 shadow-inner border-2 border-white" style={{ backgroundColor: scheme.color }}></div>
                                                <p className="text-xs font-semibold text-gray-900">{scheme.name}</p>
                                                {appearanceSettings.color_scheme === scheme.value && <div className="mt-1"><Check className="w-4 h-4 mx-auto text-gray-900" /></div>}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                <div>
                                    <label className="flex items-start justify-between p-3 bg-gray-50 rounded-lg cursor-pointer hover:bg-gray-100 transition-colors">
                                        <div className="flex-1 pr-4">
                                            <span className="text-sm text-gray-700 block">{t('compactMode')}</span>
                                            <span className="text-xs text-gray-500">{t('reduceSpacingForMoreContent')}</span>
                                        </div>
                                        <input type="checkbox" checked={appearanceSettings.compact_mode} onChange={e => setAppearanceSettings({ ...appearanceSettings, compact_mode: e.target.checked })} className="w-4 h-4 text-primary rounded focus:ring-primary mt-0.5" />
                                    </label>
                                </div>

                                <div className="pt-4 border-t border-gray-200">
                                    <button onClick={() => handleSaveSettings('Appearance', appearanceSettings)} disabled={loading} className="flex items-center gap-2 px-6 py-2 bg-primary text-white rounded-lg hover:bg-primary-hover transition-colors font-medium disabled:opacity-50">
                                        {loading ? <><Loader2 className="w-4 h-4 animate-spin" />{t('saving')}</> : <><Save className="w-4 h-4" />{t('saveChanges')}</>}
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Notifications Tab */}
                    {activeTab === 'notifications' && (
                        <div className="max-w-2xl">
                            <h2 className="text-lg font-semibold text-gray-900 mb-6">{t('notificationSettings')}</h2>
                            <div className="space-y-6">
                                <div>
                                    <h3 className="text-sm font-semibold text-gray-900 mb-3">{t('notificationChannels')}</h3>
                                    <div className="space-y-2">
                                        {[
                                            { key: 'push_enabled', label: t('notifyPush'), desc: t('notifyPushDescription') },
                                            { key: 'email_enabled', label: t('notifyEmail'), desc: t('notifyEmailDescription') },
                                            { key: 'sms_enabled', label: t('notifySms'), desc: t('notifySmsDescription') }
                                        ].map(item => (
                                            <label key={item.key} className="flex items-start justify-between p-3 bg-gray-50 rounded-lg cursor-pointer hover:bg-gray-100 transition-colors">
                                                <div className="flex-1 pr-4">
                                                    <span className="text-sm text-gray-700 block">{item.label}</span>
                                                    <span className="text-xs text-gray-500">{item.desc}</span>
                                                </div>
                                                <input type="checkbox" checked={notifSettings[item.key as keyof typeof notifSettings] as boolean} onChange={e => setNotifSettings({ ...notifSettings, [item.key]: e.target.checked })} className="w-4 h-4 text-primary rounded focus:ring-primary mt-0.5" />
                                            </label>
                                        ))}
                                    </div>
                                </div>

                                <div>
                                    <h3 className="text-sm font-semibold text-gray-900 mb-3">{t('notificationTypes')}</h3>
                                    <div className="space-y-2">
                                        {[
                                            { key: 'lesson_reminders', label: t('notifyTypeLessonReminders') },
                                            { key: 'payment_alerts', label: t('notifyTypePaymentAlerts') },
                                            { key: 'new_messages', label: t('notifyTypeNewMessages') },
                                            { key: 'student_updates', label: t('notifyTypeStudentUpdates') }
                                        ].map(item => (
                                            <label key={item.key} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg cursor-pointer hover:bg-gray-100 transition-colors">
                                                <span className="text-sm text-gray-700">{item.label}</span>
                                                <input type="checkbox" checked={notifSettings[item.key as keyof typeof notifSettings] as boolean} onChange={e => setNotifSettings({ ...notifSettings, [item.key]: e.target.checked })} className="w-4 h-4 text-primary rounded focus:ring-primary" />
                                            </label>
                                        ))}
                                    </div>
                                </div>

                                <div>
                                    <h3 className="text-sm font-semibold text-gray-900 mb-3">{t('quietHours')}</h3>
                                    <label className="flex items-center justify-between p-3 bg-gray-50 rounded-lg cursor-pointer hover:bg-gray-100 transition-colors mb-3">
                                        <span className="text-sm text-gray-700">{t('enableQuietHours')}</span>
                                        <input type="checkbox" checked={notifSettings.quiet_hours_enabled} onChange={e => setNotifSettings({ ...notifSettings, quiet_hours_enabled: e.target.checked })} className="w-4 h-4 text-primary rounded focus:ring-primary" />
                                    </label>
                                    {notifSettings.quiet_hours_enabled && (
                                        <div className="grid grid-cols-2 gap-4 pl-4">
                                            <div>
                                                <label className="block text-xs font-medium text-gray-700 mb-1">{t('startTime')}</label>
                                                <input type="time" value={notifSettings.quiet_start} onChange={e => setNotifSettings({ ...notifSettings, quiet_start: e.target.value })} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" />
                                            </div>
                                            <div>
                                                <label className="block text-xs font-medium text-gray-700 mb-1">{t('endTime')}</label>
                                                <input type="time" value={notifSettings.quiet_end} onChange={e => setNotifSettings({ ...notifSettings, quiet_end: e.target.value })} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" />
                                            </div>
                                        </div>
                                    )}
                                </div>

                                <div className="pt-4 border-t border-gray-200">
                                    <button onClick={() => handleSaveSettings('Notifications', notifSettings)} disabled={loading} className="flex items-center gap-2 px-6 py-2 bg-primary text-white rounded-lg hover:bg-primary-hover transition-colors font-medium disabled:opacity-50">
                                        {loading ? <><Loader2 className="w-4 h-4 animate-spin" />{t('saving')}</> : <><Save className="w-4 h-4" />{t('saveChanges')}</>}
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Technical Tab (Admin only) */}
                    {activeTab === 'technical' && currentUser?.role === 'admin' && (
                        <div className="max-w-3xl">
                            <h2 className="text-lg font-semibold text-gray-900 mb-6">{t('serverTechnicalSettings')}</h2>
                            <div className="space-y-8">
                                <div>
                                    <div className="flex items-center gap-2 mb-4">
                                        <Mail className="w-5 h-5 text-gray-600" />
                                        <h3 className="font-semibold text-gray-900">{t('smtpConfiguration')}</h3>
                                    </div>
                                    <div className="space-y-4 bg-gray-50 p-4 rounded-lg">
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                            <div>
                                                <label className="block text-xs font-medium text-gray-700 mb-1">{t('smtpHost')}</label>
                                                <input type="text" value={technicalSettings.smtp_host} onChange={e => setTechnicalSettings({ ...technicalSettings, smtp_host: e.target.value })} placeholder="smtp.gmail.com" className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" />
                                            </div>
                                            <div>
                                                <label className="block text-xs font-medium text-gray-700 mb-1">{t('port')}</label>
                                                <select value={technicalSettings.smtp_port} onChange={e => setTechnicalSettings({ ...technicalSettings, smtp_port: e.target.value })} className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary">
                                                    <option value="25">25 (Standard)</option>
                                                    <option value="465">465 (SSL)</option>
                                                    <option value="587">587 (TLS)</option>
                                                    <option value="2525">2525</option>
                                                </select>
                                            </div>
                                        </div>
                                        <div>
                                            <label className="block text-xs font-medium text-gray-700 mb-1">{t('usernameEmail')}</label>
                                            <input type="text" value={technicalSettings.smtp_username} onChange={e => setTechnicalSettings({ ...technicalSettings, smtp_username: e.target.value })} placeholder="your-email@gmail.com" className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-medium text-gray-700 mb-1">{t('password')}</label>
                                            <div className="relative">
                                                <input type={showSmtpPassword ? 'text' : 'password'} value={smtpPasswordEditing || technicalSettings.smtp_password ? technicalSettings.smtp_password : currentUser?.preferences?.technical?.smtp_password_set ? '••••••••' : ''} onFocus={() => setSmtpPasswordEditing(true)} onBlur={() => { if (!technicalSettings.smtp_password) setSmtpPasswordEditing(false) }} onChange={e => setTechnicalSettings({ ...technicalSettings, smtp_password: e.target.value })} autoComplete="new-password" placeholder={currentUser?.preferences?.technical?.smtp_password_set ? '' : t('password')} className="w-full px-3 py-2 pr-10 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" />
                                                <p className="text-xs text-gray-500 mt-1">{t('leaveBlankToKeepTheSavedPasswordItIsNotSentBackByTheAPI')}</p>
                                                <button type="button" onClick={() => setShowSmtpPassword(!showSmtpPassword)} disabled={!technicalSettings.smtp_password} title={technicalSettings.smtp_password ? undefined : 'Gespeicherte Passwörter werden nicht ausgelesen'} className="absolute right-3 top-2.5 text-gray-500 disabled:opacity-40">
                                                    {showSmtpPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                                </button>
                                            </div>
                                            <p className="text-xs text-gray-500 mt-1">{t('detailForGmailUseAnAppPassword')}</p>
                                        </div>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                            <div>
                                                <label className="block text-xs font-medium text-gray-700 mb-1">{t('detailFromEmail')}</label>
                                                <input type="email" value={technicalSettings.smtp_from_email} onChange={e => setTechnicalSettings({ ...technicalSettings, smtp_from_email: e.target.value })} placeholder="noreply@studio.com" className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" />
                                            </div>
                                            <div>
                                                <label className="block text-xs font-medium text-gray-700 mb-1">{t('detailFromName')}</label>
                                                <input type="text" value={technicalSettings.smtp_from_name} onChange={e => setTechnicalSettings({ ...technicalSettings, smtp_from_name: e.target.value })} placeholder="My Studio" className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" />
                                            </div>
                                        </div>
                                        <label className="flex items-center justify-between p-3 bg-white rounded-lg">
                                            <span className="text-sm text-gray-700">{t('detailUseTLSSTARTTLS')}</span>
                                            <input type="checkbox" checked={technicalSettings.smtp_use_tls} onChange={e => setTechnicalSettings({ ...technicalSettings, smtp_use_tls: e.target.checked })} className="w-4 h-4 text-primary rounded focus:ring-primary" />
                                        </label>
                                        <div className="pt-2">
                                            <button type="button" onClick={handleTestEmail} disabled={testingEmail} className="w-full flex justify-center items-center gap-2 px-4 py-2 bg-indigo-50 text-indigo-600 rounded-lg hover:bg-indigo-100 transition-colors font-semibold disabled:opacity-50">
                                                {testingEmail ? <><Loader2 className="w-4 h-4 animate-spin" />{t('detailSendingTestEmail')}</> : <><Mail className="w-4 h-4" />{t('detailTestConnection')}</>}
                                            </button>
                                        </div>
                                    </div>
                                </div>

                                <div className="pt-6 border-t border-gray-200">
                                    <div className="flex items-center gap-2 mb-4">
                                        <Mail className="w-5 h-5 text-gray-600" />
                                        <h3 className="font-semibold text-gray-900">IMAP – E-Mail-Empfang</h3>
                                    </div>
                                    <div className="space-y-4 bg-gray-50 p-4 rounded-lg">
                                        <p className="text-xs text-gray-500">
                                            Postfach für den späteren Nachrichten-Client. Der Verbindungstest meldet sich nur an; keine E-Mail wird geöffnet oder verändert.
                                        </p>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                            <div>
                                                <label htmlFor="imap-host" className="block text-xs font-medium text-gray-700 mb-1">IMAP-Server</label>
                                                <input id="imap-host" type="text" autoComplete="off" value={technicalSettings.imap_host}
                                                    onChange={e => setTechnicalSettings({ ...technicalSettings, imap_host: e.target.value })}
                                                    placeholder="mail.manitu.de"
                                                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:border-primary" />
                                            </div>
                                            <div>
                                                <label htmlFor="imap-port" className="block text-xs font-medium text-gray-700 mb-1">Port</label>
                                                <select id="imap-port" value={String(technicalSettings.imap_port)}
                                                    onChange={e => setTechnicalSettings({
                                                        ...technicalSettings, imap_port: e.target.value,
                                                        imap_security: e.target.value === '143' ? 'starttls' : 'ssl',
                                                    })}
                                                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:border-primary">
                                                    <option value="993">993 – SSL/TLS</option>
                                                    <option value="143">143 – STARTTLS</option>
                                                </select>
                                            </div>
                                        </div>
                                        <div>
                                            <label htmlFor="imap-username" className="block text-xs font-medium text-gray-700 mb-1">Benutzername (E-Mail-Adresse)</label>
                                            <input id="imap-username" type="email" autoComplete="username" value={technicalSettings.imap_username}
                                                onChange={e => setTechnicalSettings({ ...technicalSettings, imap_username: e.target.value })}
                                                placeholder="musikunterricht@musart.de"
                                                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:border-primary" />
                                        </div>
                                        <div>
                                            <label htmlFor="imap-password" className="block text-xs font-medium text-gray-700 mb-1">Postfach-Passwort</label>
                                            <div className="relative">
                                                <input id="imap-password" type={showImapPassword ? 'text' : 'password'} autoComplete="new-password"
                                                    value={imapPasswordEditing || technicalSettings.imap_password ? technicalSettings.imap_password : currentUser?.preferences?.technical?.imap_password_set ? '••••••••' : ''}
                                                    onFocus={() => setImapPasswordEditing(true)}
                                                    onBlur={() => { if (!technicalSettings.imap_password) setImapPasswordEditing(false) }}
                                                    onChange={e => setTechnicalSettings({ ...technicalSettings, imap_password: e.target.value })}
                                                    placeholder={currentUser?.preferences?.technical?.imap_password_set ? '' : 'Postfach-Passwort eingeben'}
                                                    className="w-full px-3 py-2 pr-10 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:border-primary" />
                                                <button type="button" onClick={() => setShowImapPassword(!showImapPassword)}
                                                    disabled={!technicalSettings.imap_password}
                                                    title={technicalSettings.imap_password ? undefined : 'Gespeicherte Passwörter werden nicht ausgelesen'}
                                                    aria-label={showImapPassword ? 'Passwort verbergen' : 'Passwort anzeigen'}
                                                    className="absolute right-3 top-2.5 text-gray-500">
                                                    {showImapPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                                </button>
                                            </div>
                                            <p className="text-xs text-gray-500 mt-1">Leer lassen, um das bereits gespeicherte Passwort beizubehalten. Es wird nicht an den Browser zurückgegeben.</p>
                                        </div>
                                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2">
                                            <span className="text-xs text-gray-500">Verschlüsselung: {technicalSettings.imap_security === 'starttls' ? 'STARTTLS' : 'SSL/TLS'} (verpflichtend)</span>
                                            <div className="flex flex-wrap gap-2">
                                                <button type="button" onClick={() => handleSaveSettings('Technical', technicalSettings)} disabled={loading || testingImap}
                                                    className="flex justify-center items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary-hover font-semibold text-sm disabled:opacity-50">
                                                    {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                                                    IMAP-Einstellungen speichern
                                                </button>
                                                <button type="button" onClick={handleTestImap} disabled={testingImap || loading}
                                                    className="flex justify-center items-center gap-2 px-4 py-2 bg-indigo-50 text-indigo-600 rounded-lg hover:bg-indigo-100 font-semibold text-sm disabled:opacity-50">
                                                    {testingImap ? <Loader2 className="w-4 h-4 animate-spin" /> : <Server className="w-4 h-4" />}
                                                    {testingImap ? 'IMAP-Verbindung wird geprüft …' : 'IMAP-Verbindung testen'}
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <div className="pt-4 border-t border-gray-200">
                                    <button onClick={() => handleSaveSettings('Technical', technicalSettings)} disabled={loading} className="flex items-center gap-2 px-6 py-2 bg-primary text-white rounded-lg hover:bg-primary-hover transition-colors font-medium disabled:opacity-50">
                                        {loading ? <><Loader2 className="w-4 h-4 animate-spin" />{t('saving')}</> : <><Save className="w-4 h-4" />{t('detailSaveSettings')}</>}
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Maintenance Tab (Admin only) */}
                    {activeTab === 'maintenance' && currentUser?.role === 'admin' && (
                        <div className="max-w-3xl">
                            <h2 className="text-lg font-semibold text-gray-900 mb-6">{t('detailSystemMaintenanceMigration')}</h2>
                            <div className="space-y-8">
                                <div className="p-6 bg-blue-50 rounded-2xl border border-blue-100">
                                    <div className="flex items-start gap-4">
                                        <div className="p-3 bg-blue-100 rounded-xl text-blue-600"><Download className="w-6 h-6" /></div>
                                        <div className="flex-1">
                                            <h3 className="text-lg font-bold text-blue-900 mb-1">{t('detailExportSystemData')}</h3>
                                            <p className="text-sm text-blue-700 mb-4">{t('detailDownloadACompleteBackupOfYourStudioIncludingAllDatabaseRecordsAndUploadedMediaFiles')}</p>
                                            <button onClick={handleExportSystem} disabled={isExporting} className="flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 transition-all disabled:opacity-50 shadow-md shadow-blue-200">
                                                {isExporting ? <><Loader2 className="w-5 h-5 animate-spin" />{t('detailPreparingExport')}</> : <><Download className="w-5 h-5" />{t('detailDownloadMigrationBundleZip')}</>}
                                            </button>
                                        </div>
                                    </div>
                                </div>

                                <div className="p-6 bg-orange-50 rounded-2xl border border-orange-100">
                                    <div className="flex items-start gap-4">
                                        <div className="p-3 bg-orange-100 rounded-xl text-orange-600"><Upload className="w-6 h-6" /></div>
                                        <div className="flex-1">
                                            <h3 className="text-lg font-bold text-orange-900 mb-1">{t('detailImportSystemData')}</h3>
                                            <p className="text-sm text-orange-700 mb-2">{t('detailRestoreYourStudioFromAPreviouslyExportedMigrationBundle')}</p>
                                            <div className="flex items-center gap-2 mb-4 p-3 bg-white/50 rounded-lg border border-orange-200">
                                                <ShieldAlert className="w-5 h-5 text-orange-600 shrink-0" />
                                                <p className="text-xs font-bold text-orange-800">{t('detailCRITICALThisWillOverwriteALLExistingDataThisActionCannotBeUndone')}</p>
                                            </div>
                                            <label className={`inline-flex items-center gap-2 px-6 py-3 bg-orange-600 text-white rounded-xl font-bold hover:bg-orange-700 transition-all cursor-pointer shadow-md shadow-orange-200 ${isImporting ? 'opacity-50 pointer-events-none' : ''}`}>
                                                {isImporting ? <><Loader2 className="w-5 h-5 animate-spin" />{t('detailRestoringSystem')}</> : <><Upload className="w-5 h-5" />{t('detailSelectBackupFileZip')}</>}
                                                <input type="file" accept=".zip" onChange={handleImportSystem} className="hidden" disabled={isImporting} />
                                            </label>
                                        </div>
                                    </div>
                                </div>

                                <div className="p-6 bg-gray-50 rounded-2xl border border-gray-200">
                                    <h3 className="font-bold text-gray-900 mb-4 flex items-center gap-2">
                                        <Server className="w-5 h-5" />
                                        {t('detailHowToMigrateToANewHost')}
                                    </h3>
                                    <ol className="space-y-3 text-sm text-gray-600 list-decimal pl-4">
                                        <li><strong>{t('detailOnYourCurrentMachine')}</strong> {t('detailDownloadTheMigrationBundleUsingTheButtonAbove')}</li>
                                        <li><strong>{t('detailOnYourNewVPS')}</strong> {t('detailInstallStudioSyncAndRunTheInitialSetupWizard')}</li>
                                        <li><strong>{t('detailInTheNewInstance')}</strong> {t('detailGoToSettingsGtMaintenanceAndUploadTheMigrationBundle')}</li>
                                        <li><strong>{t('detailVerify')}</strong> {t('detailCheckThatYourStudentsLessonsAndMediaAreAllPresent')}</li>
                                    </ol>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}
