/** HTML type=email rejects SMTPUTF8 mailbox characters (ä, ö, ü, ß).
 * Use text+email keyboard and broad native shape check; backend validates strictly.
 */
export const INTERNATIONAL_EMAIL_PATTERN = String.raw`[^\s@]+@[^\s@]+\.[^\s@]+`
export const INTERNATIONAL_EMAIL_HINT = 'Gültige E-Mail-Adresse (auch mit ä, ö, ü, ß)'
