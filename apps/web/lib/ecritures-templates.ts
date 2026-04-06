/**
 * Modèles d'écriture (localStorage) + parsing CSV des lignes
 */

import Cookies from "js-cookie"

export type LigneDraft = {
  compteSyscohada: string
  libelleCompte: string
  debit: string
  credit: string
}

export type ModeleEcriture = {
  id: string
  nom: string
  libelle: string
  pieceRef: string
  lignes: LigneDraft[]
  updatedAt: string
}

const LS_PREFIX = "ivoirecompta_modeles_ecritures:"

export function modelesStorageKey(): string {
  try {
    const raw = Cookies.get("user")
    if (!raw) return `${LS_PREFIX}anon`
    const j = JSON.parse(raw) as { email?: string }
    return `${LS_PREFIX}${(j.email ?? "anon").toLowerCase()}`
  } catch {
    return `${LS_PREFIX}anon`
  }
}

export function loadModeles(key: string): ModeleEcriture[] {
  if (typeof window === "undefined") return []
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return []
    const arr = JSON.parse(raw) as unknown
    if (!Array.isArray(arr)) return []
    return arr.filter(
      (m): m is ModeleEcriture =>
        m &&
        typeof m === "object" &&
        typeof (m as ModeleEcriture).id === "string" &&
        typeof (m as ModeleEcriture).nom === "string" &&
        Array.isArray((m as ModeleEcriture).lignes)
    )
  } catch {
    return []
  }
}

export function saveModeles(key: string, modeles: ModeleEcriture[]) {
  if (typeof window === "undefined") return
  localStorage.setItem(key, JSON.stringify(modeles))
}

export function newModeleId() {
  return `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`
}

function normHeader(s: string) {
  return s
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "_")
}

function parseCsvLine(line: string, delim: string): string[] {
  const out: string[] = []
  let cur = ""
  let q = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === '"') {
      q = !q
      continue
    }
    if (!q && c === delim) {
      out.push(cur.trim())
      cur = ""
      continue
    }
    cur += c
  }
  out.push(cur.trim())
  return out
}

function detectDelim(firstLine: string) {
  const sc = (firstLine.match(/;/g) || []).length
  const cc = (firstLine.match(/,/g) || []).length
  return sc >= cc ? ";" : ","
}

function colIndex(headers: string[], ...aliases: string[]) {
  const n = headers.map(normHeader)
  for (const a of aliases) {
    const na = normHeader(a)
    const i = n.indexOf(na)
    if (i >= 0) return i
  }
  return -1
}

/** Parse un fichier CSV : colonnes compte, libellé, débit, crédit (noms souples) */
export function parseCsvLignesEcriture(text: string): { lignes: LigneDraft[]; erreurs: string[] } {
  const erreurs: string[] = []
  const raw = text.replace(/^\uFEFF/, "").trim()
  if (!raw) {
    erreurs.push("Fichier vide.")
    return { lignes: [], erreurs }
  }
  const lines = raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  if (lines.length === 0) {
    erreurs.push("Aucune ligne.")
    return { lignes: [], erreurs }
  }
  const delim = detectDelim(lines[0])
  const headerCells = parseCsvLine(lines[0], delim)
  const hasHeader =
    colIndex(headerCells, "compte", "compte_syscohada", "numero", "n_compte") >= 0 ||
    colIndex(headerCells, "debit", "credit", "débit", "crédit") >= 0

  const dataLines = hasHeader ? lines.slice(1) : lines
  if (dataLines.length === 0) {
    erreurs.push("Aucune ligne de données après l'en-tête.")
    return { lignes: [], erreurs }
  }

  const h = hasHeader ? headerCells : ["compte", "libelle", "debit", "credit"]
  const iCpt = colIndex(h, "compte", "compte_syscohada", "numero", "n_compte", "n°_compte", "no_compte")
  const iLib = colIndex(h, "libelle", "libelle_compte", "libellé", "intitule")
  const iDeb = colIndex(h, "debit", "débit", "deb", "d")
  const iCred = colIndex(h, "credit", "crédit", "cred", "c")

  if (iCpt < 0 || iDeb < 0 || iCred < 0) {
    erreurs.push(
      "En-têtes requis : au minimum des colonnes « compte », « débit » et « crédit » (ou « libelle » optionnel). " +
        "Première ligne : " +
        h.join(delim === ";" ? " ; " : ", ")
    )
    return { lignes: [], erreurs }
  }

  const lignes: LigneDraft[] = []
  let rowNum = hasHeader ? 2 : 1
  for (const line of dataLines) {
    const cells = parseCsvLine(line, delim)
    const compte = (cells[iCpt] ?? "").replace(/\D/g, "").slice(0, 10)
    const libelle = iLib >= 0 ? (cells[iLib] ?? "").trim() : ""
    const debitRaw = (cells[iDeb] ?? "").replace(/\s/g, "").replace(/,/g, "")
    const creditRaw = (cells[iCred] ?? "").replace(/\s/g, "").replace(/,/g, "")
    const debit = debitRaw.replace(/[^\d]/g, "")
    const credit = creditRaw.replace(/[^\d]/g, "")
    if (!compte && !debit && !credit && !libelle) {
      rowNum++
      continue
    }
    if (!compte) {
      erreurs.push(`Ligne ${rowNum} : compte manquant ou invalide.`)
      rowNum++
      continue
    }
    lignes.push({
      compteSyscohada: compte,
      libelleCompte: libelle || "—",
      debit,
      credit,
    })
    rowNum++
  }

  if (lignes.length < 2) {
    erreurs.push("Au moins 2 lignes avec un compte valide sont nécessaires pour une écriture.")
  }

  return { lignes, erreurs }
}

export function csvTemplateContent() {
  return ["compte;libelle;debit;credit", "601100;Achat fournitures;100000;0", "401100;Fournisseur X;0;100000"].join("\n")
}
