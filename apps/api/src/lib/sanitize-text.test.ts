import { describe, expect, it } from "vitest"
import { sanitizeLibelleCompta } from "./sanitize-text.js"

describe("sanitizeLibelleCompta", () => {
  it("convertit le tiret cadratin Word (U+2014) en tiret ASCII", () => {
    expect(sanitizeLibelleCompta("Logiciel de comptabilité — licence 3 ans")).toBe(
      "Logiciel de comptabilité - licence 3 ans"
    )
  })

  it("convertit le tiret demi-cadratin (U+2013) en tiret ASCII", () => {
    expect(sanitizeLibelleCompta("A\u2013B")).toBe("A-B")
  })

  it("retire le carré blanc U+25A1 avant NFC (espace consolidé)", () => {
    expect(sanitizeLibelleCompta("Compte\u25A1Client")).toBe("Compte Client")
  })

  it("retire les autres symboles géométriques (ex. U+25AF)", () => {
    expect(sanitizeLibelleCompta("Texte\u25AFfin")).toBe("Texte fin")
  })

  it("conserve les accents français, n° et la casse", () => {
    expect(sanitizeLibelleCompta("Immobilisation n° 1 — Véhicule à Abidjan")).toBe(
      "Immobilisation n° 1 - Véhicule à Abidjan"
    )
  })

  it("conserve € et guillemets français", () => {
    expect(sanitizeLibelleCompta("« Matériel 100 € »")).toBe("« Matériel 100 € »")
  })

  it("normalise null / undefined en chaîne vide", () => {
    expect(sanitizeLibelleCompta(null)).toBe("")
    expect(sanitizeLibelleCompta(undefined)).toBe("")
  })

  it("accepte un nombre (référence numérique)", () => {
    expect(sanitizeLibelleCompta(2024)).toBe("2024")
  })

  it("réduit les espaces multiples et trim", () => {
    expect(sanitizeLibelleCompta("  IMMO\u2014001  ")).toBe("IMMO-001")
  })

  it("retire le BOM Unicode", () => {
    expect(sanitizeLibelleCompta("\uFEFFSans BOM")).toBe("Sans BOM")
  })

  it("remplace le signe multiplication × par « x » espacé", () => {
    expect(sanitizeLibelleCompta("3×5 m")).toBe("3 x 5 m")
  })
})
