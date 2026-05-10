import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { apiGet, apiPost, ApiError, apiUrl } from "./api"

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal("fetch", vi.fn())
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const okResponse = body => ({
  ok: true,
  status: 200,
  headers: { get: () => "application/json" },
  json: async () => body,
  text: async () => JSON.stringify(body),
})

const errResponse = (status, body) => ({
  ok: false,
  status,
  headers: { get: () => "application/json" },
  json: async () => body,
  text: async () => JSON.stringify(body),
})

describe("apiUrl", () => {
  it("préfixe les chemins relatifs avec API", () => {
    expect(apiUrl("/foo")).toMatch(/\/foo$/)
    expect(apiUrl("foo")).toMatch(/\/foo$/)
  })

  it("laisse passer les URLs absolues", () => {
    expect(apiUrl("https://other.example/x")).toBe("https://other.example/x")
  })
})

describe("apiGet", () => {
  it("retourne le JSON quand 200 OK", async () => {
    fetch.mockResolvedValueOnce(okResponse({ hello: "world" }))

    await expect(apiGet("/test")).resolves.toEqual({ hello: "world" })
  })

  it("lève ApiError avec le detail FastAPI quand 4xx", async () => {
    fetch.mockResolvedValueOnce(errResponse(404, { detail: "introuvable" }))

    await expect(apiGet("/missing")).rejects.toMatchObject({
      name: "ApiError",
      status: 404,
      message: "introuvable",
    })
  })

  it("détecte les réponses 200 avec detail legacy", async () => {
    fetch.mockResolvedValueOnce(okResponse({ detail: "rien à afficher" }))

    await expect(apiGet("/legacy")).rejects.toBeInstanceOf(ApiError)
  })
})

describe("apiPost", () => {
  it("encode le body en JSON et passe Content-Type", async () => {
    fetch.mockResolvedValueOnce(okResponse({ ok: true }))

    await apiPost("/echo", { a: 1, b: "x" })

    const [, init] = fetch.mock.calls[0]
    expect(init.method).toBe("POST")
    expect(init.body).toBe(JSON.stringify({ a: 1, b: "x" }))
    expect(init.headers["Content-Type"]).toBe("application/json")
  })
})
