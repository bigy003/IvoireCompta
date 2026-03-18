/** Secteurs d'activité courants pour cabinets en CI (liste indicative) */
export const SECTEURS_CABINET = [
  { value: "comptabilite_conseil", label: "Comptabilité & conseil" },
  { value: "audit_certification", label: "Audit & certification" },
  { value: "fiscalite", label: "Fiscalité" },
  { value: "paie_rh", label: "Paie & RH / social" },
  { value: "juridique", label: "Juridique & droit des affaires" },
  { value: "multi", label: "Pluridisciplinaire" },
  { value: "autre", label: "Autre" },
] as const

export const SPECIALISATIONS = [
  { value: "comptabilite", label: "Comptabilité générale" },
  { value: "audit", label: "Audit légal / contractuel" },
  { value: "fiscal", label: "Fiscal & DSF" },
  { value: "paie", label: "Paie & CNPS" },
  { value: "conseil", label: "Conseil & gestion" },
  { value: "autre", label: "Autre" },
] as const

function passwordScore(pw: string): number {
  if (pw.length === 0) return 0
  let s = 0
  if (pw.length >= 8) s++
  if (pw.length >= 12) s++
  if (/[0-9]/.test(pw) && /[a-zA-Z]/.test(pw)) s++
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw) && /[0-9]/.test(pw)) s++
  return Math.min(4, Math.max(1, s))
}

export function getPasswordStrength(pw: string): { level: number; label: string } {
  const n = passwordScore(pw)
  const labels = ["", "Faible", "Moyen", "Bon", "Fort"]
  return { level: n, label: n === 0 ? "—" : labels[n] ?? "Faible" }
}
