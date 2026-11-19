(() => {
  const cfg = window.APP_CONFIG || {};
  window.db = null;
  window.DB_READY = false;
  window.DB_ERROR = "";

  if (!window.supabase || !cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) {
    window.DB_ERROR = "Biblioteca ou configuração do Supabase não encontrada.";
    return;
  }

  try {
    window.db = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
    window.DB_READY = true;
  } catch (error) {
    window.DB_ERROR = error.message || "Falha ao iniciar Supabase.";
  }
})();
