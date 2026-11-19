const assert = require("node:assert/strict");
const A = require("../assets/js/analysis.js");

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log("ok -", name);
}

test("categorias da roleta europeia", () => {
  assert.equal(A.colorOf(0), "green");
  assert.equal(A.colorOf(1), "red");
  assert.equal(A.colorOf(2), "black");
  assert.equal(A.parityOf(7), "Impar");
  assert.equal(A.parityOf(0), "Zero");
  assert.equal(A.rangeOf(18), "Baixo");
  assert.equal(A.rangeOf(19), "Alto");
  assert.equal(A.columnOf(1), "Coluna 1");
  assert.equal(A.columnOf(35), "Coluna 2");
  assert.equal(A.columnOf(36), "Coluna 3");
  assert.equal(A.dozenOf(12), "Dúzia 1");
  assert.equal(A.dozenOf(13), "Dúzia 2");
  assert.equal(A.dozenOf(36), "Dúzia 3");
  assert.equal(A.streetOf(3), "Rua 1");
  assert.equal(A.streetOf(4), "Rua 2");
  assert.equal(A.streetOf(36), "Rua 12");
  assert.equal(A.streetOf(0), "Zero");
});

test("categoria antiga linha não entra no novo aprendizado", () => {
  assert.equal(A.categoryOf(5, "linha"), null);
  assert.equal(A.categoryOf(5, "rua"), "Rua 2");
});

test("categoryOf rejeita valores inválidos", () => {
  assert.equal(A.categoryOf(37, "cor"), null);
  assert.equal(A.categoryOf(-1, "cor"), null);
  assert.equal(A.categoryOf(5, "duzia-invalida"), null);
});

test("não gera palpites com menos de 10 giros", () => {
  assert.equal(A.makeSuggestions([1, 2, 3], []), null);
  assert.equal(A.makeForecast([1, 2, 3]), null);
  assert.deepEqual(A.makeStrategyCandidates([1, 2, 3]), []);
});

test("gera 6 categorias × 6 estratégias de candidatos", () => {
  const h = Array.from({ length: 40 }, (_, i) => (i * 7) % 37);
  assert.equal(A.makeStrategyCandidates(h).length, 36);
  assert.deepEqual(A.CATEGORIES, ["cor", "paridade", "faixa", "coluna", "duzia", "rua"]);
});

test("resumo usa só os últimos 100 giros", () => {
  const old = Array(200).fill(5);
  const recent = Array(100).fill(8);
  const summary = A.summarize([...old, ...recent]);
  assert.equal(summary.size, 100);
  assert.equal(summary.hot[0].n, 8);
  assert.equal(summary.hot[0].count, 100);
});

test("estratégia só é qualificada com 100 avaliações históricas", () => {
  const rows = Array.from({ length: 99 }, (_, i) => ({
    categoria: "cor", estrategia: "atraso", acertou: true,
    criado_em: new Date(i * 1000).toISOString()
  }));
  assert.equal(A.MIN_EVALUATIONS, 100);
  assert.equal(A.chooseBestStrategy(rows, "cor").learning, false);
  rows.push({ ...rows[0], criado_em: new Date(999999).toISOString() });
  const best = A.chooseBestStrategy(rows, "cor");
  assert.equal(best.learning, true);
  assert.equal(best.total, 100);
  assert.equal(best.strategy, "atraso");
});

test("desempenho conta histórico total, mas limita pontuação às 30 avaliações recentes", () => {
  const rows = Array.from({ length: 110 }, (_, i) => ({
    categoria: "cor", estrategia: "frequencia", acertou: i < 80,
    criado_em: new Date(i * 1000).toISOString()
  }));
  const result = A.strategyPerformance(rows, "cor", "frequencia");
  assert.equal(result.total, 110);
  assert.equal(result.evaluatedRecent, 30);
  assert.equal(result.hits, 80);
});

test("hipótese numérica oferece até cinco candidatos e combina janelas", () => {
  const history = Array.from({ length: 120 }, (_, i) => i % 2 === 0 ? 17 : 8);
  const forecast = A.makeForecast(history);
  assert.ok(forecast);
  assert.equal(forecast.candidates.length, 5);
  assert.match(forecast.method, /10\/30\/50\/100/);
  assert.ok([8, 17].includes(forecast.number));
});

console.log(`\n${passed} testes passaram.`);
