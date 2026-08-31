// AIDEV-NOTE: Carrega instructions.md de src/docs (dev) ou dist/docs (prod).
// Sincronizado de docs-lionchat/mcp/instructions.md via sync-to-mcps.sh.
// Conteudo enviado pra IA conectada via McpServer instructions option.

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

let cachedInstructions: string | null = null;

export function getServerInstructions(): string {
  if (cachedInstructions !== null) return cachedInstructions;

  // AIDEV-NOTE: [manual-nao-chegava 31/08] A 1a entrada e a que VALE nos dois modos, porque
  // docs/ e irmao do arquivo compilado: em producao __dirname=dist/ (achado: dist/docs/) e em
  // desenvolvimento __dirname=src/ (achado: src/docs/). As duas seguintes apontam um nivel ACIMA
  // e NUNCA existiram no pacote publicado — sem a 1a, o servidor caia no texto de reserva e a IA
  // conectada nunca recebia o manual (medido ao vivo em 30/08: a instrucao entregue era so a
  // frase curta abaixo). Ficam como rede pra layout futuro; nao remover a primeira.
  const candidates = [
    join(__dirname, 'docs/instructions.md'),
    join(__dirname, '../docs/instructions.md'),
    join(__dirname, '../../src/docs/instructions.md'),
  ];

  for (const filepath of candidates) {
    if (existsSync(filepath)) {
      cachedInstructions = readFileSync(filepath, 'utf-8');
      return cachedInstructions;
    }
  }

  cachedInstructions =
    'LionChat MCP Server — Plataforma brasileira de atendimento. Consulte resources/list pra mais info.';
  return cachedInstructions;
}
