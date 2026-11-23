'use client'

import { useState, useCallback } from 'react'
import { usePathname } from 'next/navigation'
import Sidebar from '@/components/Sidebar'
import DashboardHeader from '@/components/DashboardHeader'
import AuthGuard from '@/components/auth/AuthGuard'
import { ThemeProvider } from '@/components/ThemeProvider'
import { AppearanceProvider } from '@/contexts/AppearanceContext'
import { CommandPalette } from '@/components/CommandPalette'
import ColorSchemeProvider from '@/components/ColorSchemeProvider'
import { NotificationsProvider } from '@/contexts/NotificationsContext'
import UpdateBanner from '@/components/UpdateBanner'

export default function DashboardLayout({
    children,
}: {
    children: React.ReactNode
}) {
    const [isSidebarOpen, setIsSidebarOpen] = useState(false)
    const pathname = usePathname()
    const isMailPage = pathname === '/dashboard/messages'

    const handleCloseSidebar = useCallback(() => {
        setIsSidebarOpen(false)
    }, [])

    const handleOpenSidebar = useCallback(() => {
        setIsSidebarOpen(true)
    }, [])

    return (
        <AuthGuard>
            <ThemeProvider>
                <AppearanceProvider>
                    <ColorSchemeProvider>
                        <NotificationsProvider>
                            <div className="dashboard-shell flex h-[100dvh] w-full overflow-hidden">
                                {/* The navigation is an overlay on every screen size. */}
                                <Sidebar isOpen={isSidebarOpen} onClose={handleCloseSidebar} onOpen={handleOpenSidebar} />

                                <div className="dashboard-content-column flex min-w-0 flex-1 flex-col overflow-hidden">
                                    <DashboardHeader compact={isMailPage} />
                                    <UpdateBanner />
                                    <main className={isMailPage
                                        ? 'dashboard-mail-main min-h-0 min-w-0 flex-1 overflow-hidden'
                                        : 'dashboard-main min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto'}>
                                        {children}
                                    </main>
                                </div>

                                <CommandPalette />
                            </div>
                        </NotificationsProvider>
                    </ColorSchemeProvider>
                </AppearanceProvider>
            </ThemeProvider>
        </AuthGuard>
    )
}
