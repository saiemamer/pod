import { POD_PRODUCT_NAME } from '../brand'

/**
 * Why: Orca names itself in a few hundred UI strings and their translations. Pod
 * rewrites the product name at the two translate() boundaries instead of touching
 * each string, and keeps the names of Orca-operated services and apps as they are.
 */
const KEEP_AS_ORCA = [
  'Orca Mobile',
  'Orca Cloud',
  'Orca Relay',
  'Orca IDE',
  'Orca Account',
  'Orca account',
  'Sign in to Orca',
  'Sign out of Orca',
  'Connect to Orca',
  'Enjoying Orca',
  'Star Orca on GitHub'
]

export function rebrandProductName(text: string): string {
  if (!text.includes('Orca') && !text.includes('ORCA')) {
    return text
  }
  const kept: string[] = []
  let out = text
  for (const phrase of KEEP_AS_ORCA) {
    if (out.includes(phrase)) {
      kept.push(phrase)
      out = out.split(phrase).join(`@@KEEP${kept.length - 1}@@`)
    }
  }
  out = out
    .replace(/\bORCA\b/g, POD_PRODUCT_NAME.toUpperCase())
    .replace(/\bOrca\b/g, POD_PRODUCT_NAME)
  return out.replace(/@@KEEP(\d+)@@/g, (_match, index: string) => kept[Number(index)] ?? '')
}
