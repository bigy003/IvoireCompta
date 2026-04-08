"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Cookies from "js-cookie"
import Layout from "@/components/layout"
import { DatePickerFr } from "@/components/date-picker-fr"
import {
  createPointSuspens,
  deletePiecePointSuspens,
  downloadPiecePointSuspens,
  getClients,
  getPiecesPointSuspens,
  getPointsSuspens,
  getPointsSuspensResponsables,
  patchPointSuspens,
  resoudrePointSuspens,
  uploadPiecePointSuspens,
  viewPiecePointSuspens,
} from "@/lib/api"

type TypePoint = "ANOMALIE_COMPTABLE" | "PIECE_MANQUANTE" | "DECLARATION" | "BANQUE" | "IMMOBILISATION" | "AUTRE"
type Priorite = "HAUTE" | "MOYENNE" | "BASSE"
type Statut = "OUVERT" | "EN_COURS" | "BLOQUE" | "RESOLU"

type PointRow = {
  id: string
  clientId: string
  clientNom: string
  clientNcc: string
  sujet: string
  description: string
  type: TypePoint
  priorite: Priorite
  statut: Statut
  responsableUserId: string | null
  responsable: string
  echeance: string | null
  updatedAt: string
}

type Kpi = { ouverts: number; enCours: number; bloques: number; resolus30j: number }

const TYPE_LABEL: Record<TypePoint, string> = {
  ANOMALIE_COMPTABLE: "Anomalie comptable",
  PIECE_MANQUANTE: "Pièce manquante",
  DECLARATION: "Déclaration",
  BANQUE: "Banque",
  IMMOBILISATION: "Immobilisation",
  AUTRE: "Autre",
}
const PRIORITE_LABEL: Record<Priorite, string> = { HAUTE: "Haute", MOYENNE: "Moyenne", BASSE: "Basse" }
const STATUT_LABEL: Record<Statut, string> = { OUVERT: "Ouvert", EN_COURS: "En cours", BLOQUE: "Bloqué", RESOLU: "Résolu" }
const PRIORITE_CLASS: Record<Priorite, string> = {
  HAUTE: "bg-red-100 text-red-800",
  MOYENNE: "bg-amber-100 text-amber-800",
  BASSE: "bg-gray-100 text-gray-700",
}
const STATUT_CLASS: Record<Statut, string> = {
  OUVERT: "bg-blue-100 text-blue-800",
  EN_COURS: "bg-amber-100 text-amber-800",
  BLOQUE: "bg-red-100 text-red-800",
  RESOLU: "bg-emerald-100 text-emerald-800",
}

function fmtDate(iso: string | null) {
  if (!iso) return "—"
  try {
    return new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" })
  } catch {
    return iso
  }
}

function extensionFromName(name: string) {
  const idx = name.lastIndexOf(".")
  return idx > -1 ? name.slice(idx + 1).toLowerCase() : ""
}

function fileKind(mimeType: string, name: string) {
  const ext = extensionFromName(name)
  if (mimeType === "application/pdf" || ext === "pdf") return { label: "PDF", canPreview: true }
  if (mimeType.startsWith("image/") || ["png", "jpg", "jpeg", "webp", "gif", "bmp"].includes(ext)) {
    return { label: "Image", canPreview: true }
  }
  if (
    mimeType.includes("sheet") ||
    ["xls", "xlsx", "csv"].includes(ext)
  ) return { label: "Tableur", canPreview: false }
  if (mimeType.includes("word") || ["doc", "docx"].includes(ext)) return { label: "Document", canPreview: false }
  return { label: ext ? ext.toUpperCase() : "Fichier", canPreview: false }
}

export default function PointsSuspensPage() {
  const router = useRouter()
  const [authLoading, setAuthLoading] = useState(true)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState("")
  const [ok, setOk] = useState("")

  const [rows, setRows] = useState<PointRow[]>([])
  const [kpi, setKpi] = useState<Kpi>({ ouverts: 0, enCours: 0, bloques: 0, resolus30j: 0 })
  const [actions, setActions] = useState<Array<{ id: string; clientNom: string; sujet: string; priorite: Priorite; echeance: string | null }>>([])
  const [slaRetard, setSlaRetard] = useState(0)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(10)

  const [clients, setClients] = useState<Array<{ id: string; nom: string }>>([])
  const [responsables, setResponsables] = useState<Array<{ id: string; nom: string }>>([])
  const [clientId, setClientId] = useState("")
  const [typeFilter, setTypeFilter] = useState("")
  const [prioriteFilter, setPrioriteFilter] = useState("")
  const [statutFilter, setStatutFilter] = useState("")
  const [responsableFilter, setResponsableFilter] = useState("")
  const [search, setSearch] = useState("")

  const [modalOpen, setModalOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [fClientId, setFClientId] = useState("")
  const [fSujet, setFSujet] = useState("")
  const [fDesc, setFDesc] = useState("")
  const [fType, setFType] = useState<TypePoint>("PIECE_MANQUANTE")
  const [fPriorite, setFPriorite] = useState<Priorite>("MOYENNE")
  const [fResponsableUserId, setFResponsableUserId] = useState("")
  const [fEcheance, setFEcheance] = useState("")
  const [fPiece, setFPiece] = useState<File | null>(null)
  const [viewRow, setViewRow] = useState<PointRow | null>(null)
  const [editRow, setEditRow] = useState<PointRow | null>(null)
  const [savingEdit, setSavingEdit] = useState(false)
  const [eSujet, setESujet] = useState("")
  const [eDesc, setEDesc] = useState("")
  const [eType, setEType] = useState<TypePoint>("PIECE_MANQUANTE")
  const [ePriorite, setEPriorite] = useState<Priorite>("MOYENNE")
  const [eStatut, setEStatut] = useState<Statut>("OUVERT")
  const [eResponsableUserId, setEResponsableUserId] = useState("")
  const [eEcheance, setEEcheance] = useState("")
  const [viewPieces, setViewPieces] = useState<Array<{ id: string; nomOriginal: string; tailleOctets: number; mimeType: string }>>([])

  async function load() {
    setLoading(true)
    setErr("")
    try {
      const r = await getPointsSuspens({
        page,
        perPage,
        clientId: clientId || undefined,
        type: typeFilter || undefined,
        priorite: prioriteFilter || undefined,
        statut: statutFilter || undefined,
        responsableUserId: responsableFilter || undefined,
        q: search || undefined,
      } as Record<string, string | number>)
      setRows((r.data?.rows ?? []) as PointRow[])
      setKpi((r.data?.kpis ?? { ouverts: 0, enCours: 0, bloques: 0, resolus30j: 0 }) as Kpi)
      setActions((r.data?.actionsRecommandees ?? []) as Array<{ id: string; clientNom: string; sujet: string; priorite: Priorite; echeance: string | null }>)
      setSlaRetard(Number(r.data?.slaRetard ?? 0))
      setTotal(Number(r.data?.total ?? 0))
    } catch {
      setErr("Impossible de charger les points en suspens.")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!Cookies.get("token")) {
      router.push("/login")
      return
    }
    setAuthLoading(false)
    Promise.all([getClients(), getPointsSuspensResponsables()])
      .then(([rc, rr]) => {
        setClients((rc.data.clients ?? []).map((c: { id: string; nomRaisonSociale: string }) => ({ id: c.id, nom: c.nomRaisonSociale })))
        setResponsables((rr.data.responsables ?? []).map((u: { id: string; nom: string }) => ({ id: u.id, nom: u.nom })))
      })
      .catch(() => {})
  }, [router])

  useEffect(() => {
    if (!authLoading) void load()
  }, [authLoading, page, perPage, clientId, typeFilter, prioriteFilter, statutFilter, responsableFilter, search])

  const pageCount = Math.max(1, Math.ceil(total / perPage))
  async function fileToBase64(file: File) {
    const arr = new Uint8Array(await file.arrayBuffer())
    let binary = ""
    for (let i = 0; i < arr.length; i += 1) binary += String.fromCharCode(arr[i])
    return btoa(binary)
  }

  async function onSubmitCreate(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setErr("")
    setOk("")
    try {
      const created = await createPointSuspens({
        clientId: fClientId,
        sujet: fSujet,
        description: fDesc || undefined,
        type: fType,
        priorite: fPriorite,
        responsableUserId: fResponsableUserId || null,
        echeance: fEcheance ? new Date(fEcheance).toISOString() : null,
      })
      const pointId = created.data?.point?.id as string | undefined
      if (fPiece && pointId) {
        await uploadPiecePointSuspens(pointId, {
          nomOriginal: fPiece.name,
          mimeType: fPiece.type || "application/octet-stream",
          base64: await fileToBase64(fPiece),
        })
      }
      setOk("Point créé.")
      setModalOpen(false)
      setFClientId("")
      setFSujet("")
      setFDesc("")
      setFType("PIECE_MANQUANTE")
      setFPriorite("MOYENNE")
      setFResponsableUserId("")
      setFEcheance("")
      setFPiece(null)
      setPage(1)
      await load()
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error
      setErr(msg || "Création impossible.")
    } finally {
      setSaving(false)
    }
  }

  async function onResoudre(id: string) {
    setErr("")
    setOk("")
    try {
      await resoudrePointSuspens(id)
      setOk("Point marqué résolu.")
      await load()
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error
      setErr(msg || "Action impossible.")
    }
  }

  function openEdit(row: PointRow) {
    setEditRow(row)
    setESujet(row.sujet)
    setEDesc(row.description ?? "")
    setEType(row.type)
    setEPriorite(row.priorite)
    setEStatut(row.statut)
    setEResponsableUserId(row.responsableUserId ?? "")
    setEEcheance(row.echeance ? row.echeance.slice(0, 10) : "")
  }

  async function onSubmitEdit(e: React.FormEvent) {
    e.preventDefault()
    if (!editRow) return
    setSavingEdit(true)
    setErr("")
    setOk("")
    try {
      await patchPointSuspens(editRow.id, {
        sujet: eSujet,
        description: eDesc,
        type: eType,
        priorite: ePriorite,
        statut: eStatut,
        responsableUserId: eResponsableUserId || null,
        echeance: eEcheance ? new Date(eEcheance).toISOString() : null,
      })
      setOk("Point mis à jour.")
      setEditRow(null)
      await load()
    } catch (x: unknown) {
      const msg = (x as { response?: { data?: { error?: string } } })?.response?.data?.error
      setErr(msg || "Mise à jour impossible.")
    } finally {
      setSavingEdit(false)
    }
  }

  async function onDownloadPiece(pieceId: string, nomOriginal: string) {
    try {
      const res = await downloadPiecePointSuspens(pieceId)
      const blob = new Blob([res.data], { type: "application/octet-stream" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = nomOriginal
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch {
      setErr("Téléchargement de la pièce impossible.")
    }
  }

  async function onViewPiece(pieceId: string, mimeType?: string) {
    try {
      const res = await viewPiecePointSuspens(pieceId)
      const blob = new Blob([res.data], { type: mimeType || "application/octet-stream" })
      const url = URL.createObjectURL(blob)
      window.open(url, "_blank", "noopener,noreferrer")
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch {
      setErr("Ouverture de la pièce impossible.")
    }
  }

  async function onDeletePiece(pieceId: string) {
    if (!viewRow) return
    if (!window.confirm("Supprimer cette pièce jointe ?")) return
    try {
      await deletePiecePointSuspens(pieceId)
      const rp = await getPiecesPointSuspens(viewRow.id)
      setViewPieces((rp.data?.pieces ?? []) as Array<{ id: string; nomOriginal: string; tailleOctets: number; mimeType: string }>)
      setOk("Pièce supprimée.")
    } catch {
      setErr("Suppression de la pièce impossible.")
    }
  }

  if (authLoading) {
    return (
      <Layout>
        <div className="max-w-7xl mx-auto px-6 py-12 text-center text-gray-600">Chargement…</div>
      </Layout>
    )
  }

  return (
    <Layout>
      <div className="max-w-7xl mx-auto px-6 py-8 pb-20">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-4">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Points en suspens</h1>
            <p className="text-sm text-gray-500 mt-1">Suivi des anomalies, pièces manquantes et actions à traiter</p>
          </div>
          <div className="flex gap-2">
            <button type="button" className="px-4 py-2.5 rounded-xl border border-gray-200 bg-white text-gray-700 text-sm font-semibold">
              Exporter
            </button>
            <button type="button" onClick={() => setModalOpen(true)} className="px-4 py-2.5 rounded-xl bg-orange-500 text-white text-sm font-semibold hover:bg-orange-600">
              Nouveau point
            </button>
          </div>
        </div>

        {ok && <div className="mb-3 rounded-xl bg-emerald-50 border border-emerald-100 text-emerald-800 px-4 py-3 text-sm">{ok}</div>}
        {err && <div className="mb-3 rounded-xl bg-red-50 border border-red-100 text-red-800 px-4 py-3 text-sm">{err}</div>}

        <div className="bg-white rounded-2xl shadow-md border border-gray-100 p-3 sm:p-4 mb-4 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-6 gap-2">
          <select value={clientId} onChange={e => { setClientId(e.target.value); setPage(1) }} className="rounded-xl border border-gray-200 px-3 py-2.5 text-sm"><option value="">Tous les clients</option>{clients.map(c => <option key={c.id} value={c.id}>{c.nom}</option>)}</select>
          <select value={typeFilter} onChange={e => { setTypeFilter(e.target.value); setPage(1) }} className="rounded-xl border border-gray-200 px-3 py-2.5 text-sm"><option value="">Tous les types</option>{Object.entries(TYPE_LABEL).map(([v,l]) => <option key={v} value={v}>{l}</option>)}</select>
          <select value={prioriteFilter} onChange={e => { setPrioriteFilter(e.target.value); setPage(1) }} className="rounded-xl border border-gray-200 px-3 py-2.5 text-sm"><option value="">Toutes priorités</option>{Object.entries(PRIORITE_LABEL).map(([v,l]) => <option key={v} value={v}>{l}</option>)}</select>
          <select value={statutFilter} onChange={e => { setStatutFilter(e.target.value); setPage(1) }} className="rounded-xl border border-gray-200 px-3 py-2.5 text-sm"><option value="">Tous les statuts</option>{Object.entries(STATUT_LABEL).map(([v,l]) => <option key={v} value={v}>{l}</option>)}</select>
          <select value={responsableFilter} onChange={e => { setResponsableFilter(e.target.value); setPage(1) }} className="rounded-xl border border-gray-200 px-3 py-2.5 text-sm"><option value="">Tous responsables</option>{responsables.map(r => <option key={r.id} value={r.id}>{r.nom}</option>)}</select>
          <input value={search} onChange={e => { setSearch(e.target.value); setPage(1) }} placeholder="Rechercher..." className="rounded-xl border border-gray-200 px-3 py-2.5 text-sm" />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 mb-4">
          <div className="bg-white rounded-2xl border border-gray-100 p-4"><p className="text-sm text-gray-500">Ouverts</p><p className="text-3xl font-bold text-blue-700">{kpi.ouverts}</p></div>
          <div className="bg-white rounded-2xl border border-gray-100 p-4"><p className="text-sm text-gray-500">En cours</p><p className="text-3xl font-bold text-amber-700">{kpi.enCours}</p></div>
          <div className="bg-white rounded-2xl border border-gray-100 p-4"><p className="text-sm text-gray-500">Bloqués</p><p className="text-3xl font-bold text-red-700">{kpi.bloques}</p></div>
          <div className="bg-white rounded-2xl border border-gray-100 p-4"><p className="text-sm text-gray-500">Résolus (30 jours)</p><p className="text-3xl font-bold text-emerald-700">{kpi.resolus30j}</p></div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-4 gap-4 items-start">
          <div className="xl:col-span-3 bg-white rounded-2xl border border-gray-100 shadow-md overflow-hidden">
            {loading ? (
              <div className="p-10 text-center text-gray-500">Chargement…</div>
            ) : rows.length === 0 ? (
              <div className="p-10 text-center text-gray-500 text-sm">Aucun point.</div>
            ) : (
              <div className="overflow-x-auto hide-scrollbar">
                <table className="w-full text-sm min-w-full">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100 text-left text-xs font-semibold text-gray-500 uppercase">
                      <th className="px-3 py-2.5">Client</th>
                      <th className="px-3 py-2.5">Sujet</th>
                      <th className="px-3 py-2.5">Type</th>
                      <th className="px-3 py-2.5">Priorité</th>
                      <th className="px-3 py-2.5">Statut</th>
                      <th className="px-3 py-2.5">Responsable</th>
                      <th className="px-3 py-2.5">Échéance</th>
                      <th className="px-3 py-2.5">Dernière mise à jour</th>
                      <th className="px-3 py-2.5 text-center">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {rows.map(r => (
                      <tr key={r.id} className="hover:bg-gray-50/60">
                        <td className="px-3 py-2"><p className="font-semibold text-gray-900">{r.clientNom}</p><p className="text-xs text-gray-500">{r.clientNcc}</p></td>
                        <td className="px-3 py-2"><p className="font-medium text-gray-900">{r.sujet}</p></td>
                        <td className="px-3 py-2"><span className="text-xs text-gray-700">{TYPE_LABEL[r.type]}</span></td>
                        <td className="px-3 py-2"><span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-semibold ${PRIORITE_CLASS[r.priorite]}`}>{PRIORITE_LABEL[r.priorite]}</span></td>
                        <td className="px-3 py-2"><span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-semibold ${STATUT_CLASS[r.statut]}`}>{STATUT_LABEL[r.statut]}</span></td>
                        <td className="px-3 py-2 text-xs text-gray-700">{r.responsable}</td>
                        <td className="px-3 py-2 text-xs text-gray-700">{fmtDate(r.echeance)}</td>
                        <td className="px-3 py-2 text-xs text-gray-700">{fmtDate(r.updatedAt)}</td>
                        <td className="px-3 py-2">
                          <div className="flex items-center justify-center gap-1.5 whitespace-nowrap min-w-[132px]">
                            <button
                              type="button"
                              onClick={async () => {
                                setViewRow(r)
                                try {
                                  const rp = await getPiecesPointSuspens(r.id)
                                  setViewPieces((rp.data?.pieces ?? []) as Array<{ id: string; nomOriginal: string; tailleOctets: number; mimeType: string }>)
                                } catch {
                                  setViewPieces([])
                                }
                              }}
                              className="p-2 rounded-lg border border-gray-200 text-gray-600 hover:text-gray-800 hover:border-orange-300"
                              title="Voir"
                              aria-label="Voir"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                              </svg>
                            </button>
                            <button
                              type="button"
                              onClick={() => openEdit(r)}
                              className="p-2 rounded-lg border border-gray-200 text-gray-600 hover:text-gray-800 hover:border-orange-300"
                              title="Modifier"
                              aria-label="Modifier"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                              </svg>
                            </button>
                            {r.statut !== "RESOLU" ? (
                              <button
                                type="button"
                                onClick={() => onResoudre(r.id)}
                                className="p-2 rounded-lg bg-emerald-500 text-white hover:bg-emerald-600"
                                title="Résoudre"
                                aria-label="Résoudre"
                              >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                                </svg>
                              </button>
                            ) : (
                              <span
                                className="p-2 rounded-lg bg-emerald-100 text-emerald-700"
                                title="Déjà résolu"
                                aria-label="Déjà résolu"
                              >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                                </svg>
                              </span>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="px-3 py-3 border-t border-gray-100 flex items-center justify-between text-xs text-gray-600">
              <span>{total === 0 ? "Aucun point" : `Affichage ${(page - 1) * perPage + 1} à ${Math.min(page * perPage, total)} sur ${total}`}</span>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1} className="px-2 py-1 rounded border border-gray-200 disabled:opacity-40">‹</button>
                <span>{page} / {pageCount}</span>
                <button type="button" onClick={() => setPage(p => Math.min(pageCount, p + 1))} disabled={page >= pageCount} className="px-2 py-1 rounded border border-gray-200 disabled:opacity-40">›</button>
                <select value={perPage} onChange={e => { setPerPage(parseInt(e.target.value, 10)); setPage(1) }} className="rounded border border-gray-200 px-2 py-1">
                  {[10, 20, 50].map(n => <option key={n} value={n}>{n} lignes</option>)}
                </select>
              </div>
            </div>
          </div>

          <aside className="space-y-3">
            <div className="bg-white rounded-2xl border border-gray-100 shadow-md p-4">
              <h3 className="font-bold text-gray-900 mb-3">Actions recommandées aujourd&apos;hui</h3>
              {actions.length === 0 ? <p className="text-sm text-gray-500">Rien d&apos;urgent.</p> : (
                <ul className="space-y-2">
                  {actions.map(a => (
                    <li key={a.id} className="rounded-xl border border-gray-100 bg-gray-50/70 p-3">
                      <p className="text-sm font-semibold text-gray-900">{a.clientNom}</p>
                      <p className="text-xs text-gray-600 mt-1">{a.sujet}</p>
                      <p className="text-xs text-gray-500 mt-1">{PRIORITE_LABEL[a.priorite]} · Échéance {fmtDate(a.echeance)}</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="bg-white rounded-2xl border border-gray-100 shadow-md p-4">
              <h3 className="font-bold text-gray-900">SLA / Retard</h3>
              <p className="text-3xl font-bold text-red-700 mt-2">{slaRetard}</p>
              <p className="text-xs text-gray-600 mt-1">points non mis à jour depuis plus de 7 jours</p>
            </div>
          </aside>
        </div>
      </div>

      {modalOpen && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <form onSubmit={onSubmitCreate} className="bg-white rounded-2xl shadow-xl max-w-lg w-full p-6 border border-gray-100 space-y-3">
            <h2 className="text-lg font-bold text-gray-900">Nouveau point</h2>
            <select required value={fClientId} onChange={e => setFClientId(e.target.value)} className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm">
              <option value="">Client</option>{clients.map(c => <option key={c.id} value={c.id}>{c.nom}</option>)}
            </select>
            <input required value={fSujet} onChange={e => setFSujet(e.target.value)} placeholder="Sujet" className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm" />
            <textarea value={fDesc} onChange={e => setFDesc(e.target.value)} placeholder="Description" className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm min-h-[90px]" />
            <div className="grid grid-cols-2 gap-2">
              <select value={fType} onChange={e => setFType(e.target.value as TypePoint)} className="rounded-xl border border-gray-200 px-3 py-2.5 text-sm">{Object.entries(TYPE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
              <select value={fPriorite} onChange={e => setFPriorite(e.target.value as Priorite)} className="rounded-xl border border-gray-200 px-3 py-2.5 text-sm">{Object.entries(PRIORITE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
              <select value={fResponsableUserId} onChange={e => setFResponsableUserId(e.target.value)} className="rounded-xl border border-gray-200 px-3 py-2.5 text-sm"><option value="">Responsable (optionnel)</option>{responsables.map(u => <option key={u.id} value={u.id}>{u.nom}</option>)}</select>
              <DatePickerFr value={fEcheance} onChange={setFEcheance} placeholder="Échéance" />
            </div>
            <input type="file" onChange={e => setFPiece(e.target.files?.[0] ?? null)} className="w-full rounded-xl border border-gray-200 px-3 py-2 text-xs text-gray-600" />
            <div className="flex gap-2 pt-2">
              <button type="submit" disabled={saving} className="flex-1 py-2.5 rounded-xl bg-orange-500 text-white text-sm font-semibold hover:bg-orange-600 disabled:opacity-50">{saving ? "…" : "Créer"}</button>
              <button type="button" onClick={() => setModalOpen(false)} className="px-4 py-2.5 rounded-xl border border-gray-200 text-sm">Annuler</button>
            </div>
          </form>
        </div>
      )}

      {viewRow && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={() => setViewRow(null)}>
          <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full p-6 border border-gray-100 space-y-3" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-gray-900">Détail du point</h2>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div><span className="text-gray-500">Client</span><p className="font-medium text-gray-900">{viewRow.clientNom}</p></div>
              <div>
                <span className="text-gray-500">N° contribuable (NCC)</span>
                <p className="font-medium text-gray-900">{viewRow.clientNcc}</p>
              </div>
              <div><span className="text-gray-500">Type</span><p className="font-medium text-gray-900">{TYPE_LABEL[viewRow.type]}</p></div>
              <div><span className="text-gray-500">Priorité</span><p className="font-medium text-gray-900">{PRIORITE_LABEL[viewRow.priorite]}</p></div>
              <div><span className="text-gray-500">Statut</span><p className="font-medium text-gray-900">{STATUT_LABEL[viewRow.statut]}</p></div>
              <div><span className="text-gray-500">Responsable</span><p className="font-medium text-gray-900">{viewRow.responsable}</p></div>
              <div><span className="text-gray-500">Échéance</span><p className="font-medium text-gray-900">{fmtDate(viewRow.echeance)}</p></div>
              <div><span className="text-gray-500">Mise à jour</span><p className="font-medium text-gray-900">{fmtDate(viewRow.updatedAt)}</p></div>
            </div>
            <div>
              <span className="text-sm text-gray-500">Sujet</span>
              <p className="text-sm font-medium text-gray-900">{viewRow.sujet}</p>
            </div>
            <div>
              <span className="text-sm text-gray-500">Description</span>
              <p className="text-sm text-gray-700">{viewRow.description || "—"}</p>
            </div>
            <div>
              <span className="text-sm text-gray-500">Pièces jointes</span>
              {viewPieces.length === 0 ? (
                <p className="text-sm text-gray-700">Aucune pièce.</p>
              ) : (
                <ul className="text-sm text-gray-700 space-y-1">
                  {viewPieces.map(p => (
                    <li key={p.id} className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-2">
                        <span className="inline-flex rounded-full bg-gray-100 text-gray-700 px-2 py-0.5 text-[11px] font-semibold">
                          {fileKind(p.mimeType, p.nomOriginal).label}
                        </span>
                        <span>{p.nomOriginal} ({Math.round(p.tailleOctets / 1024)} Ko)</span>
                      </span>
                      <div className="flex items-center gap-1">
                        {fileKind(p.mimeType, p.nomOriginal).canPreview ? (
                          <button
                            type="button"
                            onClick={() => void onViewPiece(p.id, p.mimeType)}
                            className="text-xs rounded-lg border border-gray-200 px-2 py-1 hover:border-orange-300 hover:text-orange-700"
                          >
                            Ouvrir
                          </button>
                        ) : (
                          <button
                            type="button"
                            disabled
                            title="Prévisualisation non disponible pour ce format"
                            className="text-xs rounded-lg border border-gray-200 px-2 py-1 text-gray-400 cursor-not-allowed"
                          >
                            Ouvrir
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => void onDownloadPiece(p.id, p.nomOriginal)}
                          className="text-xs rounded-lg border border-gray-200 px-2 py-1 hover:border-orange-300 hover:text-orange-700"
                        >
                          Télécharger
                        </button>
                        <button
                          type="button"
                          onClick={() => void onDeletePiece(p.id)}
                          className="text-xs rounded-lg border border-red-200 text-red-700 px-2 py-1 hover:bg-red-50"
                        >
                          Supprimer
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="flex justify-end pt-2">
              <button type="button" onClick={() => setViewRow(null)} className="px-4 py-2 rounded-xl border border-gray-200 text-sm">Fermer</button>
            </div>
          </div>
        </div>
      )}

      {editRow && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={() => !savingEdit && setEditRow(null)}>
          <form onSubmit={onSubmitEdit} className="bg-white rounded-2xl shadow-xl max-w-lg w-full p-6 border border-gray-100 space-y-3" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-gray-900">Modifier le point</h2>
            <input required value={eSujet} onChange={e => setESujet(e.target.value)} placeholder="Sujet" className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm" />
            <textarea value={eDesc} onChange={e => setEDesc(e.target.value)} placeholder="Description" className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm min-h-[90px]" />
            <div className="grid grid-cols-2 gap-2">
              <select value={eType} onChange={e => setEType(e.target.value as TypePoint)} className="rounded-xl border border-gray-200 px-3 py-2.5 text-sm">{Object.entries(TYPE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
              <select value={ePriorite} onChange={e => setEPriorite(e.target.value as Priorite)} className="rounded-xl border border-gray-200 px-3 py-2.5 text-sm">{Object.entries(PRIORITE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
              <select value={eStatut} onChange={e => setEStatut(e.target.value as Statut)} className="rounded-xl border border-gray-200 px-3 py-2.5 text-sm">{Object.entries(STATUT_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
              <select value={eResponsableUserId} onChange={e => setEResponsableUserId(e.target.value)} className="rounded-xl border border-gray-200 px-3 py-2.5 text-sm"><option value="">Responsable (optionnel)</option>{responsables.map(u => <option key={u.id} value={u.id}>{u.nom}</option>)}</select>
              <DatePickerFr value={eEcheance} onChange={setEEcheance} placeholder="Échéance" />
            </div>
            <div className="flex gap-2 pt-2">
              <button type="submit" disabled={savingEdit} className="flex-1 py-2.5 rounded-xl bg-orange-500 text-white text-sm font-semibold hover:bg-orange-600 disabled:opacity-50">
                {savingEdit ? "…" : "Enregistrer"}
              </button>
              <button type="button" disabled={savingEdit} onClick={() => setEditRow(null)} className="px-4 py-2.5 rounded-xl border border-gray-200 text-sm">Annuler</button>
            </div>
          </form>
        </div>
      )}
    </Layout>
  )
}

