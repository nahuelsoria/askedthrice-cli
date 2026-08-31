import { describe, expect, it } from "vitest";
import { describeFailure, parseArgs, run } from "../src/cli.js";
import { ApiError } from "../src/api.js";

// Ningun test toca la API de verdad: cada medicion gasta plata en tres
// proveedores, asi que una suite que llamara a prod costaria dinero cada vez
// que corre. `fetch` se reemplaza por uno de mentira que ademas deja ver QUE se
// mando, que es la mitad de lo que hay que probar en un cliente HTTP.

function fakeFetch({ status = 200, body = {}, headers = {} } = {}) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init, body: init?.body ? JSON.parse(init.body) : null });
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (name) => headers[name.toLowerCase()] ?? null },
      text: async () => JSON.stringify(body),
    };
  };
  impl.calls = calls;
  return impl;
}

describe("parseArgs", () => {
  it("separa posicionales de banderas", () => {
    const { command, positional, flags } = parseArgs(["check", "Acme", "--category", "CRM"]);
    expect(command).toBe("check");
    expect(positional).toEqual(["Acme"]);
    expect(flags.category).toBe("CRM");
  });

  it("acepta --flag=valor", () => {
    expect(parseArgs(["repeat", "x", "--provider=gemini"]).flags.provider).toBe("gemini");
  });

  // El bug que tenia antes de existir este test: `--json` se comia el
  // posicional siguiente y la marca se perdia.
  it("las banderas booleanas no se comen el argumento siguiente", () => {
    const { positional, flags } = parseArgs(["check", "--json", "Acme"]);
    expect(flags.json).toBe(true);
    expect(positional).toEqual(["Acme"]);
  });
});

describe("check", () => {
  const respuesta = {
    brand: "Acme",
    category: "CRM",
    verdict: "barely_visible",
    knows: true,
    description: "Acme is a CRM.",
    recommendations: ["Salesforce", "Acme", "Pipedrive"],
    listPosition: 2,
    recommendVerdict: "unsure",
    recommendReason: "Little public information.",
    model: "gemini-3.1-flash-lite",
    score: 55,
  };

  it("manda brand y category al endpoint correcto", async () => {
    const fetchImpl = fakeFetch({ body: respuesta });
    await run(["check", "Acme", "--category", "CRM"], { fetchImpl });

    expect(fetchImpl.calls[0].url).toBe("https://askedthrice.com/api/check");
    expect(fetchImpl.calls[0].init.method).toBe("POST");
    expect(fetchImpl.calls[0].body).toEqual({ brand: "Acme", category: "CRM" });
  });

  it("junta una marca de varias palabras", async () => {
    const fetchImpl = fakeFetch({ body: respuesta });
    await run(["check", "Asked", "Thrice"], { fetchImpl });
    expect(fetchImpl.calls[0].body.brand).toBe("Asked Thrice");
  });

  it("muestra el veredicto en palabras y marca la posicion de la marca", async () => {
    const salida = await run(["check", "Acme"], { fetchImpl: fakeFetch({ body: respuesta }) });
    expect(salida).toContain("barely visible");
    expect(salida).toContain("<- this brand");
  });

  // Regla del producto, no del CLI: el puntaje no se muestra en ninguna
  // pantalla porque no es consistente entre corridas. Una terminal es una
  // pantalla mas.
  it("no imprime el puntaje", async () => {
    const salida = await run(["check", "Acme"], { fetchImpl: fakeFetch({ body: respuesta }) });
    expect(salida).not.toContain("55");
  });

  it("--json devuelve la respuesta cruda, con puntaje incluido", async () => {
    const salida = await run(["check", "Acme", "--json"], { fetchImpl: fakeFetch({ body: respuesta }) });
    expect(JSON.parse(salida)).toEqual(respuesta);
  });
});

describe("repeat", () => {
  const respuesta = {
    question: "best CRM",
    provider: "openai",
    model: "gpt-4.1-mini",
    runsRequested: 5,
    runs: [],
    metrics: {
      okRuns: 5,
      comparable: true,
      pairs: 10,
      sameSetPairs: 2,
      jaccardMean: 0.62,
      union: 9,
      inAll: ["Salesforce"],
      once: ["Zoho", "Close"],
      perRun: [],
    },
  };

  it("reporta lo que se movio entre corridas", async () => {
    const salida = await run(["repeat", "best CRM"], { fetchImpl: fakeFetch({ body: respuesta }) });
    expect(salida).toContain("5 of 5 runs");
    expect(salida).toContain("2 of 10 run pairs");
    expect(salida).toContain("62%");
    expect(salida).toContain("Zoho");
  });
});

describe("audit", () => {
  it("exige website y category antes de gastar una corrida", async () => {
    const fetchImpl = fakeFetch({ body: {} });
    await expect(run(["audit", "Acme"], { fetchImpl })).rejects.toThrow(/--website is required/);
    await expect(run(["audit", "Acme", "--website", "acme.com"], { fetchImpl })).rejects.toThrow(/--category is required/);
    // Lo que importa: no salio ni una request.
    expect(fetchImpl.calls).toHaveLength(0);
  });

  it("manda los campos opcionales solo cuando estan", async () => {
    const fetchImpl = fakeFetch({ body: { id: "abc", providerFindings: [] } });
    await run(["audit", "Acme", "--website", "acme.com", "--category", "CRM"], { fetchImpl });
    expect(fetchImpl.calls[0].body).toEqual({ brand: "Acme", website: "acme.com", category: "CRM" });

    await run(["audit", "Acme", "--website", "acme.com", "--category", "CRM", "--language", "es", "--location", "Argentina"], { fetchImpl });
    expect(fetchImpl.calls[1].body.promptLanguage).toBe("es");
    expect(fetchImpl.calls[1].body.location).toBe("Argentina");
  });

  it("dice como seguir con el mapa", async () => {
    const salida = await run(["audit", "Acme", "--website", "acme.com", "--category", "CRM"], {
      fetchImpl: fakeFetch({ body: { id: "abc-123", providerFindings: [{ provider: "openai" }], productFanout: { questions: [] } } }),
    });
    expect(salida).toContain("askedthrice map abc-123");
  });
});

describe("map", () => {
  it("por defecto solo lee, y no dispara una medicion", async () => {
    const fetchImpl = fakeFetch({ body: { ok: true, map: null } });
    await run(["map", "abc-123"], { fetchImpl });
    expect(fetchImpl.calls[0].init.method).toBe("GET");
  });

  it("con --start la dispara", async () => {
    const fetchImpl = fakeFetch({ body: { ok: true, map: { rows: [] } } });
    await run(["map", "abc-123", "--start"], { fetchImpl });
    expect(fetchImpl.calls[0].init.method).toBe("POST");
  });

  it("un mapa que todavia no esta se dice, y no se confunde con vacio", async () => {
    const salida = await run(["map", "abc"], { fetchImpl: fakeFetch({ body: { ok: true } }) });
    expect(salida).toContain("still being measured");
  });
});

describe("errores", () => {
  // La razon por la que la API devuelve `hint`: sin eso, un 429 es un callejon.
  it("un 429 dice cuanto esperar", async () => {
    const fetchImpl = fakeFetch({
      status: 429,
      body: { error: "Too many audit requests. Try again later.", code: "rate_limited", hint: "Wait for the number of seconds in Retry-After.", docs: "https://askedthrice.com/developers" },
      headers: { "retry-after": "120" },
    });

    const error = await run(["check", "Acme"], { fetchImpl }).catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.code).toBe("rate_limited");

    const mensaje = describeFailure(error);
    expect(mensaje).toContain("Too many audit requests");
    expect(mensaje).toContain("Wait about 2 minutes");
  });

  it("un 400 muestra el hint que explica que campo falta", async () => {
    const fetchImpl = fakeFetch({
      status: 400,
      body: { error: "Brand name is required.", code: "missing_brand", hint: 'Send a JSON body with a non-empty "brand" string.', docs: "x" },
    });
    const error = await run(["check", "Acme"], { fetchImpl }).catch((e) => e);
    expect(describeFailure(error)).toContain('non-empty "brand" string');
  });

  // Un 502 de la CDN no es la API contestando, y decir que si seria mentir
  // sobre de donde viene el problema.
  it("una respuesta sin JSON no se disfraza de error de la API", async () => {
    const impl = async () => ({ ok: false, status: 502, headers: { get: () => null }, text: async () => "<html>Bad Gateway</html>" });
    const error = await run(["check", "Acme"], { fetchImpl: impl }).catch((e) => e);
    expect(error.code).toBe("unexpected_response");
    expect(describeFailure(error)).toContain("without a JSON body");
  });

  it("un comando inventado nombra los que existen", async () => {
    const error = await run(["medir"], { fetchImpl: fakeFetch() }).catch((e) => e);
    expect(error.message).toContain("--help");
  });
});

describe("ayuda y version", () => {
  it("sin argumentos muestra la ayuda", async () => {
    expect(await run([], { fetchImpl: fakeFetch() })).toContain("askedthrice check");
  });

  it("la ayuda nombra la spec y los limites", async () => {
    const ayuda = await run(["--help"], { fetchImpl: fakeFetch() });
    expect(ayuda).toContain("https://askedthrice.com/openapi.json");
    expect(ayuda).toContain("429");
  });

  it("--version imprime la version del paquete", async () => {
    expect(await run(["--version"], { fetchImpl: fakeFetch() })).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

// La version que imprime el CLI y la que se publica en npm tienen que ser la
// misma: si se separan, alguien reporta un bug contra una version que no corre.
describe("la version no se puede desincronizar", () => {
  it("VERSION sale de package.json", async () => {
    const { readFileSync } = await import("node:fs");
    const { VERSION } = await import("../src/cli.js");
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    expect(VERSION).toBe(pkg.version);
  });
});
