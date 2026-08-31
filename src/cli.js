// El CLI de askedthrice.com: medir desde una terminal o desde un script, sin
// construir una integracion contra la API.
//
// Envuelve los endpoints publicos que describe https://askedthrice.com/openapi.json.
// Todos contestan sin cuenta, sin API key y sin cookie: no hay nada que
// configurar y no hay credencial que guardar.
//
// `--json` imprime la respuesta cruda de la API. Es lo que usa un agente o un
// script; la salida legible es para una persona.

import { ApiError, DEFAULT_BASE_URL, DEFAULT_TIMEOUT_MS, checkBrand, getBuyerQuestionMap, repeatQuestion, startAudit, startBuyerQuestionMap } from "./api.js";
import { renderAudit, renderCheck, renderMap, renderRepeat } from "./render.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// La version sale de package.json y no de un literal: dos numeros que hay que
// acordarse de subir juntos terminan diciendo cosas distintas, y el que ve el
// usuario seria el que nadie actualiza.
export const VERSION = JSON.parse(
  readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"),
).version;

const HELP = `askedthrice — measure whether AI assistants recommend a brand

  Every command below is free and needs no account or API key. Measurements ask
  the model APIs live, so they take seconds, not milliseconds.

Usage
  askedthrice check <brand> [--category <text>]
      Ask one model whether it knows the brand, and whether it names the brand
      in a list for the category built from a prompt that never mentions it.

  askedthrice repeat <question> [--provider openai|gemini|anthropic]
      Ask one buyer question five times and report what changed between runs.
      This is the cheapest way to see that an AI recommendation is a distribution.

  askedthrice audit <brand> --website <url> --category <text>
                            [--location <text>] [--language en|es]
      The full free snapshot: crawls the site, asks several providers, repeats
      each prompt. Returns an audit id. Takes 15 to 60 seconds.

  askedthrice map <audit-id> [--start]
      Read the buyer-question map of an audit. --start measures it if it has
      not run yet.

Options
  --json            Print the raw API response instead of the readable form.
  --timeout <ms>    Give up after this long (default ${DEFAULT_TIMEOUT_MS}).
  --base <url>      Point at another deployment (default ${DEFAULT_BASE_URL}).
  --version, -v     Print the version.
  --help, -h        Print this.

Limits
  Shared and per caller, because every measurement spends real money at the
  model providers: check 6/hour and 20/day, repeat 3/hour, audit 6/hour and
  40/day. A 429 carries a Retry-After and this CLI tells you how long to wait.

Docs   https://askedthrice.com/developers
Spec   https://askedthrice.com/openapi.json
`;

/**
 * Parseo de argumentos a mano, sin dependencia. Soporta `--flag valor` y
 * `--flag=valor`; los que no empiezan con `--` son posicionales.
 */
export function parseArgs(argv) {
  const positional = [];
  const flags = {};

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("-")) {
      positional.push(arg);
      continue;
    }

    const clean = arg.replace(/^--?/, "");
    const [name, inline] = clean.includes("=") ? [clean.slice(0, clean.indexOf("=")), clean.slice(clean.indexOf("=") + 1)] : [clean, undefined];

    if (inline !== undefined) {
      flags[name] = inline;
      continue;
    }

    // Las banderas booleanas no se comen el siguiente argumento: sin esto,
    // `askedthrice check Acme --json` dejaba "Acme" como valor de --json.
    if (["json", "help", "h", "version", "v", "start"].includes(name)) {
      flags[name] = true;
      continue;
    }

    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      flags[name] = true;
      continue;
    }
    flags[name] = next;
    i += 1;
  }

  return { command: positional[0], positional: positional.slice(1), flags };
}

function requestOptions(flags) {
  const timeout = Number(flags.timeout);
  return {
    baseUrl: typeof flags.base === "string" ? flags.base : DEFAULT_BASE_URL,
    ...(Number.isFinite(timeout) && timeout > 0 ? { timeoutMs: timeout } : {}),
  };
}

class UsageError extends Error {}

/**
 * Corre un comando y devuelve el texto a imprimir. Separado de `main` para que
 * los tests puedan ejercitarlo sin process.exit ni stdout de verdad.
 */
export async function run(argv, { fetchImpl = fetch } = {}) {
  const { command, positional, flags } = parseArgs(argv);

  // --version antes que el caso "sin comando", o `askedthrice --version` cae en
  // la ayuda por no traer un comando adelante.
  if (flags.version || flags.v) return VERSION;
  if (flags.help || flags.h || !command) return HELP;

  const options = { ...requestOptions(flags), fetchImpl };
  const asJson = flags.json === true;

  switch (command) {
    case "check": {
      const brand = positional.join(" ").trim();
      if (!brand) throw new UsageError("Which brand? Try: askedthrice check \"Acme\" --category \"project management\"");
      const result = await checkBrand({ brand, category: typeof flags.category === "string" ? flags.category : undefined, ...options });
      return asJson ? JSON.stringify(result, null, 2) : renderCheck(result);
    }

    case "repeat": {
      const question = positional.join(" ").trim();
      if (!question) throw new UsageError('Which question? Try: askedthrice repeat "best CRM for a small team"');
      const result = await repeatQuestion({ question, provider: typeof flags.provider === "string" ? flags.provider : undefined, ...options });
      return asJson ? JSON.stringify(result, null, 2) : renderRepeat(result);
    }

    case "audit": {
      const brand = positional.join(" ").trim();
      if (!brand) throw new UsageError("Which brand? Try: askedthrice audit \"Acme\" --website acme.com --category \"project management\"");
      if (typeof flags.website !== "string") throw new UsageError("--website is required. A bare domain is fine: --website acme.com");
      if (typeof flags.category !== "string") throw new UsageError('--category is required: the words a buyer would search, like --category "project management"');
      const result = await startAudit({
        brand,
        website: flags.website,
        category: flags.category,
        location: typeof flags.location === "string" ? flags.location : undefined,
        promptLanguage: typeof flags.language === "string" ? flags.language : undefined,
        ...options,
      });
      return asJson ? JSON.stringify(result, null, 2) : renderAudit(result);
    }

    case "map": {
      const auditId = positional[0];
      if (!auditId) throw new UsageError("Which audit? Pass the id that `askedthrice audit` printed.");
      const result = flags.start === true
        ? await startBuyerQuestionMap({ auditId, ...options })
        : await getBuyerQuestionMap({ auditId, ...options });
      return asJson ? JSON.stringify(result, null, 2) : renderMap(result);
    }

    default:
      throw new UsageError(`There is no "${command}" command. Run askedthrice --help for the four that exist.`);
  }
}

/**
 * El mensaje de un fallo. Imprime el `hint` de la API, que es lo unico que le
 * dice a alguien que se comio un 429 si tiene que esperar o cambiar algo.
 */
export function describeFailure(error) {
  if (error instanceof UsageError) return error.message;
  if (!(error instanceof ApiError)) return error?.message ?? "Unknown error.";

  const lines = [error.message];
  if (error.hint) lines.push(`  ${error.hint}`);
  if (error.retryAfterSeconds) {
    const minutes = Math.ceil(error.retryAfterSeconds / 60);
    lines.push(`  Wait about ${minutes} minute${minutes === 1 ? "" : "s"} before trying again.`);
  }
  return lines.join("\n");
}

export async function main(argv = process.argv.slice(2)) {
  try {
    const output = await run(argv);
    process.stdout.write(`${output}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`${describeFailure(error)}\n`);
    return 1;
  }
}

export { UsageError };
