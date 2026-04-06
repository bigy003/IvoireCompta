/**
 * Ponctuation hors ASCII qu’on garde explicitement (glyphes bien supportés Excel / Windows).
 * Ne pas inclure U+00B7 (point médian « · ») : souvent rendu en petit rectangle selon la police.
 */
const EXTRA_CODEPOINTS = new Set([
  0x00ab, 0x00bb, 0x00b0, 0x2018, 0x2019, 0x201c, 0x201d, 0x2030, 0x20ac,
])

const GEO_BLOCKS_PRE_NFC = /\u25A1/g

function isPrivateUseOrProblemBlock(cp: number): boolean {
  if (cp >= 0xe000 && cp <= 0xf8ff) return true
  if (cp >= 0xf0000 && cp <= 0xffffd) return true
  if (cp >= 0x100000 && cp <= 0x10fffd) return true
  if (cp >= 0xd800 && cp <= 0xdfff) return true
  if (cp <= 0x1f || (cp >= 0x7f && cp <= 0x9f)) return true
  if (cp >= 0x25a0 && cp <= 0x27bf) return true
  if (cp >= 0x2300 && cp <= 0x23ff) return true
  return false
}

function isAllowedCodePoint(cp: number): boolean {
  if (cp === 0x20) return true
  if (cp >= 0x30 && cp <= 0x39) return true
  if (cp >= 0x41 && cp <= 0x5a) return true
  if (cp >= 0x61 && cp <= 0x7a) return true
  if (cp >= 0x21 && cp <= 0x2f) return true
  if (cp >= 0x3a && cp <= 0x40) return true
  if (cp >= 0x5b && cp <= 0x60) return true
  if (cp >= 0x7b && cp <= 0x7e) return true
  if (EXTRA_CODEPOINTS.has(cp)) return true
  if (cp === 0xa0) return true
  if (cp >= 0xc0 && cp <= 0xf6) return true
  if (cp >= 0xf8 && cp <= 0xff) return true
  if (cp >= 0x100 && cp <= 0x17f) return true
  if (cp >= 0x180 && cp <= 0x24f) return true
  if (cp >= 0x1e00 && cp <= 0x1eff) return true
  if (cp >= 0x2c60 && cp <= 0x2c7f) return true
  if (cp >= 0xa720 && cp <= 0xa7ff) return true
  if (cp >= 0x300 && cp <= 0x36f) return true
  if (cp >= 0x1ab0 && cp <= 0x1aff) return true
  if (cp >= 0x1dc0 && cp <= 0x1dff) return true
  if (cp >= 0x20d0 && cp <= 0x20ff) return true
  if (cp >= 0xfe20 && cp <= 0xfe2f) return true
  if (cp >= 0xff21 && cp <= 0xff3a) return true
  if (cp >= 0xff41 && cp <= 0xff5a) return true
  return false
}

/**
 * Texte métier : lettres latines, chiffres, ASCII imprimable, accents, € « » ° …
 */
export function sanitizeLibelleCompta(raw: unknown): string {
  const rawStr = String(raw ?? "")
  let s = rawStr
    .replace(GEO_BLOCKS_PRE_NFC, " ")
    .normalize("NFC")
    .replace(/\uFEFF/g, "")
    .replace(/\u2013|\u2014|\u2015|\u2E3A|\u2E3B/g, "-")

  const parts: string[] = []
  for (const ch of s) {
    const cp = ch.codePointAt(0)!
    if (isPrivateUseOrProblemBlock(cp) || !isAllowedCodePoint(cp)) parts.push(" ")
    else parts.push(ch)
  }
  let out = parts.join("")
  out = out
    .replace(/\u00B7|\u2219|\u2022|\u2023|\u30FB/g, " - ")
    .replace(/×/g, " x ")
  return out.replace(/ +/g, " ").trim()
}
