'use client'

import MailWorkspace from '@/components/mail/MailWorkspace'
import './mail.css'

// First release: interface preview with clearly labelled sample messages.
// Keep the legacy ChatProvider/MessagingCenter source files untouched until
// the IMAP/SMTP mail replacement has been completed and verified.
export default function MessagesPage() {
    return <MailWorkspace />
}
