import { describe, expect, it } from 'vitest'
import { createI18n } from 'vue-i18n'
import zh from '../locales/zh/admin/accounts'
import en from '../locales/en/admin/accounts'

describe('Kling credential instructions', () => {
  it.each([['zh', zh], ['en', en]] as const)('renders literal credential separators in %s', (locale, messages) => {
    const i18n = createI18n({ legacy: false, locale, messages: { [locale]: messages } })
    expect(i18n.global.t('accounts.kling.apiKeyHint')).toContain('Access Key|Secret Key')
    const error = i18n.global.t('accounts.kling.invalidApiKey')
    expect(error).toContain('Access Key|Secret Key')
    expect(error).toContain('officialAccessKey|officialSecretKey')
  })
})
