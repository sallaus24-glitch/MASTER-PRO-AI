(() => {
  "use strict";

  const $ = id => document.getElementById(id);

  // Quantos giros recentes são carregados (o app só usa os últimos 100).
  // O total real vem de uma contagem separada, sem baixar a tabela toda.
  const HISTORY_LIMIT = 500;
  // Limite padrão de linhas por requisição no Supabase = 1000.
  const LEARNING_LIMIT = 1000;

  let history = [];
  let totalInDb = null;
  let sessionCount = 0;
  let selected = null;
  let typedNumber = "";
  let currentForecast = null;
  let loading = false;
  let saving = false;
  let learningEvaluations = [];
  let learningAvailable = true;

  // Fila para processar o aprendizado sem bloquear a tela.
  let backgroundQueue = Promise.resolve();

  function getSessionId() {
    let id = null;

    try {
      id = localStorage.getItem("masterProSession");
    } catch (_) { /* armazenamento bloqueado */ }

    if (!id) {
      id = crypto.randomUUID
        ? crypto.randomUUID()
        : `master-pro-${Date.now()}-${Math.random().toString(36).slice(2)}`;

      try {
        localStorage.setItem("masterProSession", id);
      } catch (_) { /* segue só com o id em memória */ }
    }

    return id;
  }

  const sessionId = getSessionId();

  function setStatus(text, state = "") {
    const el = $("connectionStatus");
    if (!el) return;

    el.innerHTML = `<i></i> ${text}`;
    el.className = `connection ${state}`;
  }

  function showMessage(message, error = false) {
    const el = $("entryMessage");
    if (!el) return;

    el.textContent = message;
    el.className = error ? "msg error" : "msg";
  }

  function normalize(value) {
    return String(value ?? "")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .trim()
      .toLowerCase();
  }

  function ball(number) {
    return `<span class="ball ${Analysis.colorOf(number)}">${number}</span>`;
  }

  // =====================================
  // TECLADO
  // =====================================

  function updateNumberDisplay() {
    const display = $("numberDisplay");
    const saveButton = $("saveNumber");

    if (display) display.textContent = typedNumber || "—";

    selected =
      typedNumber !== "" && Number(typedNumber) >= 0 && Number(typedNumber) <= 36
        ? Number(typedNumber)
        : null;

    if (saveButton) saveButton.disabled = selected === null || saving;

    if (selected !== null) {
      showMessage(`Número ${selected} pronto. Toque em ✓ para inserir.`);
    }
  }

  function renderPad() {
    const pad = $("numberPad");
    if (!pad) return;

    pad.querySelectorAll("[data-digit]").forEach(button => {
      button.classList.toggle(
        "selected",
        typedNumber !== "" && Number(typedNumber) === Number(button.dataset.digit)
      );
    });
  }

  function addDigit(digit) {
    if (saving || !/^\d$/.test(String(digit))) return;
    if (typedNumber.length >= 2) typedNumber = "";

    const next = String(Number(typedNumber + digit));

    if (Number(next) > 36) {
      showMessage("Número inválido. Use de 0 a 36.", true);
      return;
    }

    typedNumber = next;
    updateNumberDisplay();
    renderPad();
  }

  function removeDigit() {
    if (saving) return;

    typedNumber = typedNumber.slice(0, -1);
    updateNumberDisplay();
    renderPad();

    if (typedNumber === "") showMessage("Digite o número que saiu.");
  }

  function clearNumber(message = "Digite o número que saiu.") {
    typedNumber = "";
    selected = null;

    if ($("numberDisplay")) $("numberDisplay").textContent = "—";
    if ($("saveNumber")) $("saveNumber").disabled = true;

    showMessage(message);
    renderPad();
  }

  function setupKeypad() {
    const pad = $("numberPad");
    if (!pad) return;

    pad.addEventListener("click", event => {
      const button = event.target.closest("button");
      if (!button) return;

      if (button.id === "backspaceNumber") {
        removeDigit();
        return;
      }

      if (button.dataset.digit !== undefined) addDigit(button.dataset.digit);
    });

    if ($("clearSelection")) {
      $("clearSelection").addEventListener("click", () => clearNumber());
    }

    if ($("saveNumber")) {
      $("saveNumber").addEventListener("click", saveNumber);
    }

    // Teclado físico (desktop / teclado Bluetooth).
    document.addEventListener("keydown", event => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;

      const tag = (event.target && event.target.tagName) || "";
      if (tag === "INPUT" || tag === "TEXTAREA") return;

      if (/^\d$/.test(event.key)) {
        addDigit(event.key);
      } else if (event.key === "Backspace") {
        removeDigit();
      } else if (event.key === "Escape") {
        clearNumber();
      } else if (event.key === "Enter") {
        saveNumber();
      }
    });

    updateNumberDisplay();
  }

  // =====================================
  // CONSULTAS SUPABASE
  // =====================================

  async function loadRecentHistory() {
    // Últimos giros (mais novos primeiro) + total exato numa só consulta.
    const { data, error, count } = await db
      .from("historico_analise")
      .select("numero,session_id,criado_em", { count: "exact" })
      .order("criado_em", { ascending: false })
      .limit(HISTORY_LIMIT);

    if (error) throw error;

    history = (data || [])
      .slice()
      .reverse()
      .map(row => Number(row.numero))
      .filter(n => Number.isInteger(n) && n >= 0 && n <= 36);

    totalInDb = typeof count === "number" ? count : history.length;

    const sessionResult = await db
      .from("historico_analise")
      .select("numero", { count: "exact", head: true })
      .eq("session_id", sessionId);

    sessionCount = sessionResult.error ? 0 : (sessionResult.count || 0);
  }

  async function loadLearningEvaluations() {
    const { data, error } = await db
      .from("aprendizado_estrategias")
      .select("janela,categoria,estrategia,sugestao,resultado_real,acertou,peso,criado_em")
      .eq("session_id", sessionId)
      .not("resultado_real", "is", null)
      .order("criado_em", { ascending: false })
      .range(0, LEARNING_LIMIT - 1);

    if (error) throw error;

    learningEvaluations = (data || []).reverse();
  }

  // O aprendizado é opcional: se a tabela não existir ainda, o app continua
  // funcionando com a estratégia padrão e avisa o que fazer.
  async function safeLoadLearning() {
    try {
      await loadLearningEvaluations();
      learningAvailable = true;
    } catch (error) {
      learningAvailable = false;
      learningEvaluations = [];
      console.warn("Aprendizado indisponível:", error);
    }
  }

  // =====================================
  // AVALIAÇÃO DAS ESTRATÉGIAS
  // =====================================

  async function evaluateAdaptivePending(real) {
    const { data, error } = await db
      .from("aprendizado_estrategias")
      .select("id,categoria,estrategia,sugestao")
      .eq("session_id", sessionId)
      .is("resultado_real", null);

    if (error) throw error;
    if (!data || !data.length) return;

    const hits = [];
    const misses = [];
    const evaluatedAt = new Date().toISOString();

    for (const prediction of data) {
      const actual = Analysis.categoryOf(real, prediction.categoria);

      // "linha" é legado. Fecha o registro sem acerto/erro para não contaminar métricas.
      if (actual === null) {
        const { error: legacyError } = await db
          .from("aprendizado_estrategias")
          .update({ resultado_real: real, avaliado_em: evaluatedAt })
          .eq("id", prediction.id)
          .is("resultado_real", null);
        if (legacyError) throw legacyError;
        continue;
      }

      if (normalize(prediction.sugestao) === normalize(actual)) {
        hits.push(prediction.id);
      } else {
        misses.push(prediction.id);
      }
    }

    for (const [ids, acertou] of [[hits, true], [misses, false]]) {
      if (!ids.length) continue;

      const { error: updateError } = await db
        .from("aprendizado_estrategias")
        .update({ resultado_real: real, acertou, avaliado_em: evaluatedAt })
        .in("id", ids)
        .is("resultado_real", null);

      if (updateError) throw updateError;
    }
  }

  async function createAdaptivePredictions() {
    if (!DB_READY || !learningAvailable || history.length < 10) return;

    const { data: pending, error: pendingError } = await db
      .from("aprendizado_estrategias")
      .select("id")
      .eq("session_id", sessionId)
      .is("resultado_real", null)
      .limit(1);

    if (pendingError) throw pendingError;
    if (pending && pending.length) return;

    const candidates = Analysis.makeStrategyCandidates(history);
    if (!candidates.length) return;

    const records = candidates.map(item => ({
      session_id: sessionId,
      janela: 30,
      categoria: item.categoria,
      estrategia: item.estrategia,
      sugestao: String(item.sugestao),
      peso: 1
    }));

    const { error } = await db.from("aprendizado_estrategias").insert(records);
    if (error) throw error;
  }

  // =====================================
  // HIPÓTESE NUMÉRICA AUXILIAR
  // =====================================

  // Garante UMA hipótese pendente por sessão (evita linhas duplicadas
  // que nunca seriam avaliadas).
  async function ensureNumericPending() {
    currentForecast = Analysis.makeForecast(history);
    renderForecast();

    if (!currentForecast || !learningAvailable) return;

    const { data: pending, error: pendingError } = await db
      .from("aprendizado_modelo")
      .select("id")
      .eq("session_id", sessionId)
      .is("resultado_real", null)
      .limit(1);

    if (pendingError) throw pendingError;
    if (pending && pending.length) return;

    const f = currentForecast;

    const { error } = await db.from("aprendizado_modelo").insert({
      session_id: sessionId,
      base_ultimo_numero: f.base,
      previsto_numero: f.number,
      previsto_cor: f.color,
      previsto_faixa: f.range,
      previsto_paridade: f.parity
    });

    if (error) console.warn("Erro ao registrar hipótese numérica:", error.message);
  }

  async function evaluateNumericPending(real) {
    const { data, error } = await db
      .from("aprendizado_modelo")
      .select("id,previsto_numero,previsto_cor,previsto_faixa,previsto_paridade")
      .eq("session_id", sessionId)
      .is("resultado_real", null)
      .order("criado_em", { ascending: false })
      .limit(1);

    if (error) throw error;
    if (!data || !data.length) return;

    const prediction = data[0];

    const { error: updateError } = await db
      .from("aprendizado_modelo")
      .update({
        resultado_real: real,
        acertou_numero: Number(prediction.previsto_numero) === real,
        acertou_cor: prediction.previsto_cor === Analysis.colorOf(real),
        acertou_faixa:
          normalize(prediction.previsto_faixa) === normalize(Analysis.rangeOf(real)),
        acertou_paridade:
          normalize(prediction.previsto_paridade) === normalize(Analysis.parityOf(real)),
        avaliado_em: new Date().toISOString()
      })
      .eq("id", prediction.id)
      .is("resultado_real", null);

    if (updateError) throw updateError;
  }

  async function loadNumericStats() {
    const { data, error } = await db
      .from("aprendizado_modelo")
      .select("acertou_numero,acertou_cor")
      .eq("session_id", sessionId)
      .not("resultado_real", "is", null)
      .order("criado_em", { ascending: false })
      .limit(500);

    if (error || !data) return null;

    const total = data.length;

    return {
      total,
      exact: data.filter(r => r.acertou_numero).length,
      color: data.filter(r => r.acertou_cor).length
    };
  }

  // =====================================
  // RENDERIZAÇÃO
  // =====================================

  function renderSuggestions() {
    const el = $("suggestionsGrid");
    if (!el) return;

    const suggestions = Analysis.makeSuggestions(history, learningEvaluations);

    if (!suggestions) {
      el.innerHTML = `
        <article class="sug-card sug-empty">
          <small>PALPITES</small>
          <strong>—</strong>
          <span>Precisa de 10+ resultados no histórico.</span>
        </article>`;
      return;
    }

    const cards = [
      ["COR", suggestions.cor, suggestions.cor.value],
      ["PARIDADE", suggestions.paridade, null],
      ["ALTO/BAIXO", suggestions.faixa, null],
      ["COLUNA", suggestions.coluna, null],
      ["DÚZIA", suggestions.duzia, null],
      ["RUA", suggestions.rua, null]
    ];

    el.innerHTML = cards.map(([title, item, colorValue]) => {
      const tone = colorValue ? ` tone-${colorValue}` : "";
      const meta = item.learning
        ? `${item.count}/${item.total} hist. · ${item.pct} rec.`
        : "em observação";

      return `
        <article class="sug-card${tone}" title="Estratégia: ${item.strategyLabel}">
          <small>${title}</small>
          <strong>${item.label}</strong>
          <span>${meta}${item.declining ? ' <b class="down">▼</b>' : ""}</span>
        </article>`;
    }).join("");
  }

  function renderForecast() {
    const f = currentForecast;

    if ($("forecastNumber")) {
      $("forecastNumber").textContent = f ? f.number : "—";
      $("forecastNumber").className =
        "forecast-number" + (f ? ` ${Analysis.colorOf(f.number)}` : "");
    }

    if ($("forecastTitle")) {
      $("forecastTitle").textContent = f
        ? f.method
        : "Aguardando histórico";
    }

    if ($("forecastColor")) $("forecastColor").textContent = f ? Analysis.colorLabel(f.color) : "—";
    if ($("forecastRange")) $("forecastRange").textContent = f ? f.range : "—";
    if ($("forecastParity")) $("forecastParity").textContent = f ? f.parity : "—";
    if ($("forecastCandidates")) $("forecastCandidates").textContent = f ? `Outros candidatos do histórico: ${f.candidates.slice(1).join(", ")}` : "";
  }

  function renderNumericStats(stats) {
    if (!stats) return;

    if ($("evaluatedCount")) $("evaluatedCount").textContent = stats.total;

    if ($("exactRate")) {
      $("exactRate").textContent = stats.total
        ? `${Math.round((stats.exact / stats.total) * 100)}%`
        : "—";
    }

    if ($("colorRate")) {
      $("colorRate").textContent = stats.total
        ? `${Math.round((stats.color / stats.total) * 100)}%`
        : "—";
    }
  }

  function renderAll() {
    if ($("statTotal")) {
      $("statTotal").textContent = (totalInDb ?? history.length).toLocaleString("pt-BR");
    }

    if ($("statSession")) $("statSession").textContent = sessionCount;

    const last = history.length ? history[history.length - 1] : undefined;

    if ($("statLast")) $("statLast").textContent = last ?? "—";

    if ($("statLastMeta")) {
      $("statLastMeta").textContent =
        last === undefined
          ? "Aguardando registro"
          : `${Analysis.colorLabel(Analysis.colorOf(last))} · ${Analysis.parityOf(last)}`;
    }

    const summary = Analysis.summarize(history);

    if ($("summaryWindow")) {
      $("summaryWindow").textContent = `últimos ${summary.size}`;
    }

    if ($("hotNumbers")) {
      $("hotNumbers").innerHTML = summary.hot.map(item => `
        <div class="rank-item">
          ${ball(item.n)}
          <div class="bar"><i style="width:${Math.round((item.count / summary.maxCount) * 100)}%"></i></div>
          <b>${item.count}×</b>
        </div>`).join("");
    }

    if ($("coldNumbers")) {
      $("coldNumbers").innerHTML = summary.cold.map(item => `
        <div class="rank-item">
          ${ball(item.n)}
          <div class="bar"><i style="width:${Math.round((item.delay / summary.maxDelay) * 100)}%"></i></div>
          <b>${item.delay}</b>
        </div>`).join("");
    }

    if ($("colorStats")) {
      $("colorStats").innerHTML = Object.entries(summary.colors)
        .map(([key, value]) => `<div class="dist-line"><span>${key}</span><b>${value}</b></div>`)
        .join("");
    }

    if ($("rangeStats")) {
      $("rangeStats").innerHTML = `
        <div class="dist-line"><span>Par</span><b>${summary.parity.Par}</b></div>
        <div class="dist-line"><span>Ímpar</span><b>${summary.parity["Ímpar"]}</b></div>
        <div class="dist-line"><span>Baixo</span><b>${summary.ranges["1–18"]}</b></div>
        <div class="dist-line"><span>Alto</span><b>${summary.ranges["19–36"]}</b></div>`;
    }

    if ($("recentStrip")) {
      $("recentStrip").innerHTML = history.length
        ? history.slice(-14).reverse().map(ball).join("")
        : '<span class="empty">Sem resultados ainda</span>';
    }

    if ($("recentResults")) {
      $("recentResults").innerHTML = history.length
        ? history.slice(-40).reverse().map(ball).join("")
        : '<span class="empty">Nenhum resultado registrado.</span>';
    }

    renderSuggestions();
    renderForecast();

    const banner = $("learningWarning");
    if (banner) banner.hidden = learningAvailable;
  }

  // =====================================
  // PROCESSAMENTO EM SEGUNDO PLANO
  // =====================================

  async function processAfterSave(real) {
    try {
      if (learningAvailable) {
        await evaluateNumericPending(real);
        await evaluateAdaptivePending(real);
        await loadLearningEvaluations();
      }

      renderSuggestions();

      await ensureNumericPending();
      await createAdaptivePredictions();

      renderNumericStats(await loadNumericStats());
    } catch (error) {
      console.error("Erro no processamento em segundo plano:", error);
      showMessage(
        `Resultado salvo. Análise será refeita na próxima atualização (${error.message || error}).`,
        true
      );
    }
  }

  function queueBackgroundProcessing(real) {
    backgroundQueue = backgroundQueue
      .then(() => processAfterSave(real))
      .catch(error => console.error("Falha na fila de aprendizado:", error));
  }

  // =====================================
  // CARREGAMENTO DO BANCO
  // =====================================

  async function loadHistory() {
    if (!DB_READY) {
      setStatus("Sem configuração", "error");
      showMessage(DB_ERROR || "Verifique a configuração do Supabase.", true);
      return;
    }

    if (loading) return;

    loading = true;
    setStatus("Carregando");

    try {
      // 1) O histórico principal sempre aparece primeiro.
      await loadRecentHistory();
      await safeLoadLearning();

      renderAll();
      setStatus("Banco conectado", "online");

      if ($("updatedAt")) {
        $("updatedAt").textContent = `Atualizado ${new Date().toLocaleTimeString("pt-BR", {
          hour: "2-digit",
          minute: "2-digit"
        })}`;
      }

      // 2) Aprendizado em segundo plano; falhas aqui não derrubam o app.
      try {
        await createAdaptivePredictions();
        await ensureNumericPending();
        renderNumericStats(await loadNumericStats());
      } catch (error) {
        console.warn("Aprendizado não pôde ser preparado:", error);
      }
    } catch (error) {
      console.error(error);
      setStatus("Falha no banco", "error");
      showMessage(`Erro ao carregar: ${error.message || error}`, true);
    } finally {
      loading = false;
    }
  }

  // =====================================
  // REGISTRO RÁPIDO
  // =====================================

  async function saveNumber() {
    if (selected === null || saving) return;

    if (!DB_READY) {
      showMessage("Supabase não está conectado.", true);
      return;
    }

    const number = selected;

    saving = true;

    if ($("saveNumber")) $("saveNumber").disabled = true;

    showMessage("Enviando…");

    try {
      const { error } = await db
        .from("historico_analise")
        .insert({ numero: number, session_id: sessionId });

      if (error) throw error;

      history.push(number);
      sessionCount++;
      if (totalInDb !== null) totalInDb++;

      saving = false;
      clearNumber(`Resultado ${number} registrado.`);
      renderAll();

      queueBackgroundProcessing(number);
    } catch (error) {
      console.error(error);
      showMessage(`Não foi possível registrar: ${error.message || error}`, true);
    } finally {
      saving = false;
      if ($("saveNumber")) $("saveNumber").disabled = selected === null;
    }
  }

  // =====================================
  // INICIALIZAÇÃO
  // =====================================

  if ($("refreshData")) $("refreshData").addEventListener("click", loadHistory);

  setupKeypad();
  renderAll();
  loadHistory();

  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    navigator.serviceWorker.register("./sw.js").catch(console.warn);
  }
})();
