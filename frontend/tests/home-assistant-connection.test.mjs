import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8')

const ui = source('components/HomeAssistantConnectionSettings.tsx')
const settings = source('app/dashboard/settings/general/page.tsx')
const backendRoute = source('../backend/apps/core/urls.py')
const translations = {
    de: JSON.parse(source('messages/de.json')).HomeAssistantConnection,
    en: JSON.parse(source('messages/en.json')).HomeAssistantConnection,
}

test('Home Assistant connection probe stays in admin technical settings', () => {
    assert.match(settings, /import HomeAssistantConnectionSettings from/)
    assert.match(settings, /<HomeAssistantConnectionSettings \/>/)
    assert.match(backendRoute, /home-assistant\/connection/)
    assert.match(ui, /api\.get<ConnectionCheck>\('\/core\/home-assistant\/connection\/'\)/)
    assert.doesNotMatch(ui, /api\.post|api\.patch|api\.delete/)
})

test('Home Assistant connection probe has German and English translations', () => {
    assert.match(ui, /useTranslations\('HomeAssistantConnection'\)/)
    for (const language of ['de', 'en']) {
        for (const key of [
            'title', 'description', 'serverConfiguration', 'check',
            'failed', 'notConnected', 'connected', 'found',
            'zones', 'trackers', 'selectedTracker', 'trackerMissing',
            'trackerNotSelected', 'readOnly',
        ]) {
            assert.ok(translations[language][key], language + ': ' + key)
        }
    }
})
