/**
 * Nettoie en base tous les champs texte des immobilisations (même règle que l’API).
 * Usage (depuis apps/api) : npx tsx scripts/sanitize-immobilisation-texts.ts
 * Ou : npm run sanitize:immobilisations
 */

import { PrismaClient } from "@prisma/client"
import { sanitizeLibelleCompta } from "../src/lib/sanitize-text.js"

const prisma = new PrismaClient()

async function main() {
  const rows = await prisma.immobilisation.findMany({
    select: { id: true, reference: true, libelle: true, fournisseur: true, notes: true },
  })

  let updated = 0
  let skipped = 0

  for (const row of rows) {
    const reference = sanitizeLibelleCompta(row.reference)
    const libelle = sanitizeLibelleCompta(row.libelle)
    const fournisseur =
      row.fournisseur != null && String(row.fournisseur).trim() !== ""
        ? sanitizeLibelleCompta(row.fournisseur) || null
        : null
    const notes =
      row.notes != null && String(row.notes).trim() !== "" ? sanitizeLibelleCompta(row.notes) || null : null

    if (
      reference === row.reference &&
      libelle === row.libelle &&
      fournisseur === row.fournisseur &&
      notes === row.notes
    ) {
      continue
    }

    if (!reference || !libelle) {
      console.warn(`[skip] ${row.id} : nettoyage laisserait référence ou libellé vide — intervention manuelle.`)
      skipped++
      continue
    }

    await prisma.immobilisation.update({
      where: { id: row.id },
      data: { reference, libelle, fournisseur, notes },
    })
    updated++
    console.log(`[ok] ${row.id.slice(0, 8)}…  libelle: ${JSON.stringify(row.libelle)} → ${JSON.stringify(libelle)}`)
  }

  console.log(`\nTerminé : ${updated} ligne(s) mises à jour, ${skipped} ignorée(s), ${rows.length} au total.`)
}

main()
  .catch(e => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
