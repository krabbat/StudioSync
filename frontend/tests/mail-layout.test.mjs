import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8')

test('mail screen is the two-pane workspace, preserving the old chat for other roles', () => {
    const page = source('app/dashboard/messages/page.tsx')
    assert.match(page, /<MailWorkspace\s*\/>/)
    assert.match(page, /currentUser\.role !== 'admin'/)
    assert.match(page, /<MessagingCenter\s*\/>/)
})

test('sidebar is a stable icon rail with an expanding overlay and no scroll locking', () => {
    const layout = source('app/dashboard/layout.tsx')
    const sidebar = source('components/Sidebar.tsx')
    const css = source('app/globals.css')
    assert.doesNotMatch(layout, /md:ml-64/)
    assert.match(layout, /dashboard-content-column/)
    assert.match(sidebar, /studiosync-sidebar.*is-expanded.*is-collapsed/)
    assert.match(sidebar, /studiosync-sidebar-icon/)
    assert.doesNotMatch(sidebar, /document\.body\.style\.overflow/)
    assert.doesNotMatch(sidebar, /AnimatePresence|motion\.aside/)
    assert.match(css, /--dashboard-sidebar-rail-width:\s*60px/)
    assert.match(css, /--dashboard-sidebar-expanded-width/)
    assert.match(css, /\.dashboard-content-column\s*\{\s*padding-left:/)
    assert.match(layout, /compact=\{isMailPage\}/)
})

test('mail page splits the list and reader with movable divider', () => {
    const jsx = source('components/mail/MailWorkspace.tsx')
    const css = source('app/dashboard/messages/mail.css')
    assert.match(jsx, /role="separator"/)
    assert.match(jsx, /onPointerDown=\{startResizing\}/)
    assert.match(css, /grid-template-columns:\s*minmax\(var\(--mail-min-list-width\), var\(--mail-list-width\)\)/)
})

test('mail design uses shared template tokens instead of a separate theme', () => {
    const globals = source('app/globals.css')
    const css = source('app/dashboard/messages/mail.css')
    for (const token of [
        '--mail-list-width', '--mail-page-background', '--mail-panel-background',
        '--mail-border-color', '--mail-panel-shadow', '--dashboard-content-gap',
    ]) assert.ok(globals.includes(token), token)
    assert.match(css, /var\(--mail-panel-background\)/)
})

test('real inbox is requested from IMAP and has a working refresh button', () => {
    const jsx = source('components/mail/MailWorkspace.tsx')
    assert.doesNotMatch(jsx, /SAMPLE_MESSAGES|example\.invalid|Vorschau · Beispieldaten/)
    assert.match(jsx, /api\.get<InboxPage>/)
    assert.match(jsx, /\/core\/mail\/folders\/\$\{currentFolder\}/)
    assert.match(jsx, /api\.get<InboxApiMessage & \{ body: string \}>/)
    assert.match(jsx, /aria-label="Mails abrufen"/)
    assert.match(jsx, /void loadFolder\(folder, true\)/)
    assert.match(jsx, /Weitere Nachrichten laden/)
    assert.match(jsx, /uidvalidity/)
    assert.match(jsx, /Noch kein Versand und keine dauerhafte Entwurfsspeicherung/)
    assert.match(jsx, /className="mail-send-button" disabled/)
})


test('selected messages use real IMAP batch actions and stable UIDVALIDITY', () => {
    const jsx = source('components/mail/MailWorkspace.tsx')
    const css = source('app/dashboard/messages/mail.css')
    assert.match(jsx, /selectedMailIds/)
    assert.match(jsx, /checked=\{allVisibleSelected\}/)
    assert.match(jsx, /onChange=\{toggleAllVisible\}/)
    assert.match(jsx, /onChange=\{\(\) => toggleMessageSelection\(message\.id\)\}/)
    assert.match(jsx, /selectedVisibleIds/)
    assert.match(jsx, /runMailAction\('read', selectedVisibleIds\)/)
    assert.match(jsx, /runMailAction\('unread', selectedVisibleIds\)/)
    assert.match(jsx, /runMailAction\('spam', selectedVisibleIds\)/)
    assert.match(jsx, /runMailAction\('archive', selectedVisibleIds\)/)
    assert.match(jsx, /runMailAction\('archive', \[selected\.id\]\)/)
    assert.match(jsx, /runMailAction\('spam', \[selected\.id\]\)/)
    assert.match(jsx, /runMailAction\('delete', selectedVisibleIds\)/)
    assert.match(jsx, /runMailAction\('delete', \[selected\.id\]\)/)
    assert.match(jsx, /runMailAction\('restore', selectedVisibleIds\)/)
    assert.match(jsx, /runMailAction\('read', \[message\.id\], true\)/)
    assert.match(jsx, /runMailAction\('restore', \[selected\.id\]\)/)
    assert.match(jsx, /\/core\/mail\/folders\/\$\{folder\}\/actions\//)
    assert.match(jsx, /\{ action, uids, uidvalidity \}/)
    assert.match(jsx, /disabled=\{mailActionBusy\}/)
    assert.match(css, /\.mail-bulk-toolbar/)
    assert.match(css, /\.mail-message-select/)
})
