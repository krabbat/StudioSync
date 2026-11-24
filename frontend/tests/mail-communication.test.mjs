import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8')

test('student profile adds an admin-only Kommunikation tab and a mail overview', () => {
    const profile = read('app/dashboard/students/[id]/page.tsx')
    const panel = read('components/StudentCommunicationPanel.tsx')
    assert.match(profile, /profileTab === 'communication'/)
    assert.match(profile, /currentUser\?\.role === 'admin'/)
    assert.match(profile, /<StudentCommunicationPanel studentId=\{studentId\}/)
    assert.match(panel, /\/core\/mail\/cache\/students\/\$\{studentId\}\/overview\//)
    assert.match(panel, /\/dashboard\/messages\?student=/)
    assert.match(panel, /&folder=/)
    assert.match(panel, /&uid=/)
})

test('mail filters use student UUID and instrument assignments from backend', () => {
    const client = read('components/mail/MailWorkspace.tsx')
    assert.match(client, /\/core\/mail\/cache\/students\//)
    assert.match(client, /m\.student_ids\.includes\(studentFilter\)/)
    assert.match(client, /m\.instruments\.includes\(instrumentFilter\)/)
    assert.match(client, /option value="">Alle Schüler</)
    assert.match(client, /option value="">Alle Instrumente</)
    assert.match(client, /saveMailAssociation/)
    assert.match(client, /automati[sS]ch/i)
    assert.match(client, /studentFilter\(sid\)/)
})

test('drafts have durable server storage including file restore', () => {
    const client = read('components/mail/MailWorkspace.tsx')
    assert.match(client, /currentFolder === 'drafts' \? '\/core\/mail\/drafts\/'/)
    assert.match(client, /form\.append\('draft_id', draftId\)/)
    assert.match(client, /api\.post<SavedMailDraft>\('\/core\/mail\/drafts\/', form\)/)
    assert.match(client, /responseType: 'blob'/)
    assert.match(client, /new File\(\[blob\], file\.filename/)
    assert.match(client, /\/core\/mail\/drafts\/.*attachments\//)
    assert.match(client, /Entwurf speichern/)
    assert.match(client, /deleteDraft/)
})

test('resource/invoice mail and WhatsApp share workflows keep existing SMTP', () => {
    const client = read('components/mail/MailWorkspace.tsx')
    const resources = read('app/dashboard/resources/page.tsx')
    const billing = read('app/dashboard/billing/page.tsx')
    const share = read('lib/shareFile.ts')
    assert.match(client, /shareComposedMail/)
    assert.match(client, /\/core\/mail\/attachments\/resources\/.*download\//)
    assert.match(client, /api\.post<SendMailResult>\('\/core\/mail\/send\/', form\)/)
    assert.match(resources, /compose=1&resource=/)
    assert.match(resources, /handleShare/)
    assert.match(billing, /handleShareInvoice/)
    assert.match(billing, /handleSendInvoice/)
    assert.match(share, /navigator\.canShare/)
    assert.match(share, /navigator\.share/)
    assert.match(share, /https:\/\/wa\.me\/\?text=/)
})
