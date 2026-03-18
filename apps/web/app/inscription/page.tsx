"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import Cookies from "js-cookie"
import { register } from "@/lib/api"
import { getPasswordStrength } from "@/lib/inscription-secteurs"
import { AuthFloatingHeader } from "@/components/auth-floating-header"

const SECTEURS = [
  "Audit & Comptabilité",
  "Fiscalité",
  "Conseil financier",
  "Juridique",
  "Paie & social",
  "Pluridisciplinaire",
  "Autre",
]

const SPECS = [
  "Commissaire aux comptes",
  "Expert judiciaire",
  "Conseil fiscal",
  "Comptabilité",
  "Autre",
]

export default function InscriptionPage() {
  const router = useRouter()

  const [cabinetNom, setCabinetNom] = useState("")
  const [rccm, setRccm] = useState("")
  const [numeroOrdre, setNumeroOrdre] = useState("")
  const [secteur, setSecteur] = useState("")
  const [cabinetTelephone, setCabinetTelephone] = useState("")
  const [adresse, setAdresse] = useState("")
  const [cabinetEmail, setCabinetEmail] = useState("")
  /** NIF = N° contribuable DGI (stocké en ncc) */
  const [nif, setNif] = useState("")
  const [gestionFacturation, setGestionFacturation] = useState(false)

  const [prenom, setPrenom] = useState("")
  const [nom, setNom] = useState("")
  const [expertNumeroOrdre, setExpertNumeroOrdre] = useState("")
  const [specialisation, setSpecialisation] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [passwordConfirm, setPasswordConfirm] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [showPasswordConfirm, setShowPasswordConfirm] = useState(false)
  const [acceptCgu, setAcceptCgu] = useState(false)

  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  const strength = useMemo(() => getPasswordStrength(password), [password])

  function effectiveCabinetNom(): string {
    return cabinetNom.trim()
  }

  function effectiveCabinetEmail(): string {
    return cabinetEmail.trim().toLowerCase()
  }

  function validate(): string | null {
    if (
      password.length > 0 &&
      passwordConfirm.length > 0 &&
      password !== passwordConfirm
    ) {
      return "Les mots de passe ne sont pas identiques. Vérifiez le champ « Confirmer le mot de passe »."
    }

    const manquants: string[] = []
    if (cabinetNom.trim().length < 2) manquants.push("nom du cabinet")
    if (numeroOrdre.trim().length < 3) manquants.push("n° ONECCA du cabinet")
    if (!secteur) manquants.push("secteur d'activité")
    if (!cabinetTelephone.trim()) manquants.push("téléphone du cabinet")
    if (!adresse.trim()) manquants.push("adresse du cabinet")
    if (!cabinetEmail.trim()) manquants.push("email du cabinet")
    if (!prenom.trim()) manquants.push("prénom")
    if (!nom.trim()) manquants.push("nom")
    if (!email.trim()) manquants.push("email professionnel (connexion)")
    if (password.length < 8) manquants.push("mot de passe (8 caractères minimum)")
    if (passwordConfirm.length === 0 || password !== passwordConfirm) {
      if (password.length >= 8) manquants.push("confirmation du mot de passe (identique)")
    }
    if (gestionFacturation && nif.trim().length < 3) {
      manquants.push("NIF (obligatoire si vous émettez des factures)")
    }
    if (!acceptCgu) manquants.push("acceptation des CGU")

    if (manquants.length > 0) {
      return `Veuillez remplir tous les champs obligatoires : ${manquants.join(", ")}.`
    }
    return null
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const v = validate()
    if (v) {
      setError(v)
      return
    }
    setError("")
    setLoading(true)
    try {
      await register({
        cabinetNom: effectiveCabinetNom(),
        numeroOrdre: numeroOrdre.trim(),
        cabinetEmail: effectiveCabinetEmail(),
        cabinetTelephone: cabinetTelephone.trim(),
        rccm: rccm.trim() || undefined,
        adresse: adresse.trim(),
        secteurActivite: secteur,
        prenom: prenom.trim(),
        nom: nom.trim(),
        email: email.trim().toLowerCase(),
        password,
        expertNumeroOrdre: (() => {
          const ex = expertNumeroOrdre.trim() || numeroOrdre.trim()
          return ex !== numeroOrdre.trim() ? ex : undefined
        })(),
        specialisation: specialisation || undefined,
        ncc: nif.trim() || undefined,
        gestionFacturation: gestionFacturation || undefined,
      })
      const loginEmail = encodeURIComponent(email.trim().toLowerCase())
      router.push(`/login?registered=1&email=${loginEmail}`)
    } catch (err: unknown) {
      setError(
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
          "Inscription impossible. Réessayez."
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="iv-registration" style={{ fontFamily: "var(--font-inter), Inter, sans-serif" }}>
      <div className="bg-illustration" aria-hidden />

      <AuthFloatingHeader logoHref="/login" />

      <main className="iv-main iv-main--with-floating-header">
        <div className="card">
          <h1 className="card-title">
            Créer un compte <span>IvoireCompta</span>
          </h1>
          <p className="card-subtitle">
            Rejoignez des milliers de professionnels en Côte d&apos;Ivoire
          </p>

          <form onSubmit={handleSubmit}>
            {error && <div className="form-error">{error}</div>}

            <hr className="divider" />
            <div className="section-label">Informations du Cabinet</div>

            <div className="form-grid">
              <div className="field span2">
                <label>Nom du Cabinet *</label>
                <div className="input-wrap">
                  <svg viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2">
                    <path d="M3 21h18M3 7v1m0 4v1m0 4v1M21 7v1m0 4v1m0 4v1M9 21V3h6v18" />
                  </svg>
                  <input
                    type="text"
                    placeholder="Ex : Cabinet Expertise Abidjan"
                    value={cabinetNom}
                    onChange={e => setCabinetNom(e.target.value)}
                  />
                </div>
              </div>

              <div className="field span2">
                <label>RCCM — Registre du Commerce (optionnel)</label>
                <div className="input-wrap">
                  <svg viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2">
                    <rect x="5" y="2" width="14" height="20" rx="2" />
                    <path d="M9 7h6M9 11h6M9 15h4" />
                  </svg>
                  <input
                    type="text"
                    placeholder="CI-ABJ-2024-XXX"
                    value={rccm}
                    onChange={e => setRccm(e.target.value)}
                  />
                </div>
                <span style={{ fontSize: "0.72rem", color: "#9ca3af" }}>
                  Immatriculation commerciale de la structure — pas le n° d&apos;ordre des experts-comptables.
                </span>
              </div>

              <div className="field">
                <label>N° ONECCA du cabinet *</label>
                <div className="input-wrap">
                  <svg viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2">
                    <rect x="5" y="2" width="14" height="20" rx="2" />
                    <path d="M9 7h6M9 11h6M9 15h4" />
                  </svg>
                  <input
                    type="text"
                    placeholder="Référence ONECCA du cabinet"
                    value={numeroOrdre}
                    onChange={e => setNumeroOrdre(e.target.value)}
                  />
                </div>
              </div>

              <div className="field">
                <label>Secteur d&apos;activité *</label>
                <div className="input-wrap">
                  <svg viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2">
                    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                  </svg>
                  <select value={secteur} onChange={e => setSecteur(e.target.value)} required>
                    <option value="">Sélectionner</option>
                    {SECTEURS.map(s => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="field">
                <label>Téléphone du Cabinet *</label>
                <div className="input-wrap">
                  <svg viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2">
                    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 13a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.56 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 9.4a16 16 0 0 0 6.72 6.72l.88-.88a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
                  </svg>
                  <input
                    type="tel"
                    placeholder="+225 07 XX XX XX XX"
                    value={cabinetTelephone}
                    onChange={e => setCabinetTelephone(e.target.value)}
                  />
                </div>
              </div>

              <div className="field span2">
                <label>Email du cabinet *</label>
                <div className="input-wrap">
                  <svg viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2">
                    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                    <polyline points="22,6 12,13 2,6" />
                  </svg>
                  <input
                    type="email"
                    placeholder="contact@cabinet.ci"
                    value={cabinetEmail}
                    onChange={e => setCabinetEmail(e.target.value)}
                  />
                </div>
              </div>

              <div className="field span2">
                <label>
                  NIF — Numéro d&apos;identification fiscale (N° contribuable DGI)
                  {gestionFacturation ? " *" : " (optionnel)"}
                </label>
                <div className="input-wrap">
                  <svg viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" />
                  </svg>
                  <input
                    type="text"
                    placeholder="N° contribuable (carte / attestation DGI)"
                    value={nif}
                    onChange={e => setNif(e.target.value)}
                    required={gestionFacturation}
                  />
                </div>
                <label
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 8,
                    marginTop: 10,
                    cursor: "pointer",
                    fontSize: "0.82rem",
                    fontWeight: 500,
                    color: "var(--gray-700)",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={gestionFacturation}
                    onChange={e => setGestionFacturation(e.target.checked)}
                    style={{ marginTop: 3, accentColor: "var(--green)" }}
                  />
                  <span>
                    Notre cabinet <strong>émet des factures</strong> (honoraires, prestations) — le{" "}
                    <strong>NIF devient obligatoire</strong> pour la conformité fiscale des factures.
                  </span>
                </label>
              </div>

              <div className="field span2">
                <label>Adresse du Cabinet *</label>
                <div className="input-wrap">
                  <svg viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2">
                    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                    <circle cx="12" cy="10" r="3" />
                  </svg>
                  <input
                    type="text"
                    placeholder="Ex : Plateau, Avenue Botreau Roussel, Abidjan"
                    value={adresse}
                    onChange={e => setAdresse(e.target.value)}
                  />
                </div>
              </div>
            </div>

            <hr className="divider" />
            <div className="section-label">Compte Expert-Comptable</div>

            <div className="form-grid">
              <div className="field">
                <label>Prénom *</label>
                <div className="input-wrap">
                  <svg viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                    <circle cx="12" cy="7" r="4" />
                  </svg>
                  <input
                    type="text"
                    placeholder="Prénom"
                    value={prenom}
                    onChange={e => setPrenom(e.target.value)}
                  />
                </div>
              </div>

              <div className="field">
                <label>Nom *</label>
                <div className="input-wrap">
                  <svg viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                    <circle cx="12" cy="7" r="4" />
                  </svg>
                  <input
                    type="text"
                    placeholder="Nom de famille"
                    value={nom}
                    onChange={e => setNom(e.target.value)}
                  />
                </div>
              </div>

              <div className="field">
                <label>N° ONECCA personnel (expert-comptable) *</label>
                <div className="input-wrap">
                  <svg viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2">
                    <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
                    <rect x="9" y="3" width="6" height="4" rx="2" />
                  </svg>
                  <input
                    type="text"
                    placeholder="ONECCA-CI-XXXX (vide = même n° que le cabinet)"
                    value={expertNumeroOrdre}
                    onChange={e => setExpertNumeroOrdre(e.target.value)}
                  />
                </div>
              </div>

              <div className="field">
                <label>Spécialisation</label>
                <div className="input-wrap">
                  <svg viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2">
                    <circle cx="12" cy="12" r="10" />
                    <path d="M12 8v4l3 3" />
                  </svg>
                  <select value={specialisation} onChange={e => setSpecialisation(e.target.value)}>
                    <option value="">Choisir</option>
                    {SPECS.map(s => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="field span2">
                <label>Adresse Email professionnelle *</label>
                <div className="input-wrap">
                  <svg viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2">
                    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                    <polyline points="22,6 12,13 2,6" />
                  </svg>
                  <input
                    type="email"
                    placeholder="expert@cabinet.ci"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                  />
                </div>
              </div>

              <div className="field">
                <label>Mot de passe *</label>
                <div className="relative">
                  <div className="input-wrap">
                    <svg viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2">
                      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                    </svg>
                    <input
                      type={showPassword ? "text" : "password"}
                      placeholder="••••••••"
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      autoComplete="new-password"
                      className="!pr-[4.5rem]"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs font-semibold text-gray-500 hover:text-gray-800"
                  >
                    {showPassword ? "Masquer" : "Afficher"}
                  </button>
                </div>
                <div className="strength-bar">
                  {[1, 2, 3, 4].map(i => (
                    <div key={i} className={i <= strength.level ? "ok" : ""} />
                  ))}
                </div>
                <span className="strength-label">
                  Force du mot de passe : {strength.level === 0 ? "—" : strength.label}
                </span>
              </div>

              <div className="field">
                <label>Confirmer le mot de passe *</label>
                <div className="relative">
                  <div className="input-wrap">
                    <svg viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2">
                      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                    </svg>
                    <input
                      type={showPasswordConfirm ? "text" : "password"}
                      placeholder="••••••••"
                      value={passwordConfirm}
                      onChange={e => setPasswordConfirm(e.target.value)}
                      autoComplete="new-password"
                      className="!pr-[4.5rem]"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowPasswordConfirm(!showPasswordConfirm)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs font-semibold text-gray-500 hover:text-gray-800"
                  >
                    {showPasswordConfirm ? "Masquer" : "Afficher"}
                  </button>
                </div>
              </div>
            </div>

            <div className="cgu-block">
              <h3>Acceptation des Conditions Générales d&apos;Utilisation (CGU)</h3>
              <div className="checkbox-row" style={{ marginBottom: 0 }}>
                <input
                  type="checkbox"
                  id="cgu"
                  checked={acceptCgu}
                  onChange={e => setAcceptCgu(e.target.checked)}
                />
                <label htmlFor="cgu">
                  J&apos;ai lu et j&apos;accepte sans réserve les{" "}
                  <a href="#" onClick={e => e.preventDefault()}>
                    Conditions Générales d&apos;Utilisation
                  </a>{" "}
                  ainsi que la{" "}
                  <a href="#" onClick={e => e.preventDefault()}>
                    Politique de confidentialité
                  </a>{" "}
                  d&apos;IvoireCompta. Je confirme l&apos;exactitude des informations fournies.
                </label>
              </div>
            </div>

            <button type="submit" className="btn-submit" disabled={loading}>
              {loading ? "Création en cours…" : "Créer mon compte IvoireCompta"}
            </button>
          </form>

          <p className="login-link">
            Vous avez déjà un compte ?{" "}
            <Link href="/login">Connectez-vous</Link>
          </p>
        </div>
      </main>
    </div>
  )
}
