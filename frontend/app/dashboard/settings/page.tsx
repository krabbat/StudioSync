'use client';

import { useTranslations } from 'next-intl'
import Link from 'next/link';
import { useUser } from '@/contexts/UserContext';
import {
    User,
    Building2,
    Palette,
    Bell,
    Mail,
    Server,
    Database,
    Key,
    ChevronRight,
    Layers,
    ShieldAlert,
    MapPin,
} from 'lucide-react';



export default function SettingsHubPage() {
    const tr = useTranslations('SettingsHub')
const SECTIONS = [
    {
        title: tr('sectionAccount'),
        description: tr('sectionAccountDescription'),
        icon: User,
        href: '/dashboard/settings/general/?tab=profile',
        roles: ['admin', 'teacher', 'student', 'parent'],
    },
    {
        title: tr('sectionSecurity'),
        description: tr('sectionSecurityDescription'),
        icon: ShieldAlert,
        href: '/dashboard/settings/general/?tab=security',
        roles: ['admin', 'teacher', 'student', 'parent'],
    },
    {
        title: tr('sectionStudio'),
        description: tr('sectionStudioDescription'),
        icon: Building2,
        href: '/dashboard/settings/general/?tab=studio',
        roles: ['admin'],
    },
    {
        title: tr('sectionAppearance'),
        description: tr('sectionAppearanceDescription'),
        icon: Palette,
        href: '/dashboard/settings/general/?tab=appearance',
        roles: ['admin', 'teacher', 'student', 'parent'],
    },
    {
        title: tr('sectionNotifications'),
        description: tr('sectionNotificationsDescription'),
        icon: Bell,
        href: '/dashboard/settings/general/?tab=notifications',
        roles: ['admin', 'teacher', 'student', 'parent'],
    },
    {
        title: tr('sectionCommunication'),
        description: tr('sectionCommunicationDescription'),
        icon: Mail,
        href: '/dashboard/settings/general/?tab=communication',
        roles: ['admin', 'teacher', 'student', 'parent'],
    },
    {
        title: tr('sectionFeatures'),
        description: tr('sectionFeaturesDescription'),
        icon: Layers,
        href: '/dashboard/settings/features/',
        roles: ['admin'],
    },
    {
        title: tr('sectionApiKeys'),
        description: tr('sectionApiKeysDescription'),
        icon: Key,
        href: '/dashboard/settings/api-keys/',
        roles: ['admin'],
    },
    {
        title: tr('sectionGigVenues'),
        description: tr('sectionGigVenuesDescription'),
        icon: MapPin,
        href: '/dashboard/settings/gig-venues/',
        roles: ['admin'],
    },
    {
        title: tr('sectionTechnical'),
        description: tr('sectionTechnicalDescription'),
        icon: Server,
        href: '/dashboard/settings/general/?tab=technical',
        roles: ['admin'],
    },
    {
        title: tr('sectionMaintenance'),
        description: tr('sectionMaintenanceDescription'),
        icon: Database,
        href: '/dashboard/settings/general/?tab=maintenance',
        roles: ['admin'],
    },
];

    const { currentUser } = useUser();

    const visible = SECTIONS.filter(
        s => !s.roles || (currentUser && s.roles.includes(currentUser.role as string))
    );

    return (
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 pb-12 animate-in fade-in slide-in-from-bottom-4 duration-700">
            <header className="pt-8 pb-8">
                <h1 className="text-3xl font-black text-gray-900 tracking-tight">{tr('settings')}</h1>
                <p className="text-gray-500 mt-1 font-medium">{tr('manageYourAccountStudioAndIntegrations')}</p>
            </header>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {visible.map(section => {
                    const Icon = section.icon;
                    return (
                        <Link
                            key={section.href}
                            href={section.href}
                            className="group flex items-start gap-4 p-5 bg-white border border-gray-100 rounded-2xl shadow-sm hover:shadow-md hover:border-primary/20 transition-all duration-150"
                        >
                            <div className="p-2.5 bg-primary/10 rounded-xl shrink-0 group-hover:bg-primary/15 transition-colors">
                                <Icon className="w-5 h-5 text-primary" />
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="font-bold text-gray-900 text-sm">{section.title}</p>
                                <p className="text-xs text-gray-500 mt-0.5 leading-snug">{section.description}</p>
                            </div>
                            <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-primary transition-colors mt-0.5 shrink-0" />
                        </Link>
                    );
                })}
            </div>
        </div>
    );
}
