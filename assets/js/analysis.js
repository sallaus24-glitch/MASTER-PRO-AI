(function (root) {
  "use strict";

  // Mínimo de avaliações para uma estratégia ser considerada "qualificada".
  // Com poucas amostras, o desempenho é praticamente sorte.
  const MIN_EVALUATIONS = 100;
  const MAX_RECENT_EVALUATIONS = 30;
  const SUMMARY_WINDOW = 100;

  const CATEGORIES = ["cor", "paridade", "faixa", "coluna", "duzia", "rua"];

  const STRATEGIES = [
    "frequencia",
    "alternancia",
    "tendencia",
    "atraso",
    "ciclo",
    "quebra"
  ];

  const STRATEGY_LABELS = {
    frequencia: "Frequência",
    alternancia: "Alternância",
    tendencia: "Tendência recente",
    atraso: "Atraso",
    ciclo: "Ciclo",
    quebra: "Quebra de sequência"
  };

  const RED = new Set([
    1, 3, 5, 7, 9, 12, 14, 16, 18,
    19, 21, 23, 25, 27, 30, 32, 34, 36
  ]);

  const VALID_VALUES = {
    cor: ["red", "black", "green"],
    paridade: ["Par", "Impar", "Zero"],
    faixa: ["Baixo", "Alto", "Zero"],
    coluna: ["Coluna 1", "Coluna 2", "Coluna 3", "Zero"],
    duzia: ["Dúzia 1", "Dúzia 2", "Dúzia 3", "Zero"],
    rua: Array.from({ length: 12 }, (_, i) => `Rua ${i + 1}`).concat("Zero")
  };

  function normalizeHistory(history) {
    return (Array.isArray(history) ? history : [])
      .map(Number)
      .filter(n => Number.isInteger(n) && n >= 0 && n <= 36);
  }

  function colorOf(number) {
    const n = Number(number);
    if (n === 0) return "green";
    return RED.has(n) ? "red" : "black";
  }

  function colorLabel(color) {
    return { red: "Vermelho", black: "Preto", green: "Zero" }[color] || "—";
  }

  function parityOf(number) {
    const n = Number(number);
    if (n === 0) return "Zero";
    return n % 2 === 0 ? "Par" : "Impar";
  }

  function rangeOf(number) {
    const n = Number(number);
    if (n === 0) return "Zero";
    return n <= 18 ? "Baixo" : "Alto";
  }

  function columnOf(number) {
    const n = Number(number);
    if (n === 0) return "Zero";
    return `Coluna ${((n - 1) % 3) + 1}`;
  }

  function dozenOf(number) {
    const n = Number(number);
    if (n === 0) return "Zero";
    return `Dúzia ${Math.ceil(n / 12)}`;
  }

  function streetOf(number) {
    const n = Number(number);
    if (n === 0) return "Zero";
    return `Rua ${Math.ceil(n / 3)}`;
  }

  function lineOf(number) {
    const n = Number(number);
    if (n === 0) return "Zero";
    return `Linha ${Math.ceil(n / 9)}`;
  }

  function categoryOf(number, category) {
    const n = Number(number);

    if (!Number.isInteger(n) || n < 0 || n > 36) return null;

    switch (category) {
      case "cor": return colorOf(n);
      case "paridade": return parityOf(n);
      case "faixa": return rangeOf(n);
      case "coluna": return columnOf(n);
      case "duzia": return dozenOf(n);
      case "rua": return streetOf(n);
      case "linha": return null; // legado, não participa do novo aprendizado
      default: return null;
    }
  }

  function labelOf(category, value) {
    if (category === "cor") return colorLabel(value);
    if (category === "paridade") return value === "Impar" ? "Ímpar" : value;
    return value || "—";
  }

  function valuesFor(history, category) {
    return normalizeHistory(history)
      .map(n => categoryOf(n, category))
      .filter(Boolean);
  }

  function countValues(values) {
    const counts = {};
    for (const value of values) counts[value] = (counts[value] || 0) + 1;
    return counts;
  }

  // `pool` limita os candidatos (usado na quebra de sequência).
  function mostFrequent(values, category, pool) {
    const allowed = pool || VALID_VALUES[category] || [];
    const counts = countValues(values);

    const lastSeen = {};
    values.forEach((value, index) => { lastSeen[value] = index; });
    return allowed
      .map((value, index) => ({ value, count: counts[value] || 0, lastSeen: lastSeen[value] ?? -1, index }))
      .sort((a, b) => b.count - a.count || b.lastSeen - a.lastSeen || a.index - b.index)[0]?.value ||
      allowed[0] || null;
  }

  function leastRecent(values, category) {
    // Zero fica fora: por ser raro, sempre seria o "mais atrasado".
    const allowed = (VALID_VALUES[category] || []).filter(
      v => v !== "Zero" && v !== "green"
    );

    if (!values.length) return allowed[0] || null;

    const lastPositions = {};
    values.forEach((value, index) => { lastPositions[value] = index; });

    return allowed
      .map((value, index) => ({
        value,
        position: lastPositions[value] ?? -1,
        index
      }))
      .sort((a, b) => a.position - b.position || a.index - b.index)[0]?.value ||
      allowed[0] || null;
  }

  function streakInfo(values) {
    if (!values.length) return { value: null, count: 0 };

    const last = values[values.length - 1];
    let count = 0;

    for (let i = values.length - 1; i >= 0; i--) {
      if (values[i] !== last) break;
      count++;
    }

    return { value: last, count };
  }

  // Só faz sentido quando a janela alterna entre exatamente DOIS valores.
  function alternatingPrediction(values) {
    const last = values.slice(-6);

    if (last.length < 4) return null;

    for (let i = 1; i < last.length; i++) {
      if (last[i] === last[i - 1]) return null;
    }

    if (new Set(last).size !== 2) return null;

    return last[last.length - 2];
  }

  function cyclePrediction(values) {
    if (values.length < 8) return null;

    for (let period = 2; period <= 6; period++) {
      if (values.length < period * 2 + 2) continue;

      let matches = 0;
      let comparisons = 0;

      const start = Math.max(0, values.length - Math.min(18, period * 3));

      for (let i = start + period; i < values.length; i++) {
        comparisons++;
        if (values[i] === values[i - period]) matches++;
      }

      if (comparisons >= 4 && matches / comparisons >= 0.75) {
        return values[values.length - period];
      }
    }

    return null;
  }

  function strategyPrediction(values, category, strategy) {
    const allowed = VALID_VALUES[category] || [];

    if (!allowed.length) return null;

    const recent = values.slice(-30);

    if (!recent.length) return allowed[0];

    const frequency = mostFrequent(recent, category);

    switch (strategy) {
      case "frequencia":
        return frequency;

      case "alternancia":
        return alternatingPrediction(recent) || frequency;

      case "tendencia":
        return mostFrequent(values.slice(-8), category);

      case "atraso":
        return leastRecent(recent, category);

      case "ciclo":
        return cyclePrediction(recent) || frequency;

      case "quebra": {
        const streak = streakInfo(recent);

        if (streak.count >= 4) {
          const alternatives = allowed.filter(
            v => v !== streak.value && v !== "Zero" && v !== "green"
          );

          if (alternatives.length) {
            return mostFrequent(
              recent.filter(v => v !== streak.value),
              category,
              alternatives
            );
          }
        }

        return frequency;
      }

      default:
        return frequency;
    }
  }

  function makeStrategyCandidates(history) {
    const numbers = normalizeHistory(history);

    if (numbers.length < 10) return [];

    const candidates = [];

    for (const category of CATEGORIES) {
      const values = valuesFor(numbers, category);

      for (const strategy of STRATEGIES) {
        const suggestion = strategyPrediction(values, category, strategy);

        if (!suggestion) continue;

        candidates.push({
          categoria: category,
          estrategia: strategy,
          sugestao: suggestion,
          janela: 30
        });
      }
    }

    return candidates;
  }

  function getStrategyEvaluations(evaluations, category, strategy) {
    return (Array.isArray(evaluations) ? evaluations : [])
      .filter(item =>
        item &&
        item.categoria === category &&
        item.estrategia === strategy &&
        typeof item.acertou === "boolean"
      )
      .sort((a, b) =>
        new Date(a.criado_em || 0).getTime() -
        new Date(b.criado_em || 0).getTime()
      );
  }

  function weightedPerformance(rows) {
    const recent = rows.slice(-MAX_RECENT_EVALUATIONS);

    let weightedHits = 0;
    let weightedTotal = 0;
    let totalHits = 0;

    recent.forEach((row, index) => {
      // Resultados recentes recebem peso maior.
      const weight = 0.35 + 0.65 * ((index + 1) / recent.length);

      weightedTotal += weight;

      if (row.acertou) {
        weightedHits += weight;
        totalHits++;
      }
    });

    const rawRate = weightedTotal ? weightedHits / weightedTotal : 0;

    // Suavização para não exagerar com poucas avaliações.
    const score = (rawRate * weightedTotal + 0.5) / (weightedTotal + 1);

    const recentBlock = recent.slice(-8);
    const previousBlock = recent.slice(-16, -8);

    const recentRate = recentBlock.length
      ? recentBlock.filter(r => r.acertou).length / recentBlock.length
      : 0;

    const previousRate = previousBlock.length
      ? previousBlock.filter(r => r.acertou).length / previousBlock.length
      : recentRate;

    const declining =
      recentBlock.length >= 6 &&
      previousBlock.length >= 6 &&
      recentRate < previousRate - 0.15;

    return {
      total: rows.length,
      evaluatedRecent: recent.length,
      hits: rows.filter(row => row.acertou).length,
      recentHits: totalHits,
      score,
      percentage: Math.round(score * 100),
      recentRate,
      previousRate,
      declining
    };
  }

  function strategyPerformance(evaluations, category, strategy) {
    return weightedPerformance(
      getStrategyEvaluations(evaluations, category, strategy)
    );
  }

  function chooseBestStrategy(evaluations, category) {
    const ranking = STRATEGIES.map(strategy => {
      const performance = strategyPerformance(evaluations, category, strategy);
      const declinePenalty = performance.declining ? 0.06 : 0;

      return {
        strategy,
        ...performance,
        selectionScore: performance.score - declinePenalty
      };
    });

    const qualified = ranking.filter(item => item.total >= MIN_EVALUATIONS);

    if (!qualified.length) {
      return {
        strategy: "frequencia",
        learning: false,
        total: 0,
        hits: 0,
        percentage: 0,
        declining: false
      };
    }

    qualified.sort((a, b) =>
      b.selectionScore - a.selectionScore || b.total - a.total
    );

    return { ...qualified[0], learning: true };
  }

  function makeSuggestions(history, evaluations) {
    const numbers = normalizeHistory(history);

    if (numbers.length < 10) return null;

    const result = {};

    for (const category of CATEGORIES) {
      const values = valuesFor(numbers, category);
      const chosen = chooseBestStrategy(evaluations, category);
      const suggestion = strategyPrediction(values, category, chosen.strategy);

      result[category] = {
        value: suggestion,
        label: labelOf(category, suggestion),
        strategy: chosen.strategy,
        strategyLabel: STRATEGY_LABELS[chosen.strategy],
        count: chosen.hits || 0,
        total: chosen.total || 0,
        pct: `${chosen.percentage || 0}%`,
        learning: chosen.learning,
        declining: chosen.declining || false
      };
    }

    return result;
  }

  // Hipótese exata descritiva: frequências normalizadas em janelas de 10/30/50/100.
  // Isso não significa que o número tenha probabilidade maior no próximo giro.
  function makeForecast(history) {
    const numbers = normalizeHistory(history);
    if (numbers.length < 10) return null;
    const windows = [
      { size: 10, weight: 0.10 }, { size: 30, weight: 0.20 },
      { size: 50, weight: 0.30 }, { size: 100, weight: 0.40 }
    ].filter(w => numbers.length >= w.size);
    const scores = Array.from({ length: 37 }, (_, number) => ({ number, score: 0, lastSeen: -1 }));
    const weightTotal = windows.reduce((sum, window) => sum + window.weight, 0);
    numbers.forEach((n, index) => { scores[n].lastSeen = index; });
    for (const window of windows) {
      const sample = numbers.slice(-window.size);
      const counts = countValues(sample.map(String));
      for (const item of scores) {
        item.score += ((counts[String(item.number)] || 0) / sample.length) * (window.weight / weightTotal);
      }
    }
    scores.sort((a, b) => b.score - a.score || b.lastSeen - a.lastSeen || a.number - b.number);
    const number = scores[0]?.number;
    if (number === undefined) return null;
    return {
      base: numbers[numbers.length - 1],
      number,
      candidates: scores.slice(0, 5).map(item => item.number),
      method: `Frequência combinada (${windows.map(w => w.size).join("/")})`,
      color: colorOf(number),
      range: rangeOf(number),
      parity: parityOf(number)
    };
  }

  // Resumo dos últimos `windowSize` giros (padrão: 100).
  function summarize(history, windowSize = SUMMARY_WINDOW) {
    const numbers = normalizeHistory(history).slice(-windowSize);

    const numberCounts = Array.from({ length: 37 }, (_, n) => ({
      n,
      count: 0,
      delay: 0
    }));

    const lastPositions = {};

    numbers.forEach((n, index) => {
      numberCounts[n].count++;
      lastPositions[n] = index;
    });

    numberCounts.forEach(item => {
      item.delay = lastPositions[item.n] === undefined
        ? numbers.length
        : numbers.length - 1 - lastPositions[item.n];
    });

    const hot = [...numberCounts]
      .sort((a, b) => b.count - a.count || a.n - b.n)
      .slice(0, 5);

    const cold = [...numberCounts]
      .sort((a, b) => b.delay - a.delay || a.n - b.n)
      .slice(0, 5);

    const colors = { Vermelho: 0, Preto: 0, Zero: 0 };
    const parity = { Par: 0, "Ímpar": 0, Zero: 0 };
    const ranges = { "1–18": 0, "19–36": 0, Zero: 0 };

    numbers.forEach(n => {
      const color = colorOf(n);

      if (color === "red") colors.Vermelho++;
      else if (color === "black") colors.Preto++;
      else colors.Zero++;

      if (n === 0) {
        parity.Zero++;
        ranges.Zero++;
      } else {
        if (n % 2 === 0) parity.Par++;
        else parity["Ímpar"]++;

        if (n <= 18) ranges["1–18"]++;
        else ranges["19–36"]++;
      }
    });

    return {
      size: numbers.length,
      maxCount: Math.max(1, ...hot.map(i => i.count)),
      maxDelay: Math.max(1, ...cold.map(i => i.delay)),
      hot,
      cold,
      colors,
      parity,
      ranges
    };
  }

  const api = {
    CATEGORIES,
    STRATEGIES,
    STRATEGY_LABELS,
    MIN_EVALUATIONS,
    SUMMARY_WINDOW,
    normalizeHistory,
    colorOf,
    colorLabel,
    parityOf,
    rangeOf,
    columnOf,
    lineOf,
    dozenOf,
    streetOf,
    categoryOf,
    labelOf,
    valuesFor,
    makeStrategyCandidates,
    strategyPerformance,
    chooseBestStrategy,
    makeSuggestions,
    makeForecast,
    summarize
  };

  root.Analysis = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
