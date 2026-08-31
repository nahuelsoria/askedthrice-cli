// Como se ve un resultado en una terminal.
//
// Regla que viene del producto y no del CLI: NO se imprime el puntaje. El
// numero se calcula y se guarda, pero no es consistente entre corridas, asi que
// lo que se muestra es el veredicto de tres bandas y CONTEOS ("aparecio en 3 de
// 5 corridas"). Un CLI que imprimiera 61/100 estaria contradiciendo a la propia
// pagina del producto, que hace un año dejo de mostrarlo.
//
// Sin colores ANSI: la salida se pipea a jq, a un archivo o a un agente mas
// seguido de lo que se mira, y los codigos de escape ensucian los tres casos.

const VERDICTS = {
  ai_approved: "recommended",
  barely_visible: "barely visible",
  invisible: "invisible",
};

function bullet(label, value) {
  return `  ${label.padEnd(14)} ${value}`;
}

export function renderCheck(result) {
  const lines = [`${result.brand}${result.category ? ` — ${result.category}` : ""}`, ""];

  lines.push(bullet("verdict", VERDICTS[result.verdict] ?? result.verdict));
  lines.push(bullet("knows it", result.knows ? "yes" : "no"));

  if (result.knows && result.description) {
    lines.push(bullet("describes it", result.description));
  }

  if (result.recommendations?.length) {
    lines.push("");
    lines.push(`  Asked for the category without naming the brand, ${result.model} answered:`);
    result.recommendations.forEach((name, index) => {
      const mine = result.listPosition === index + 1;
      lines.push(`    ${String(index + 1).padStart(2)}. ${name}${mine ? "   <- this brand" : ""}`);
    });
    if (result.listPosition == null) {
      lines.push("");
      lines.push("  The brand was not named in that list.");
    }
  }

  if (result.recommendReason) {
    lines.push("");
    lines.push(bullet("would it recommend", `${result.recommendVerdict}: ${result.recommendReason}`));
  }

  return lines.join("\n");
}

export function renderRepeat(result) {
  const { metrics } = result;
  const lines = [`"${result.question}"`, `asked ${result.runsRequested} times to ${result.model}`, ""];

  lines.push(bullet("answered", `${metrics.okRuns} of ${result.runsRequested} runs`));
  lines.push(bullet("brands named", `${metrics.union} different ones across the runs`));

  if (metrics.comparable) {
    lines.push(bullet("identical", `${metrics.sameSetPairs} of ${metrics.pairs} run pairs named the same set`));
    if (metrics.jaccardMean != null) {
      lines.push(bullet("overlap", `${(metrics.jaccardMean * 100).toFixed(0)}% mean between pairs`));
    }
  }

  if (metrics.inAll?.length) {
    lines.push("");
    lines.push(`  Named in every run (${metrics.inAll.length}):`);
    metrics.inAll.forEach((name) => lines.push(`    - ${name}`));
  }

  // La parte que vale del resultado: lo que aparecio una sola vez es la prueba
  // de que la respuesta se mueve entre corridas identicas.
  if (metrics.once?.length) {
    lines.push("");
    lines.push(`  Named in only one run (${metrics.once.length}) — these move between identical runs:`);
    metrics.once.forEach((name) => lines.push(`    - ${name}`));
  }

  return lines.join("\n");
}

export function renderAudit(result) {
  const lines = [`${result.audit?.brand ?? "audit"} — ${result.audit?.website ?? ""}`.trim(), ""];

  lines.push(bullet("audit id", result.id));
  lines.push(bullet("measured in", result.measurementLocale === "es" ? "Spanish" : "English"));

  if (result.categoryLocalized) {
    lines.push(bullet("category", result.categoryLocalized));
  }

  const findings = result.providerFindings ?? [];
  if (findings.length) {
    lines.push("");
    lines.push(`  What each provider answered (${findings.length}):`);
    findings.forEach((finding) => {
      const summary = finding.summary ? ` — ${String(finding.summary).slice(0, 110)}` : "";
      lines.push(`    - ${finding.provider}${summary}`);
    });
  }

  const errors = result.providerErrors ?? [];
  if (errors.length) {
    lines.push("");
    lines.push(`  Providers that did not answer (${errors.length}): ${errors.map((e) => e.provider ?? "unknown").join(", ")}`);
  }

  if (result.fanoutMissingReason) {
    lines.push("");
    lines.push(`  No buyer questions for this brand: ${result.fanoutMissingReason}`);
  } else if (result.productFanout) {
    lines.push("");
    lines.push(`  Buyer questions are ready. Ask them live with:`);
    lines.push(`    askedthrice map ${result.id}`);
  }

  if (result.rateLimit) {
    lines.push("");
    lines.push(bullet("calls left", `${result.rateLimit.remaining} in this window`));
  }

  return lines.join("\n");
}

export function renderMap(payload) {
  if (!payload?.map) {
    return "The buyer-question map is still being measured. Run the same command again in a few seconds.";
  }

  const rows = payload.map.rows ?? [];
  const lines = [`Buyer-question map${payload.cached ? " (stored, not re-measured)" : ""}`, ""];

  if (!rows.length) {
    lines.push("  The map has no rows.");
    return lines.join("\n");
  }

  rows.forEach((row) => {
    lines.push(`  ${row.question}`);
    const cells = row.cells ?? row.answers ?? [];
    cells.forEach((cell) => {
      const named = cell.mentioned ?? cell.brandMentioned;
      const mark = named === true ? "named" : named === false ? "not named" : (cell.status ?? "no answer");
      lines.push(`    ${String(cell.provider ?? "provider").padEnd(12)} ${mark}`);
    });
    lines.push("");
  });

  return lines.join("\n").trimEnd();
}
