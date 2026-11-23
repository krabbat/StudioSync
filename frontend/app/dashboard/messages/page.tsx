'use client'

import MailWorkspace from '@/components/mail/MailWorkspace'
import { ChatProvider } from '@/components/messaging/ChatProvider'
import { MessagingCenter } from '@/components/messaging/MessagingCenter'
import { useUser } from '@/contexts/UserContext'
import './mail.css'

// Admins preview the new mail surface. The previous chat implementation remains
// available to other roles until the mail replacement is fully functional.
export default function MessagesPage() {
    const { currentUser } = useUser()
    if (!currentUser) return null
    if (currentUser.role !== 'admin') {
        return (
            <ChatProvider>
                <MessagingCenter />
            </ChatProvider>
        )
    }
    return <MailWorkspace />
}
