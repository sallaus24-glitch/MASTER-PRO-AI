# MASTER PRO AI (v3.0)

App web mobile-first para registrar resultados de roleta europeia (0–36), consultar o histórico no Supabase e acompanhar análises estatísticas retrospectivas.

Na tela principal ficam juntos: **palpites, número digitado, últimos resultados e teclado**, sem precisar rolar. Resumo estatístico, hipótese numérica e linha do tempo ficam logo abaixo (no desktop, ao lado).

Também funciona com o teclado do computador: dígitos, `Backspace`, `Enter` (inserir) e `Esc` (limpar).

## Arquivos

- `index.html` — interface.
- `assets/css/style.css` — visual responsivo.
- `assets/js/config.js` — URL e chave publicável do Supabase.
- `assets/js/supabase.js` — inicialização do cliente.
- `assets/js/analysis.js` — cálculos estatísticos.
- `assets/js/app.js` — eventos, gravação, histórico e avaliação de previsões.
- `manifest.json` e `sw.js` — suporte PWA.
- `supabase/setup-aprendizado.sql` — cria as tabelas de aprendizado.
- `tests/analysis.test.js` — testes (`node tests/analysis.test.js`).

## Publicação no GitHub

Envie o conteúdo desta pasta para a raiz do repositório, mantendo os caminhos. Ative GitHub Pages em Settings → Pages → Deploy from a branch → `main` → `/ (root)`.

## Supabase

O app usa a tabela existente `historico_analise` (colunas `numero`, `session_id`, `criado_em`). **Ela não é alterada nem recriada.**

Execute `supabase/setup-aprendizado.sql` no SQL Editor. Ele é seguro de rodar mais de uma vez e cria `aprendizado_modelo` e `aprendizado_estrategias` (esta última era usada pelo app mas faltava no SQL antigo). Se a tabela de aprendizado não existir, o app continua funcionando e mostra um aviso.

### Mudanças da v3.0

- Corrigido: tabela `aprendizado_estrategias` ausente derrubava o carregamento do histórico.
- O histórico agora carrega só os 500 giros mais recentes + contagem exata, em vez de baixar a tabela inteira (e sem paginação instável).
- "Mais frequentes / atrasados" agora usam de fato os **últimos 100** giros, e as barras são proporcionais.
- Categoria "Linha" (4 grupos de 9, que não existe na roleta) trocada por **Dúzia** (1–12, 13–24, 25–36).
- Estratégia "alternância" só vale para sequências com exatamente dois valores; "quebra" nunca sugere zero.
- Mínimo de avaliações para uma estratégia ser considerada subiu de 8 para 20.
- Só existe uma hipótese numérica pendente por sessão (sem linhas duplicadas).
- Policies mais restritas nas tabelas de aprendizado: sem DELETE e linhas já avaliadas não podem ser reescritas.
- Versão do `supabase-js` fixada no CDN; cache do PWA inclui os ícones.

### Segurança

Sem login, o navegador usa a chave anon, então as tabelas ainda são acessíveis por quem tiver essa chave. Antes de abrir o app ao público, adicione autenticação e policies RLS por usuário, e confira as policies de `historico_analise` (este projeto não as modifica).

## Limite estatístico

Em uma roleta justa, cada giro é independente. Frequências e atrasos descrevem o histórico, não preveem o próximo giro nem prometem lucro; a casa tem vantagem de ~2,7% por causa do zero. O painel de aprendizado mede só o desempenho passado de métodos simples.
