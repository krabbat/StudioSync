'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useUser, UserRole } from '@/contexts/UserContext'
import { useFeatureFlags } from '@/hooks/useFeatureFlags'
import { FeatureFlags } from '@/types/setup'
import {
    LayoutDashboard,
    Users,
    UserCheck,
    Calendar,
    BookOpen,
    CreditCard,
    Library,
    MessageSquare,
    Bell,
    Target,
    BarChart3,
    Palette,
    Mail,
    Server,
    Database,
    Key,
    Layers,
    ShieldAlert,
    Building2,
    UserCog,
    UserRound,
    Package,
    FileText,
    Music,
    PanelLeftClose,
    PanelLeftOpen,
    MapPin,
} from 'lucide-react'
import { useNotifications } from '@/hooks/useNotifications'
import { useTranslations } from 'next-intl'

// ─── Design tokens ───────────────────────────────────────────────────────────
const S = {
    bg: 'var(--dashboard-sidebar-background)',
    border: 'var(--dashboard-sidebar-border)',
    amber: 'var(--dashboard-sidebar-accent)',
    amberBg: 'var(--dashboard-sidebar-accent-soft)',
    text: 'var(--dashboard-sidebar-text)',
    muted: 'var(--dashboard-sidebar-muted)',
    hoverBg: 'var(--dashboard-sidebar-hover)',
    badgeBg: 'var(--dashboard-sidebar-badge)',
} as const

interface SidebarItem {
    name: string
    href: string
    icon: any
    badge?: string | number
    roles?: UserRole[]
    featureFlag?: keyof FeatureFlags
}

interface SidebarSection {
    title?: string
    items: SidebarItem[]
    roles?: UserRole[]
}

interface SidebarProps {
    isOpen: boolean
    onClose: () => void
    onOpen: () => void
}

export default function Sidebar({ isOpen, onClose, onOpen }: SidebarProps) {
    const t = useTranslations('Sidebar')
    const tSettings = useTranslations('SettingsHub')
    const pathname = usePathname()
    const [activeSettingsTab, setActiveSettingsTab] = useState('')
    useEffect(() => {
        const updateTab = () => setActiveSettingsTab(new URLSearchParams(window.location.search).get('tab') || '')
        updateTab()
        window.addEventListener('popstate', updateTab)
        return () => window.removeEventListener('popstate', updateTab)
    }, [pathname])
    const { currentUser } = useUser()
    const { flags } = useFeatureFlags()
    const { unreadCount } = useNotifications(60000)
    const sidebarRef = useRef<HTMLElement>(null)

    useEffect(() => {
        onClose()
    }, [pathname, onClose])

    // The rail always remains mounted; avoid scroll locking, backdrops, and
    // mounting animations that formerly caused the content pane to flicker.
    useEffect(() => {
        if (!isOpen) return
        const closeOutside = (event: PointerEvent) => {
            if (event.target instanceof Node && !sidebarRef.current?.contains(event.target)) onClose()
        }
        document.addEventListener('pointerdown', closeOutside)
        return () => document.removeEventListener('pointerdown', closeOutside)
    }, [isOpen, onClose])

    useEffect(() => {
        const handleEscape = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && isOpen) onClose()
        }
        window.addEventListener('keydown', handleEscape)
        return () => window.removeEventListener('keydown', handleEscape)
    }, [isOpen, onClose])

    const sections: SidebarSection[] = [
        {
            title: t('overview'),
            items: [
                { name: t('dashboard'), href: '/dashboard', icon: LayoutDashboard, roles: ['admin', 'teacher', 'student'] },
                { name: t('myAccount'), href: '/dashboard/my-account', icon: UserRound, roles: ['student'] },
                { name: t('studio'), href: '/dashboard/studios', icon: Building2, roles: ['admin', 'teacher', 'student'] },
            ],
        },
        {
            title: t('management'),
            items: [
                { name: t('students'), href: '/dashboard/students', icon: Users, roles: ['admin', 'teacher'] },
                { name: t('bands'), href: '/dashboard/bands', icon: Music, roles: ['admin', 'teacher', 'student'], featureFlag: 'bands_enabled' },
                { name: t('gigs'), href: '/dashboard/gigs', icon: MapPin, roles: ['admin', 'teacher', 'student'], featureFlag: 'gigs_enabled' },
                { name: t('instructors'), href: '/dashboard/teachers', icon: UserCheck, roles: ['admin'], featureFlag: 'teachers_enabled' },
                { name: t('schedule'), href: '/dashboard/schedule', icon: Calendar, roles: ['admin', 'teacher', 'student'] },
                { name: t('lessons'), href: '/dashboard/lessons', icon: BookOpen, roles: ['admin', 'teacher', 'student'] },
                { name: t('billing'), href: '/dashboard/billing', icon: CreditCard, roles: ['admin', 'teacher', 'student'], featureFlag: 'billing_enabled' },
            ],
        },
        {
            title: t('tools'),
            items: [
                { name: t('resources'), href: '/dashboard/resources', icon: Library, roles: ['admin', 'teacher', 'student'], featureFlag: 'resources_enabled' },
                { name: t('messages'), href: '/dashboard/messages', icon: MessageSquare, roles: ['admin', 'teacher', 'student'], featureFlag: 'messaging_enabled' },
                { name: t('notifications'), href: '/dashboard/notifications', icon: Bell, badge: unreadCount > 0 ? unreadCount : undefined, roles: ['admin', 'teacher', 'student'] },
                { name: t('goals'), href: '/dashboard/goals', icon: Target, roles: ['admin', 'teacher', 'student'], featureFlag: 'goals_enabled' },
                { name: t('inventory'), href: '/dashboard/inventory', icon: Package, roles: ['admin', 'teacher'], featureFlag: 'inventory_enabled' },
                { name: t('reports'), href: '/dashboard/reports', icon: BarChart3, roles: ['admin'], featureFlag: 'analytics_enabled' },
            ],
        },
        {
            title: t('admin'),
            roles: ['admin'],
            items: [
                { name: t('users'), href: '/dashboard/users', icon: UserCog, roles: ['admin'] },
                { name: tSettings('sectionAccount'), href: '/dashboard/settings/general/?tab=profile', icon: UserRound, roles: ['admin'] },
                { name: tSettings('sectionSecurity'), href: '/dashboard/settings/general/?tab=security', icon: ShieldAlert, roles: ['admin'] },
                { name: tSettings('sectionStudio'), href: '/dashboard/settings/general/?tab=studio', icon: Building2, roles: ['admin'] },
                { name: tSettings('sectionAppearance'), href: '/dashboard/settings/general/?tab=appearance', icon: Palette, roles: ['admin'] },
                { name: tSettings('sectionNotifications'), href: '/dashboard/settings/general/?tab=notifications', icon: Bell, roles: ['admin'] },
                { name: tSettings('sectionCommunication'), href: '/dashboard/settings/general/?tab=communication', icon: Mail, roles: ['admin'] },
                { name: tSettings('sectionFeatures'), href: '/dashboard/features/', icon: Layers, roles: ['admin'] },
                { name: tSettings('sectionApiKeys'), href: '/dashboard/settings/api-keys/', icon: Key, roles: ['admin'] },
                { name: tSettings('sectionGigVenues'), href: '/dashboard/settings/gig-venues/', icon: MapPin, roles: ['admin'], featureFlag: 'gigs_enabled' },
                { name: tSettings('sectionTechnical'), href: '/dashboard/settings/general/?tab=technical', icon: Server, roles: ['admin'] },
                { name: tSettings('sectionMaintenance'), href: '/dashboard/settings/general/?tab=maintenance', icon: Database, roles: ['admin'] },
            ],
        },
        {
            title: t('help'),
            items: [
                { name: t('documentation'), href: '/docs', icon: FileText, roles: ['admin', 'teacher', 'student'], featureFlag: 'documentation_enabled' },
            ],
        },
    ]

    const isActive = (href: string) => {
        const [hrefPath, query] = href.split('?')
        const normalizedPath = (pathname || '').replace(/\/+$/, '')
        const normalizedHref = hrefPath.replace(/\/+$/, '')
        if (query) {
            return normalizedPath === normalizedHref
                && new URLSearchParams(query).get('tab') === activeSettingsTab
        }
        if (normalizedHref === '/dashboard') return normalizedPath === normalizedHref
        return normalizedPath === normalizedHref || normalizedPath.startsWith(normalizedHref + '/')
    }


    const toggleNavigation = () => {
        if (isOpen) onClose()
        else onOpen()
    }

    return (
        <aside
            ref={sidebarRef}
            className={`studiosync-sidebar ${isOpen ? 'is-expanded' : 'is-collapsed'}`}
            aria-label="StudioSync-Hauptnavigation"
            style={{ backgroundColor: S.bg }}
        >
            <div className="studiosync-sidebar-header">
                <button
                    type="button"
                    className="studiosync-sidebar-toggle"
                    onClick={toggleNavigation}
                    title={isOpen ? 'Menü einklappen' : 'Menü aufklappen'}
                    aria-label={isOpen ? 'StudioSync-Menü einklappen' : 'StudioSync-Menü aufklappen'}
                    aria-expanded={isOpen}
                >
                    {isOpen ? <PanelLeftClose size={21} /> : <PanelLeftOpen size={21} />}
                </button>
                <span className="studiosync-sidebar-label studiosync-sidebar-brand">StudioSync</span>
            </div>

            <nav className="studiosync-sidebar-nav" aria-label="Hauptmenü">
                {sections.map((section, sectionIdx) => {
                    if (section.roles && (!currentUser || !section.roles.includes(currentUser.role))) return null
                    const items = section.items.filter((item) => {
                        if (item.roles && (!currentUser || !item.roles.includes(currentUser.role))) return false
                        return !item.featureFlag || flags[item.featureFlag]
                    })
                    if (items.length === 0) return null

                    return (
                        <div className="studiosync-sidebar-section" key={sectionIdx}>
                            {section.title && (
                                <div className="studiosync-sidebar-section-title studiosync-sidebar-label">
                                    {section.title}
                                </div>
                            )}
                            {items.map((item) => {
                                const active = isActive(item.href)
                                const Icon = item.icon
                                const content = (
                                    <>
                                        <span className="studiosync-sidebar-icon">
                                            <Icon size={19} style={{ color: active ? S.amber : S.muted }} />
                                        </span>
                                        <span className="studiosync-sidebar-label studiosync-sidebar-item-name">{item.name}</span>
                                        {item.badge !== undefined && (
                                            <span className="studiosync-sidebar-label studiosync-sidebar-badge">{item.badge}</span>
                                        )}
                                    </>
                                )
                                return item.href.startsWith('http') ? (
                                    <a key={item.href} href={item.href} target="_blank" rel="noopener noreferrer"
                                        title={!isOpen ? item.name : undefined}
                                        className={`studiosync-sidebar-item ${active ? 'is-active' : ''}`}>
                                        {content}
                                    </a>
                                ) : (
                                    <Link key={item.href} href={item.href}
                                        onClick={() => {
                                            if (item.href.includes('?tab=')) {
                                                setActiveSettingsTab(new URLSearchParams(item.href.split('?')[1]).get('tab') || '')
                                            }
                                            onClose()
                                        }}
                                        title={!isOpen ? item.name : undefined}
                                        aria-current={active ? 'page' : undefined}
                                        className={`studiosync-sidebar-item ${active ? 'is-active' : ''}`}>
                                        {content}
                                    </Link>
                                )
                            })}
                        </div>
                    )
                })}
            </nav>
        </aside>
    )
}
