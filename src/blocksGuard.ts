// AIDEV-NOTE: [resposta-pronta-blocos 01/09/2026] Resposta pronta guarda o texto em DOIS lugares:
// `blocks` (o que e REALMENTE enviado ao cliente, via CannedResponseDispatchService) e `content`
// (copia usada so pra busca/preview). O model do Rails tem `before_save :sync_content_from_blocks`,
// entao TODA gravacao reescreve `content` a partir do primeiro bloco de texto. Consequencia: mandar
// SO `content` numa resposta que tem blocos e descartado SEMPRE — a API responde 200, devolve o
// registro com o texto VELHO e nao levanta erro nenhum.
//
// Medido em 01/09/2026 (conta 56): 130 de 131 respostas prontas tem blocos, e 6 chamadas
// so-com-`content` nao gravaram absolutamente nada — o efeito parecia intermitente so porque outra
// pessoa editava as mesmas respostas no painel ao mesmo tempo.
//
// Este guard recusa esse caso ANTES de gravar e explica o que fazer. Mesma familia da trava de
// `confirm_required`: falha barulhenta em vez de silencio.
//
// GOTCHA: `canned_responses` NAO tem rota de leitura por id (routes.rb: only index/create/update/
// destroy). Ler `/canned_responses/{id}` daria 404 e o guard viraria no-op silencioso — por isso a
// conferencia passa pela LISTA e acha o registro pelo id.

export const BLOCKS_GUARD_TOOL_ID = 'lionchat_canned_responses_update';

const BODY_WRAPPER = 'canned_response';

/** Corpo ja embrulhado por separateParams: { canned_response: { ... } }. */
function unwrapBody(body: unknown): Record<string, unknown> | undefined {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return undefined;
  const inner = (body as Record<string, unknown>)[BODY_WRAPPER];
  if (!inner || typeof inner !== 'object' || Array.isArray(inner)) return undefined;
  return inner as Record<string, unknown>;
}

/**
 * Verdadeiro quando quem chamou mandou `content` e NAO mandou `blocks` — o unico caso em que o
 * Rails descarta o texto em silencio.
 */
export function sentContentWithoutBlocks(body: unknown): boolean {
  const inner = unwrapBody(body);
  if (!inner) return false;

  const content = inner['content'];
  const hasContent = typeof content === 'string' && content.length > 0;
  if (!hasContent) return false;

  const blocks = inner['blocks'];
  const hasBlocks = Array.isArray(blocks) ? blocks.length > 0 : blocks !== undefined && blocks !== null;
  return !hasBlocks;
}

/** Acha o registro na lista e diz se ele e feito de blocos. */
export function recordHasBlocks(list: unknown, id: unknown): boolean {
  if (!Array.isArray(list)) return false;
  const wanted = String(id);
  const record = list.find(
    (r) => r && typeof r === 'object' && String((r as Record<string, unknown>)['id']) === wanted
  ) as Record<string, unknown> | undefined;
  if (!record) return false;
  const blocks = record['blocks'];
  return Array.isArray(blocks) && blocks.length > 0;
}

export function blocksGuardMessage(id: unknown): string {
  return (
    `A resposta pronta ${id} e feita de BLOCOS, e os blocos sao o que o cliente recebe. ` +
    'O campo `content` e apenas uma copia: o servidor o reescreve a partir do primeiro bloco a cada ' +
    'gravacao, entao enviar so `content` NAO altera nada (a chamada responde sucesso e o texto ' +
    'antigo continua valendo). ' +
    'Reenvie com `blocks` — o array inteiro, com o texto novo dentro do bloco — de preferencia com ' +
    '`content` igual ao primeiro bloco de texto. Use `lionchat_canned_responses_list` para ver os ' +
    'blocos atuais antes de montar o array.'
  );
}

/**
 * Devolve a mensagem de recusa, ou null pra seguir normalmente.
 *
 * FAIL-OPEN de proposito: se a lista nao puder ser lida (rede, permissao, formato inesperado), a
 * gravacao segue como antes. O guard existe pra evitar um no-op silencioso, nunca pra impedir uma
 * edicao legitima por indisponibilidade.
 */
export async function blocksGuardRefusal(
  toolId: string,
  body: unknown,
  id: unknown,
  loadList: () => Promise<unknown>
): Promise<string | null> {
  if (toolId !== BLOCKS_GUARD_TOOL_ID) return null;
  if (!sentContentWithoutBlocks(body)) return null;

  let list: unknown;
  try {
    list = await loadList();
  } catch {
    return null;
  }

  return recordHasBlocks(list, id) ? blocksGuardMessage(id) : null;
}
