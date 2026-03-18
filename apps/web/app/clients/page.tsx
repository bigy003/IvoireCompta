"use client"

import { useEffect, useState, useMemo } from "react"
import { useRouter } from "next/navigation"
import Cookies from "js-cookie"
import Layout from "@/components/layout"
import { getClients, createClient, updateClient, deleteClient } from "@/lib/api"

type ClientRow = {
  id: string
  ncc: string
  nomRaisonSociale: string
  formeJuridique: string
  regimeImposition?: string
  assujettitTVA?: boolean
  email?: string | null
  telephone?: string | null
  actif: boolean
}

const FORMES = [
  { v: "SARL", l: "SARL" },
  { v: "SA", l: "SA" },
  { v: "SAS", l: "SAS" },
  { v: "SNC", l: "SNC" },
  { v: "EI", l: "Entreprise individuelle" },
  { v: "GIE", l: "GIE" },
  { v: "ASSOCIATION", l: "Association" },
  { v: "ONG", l: "ONG" },
  { v: "AUTRE", l: "Autre" },
]

const REGIMES = [
  { v: "REEL_NORMAL", l: "Réel normal" },
  { v: "REEL_SIMPLIFIE", l: "Réel simplifié" },
  { v: "BIC_SIMPLIFIE", l: "BIC simplifié" },
  { v: "BNC", l: "BNC" },
  { v: "ZONE_FRANCHE_ZICI", l: "Zone franche / ZICI" },
]

function libelleForme(code: string) {
  return FORMES.find(f => f.v === code)?.l ?? code
}

function initiales(nom: string) {
  const parts = nom.trim().split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return nom.slice(0, 2).toUpperCase() || "?"
}

const PAGE_SIZES = [7, 10, 25, 50]

function emptyCreateFields() {
  return {
    ncc: "",
    nomRaisonSociale: "",
    formeJuridique: "SARL",
    regimeImposition: "REEL_NORMAL",
    assujettitTVA: true,
    email: "",
    telephone: "",
  }
}

export default function ClientsPage() {
  const router = useRouter()
  const [authLoading, setAuthLoading] = useState(true)
  const [clients, setClients] = useState<ClientRow[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState("")
  const [succes, setSucces] = useState("")
  const [showForm, setShowForm] = useState(false)
  const [editingClient, setEditingClient] = useState<ClientRow | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<ClientRow | null>(null)
  const [deleting, setDeleting] = useState(false)

  const [search, setSearch] = useState("")
  const [filterType, setFilterType] = useState("")
  const [filterStatut, setFilterStatut] = useState<"" | "actif" | "inactif">("")
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(7)

  const [ncc, setNcc] = useState("")
  const [nomRaisonSociale, setNomRaisonSociale] = useState("")
  const [formeJuridique, setFormeJuridique] = useState("SARL")
  const [regimeImposition, setRegimeImposition] = useState("REEL_NORMAL")
  const [assujettitTVA, setAssujettitTVA] = useState(true)
  const [email, setEmail] = useState("")
  const [telephone, setTelephone] = useState("")
  const [editActif, setEditActif] = useState(true)

  const stats = useMemo(() => {
    const total = clients.length
    const actifs = clients.filter(c => c.actif).length
    const inactifs = total - actifs
    return { total, actifs, inactifs }
  }, [clients])

  const filtered = useMemo(() => {
    let list = clients
    const q = search.trim().toLowerCase()
    if (q) {
      list = list.filter(
        c =>
          c.nomRaisonSociale.toLowerCase().includes(q) ||
          c.ncc.toLowerCase().includes(q) ||
          (c.email && c.email.toLowerCase().includes(q)) ||
          (c.telephone && c.telephone.includes(q))
      )
    }
    if (filterType) list = list.filter(c => c.formeJuridique === filterType)
    if (filterStatut === "actif") list = list.filter(c => c.actif)
    if (filterStatut === "inactif") list = list.filter(c => !c.actif)
    return list
  }, [clients, search, filterType, filterStatut])

  const totalFiltered = filtered.length
  const pageCount = Math.max(1, Math.ceil(totalFiltered / pageSize))
  const pageSafe = Math.min(page, pageCount)
  const pageSlice = useMemo(() => {
    const start = (pageSafe - 1) * pageSize
    return filtered.slice(start, start + pageSize)
  }, [filtered, pageSafe, pageSize])

  useEffect(() => {
    setPage(1)
  }, [search, filterType, filterStatut, pageSize])

  function fillFormFromClient(c: ClientRow) {
    setNcc(c.ncc)
    setNomRaisonSociale(c.nomRaisonSociale)
    setFormeJuridique(c.formeJuridique || "SARL")
    setRegimeImposition(c.regimeImposition || "REEL_NORMAL")
    setAssujettitTVA(c.assujettitTVA !== false)
    setEmail(c.email ?? "")
    setTelephone(c.telephone ?? "")
    setEditActif(c.actif)
  }

  function resetCreateForm() {
    const e = emptyCreateFields()
    setNcc(e.ncc)
    setNomRaisonSociale(e.nomRaisonSociale)
    setFormeJuridique(e.formeJuridique)
    setRegimeImposition(e.regimeImposition)
    setAssujettitTVA(e.assujettitTVA)
    setEmail(e.email)
    setTelephone(e.telephone)
  }

  useEffect(() => {
    if (!Cookies.get("token")) {
      router.push("/login")
      return
    }
    setAuthLoading(false)
    load()
  }, [router])

  async function load() {
    setLoading(true)
    setErr("")
    try {
      const r = await getClients({ tous: true })
      const raw = r.data.clients ?? []
      setClients(
        raw.map((c: ClientRow & { actif?: boolean }) => ({
          ...c,
          actif: c.actif !== false,
        }))
      )
    } catch {
      setErr("Impossible de charger les clients.")
    } finally {
      setLoading(false)
    }
  }

  async function onSubmitCreate(e: React.FormEvent) {
    e.preventDefault()
    setErr("")
    setSucces("")
    setSubmitting(true)
    try {
      const r = await createClient({
        ncc: ncc.trim(),
        nomRaisonSociale: nomRaisonSociale.trim(),
        formeJuridique,
        regimeImposition,
        assujettitTVA,
        email: email.trim() || undefined,
        telephone: telephone.trim() || undefined,
      })
      const annee = r.data.comptabilite?.exerciceAnnee
      setSucces(
        annee
          ? `Client créé — exercice ${annee} et journaux prêts.`
          : "Client créé."
      )
      setShowForm(false)
      resetCreateForm()
      await load()
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        ((e as { response?: { status?: number } })?.response?.status === 409
          ? "Ce NCC existe déjà."
          : "Échec de la création.")
      setErr(typeof msg === "string" ? msg : "Erreur.")
    } finally {
      setSubmitting(false)
    }
  }

  async function onSubmitEdit(e: React.FormEvent) {
    e.preventDefault()
    if (!editingClient) return
    setErr("")
    setSucces("")
    setSubmitting(true)
    try {
      await updateClient(editingClient.id, {
        ncc: ncc.trim(),
        nomRaisonSociale: nomRaisonSociale.trim(),
        formeJuridique,
        regimeImposition,
        assujettitTVA,
        email: email.trim(),
        telephone: telephone.trim(),
        actif: editActif,
      })
      setSucces("Client mis à jour.")
      setEditingClient(null)
      resetCreateForm()
      await load()
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        ((e as { response?: { status?: number } })?.response?.status === 409
          ? "NCC déjà utilisé."
          : "Échec de la mise à jour.")
      setErr(typeof msg === "string" ? msg : "Erreur.")
    } finally {
      setSubmitting(false)
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return
    const removedId = deleteTarget.id
    const removedNom = deleteTarget.nomRaisonSociale
    setDeleting(true)
    setErr("")
    try {
      await deleteClient(removedId)
      setSucces(`« ${removedNom} » désactivé.`)
      setDeleteTarget(null)
      if (editingClient?.id === removedId) {
        setEditingClient(null)
        resetCreateForm()
      }
      await load()
    } catch {
      setErr("Impossible de supprimer.")
    } finally {
      setDeleting(false)
    }
  }

  const formFields = (isEdit: boolean) => (
    <>
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">NCC *</label>
        <input
          required
          className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm"
          value={ncc}
          onChange={e => setNcc(e.target.value)}
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Raison sociale *</label>
        <input
          required
          className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm"
          value={nomRaisonSociale}
          onChange={e => setNomRaisonSociale(e.target.value)}
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Forme juridique</label>
        <select
          className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm"
          value={formeJuridique}
          onChange={e => setFormeJuridique(e.target.value)}
        >
          {FORMES.map(f => (
            <option key={f.v} value={f.v}>
              {f.l}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Régime</label>
        <select
          className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm"
          value={regimeImposition}
          onChange={e => setRegimeImposition(e.target.value)}
        >
          {REGIMES.map(f => (
            <option key={f.v} value={f.v}>
              {f.l}
            </option>
          ))}
        </select>
      </div>
      <div className="md:col-span-2 flex items-center gap-2">
        <input
          id="tva-modal"
          type="checkbox"
          checked={assujettitTVA}
          onChange={e => setAssujettitTVA(e.target.checked)}
          className="rounded border-gray-300 text-orange-500"
        />
        <label htmlFor="tva-modal" className="text-sm text-gray-700">
          Assujetti TVA
        </label>
      </div>
      {isEdit && (
        <div className="md:col-span-2 flex items-center gap-2">
          <input
            id="actif-modal"
            type="checkbox"
            checked={editActif}
            onChange={e => setEditActif(e.target.checked)}
            className="rounded border-gray-300 text-orange-500"
          />
          <label htmlFor="actif-modal" className="text-sm text-gray-700">
            Client actif (visible dans les listes métier)
          </label>
        </div>
      )}
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">E-mail</label>
        <input
          type="email"
          className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm"
          value={email}
          onChange={e => setEmail(e.target.value)}
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Téléphone</label>
        <input
          className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm"
          value={telephone}
          onChange={e => setTelephone(e.target.value)}
        />
      </div>
    </>
  )

  if (authLoading) {
    return (
      <Layout>
        <div className="max-w-7xl mx-auto px-6 py-12 text-center text-gray-600">Chargement…</div>
      </Layout>
    )
  }

  const from = totalFiltered === 0 ? 0 : (pageSafe - 1) * pageSize + 1
  const to = Math.min(pageSafe * pageSize, totalFiltered)

  return (
    <Layout>
      <div className="max-w-7xl mx-auto px-6 py-8 pb-24">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Clients</h1>
          <p className="text-sm text-gray-500 mt-1">Gestion des entreprises suivies par votre cabinet</p>
        </div>

        {succes && (
          <div className="mb-4 rounded-xl bg-orange-50 border border-orange-100 text-orange-900 px-4 py-3 text-sm">
            {succes}
          </div>
        )}
        {err && !showForm && !editingClient && (
          <div className="mb-4 rounded-xl bg-red-50 border border-red-100 text-red-800 px-4 py-3 text-sm">{err}</div>
        )}

        {/* Cartes stats */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 mb-8">
          <div className="bg-white/95 backdrop-blur rounded-2xl shadow-md border border-gray-100/80 p-5 flex items-start gap-4">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-orange-100 text-orange-600">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
                />
              </svg>
            </div>
            <div>
              <p className="text-sm font-medium text-gray-500">Total clients</p>
              <p className="text-3xl font-bold text-orange-600 tabular-nums mt-0.5">{stats.total}</p>
            </div>
          </div>
          <div className="bg-white/95 backdrop-blur rounded-2xl shadow-md border border-gray-100/80 p-5 flex items-start gap-4">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-orange-100 text-orange-600">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-medium text-gray-500">Clients actifs</p>
              <p className="text-3xl font-bold text-orange-600 tabular-nums mt-0.5">{stats.actifs}</p>
            </div>
          </div>
          <div className="bg-white/95 backdrop-blur rounded-2xl shadow-md border border-gray-100/80 p-5 flex items-start gap-4">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-red-100 text-red-600">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"
                />
              </svg>
            </div>
            <div>
              <p className="text-sm font-medium text-gray-500">Clients inactifs</p>
              <p className="text-3xl font-bold text-red-700 tabular-nums mt-0.5">{stats.inactifs}</p>
            </div>
          </div>
        </div>

        {/* Barre filtres */}
        <div className="bg-white/95 backdrop-blur rounded-2xl shadow-md border border-gray-100/80 p-4 mb-6 flex flex-col lg:flex-row lg:items-center gap-4">
          <div className="relative flex-1 min-w-[200px]">
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="search"
              placeholder="Rechercher un client…"
              className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-gray-200 text-sm focus:ring-2 focus:ring-orange-500/30 focus:border-orange-500 outline-none"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <select
              className="rounded-xl border border-gray-200 px-3 py-2.5 text-sm text-gray-700 min-w-[140px] bg-white"
              value={filterType}
              onChange={e => setFilterType(e.target.value)}
            >
              <option value="">Type (tous)</option>
              {FORMES.map(f => (
                <option key={f.v} value={f.v}>
                  {f.l}
                </option>
              ))}
            </select>
            <select
              className="rounded-xl border border-gray-200 px-3 py-2.5 text-sm text-gray-700 min-w-[140px] bg-white"
              value={filterStatut}
              onChange={e => setFilterStatut(e.target.value as "" | "actif" | "inactif")}
            >
              <option value="">Statut (tous)</option>
              <option value="actif">Actif</option>
              <option value="inactif">Inactif</option>
            </select>
            <button
              type="button"
              onClick={() => {
                resetCreateForm()
                setErr("")
                setShowForm(true)
              }}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold shadow-md shadow-orange-500/25 transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Nouveau client
            </button>
          </div>
        </div>

        {/* Tableau */}
        <div className="bg-white/95 backdrop-blur rounded-2xl shadow-md border border-gray-100/80 overflow-hidden">
          {loading ? (
            <div className="p-16 text-center text-gray-500 text-sm">Chargement…</div>
          ) : totalFiltered === 0 ? (
            <div className="p-16 text-center text-gray-500 text-sm">
              {clients.length === 0 ? "Aucun client. Créez-en un avec le bouton vert." : "Aucun résultat pour ces filtres."}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50/90 border-b border-gray-100 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    <th className="px-5 py-4">Client</th>
                    <th className="px-5 py-4">E-mail</th>
                    <th className="px-5 py-4">Type / Téléphone</th>
                    <th className="px-5 py-4">Statut</th>
                    <th className="px-5 py-4 w-24 text-center">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {pageSlice.map(c => (
                    <tr key={c.id} className="hover:bg-gray-50/60 transition-colors">
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3">
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-orange-500 to-orange-600 text-xs font-bold text-white shadow-sm">
                            {initiales(c.nomRaisonSociale)}
                          </div>
                          <div className="min-w-0">
                            <p className="font-semibold text-gray-900 truncate">{c.nomRaisonSociale}</p>
                            <p className="text-xs text-gray-400 font-mono truncate">{c.ncc}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-4 text-gray-600 max-w-[200px]">
                        {c.email?.trim() ? (
                          <span className="break-all">{c.email}</span>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>
                      <td className="px-5 py-4">
                        <div className="text-gray-800 font-medium">{libelleForme(c.formeJuridique)}</div>
                        <div className="text-gray-500 text-xs mt-0.5">
                          {c.telephone?.trim() || "—"}
                        </div>
                      </td>
                      <td className="px-5 py-4">
                        {c.actif ? (
                          <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800">
                            Actif
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-red-100 text-red-800">
                            Inactif
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            type="button"
                            title="Modifier"
                            aria-label="Modifier"
                            onClick={() => {
                              setShowForm(false)
                              setErr("")
                              setEditingClient(c)
                              fillFormFromClient(c)
                            }}
                            className="p-2 rounded-lg text-gray-400 hover:bg-orange-50 hover:text-orange-600 transition-colors"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
                              />
                            </svg>
                          </button>
                          {c.actif && (
                            <button
                              type="button"
                              title="Désactiver"
                              aria-label="Désactiver"
                              onClick={() => {
                                setDeleteTarget(c)
                                setErr("")
                              }}
                              className="p-2 rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-600 transition-colors"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={2}
                                  d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                                />
                              </svg>
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {!loading && totalFiltered > 0 && (
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 px-5 py-4 border-t border-gray-100 bg-gray-50/50 text-sm text-gray-600">
              <p>
                Affichage <span className="font-medium text-gray-900">{from}</span> –{" "}
                <span className="font-medium text-gray-900">{to}</span> sur{" "}
                <span className="font-medium text-gray-900">{totalFiltered}</span> client
                {totalFiltered > 1 ? "s" : ""}
              </p>
              <div className="flex flex-wrap items-center gap-4">
                <label className="flex items-center gap-2 text-sm">
                  <span className="text-gray-500">Par page</span>
                  <select
                    className="rounded-lg border border-gray-200 px-2 py-1.5 text-sm bg-white"
                    value={pageSize}
                    onChange={e => setPageSize(Number(e.target.value))}
                  >
                    {PAGE_SIZES.map(n => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    disabled={pageSafe <= 1}
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    className="px-3 py-1.5 rounded-lg border border-gray-200 bg-white text-sm disabled:opacity-40 hover:bg-gray-50"
                  >
                    Précédent
                  </button>
                  <span className="px-3 py-1.5 text-sm font-medium text-gray-800">
                    {pageSafe} / {pageCount}
                  </span>
                  <button
                    type="button"
                    disabled={pageSafe >= pageCount}
                    onClick={() => setPage(p => Math.min(pageCount, p + 1))}
                    className="px-3 py-1.5 rounded-lg border border-gray-200 bg-white text-sm disabled:opacity-40 hover:bg-gray-50"
                  >
                    Suivant
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Modal création */}
      {showForm && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto border border-gray-100">
            <div className="p-6 border-b border-gray-100 flex items-center justify-between">
              <h2 className="text-lg font-bold text-gray-900">Nouveau client</h2>
              <button
                type="button"
                onClick={() => {
                  setShowForm(false)
                  resetCreateForm()
                  setErr("")
                }}
                className="p-2 rounded-lg text-gray-400 hover:bg-gray-100"
                aria-label="Fermer"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <form onSubmit={onSubmitCreate} className="p-6 grid gap-4 md:grid-cols-2">
              {err && <div className="md:col-span-2 text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{err}</div>}
              {formFields(false)}
              <div className="md:col-span-2 flex gap-3 pt-2">
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex-1 py-2.5 rounded-xl bg-orange-500 text-white font-semibold text-sm hover:bg-orange-600 disabled:opacity-50"
                >
                  {submitting ? "…" : "Créer"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowForm(false)
                    resetCreateForm()
                  }}
                  className="px-5 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-700"
                >
                  Annuler
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal édition */}
      {editingClient && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto border border-gray-100">
            <div className="p-6 border-b border-gray-100 flex items-center justify-between">
              <h2 className="text-lg font-bold text-gray-900">Modifier le client</h2>
              <button
                type="button"
                onClick={() => {
                  setEditingClient(null)
                  resetCreateForm()
                  setErr("")
                }}
                className="p-2 rounded-lg text-gray-400 hover:bg-gray-100"
                aria-label="Fermer"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <form onSubmit={onSubmitEdit} className="p-6 grid gap-4 md:grid-cols-2">
              {err && <div className="md:col-span-2 text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{err}</div>}
              {formFields(true)}
              <div className="md:col-span-2 flex gap-3 pt-2">
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex-1 py-2.5 rounded-xl bg-orange-500 text-white font-semibold text-sm hover:bg-orange-600 disabled:opacity-50"
                >
                  {submitting ? "…" : "Enregistrer"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditingClient(null)
                    resetCreateForm()
                  }}
                  className="px-5 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-700"
                >
                  Annuler
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/45"
          role="dialog"
          aria-modal="true"
        >
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6 border border-gray-100">
            <h3 className="text-lg font-semibold text-gray-900">Désactiver ce client ?</h3>
            <p className="mt-2 text-sm text-gray-600">
              <strong>{deleteTarget.nomRaisonSociale}</strong> passera en <strong>inactif</strong>. Vous pourrez le
              réactiver depuis la fiche (modifier → case « Client actif »).
            </p>
            <div className="mt-6 flex flex-col-reverse sm:flex-row gap-3 sm:justify-end">
              <button
                type="button"
                disabled={deleting}
                onClick={() => setDeleteTarget(null)}
                className="px-4 py-2.5 rounded-xl border border-gray-200 text-sm font-medium"
              >
                Annuler
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={confirmDelete}
                className="px-4 py-2.5 rounded-xl bg-red-600 text-white text-sm font-semibold hover:bg-red-700 disabled:opacity-60"
              >
                {deleting ? "…" : "Désactiver"}
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  )
}
