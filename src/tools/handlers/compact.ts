import type { CallToolResult } from '../handlers';

/**
 * Strips a tool response down to essential information.
 * Applied when the caller passes `compact: true`.
 *
 * Strategy:
 * - Mutations (move, resize, connect, delete, etc.): return {ok: true}
 * - build_process: return flat idMap only
 * - batch_operations: return {ok: N} where N is the number of operations
 * - list_elements: return array of {id, type}
 * - validate_layout / get_element / get_element_bounds: keep full detail (that IS the payload)
 * - Errors: always keep full detail
 */
export function compactResult(result: CallToolResult, toolName?: string): CallToolResult {
  if (result.isError) return result;
  try {
    const data = JSON.parse(result.content[0].text);

    // Read-oriented tools: keep full response (the data IS the purpose)
    const keepFullTools = [
      'validate_layout', 'get_element', 'get_element_bounds', 'get_diagram_xml',
      'list_open_diagrams',
    ];
    if (toolName && keepFullTools.includes(toolName)) return result;

    // build_process: return just the idMap (only new information)
    if (data.idMap) {
      return { content: [{ type: 'text', text: JSON.stringify(data.idMap) }] };
    }

    // batch_operations: return count of operations
    if (Array.isArray(data.results)) {
      return { content: [{ type: 'text', text: JSON.stringify({ ok: data.results.length }) }] };
    }

    // list_elements: trim to id array
    if (Array.isArray(data.elements)) {
      return { content: [{ type: 'text', text: JSON.stringify({ ids: data.elements.map((el: any) => el.id) }) }] };
    }

    // Tabs
    if (Array.isArray(data.tabs)) {
      return { content: [{ type: 'text', text: JSON.stringify({ tabs: data.tabs.map((t: any) => ({ id: t.id, name: t.name })) }) }] };
    }

    // Issues (validate_layout) — keep full
    if (Array.isArray(data.issues)) return result;

    // Everything else (mutations): return {ok: true} + any ID fields
    const compacted: Record<string, unknown> = { ok: true };
    for (const key of Object.keys(data)) {
      if (key.endsWith('Id') || key === 'idMap' || key === 'childIds') {
        compacted[key] = data[key];
      }
    }
    return { content: [{ type: 'text', text: JSON.stringify(compacted) }] };
  } catch {
    return result;
  }
}
