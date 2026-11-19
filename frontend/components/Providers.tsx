'use client'

import { ReactNode } from 'react'
import { UserProvider } from '@/contexts/UserContext'
import { FeatureFlagProvider } from '@/contexts/FeatureFlagContext'
import { Toaster } from 'react-hot-toast'

/**
 * Combined providers component for the application.
 * Wraps the app with all necessary context providers.
 */
export function Providers({ children }: { children: ReactNode }) {
    return (
        <UserProvider>
            <FeatureFlagProvider>
                {children}
                <Toaster
                    position="top-right"
                    containerStyle={{ zIndex: 100000 }}
                    toastOptions={{
                        duration: 5000,
                        style: {
                            background: 'hsl(var(--card))',
                            color: 'hsl(var(--card-foreground))',
                            border: '1px solid hsl(var(--border))',
                            padding: '14px 18px',
                            maxWidth: '450px',
                            fontSize: '14px',
                            fontWeight: 600,
                        },
                        success: { duration: 5000 },
                        error: { duration: 7500 },
                    }}
                />
            </FeatureFlagProvider>
        </UserProvider>
    )
}
