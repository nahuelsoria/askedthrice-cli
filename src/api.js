// El cliente HTTP de la API publica de askedthrice.com.
//
// Todo lo que sabe de la API sale de https://askedthrice.com/openapi.json: los
// paths, los codigos de error y los limites que se citan en los mensajes de
// abajo estan ahi. Si un dia cambia el contrato, cambia la spec primero.
//
// Sin dependencias a proposito. `npx askedthrice` tiene que arrancar en un
// segundo, y cada dependencia es una descarga mas y una superficie mas.

export const DEFAULT_BASE_URL = "https://askedthrice.com";

// Una medicion completa tarda entre 15 y 60 segundos porque las preguntas se le
// hacen a los modelos en vivo. La spec pide 90 de margen; se respeta.
export const DEFAULT_TIMEOUT_MS = 90_000;

/**
 * El error que entiende el CLI. Lleva los campos del contrato de la API
 * (`error`, `code`, `hint`) para poder imprimir el hint, que es lo unico que le
 * dice a alguien que se comio un 429 que tiene que esperar y no reintentar ya.
 */
export class ApiError extends Error {
  constructor({ message, code, hint, status, retryAfterSeconds }) {
    super(message);
    this.name = "ApiError";
    this.code = code ?? "unknown";
    this.hint = hint ?? "";
    this.status = status ?? 0;
    this.retryAfterSeconds = retryAfterSeconds ?? null;
  }
}

function readRetryAfter(response) {
  const raw = response.headers?.get?.("retry-after");
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

/**
 * Una request contra la API. El cuerpo de error de la API es JSON SIEMPRE, hasta
 * en un 404 de un path que no existe, asi que se parsea y se convierte en
 * ApiError. Cuando no lo es (un 502 de la CDN, por ejemplo) se dice eso y no se
 * inventa un codigo.
 */
export async function request(path, { baseUrl = DEFAULT_BASE_URL, method = "GET", body, timeoutMs = DEFAULT_TIMEOUT_MS, fetchImpl = fetch } = {}) {
  const url = `${baseUrl.replace(/\/$/, "")}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response;
  try {
    response = await fetchImpl(url, {
      method,
      signal: controller.signal,
      headers: {
        accept: "application/json",
        "user-agent": "askedthrice-cli",
        ...(body ? { "content-type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch (error) {
    clearTimeout(timer);
    if (error?.name === "AbortError") {
      throw new ApiError({
        message: `The request took longer than ${Math.round(timeoutMs / 1000)}s and was cancelled.`,
        code: "timeout",
        hint: "A measurement asks the models live, so it is slow by nature. Raise the limit with --timeout, or run it again.",
      });
    }
    throw new ApiError({
      message: `Could not reach ${baseUrl}: ${error?.message ?? "network error"}.`,
      code: "network_error",
      hint: "Check your connection. If askedthrice.com opens in a browser, this is not the site being down.",
    });
  }
  clearTimeout(timer);

  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    if (payload && typeof payload.error === "string") {
      throw new ApiError({
        message: payload.error,
        code: payload.code,
        hint: payload.hint,
        status: response.status,
        retryAfterSeconds: readRetryAfter(response),
      });
    }
    // Sin cuerpo JSON no es la API contestando: es algo delante de ella.
    throw new ApiError({
      message: `${baseUrl} answered HTTP ${response.status} without a JSON body.`,
      code: "unexpected_response",
      hint: "This is not the API answering. Retry in a minute; if it persists, the site or its CDN is having trouble.",
      status: response.status,
      retryAfterSeconds: readRetryAfter(response),
    });
  }

  return payload;
}

export function checkBrand({ brand, category, ...options }) {
  return request("/api/check", { ...options, method: "POST", body: { brand, ...(category ? { category } : {}) } });
}

export function repeatQuestion({ question, provider, ...options }) {
  return request("/api/tools/repeat", {
    ...options,
    method: "POST",
    body: { question, ...(provider ? { provider } : {}) },
  });
}

export function startAudit({ brand, website, category, location, promptLanguage, ...options }) {
  return request("/api/audit", {
    ...options,
    method: "POST",
    body: {
      brand,
      website,
      category,
      ...(location ? { location } : {}),
      ...(promptLanguage ? { promptLanguage } : {}),
    },
  });
}

export function getBuyerQuestionMap({ auditId, ...options }) {
  return request(`/api/audit/${encodeURIComponent(auditId)}/fanout-map`, { ...options, method: "GET" });
}

export function startBuyerQuestionMap({ auditId, ...options }) {
  return request(`/api/audit/${encodeURIComponent(auditId)}/fanout-map`, { ...options, method: "POST", body: {} });
}
