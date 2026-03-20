"use client"

import { useState, useEffect, useRef } from "react"
import { useRouter, usePathname } from "next/navigation"
import Link from "next/link"
import Cookies from "js-cookie"

interface Props {
  children: React.ReactNode
}

export default function Layout({ children }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const [user, setUser] = useState<{
    prenom?: string
    nom?: string
    email?: string
    role?: string
    totpActif?: boolean
  } | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    try {
      const u = Cookies.get("user")
      if (u) setUser(JSON.parse(u))
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener("click", onDocClick)
    return () => document.removeEventListener("click", onDocClick)
  }, [])

  function logout() {
    Cookies.remove("token")
    Cookies.remove("user")
    setMenuOpen(false)
    router.push("/login")
  }

  const navItems = [
    { label: "Tableau de Bord", href: "/dashboard" },
    { label: "Clients", href: "/clients" },
    { label: "Écritures", href: "/ecritures" },
    { label: "BAL | GL", href: "/bal-gl" },
    { label: "Rapprochement bancaire", href: "/rapprochement-bancaire" },
    { label: "Clôture mensuelle", href: "/cloture-mensuelle" },
    { label: "DSF & Déclarations", href: "/dsf" },
    { label: "Paie", href: "/paie" },
  ]

  return (
    <div
      className="min-h-screen"
      style={{
        backgroundImage: "url('/images/Background.png')",
        backgroundSize: "cover",
        backgroundPosition: "center",
        backgroundRepeat: "no-repeat",
        backgroundAttachment: "fixed",
      }}
    >
      <div className="px-8 py-4 no-print">
        <div className="max-w-7xl mx-auto">
          <div className="bg-white rounded-2xl shadow-lg px-6 py-3 flex items-center justify-between relative z-50 isolate">
            <div
              className="flex items-center gap-2 cursor-pointer"
              onClick={() => router.push("/dashboard")}
            >
              <img src="/images/logo.png" alt="Logo" className="h-8 w-8 object-contain" />
              <span className="font-bold text-gray-900 text-lg">
                Ivoire<span className="text-orange-500">Compta</span>
              </span>
            </div>

            <nav className="flex-1 min-w-0 mx-4 overflow-x-auto whitespace-nowrap hide-scrollbar">
              <div className="inline-flex items-center gap-1 min-w-max">
              {navItems.map(item => (
                <button
                  key={item.href}
                  onClick={() => router.push(item.href)}
                  className={`px-4 py-2 text-sm transition-colors relative rounded-md [-webkit-font-smoothing:auto] ${
                    pathname === item.href
                      ? "font-semibold text-orange-600 tracking-tight"
                      : "font-medium text-gray-700 hover:text-gray-900"
                  }`}
                >
                  {item.label}
                  {pathname === item.href && (
                    <div className="absolute bottom-0 left-1 right-1 h-0.5 bg-orange-600 rounded-full" />
                  )}
                </button>
              ))}
              </div>
            </nav>

            <div className="flex items-center gap-3">
              <button type="button" className="p-2 text-gray-400 hover:text-gray-600" aria-hidden>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
                  />
                </svg>
              </button>

              <button type="button" className="relative p-2 text-gray-400 hover:text-gray-600" aria-hidden>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                  />
                </svg>
                <span className="absolute top-1 right-1 w-4 h-4 bg-orange-500 rounded-full text-white text-xs flex items-center justify-center">
                  3
                </span>
              </button>

              <div className="relative pl-3 border-l border-gray-100" ref={menuRef}>
                <button
                  type="button"
                  onClick={e => {
                    e.stopPropagation()
                    setMenuOpen(v => !v)
                  }}
                  className="flex items-center gap-2 cursor-pointer rounded-lg py-1 pr-1 hover:bg-gray-50 transition-colors"
                  aria-expanded={menuOpen}
                  aria-haspopup="true"
                >
                  <div className="w-9 h-9 rounded-full bg-orange-100 flex items-center justify-center">
                    <span className="text-orange-600 font-semibold text-sm">
                      {user?.prenom?.[0] ?? ""}
                      {user?.nom?.[0] ?? ""}
                    </span>
                  </div>
                  <span className="text-sm font-medium text-gray-700 max-w-[120px] truncate">
                    {user?.prenom ? `${user.prenom} ${user?.nom ?? ""}` : user?.nom ?? "Compte"}
                  </span>
                  <svg
                    className={`w-4 h-4 text-gray-400 shrink-0 transition-transform ${menuOpen ? "rotate-180" : ""}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {menuOpen && (
                  <div
                    className="absolute right-0 top-full mt-2 w-52 rounded-xl border border-gray-100 bg-white shadow-xl py-1 z-[100]"
                    role="menu"
                  >
                    <Link
                      href="/parametres"
                      onClick={() => setMenuOpen(false)}
                      className="flex items-center gap-2 px-4 py-2.5 text-sm text-gray-700 hover:bg-orange-50 hover:text-orange-700"
                      role="menuitem"
                    >
                      <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                        />
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                        />
                      </svg>
                      Paramètres
                    </Link>
                    <button
                      type="button"
                      onClick={logout}
                      className="flex w-full items-center gap-2 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 text-left"
                      role="menuitem"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
                        />
                      </svg>
                      Déconnexion
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      <main>{children}</main>
    </div>
  )
}
