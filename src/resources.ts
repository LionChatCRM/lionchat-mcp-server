// AIDEV-NOTE: Registra MCP Resources no McpServer (high-level SDK).
// 4 docs Markdown sincronizados de docs-lionchat/mcp/resources/.

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface ResourceDef {
  name: string;
  uri: string;
  description: string;
  filename: string;
}

export const RESOURCES: ResourceDef[] = [
  {
    name: 'Glossario LionChat',
    uri: 'lionchat://docs/glossary',
    description:
      'Glossario completo de termos, status codes, enums e conceitos. Consulte sempre que encontrar campo numerico ou enum desconhecido.',
    filename: 'glossary.md',
  },
  {
    name: 'Modelo de Dados',
    uri: 'lionchat://docs/data-model',
    description:
      'Mapa completo de entidades, relacionamentos e FKs. Use quando precisar entender como dados conectam.',
    filename: 'data-model.md',
  },
  {
    name: 'Guia de Relatorios',
    uri: 'lionchat://docs/reports-guide',
    description:
      'Como interpretar cada um dos 19 endpoints de relatorio. Unidades, comparativos, business hours, CSAT, SLA.',
    filename: 'reports-guide.md',
  },
  {
    name: 'Convencoes da API',
    uri: 'lionchat://docs/api-conventions',
    description:
      'Auth, paginacao, filtros, datas, codigos HTTP, rate limits. Use quando tiver duvida sobre como chamar endpoint.',
    filename: 'api-conventions.md',
  },
  {
    name: 'Filtros e Relatorios',
    uri: 'lionchat://docs/filtros-e-relatorios',
    description:
      'Tabelas COMPLETAS de chaves/operadores dos filtros de conversas, contatos e Kanban + relatorio agregado do funil + receitas prontas. Consulte ANTES de montar qualquer filtro ou relatorio — evita 422 de operador invalido.',
    filename: 'filtros-e-relatorios.md',
  },
  {
    name: 'Fluxos de Conversacao',
    uri: 'lionchat://docs/conversation-flows',
    description:
      'Ciclo de vida de uma conversa: criacao, greeting, auto-assignment, Captain IA, resolucao, snooze. Use pra diagnosticar comportamento de conversas.',
    filename: 'conversation-flows.md',
  },
  {
    name: 'Kanban Detalhado',
    uri: 'lionchat://docs/kanban-deep-dive',
    description:
      'Estrutura completa do Kanban: Funnel, stages, KanbanItem, item_details, pipeline, activities. Use ao trabalhar com cards ou funis.',
    filename: 'kanban-deep-dive.md',
  },
  {
    name: 'Boas Praticas',
    uri: 'lionchat://docs/best-practices',
    description:
      'Como economizar tokens, evitar rate limits, usar filtros, paginar. Consulte antes de workflows pesados ou loops em massa.',
    filename: 'best-practices.md',
  },
  {
    name: 'Troubleshooting',
    uri: 'lionchat://docs/troubleshooting',
    description:
      'Codigos HTTP, erros comuns (401/403/422/429), erros MCP, debugging, quando reportar suporte. Use pra interpretar erros.',
    filename: 'troubleshooting.md',
  },
  {
    name: 'FlowBuilder Design Guide',
    uri: 'lionchat://docs/flowbuilder-design-guide',
    description:
      'OBRIGATORIO antes de criar/editar fluxo. Arvore de decisao por necessidade, schema por tipo de node (com handles expostos), regras de layout/positioning, erros comuns, checklist pre-submit.',
    filename: 'flowbuilder-design-guide.md',
  },
  {
    name: 'FlowBuilder Patterns',
    uri: 'lionchat://docs/flowbuilder-patterns',
    description:
      '10 templates de fluxos prontos pra adaptar: saudacao, captura, qualificacao BANT, CSAT, horario comercial, IA intent, re-engajamento, escalation, agendamento, webhook. Cada um com layout valido e handles certos.',
    filename: 'flowbuilder-patterns.md',
  },
  {
    uri: 'lionchat://docs/formularios-publicos',
    name: 'Formularios Publicos',
    description:
      'Feature Formularios (captacao estilo Typeform/Typebot): contrato completo do form_data (blocos, handles, variaveis, blocos de API e IA), regras de publicacao, tetos e receitas. Use SEMPRE antes de criar/editar formularios via lionchat_lead_forms_*.',
    filename: 'formularios-publicos.md',
  },
];

function findDocsPath(filename: string): string | null {
  // __dirname e dist/ quando publicado (dist/docs/resources/) ou dist/ em dev.
  // Tenta multiplos layouts pra cobrir build local, npm/npx e source.
  const candidates = [
    join(__dirname, 'docs/resources', filename),        // dist/docs/resources (publicado)
    join(__dirname, '../docs/resources', filename),     // legacy / monorepo
    join(__dirname, '../../src/docs/resources', filename), // source dir em dev
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

export function registerResources(server: McpServer): void {
  for (const res of RESOURCES) {
    server.registerResource(
      res.name,
      res.uri,
      {
        description: res.description,
        mimeType: 'text/markdown',
      },
      async (uri) => {
        const filepath = findDocsPath(res.filename);
        if (!filepath) {
          throw new Error(`Resource file missing: ${res.filename}`);
        }
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: 'text/markdown',
              text: readFileSync(filepath, 'utf-8'),
            },
          ],
        };
      },
    );
  }
}
