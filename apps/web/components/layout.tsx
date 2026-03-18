"use client"

import { useState, useEffect } from "react"
import { useRouter, usePathname } from "next/navigation"
import Cookies from "js-cookie"

interface Props { children: React.ReactNode }

export default function Layout({ children }: Props) {
  const router   = useRouter()
  const pathname = usePathname()
  const [user, setUser] = useState<any>(null)

  useEffect(() => {
    try {
      const u = Cookies.get("user")
      if (u) setUser(JSON.parse(u))
    } catch {}
  }, [])

  function logout() {
    Cookies.remove("token")
    Cookies.remove("user")
    router.push("/login")
  }

  const navItems = [
    { label: "Tableau de Bord",    href: "/dashboard" },
    { label: "Clients",            href: "/clients" },
    { label: "Écritures",          href: "/ecritures" },
    { label: "DSF & Déclarations", href: "/dsf" },
    { label: "Paie",               href: "/paie" },
    { label: "Paramètres",         href: "/parametres" },
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
      {/* Header flottant */}
      <div className="px-8 py-4">
        <div className="max-w-7xl mx-auto">
          <div className="bg-white rounded-2xl shadow-lg px-6 py-3 flex items-center justify-between relative z-50 isolate">

            {/* Logo */}
            <div
              className="flex items-center gap-2 cursor-pointer"
              onClick={() => router.push("/dashboard")}
            >
              <img src="/images/logo.png" alt="Logo" className="h-8 w-8 object-contain" />
              <span className="font-bold text-gray-900 text-lg">
                Ivoire<span className="text-orange-500">Compta</span>
              </span>
            </div>

            {/* Navigation */}
            <nav className="flex items-center gap-1">
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
            </nav>

            {/* Droite */}
            <div className="flex items-center gap-3">
              <button className="p-2 text-gray-400 hover:text-gray-600">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                </svg>
              </button>

              <button className="relative p-2 text-gray-400 hover:text-gray-600">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
                <span className="absolute top-1 right-1 w-4 h-4 bg-orange-500 rounded-full text-white text-xs flex items-center justify-center">3</span>
              </button>

              <div
                className="flex items-center gap-2 cursor-pointer pl-3 border-l border-gray-100"
                onClick={logout}
              >
                <div className="w-9 h-9 rounded-full bg-orange-100 flex items-center justify-center">
                  <span className="text-orange-600 font-semibold text-sm">
                    {user?.prenom?.[0] ?? ""}{user?.nom?.[0] ?? ""}
                  </span>
                </div>
                <span className="text-sm font-medium text-gray-700">
                  M. {user?.nom ?? ""}
                </span>
                <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </div>
          </div>
        </div>
      </div>

      <main>{children}</main>
    </div>
  )
}