/**
 * IvoireCompta — Route /auth
 * Login JWT + 2FA TOTP pour visa expert-comptable
 */

import { FastifyInstance } from "fastify"
import { z } from "zod"
import bcrypt from "bcryptjs"
import { authenticator } from "otplib"
import { PrismaClient } from "@prisma/client"

const prisma = new PrismaClient()

const LoginSchema = z.object({
  email:    z.string().email(),
  password: z.string().min(8),
  totp:     z.string().length(6).optional(), // Requis pour visa expert
})

const PatchMeSchema = z
  .object({
    prenom:         z.string().min(1, "Prénom requis").max(100).optional(),
    nom:            z.string().min(1, "Nom requis").max(100).optional(),
    email:          z.string().email("E-mail invalide").optional(),
    specialisation: z.string().max(120).optional().nullable(),
    numeroOrdre:    z.string().max(80).optional().nullable(),
  })
  .refine(o => Object.keys(o).length > 0, { message: "Aucun champ à mettre à jour" })

const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Mot de passe actuel requis"),
  newPassword:     z.string().min(8, "Mot de passe : minimum 8 caractères"),
})

const RegisterSchema = z.object({
  /** Cabinet */
  cabinetNom:       z.string().min(2, "Nom du cabinet requis").max(200),
  numeroOrdre:      z.string().min(3, "N° d'ordre ONECCA requis"),
  rccm:             z.string().max(80).optional().or(z.literal("")),
  adresse:          z.string().max(500).optional().or(z.literal("")),
  secteurActivite:  z.string().max(120).optional().or(z.literal("")),
  cabinetEmail:     z.string().email(),
  cabinetTelephone: z.string().max(30).optional().or(z.literal("")),
  /** NIF / N° contribuable DGI (optionnel sauf si facturation) */
  ncc: z.string().max(50).optional().or(z.literal("")),
  gestionFacturation: z.boolean().optional(),
  /** Premier utilisateur */
  prenom:            z.string().min(1, "Prénom requis"),
  nom:               z.string().min(1, "Nom requis"),
  email:             z.string().email(),
  password:          z.string().min(8, "Mot de passe : minimum 8 caractères"),
  expertNumeroOrdre: z.string().max(80).optional().or(z.literal("")),
  specialisation:    z.string().max(120).optional().or(z.literal("")),
})

export async function authRoutes(app: FastifyInstance) {

  /**
   * POST /auth/register
   * Création d'un cabinet + premier expert-comptable (inscription publique MVP)
   */
  app.post("/register", async (request, reply) => {
    const parsed = RegisterSchema.safeParse(request.body)
    if (!parsed.success) {
      const msg = parsed.error.flatten().fieldErrors
      const first = Object.values(msg).flat()[0] ?? "Données invalides"
      return reply.status(400).send({ error: first })
    }
    const d = parsed.data
    const tel = d.cabinetTelephone?.trim() || null
    const rccm = d.rccm?.trim() || null
    const adresse = d.adresse?.trim() || null
    const secteur = d.secteurActivite?.trim() || null
    const spec = d.specialisation?.trim() || null
    const ncc = d.ncc?.trim() || null
    if (d.gestionFacturation && (!ncc || ncc.length < 3)) {
      return reply.status(400).send({
        error:
          "Le NIF (numéro d'identification fiscale / N° contribuable) est obligatoire si le cabinet gère la facturation.",
      })
    }
    const noCabinet = d.numeroOrdre.trim()
    const noExpert = (d.expertNumeroOrdre?.trim() || noCabinet)

    const existingUser = await prisma.utilisateur.findFirst({
      where: { email: d.email.toLowerCase() },
    })
    if (existingUser) {
      return reply.status(409).send({
        error: "Cet email est déjà associé à un compte. Connectez-vous ou utilisez un autre email.",
      })
    }

    const existingCabinet = await prisma.cabinet.findUnique({
      where: { numeroOrdre: noCabinet },
    })
    if (existingCabinet) {
      return reply.status(409).send({
        error: "Un cabinet est déjà enregistré avec ce numéro d'ordre ONECCA.",
      })
    }

    const passwordHash = await bcrypt.hash(d.password, 10)

    try {
      const result = await prisma.$transaction(async tx => {
        const cabinet = await tx.cabinet.create({
          data: {
            nom:              d.cabinetNom.trim(),
            numeroOrdre:      noCabinet,
            rccm,
            adresse,
            secteurActivite:  secteur,
            email:            d.cabinetEmail.toLowerCase(),
            telephone:        tel,
            ncc,
          },
        })
        const utilisateur = await tx.utilisateur.create({
          data: {
            cabinetId:     cabinet.id,
            nom:           d.nom.trim(),
            prenom:        d.prenom.trim(),
            email:         d.email.toLowerCase(),
            passwordHash,
            role:          "EXPERT_COMPTABLE",
            numeroOrdre:   noExpert,
            specialisation: spec,
          },
        })
        await tx.parametreCabinet.create({
          data: {
            cabinetId:     cabinet.id,
            emailAlertes:  d.email.toLowerCase(),
          },
        })
        await tx.auditLog.create({
          data: {
            cabinetId:  cabinet.id,
            userId:     utilisateur.id,
            action:     "CABINET_INSCRIT",
            entite:     "cabinets",
            entiteId:   cabinet.id,
            donneeApres: { nom: cabinet.nom, numeroOrdre: noCabinet } as object,
            ipAddress:  request.ip,
          },
        })
        return { cabinet, utilisateur }
      })

      const token = app.jwt.sign({
        id:        result.utilisateur.id,
        cabinetId: result.utilisateur.cabinetId,
        role:      result.utilisateur.role,
        nom:       `${result.utilisateur.prenom} ${result.utilisateur.nom}`,
      })

      return reply.status(201).send({
        token,
        utilisateur: {
          id:        result.utilisateur.id,
          nom:       result.utilisateur.nom,
          prenom:    result.utilisateur.prenom,
          email:     result.utilisateur.email,
          role:      result.utilisateur.role,
          totpActif: result.utilisateur.totpActif,
          cabinet: {
            id:          result.cabinet.id,
            nom:         result.cabinet.nom,
            numeroOrdre: result.cabinet.numeroOrdre,
          },
        },
      })
    } catch (e) {
      app.log.error(e)
      return reply.status(500).send({ error: "Inscription impossible pour le moment. Réessayez plus tard." })
    }
  })

  /**
   * POST /auth/login
   * Authentification standard (email + mot de passe)
   * Le 2FA TOTP est vérifié séparément pour le visa DSF
   */
  app.post("/login", async (request, reply) => {
    const parsed = LoginSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: "Données invalides" })
    }
    const { email, password } = parsed.data

    const utilisateur = await prisma.utilisateur.findFirst({
      where: { email, actif: true },
      include: { cabinet: { select: { id: true, nom: true, numeroOrdre: true } } },
    })

    if (!utilisateur || !(await bcrypt.compare(password, utilisateur.passwordHash))) {
      return reply.status(401).send({ error: "Email ou mot de passe incorrect" })
    }

    // Mise à jour dernier accès
    await prisma.utilisateur.update({
      where: { id: utilisateur.id },
      data: { dernierAcces: new Date() },
    })

    const token = app.jwt.sign({
      id:        utilisateur.id,
      cabinetId: utilisateur.cabinetId,
      role:      utilisateur.role,
      nom:       `${utilisateur.prenom} ${utilisateur.nom}`,
    })

    return reply.send({
      token,
      utilisateur: {
        id:           utilisateur.id,
        nom:          utilisateur.nom,
        prenom:       utilisateur.prenom,
        email:        utilisateur.email,
        role:         utilisateur.role,
        totpActif:    utilisateur.totpActif,
        cabinet:      utilisateur.cabinet,
      },
    })
  })

  /**
   * GET /auth/me
   * Profil connecté + cabinet (paramètres)
   */
  app.get("/me", async (request, reply) => {
    const jwt = request.user as { id: string; cabinetId: string }
    const u = await prisma.utilisateur.findFirst({
      where: { id: jwt.id, cabinetId: jwt.cabinetId, actif: true },
      include: { cabinet: true },
    })
    if (!u) return reply.status(404).send({ error: "Utilisateur introuvable" })
    const c = u.cabinet
    return reply.send({
      utilisateur: {
        id: u.id,
        prenom: u.prenom,
        nom: u.nom,
        email: u.email,
        role: u.role,
        numeroOrdre: u.numeroOrdre,
        specialisation: u.specialisation,
        totpActif: u.totpActif,
        dernierAcces: u.dernierAcces,
        createdAt: u.createdAt,
      },
      cabinet: {
        id: c.id,
        nom: c.nom,
        numeroOrdre: c.numeroOrdre,
        rccm: c.rccm,
        ncc: c.ncc,
        secteurActivite: c.secteurActivite,
        adresse: c.adresse,
        telephone: c.telephone,
        email: c.email,
        regimeFiscal: c.regimeFiscal,
        planComptable: c.planComptable,
      },
    })
  })

  /**
   * PATCH /auth/me
   * Mise à jour du profil connecté (pas le rôle)
   */
  app.patch("/me", async (request, reply) => {
    const parsed = PatchMeSchema.safeParse(request.body)
    if (!parsed.success) {
      const msg = parsed.error.flatten().fieldErrors
      const first = Object.values(msg).flat()[0] ?? parsed.error.flatten().formErrors[0] ?? "Données invalides"
      return reply.status(400).send({ error: first })
    }
    const jwt = request.user as { id: string; cabinetId: string; role: string }
    const body = parsed.data

    const existing = await prisma.utilisateur.findFirst({
      where: { id: jwt.id, cabinetId: jwt.cabinetId, actif: true },
    })
    if (!existing) return reply.status(404).send({ error: "Utilisateur introuvable" })

    if (body.email !== undefined) {
      const emailNorm = body.email.trim().toLowerCase()
      const dup = await prisma.utilisateur.findFirst({
        where: {
          cabinetId: jwt.cabinetId,
          email:     emailNorm,
          NOT:       { id: jwt.id },
          actif:     true,
        },
      })
      if (dup) {
        return reply.status(409).send({
          error: "Cet e-mail est déjà utilisé par un autre compte du cabinet.",
        })
      }
    }

    const spec =
      body.specialisation === undefined
        ? undefined
        : body.specialisation === null || body.specialisation.trim() === ""
          ? null
          : body.specialisation.trim()

    const no =
      body.numeroOrdre === undefined
        ? undefined
        : body.numeroOrdre === null || String(body.numeroOrdre).trim() === ""
          ? null
          : String(body.numeroOrdre).trim()

    if (jwt.role !== "EXPERT_COMPTABLE" && no !== undefined && no !== null) {
      return reply.status(403).send({
        error: "Seul un expert-comptable peut renseigner un n° d'ordre ONECCA personnel.",
      })
    }

    try {
      await prisma.utilisateur.update({
        where: { id: jwt.id },
        data: {
          ...(body.prenom !== undefined && { prenom: body.prenom.trim() }),
          ...(body.nom !== undefined && { nom: body.nom.trim() }),
          ...(body.email !== undefined && { email: body.email.trim().toLowerCase() }),
          ...(body.specialisation !== undefined && { specialisation: spec }),
          ...(body.numeroOrdre !== undefined && { numeroOrdre: no }),
        },
      })
    } catch (e: unknown) {
      const code = (e as { code?: string })?.code
      if (code === "P2002") {
        return reply.status(409).send({ error: "Cet e-mail est déjà utilisé." })
      }
      throw e
    }

    await prisma.auditLog.create({
      data: {
        cabinetId: jwt.cabinetId,
        userId:    jwt.id,
        action:    "PROFIL_MODIFIE",
        entite:    "utilisateurs",
        entiteId:  jwt.id,
        ipAddress: request.ip,
      },
    })

    const u = await prisma.utilisateur.findFirst({
      where: { id: jwt.id, cabinetId: jwt.cabinetId, actif: true },
      include: { cabinet: true },
    })
    if (!u) return reply.status(404).send({ error: "Utilisateur introuvable" })
    const c = u.cabinet
    return reply.send({
      utilisateur: {
        id: u.id,
        prenom: u.prenom,
        nom: u.nom,
        email: u.email,
        role: u.role,
        numeroOrdre: u.numeroOrdre,
        specialisation: u.specialisation,
        totpActif: u.totpActif,
        dernierAcces: u.dernierAcces,
        createdAt: u.createdAt,
      },
      cabinet: {
        id: c.id,
        nom: c.nom,
        numeroOrdre: c.numeroOrdre,
        rccm: c.rccm,
        ncc: c.ncc,
        secteurActivite: c.secteurActivite,
        adresse: c.adresse,
        telephone: c.telephone,
        email: c.email,
        regimeFiscal: c.regimeFiscal,
        planComptable: c.planComptable,
      },
    })
  })

  /**
   * POST /auth/password
   * Changement du mot de passe (401 évité pour ne pas déclencher une déconnexion côté client axios)
   */
  app.post("/password", async (request, reply) => {
    const parsed = ChangePasswordSchema.safeParse(request.body)
    if (!parsed.success) {
      const msg = parsed.error.flatten().fieldErrors
      const first = Object.values(msg).flat()[0] ?? "Données invalides"
      return reply.status(400).send({ error: first })
    }
    const jwt = request.user as { id: string; cabinetId: string }
    const { currentPassword, newPassword } = parsed.data

    const u = await prisma.utilisateur.findFirst({
      where: { id: jwt.id, cabinetId: jwt.cabinetId, actif: true },
    })
    if (!u) return reply.status(404).send({ error: "Utilisateur introuvable" })

    const ok = await bcrypt.compare(currentPassword, u.passwordHash)
    if (!ok) {
      return reply.status(400).send({ error: "Mot de passe actuel incorrect." })
    }

    const passwordHash = await bcrypt.hash(newPassword, 10)
    await prisma.utilisateur.update({
      where: { id: jwt.id },
      data:  { passwordHash },
    })

    await prisma.auditLog.create({
      data: {
        cabinetId: jwt.cabinetId,
        userId:    jwt.id,
        action:    "MOT_DE_PASSE_MODIFIE",
        entite:    "utilisateurs",
        entiteId:  jwt.id,
        ipAddress: request.ip,
      },
    })

    return reply.send({ message: "Mot de passe mis à jour." })
  })

  /**
   * POST /auth/visa/verifier
   * Vérifie le code TOTP avant d'apposer un visa sur une DSF
   * Endpoint séparé — action critique avec traçabilité
   */
  app.post("/visa/verifier", async (request, reply) => {
    const user = request.user as { id: string; role: string; cabinetId: string }

    if (user.role !== "EXPERT_COMPTABLE") {
      return reply.status(403).send({
        error: "Seul un expert-comptable inscrit à l'ONECCA-CI peut viser une DSF"
      })
    }

    const { totpCode } = request.body as { totpCode: string }

    const utilisateur = await prisma.utilisateur.findUnique({
      where: { id: user.id },
    })

    const devBypassCode = process.env.DEV_VISA_BYPASS_CODE || "000000"
    const bypassVisaDev =
      process.env.NODE_ENV !== "production" &&
      totpCode === devBypassCode

    if (bypassVisaDev) {
      const visaToken = app.jwt.sign(
        { id: user.id, cabinetId: user.cabinetId, scope: "VISA_DSF" },
        { expiresIn: "15m" }
      )
      await prisma.auditLog.create({
        data: {
          cabinetId: user.cabinetId,
          userId:    user.id,
          action:    "VISA_TOTP_BYPASS_DEV",
          entite:    "utilisateurs",
          entiteId:  user.id,
          donneeApres: { code: "DEV_BYPASS" },
        },
      })
      return reply.send({ visaToken, expiresIn: 900, bypass: true })
    }

    if (!utilisateur?.totpActif || !utilisateur.totpSecret) {
      return reply.status(400).send({
        error: "L'authentification à deux facteurs n'est pas configurée. Activez-la dans vos paramètres de compte."
      })
    }

    const isValid = authenticator.verify({
      token:  totpCode,
      secret: utilisateur.totpSecret,
    })

    if (!isValid) {
      await prisma.auditLog.create({
        data: {
          cabinetId: user.cabinetId,
          userId:    user.id,
          action:    "VISA_TOTP_ECHEC",
          entite:    "utilisateurs",
          entiteId:  user.id,
        },
      })
      return reply.status(401).send({ error: "Code d'authentification incorrect ou expiré" })
    }

    // Token de visa à courte durée (15 minutes)
    const visaToken = app.jwt.sign(
      { id: user.id, cabinetId: user.cabinetId, scope: "VISA_DSF" },
      { expiresIn: "15m" }
    )

    await prisma.auditLog.create({
      data: {
        cabinetId: user.cabinetId,
        userId:    user.id,
        action:    "VISA_TOTP_VALIDE",
        entite:    "utilisateurs",
        entiteId:  user.id,
      },
    })

    return reply.send({ visaToken, expiresIn: 900 })
  })

  /**
   * POST /auth/totp/setup
   * Configure le 2FA pour un expert-comptable
   */
  app.post("/totp/setup", async (request, reply) => {
    const user = request.user as { id: string; role: string }

    if (user.role !== "EXPERT_COMPTABLE") {
      return reply.status(403).send({ error: "Réservé aux experts-comptables" })
    }

    const secret = authenticator.generateSecret()
    const utilisateur = await prisma.utilisateur.findUnique({ where: { id: user.id } })

    const otpAuthUrl = authenticator.keyuri(
      utilisateur?.email ?? "",
      "IvoireCompta",
      secret
    )

    // Stocker temporairement (avant confirmation)
    await prisma.utilisateur.update({
      where: { id: user.id },
      data:  { totpSecret: secret, totpActif: false },
    })

    return reply.send({ secret, otpAuthUrl })
  })

  /**
   * POST /auth/totp/confirmer
   * Confirme la configuration 2FA avec un premier code valide
   */
  app.post("/totp/confirmer", async (request, reply) => {
    const user = request.user as { id: string }
    const { totpCode } = request.body as { totpCode: string }

    const utilisateur = await prisma.utilisateur.findUnique({ where: { id: user.id } })
    if (!utilisateur?.totpSecret) {
      return reply.status(400).send({ error: "Configurez d'abord le 2FA via /auth/totp/setup" })
    }

    const isValid = authenticator.verify({ token: totpCode, secret: utilisateur.totpSecret })
    if (!isValid) {
      return reply.status(401).send({ error: "Code incorrect — réessayez" })
    }

    await prisma.utilisateur.update({
      where: { id: user.id },
      data:  { totpActif: true },
    })

    return reply.send({ message: "Authentification à deux facteurs activée avec succès" })
  })
}
