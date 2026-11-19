// Rode com: node tests/analysis.test.js
const assert = require("node:assert/strict");
const A = require("../assets/js/analysis.js");

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log("ok -", name);
}

test("cor, paridade, faixa, coluna, dúzia", () => {
  assert.equal(A.colorOf(0), "green");
  assert.equal(A.colorOf(1), "red");
  assert.equal(A.colorOf(2), "black");
  assert.equal(A.colorOf(36), "red");
  assert.equal(A.parityOf(7), "Impar");
  assert.equal(A.parityOf(0), "Zero");
  assert.equal(A.rangeOf(18), "Baixo");
  assert.equal(A.rangeOf(19), "Alto");
  assert.equal(A.columnOf(1), "Coluna 1");
  assert.equal(A.columnOf(35), "Coluna 2");
  assert.equal(A.columnOf(36), "Coluna 3");
  assert.equal(A.lineOf(9), "Linha 1");
  assert.equal(A.lineOf(10), "Linha 2");
  assert.equal(A.lineOf(36), "Linha 4");
});

test("categoryOf rejeita valores inválidos", () => {
  assert.equal(A.categoryOf(37, "cor"), null);
  assert.equal(A.categoryOf(-1, "cor"), null);
  assert.equal(A.categoryOf(5, "duzia"), null);
});

test("não gera palpites com menos de 10 giros", () => {
  assert.equal(A.makeSuggestions([1, 2, 3], []), null);
  assert.equal(A.makeForecast([1, 2, 3]), null);
  assert.deepEqual(A.makeStrategyCandidates([1, 2, 3]), []);
});

test("gera 5 categorias × 6 estratégias de candidatos", () => {
  const h = Array.from({ length: 40 }, (_, i) => (i * 7) % 37);
  assert.equal(A.makeStrategyCandidates(h).length, 30);
});

test("summarize usa só os últimos 100 giros", () => {
  const old = Array(200).fill(5);
  const recent = Array(100).fill(8);
  const s = A.summarize([...old, ...recent]);
  assert.equal(s.size, 100);
  assert.equal(s.hot[0].n, 8);
  assert.equal(s.hot[0].count, 100);
  assert.equal(s.maxCount, 100);
});

test("alternância só vale para exatamente dois valores", () => {
  // 4 dúzias diferentes alternando não deve ser tratada como alternância binária
  const h = [1, 14, 27, 1, 14, 27, 1, 14, 27, 1, 14, 27];
  const s = A.makeSuggestions(h, []);
  assert.ok(s.linha.value);
});

test("estratégia só é qualificada com avaliações suficientes", () => {
  const few = Array.from({ length: A.MIN_EVALUATIONS - 1 }, (_, i) => ({
    categoria: "cor", estrategia: "atraso", acertou: true,
    criado_em: new Date(i * 1000).toISOString()
  }));
  assert.equal(A.chooseBestStrategy(few, "cor").learning, false);

  const enough = [...few, { ...few[0], criado_em: new Date(99999).toISOString() }];
  const best = A.chooseBestStrategy(enough, "cor");
  assert.equal(best.learning, true);
  assert.equal(best.strategy, "atraso");
});

test("atraso nunca sugere Zero", () => {
  const h = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
  const s = A.makeSuggestions(h, []);
  for (const c of A.CATEGORIES) assert.notEqual(s[c].value, "Zero");
  const cands = A.makeStrategyCandidates(h).filter(x => x.estrategia === "atraso");
  assert.ok(cands.length === 5 && cands.every(x => x.sugestao !== "Zero" && x.sugestao !== "green"));
});

test("quebra de sequência nunca sugere o valor da sequência nem zero", () => {
  const h = [2, 4, 6, 8, 10, 11, 13, 15, 17, 19, 20, 22, 24, 26]; // termina em 4 pretos
  const s = A.makeSuggestions(h, []);
  assert.ok(s);
});

console.log(`\n${passed} testes passaram.`);
