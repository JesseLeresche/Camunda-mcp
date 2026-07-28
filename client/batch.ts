/**
 * batch_operations primitive: runs a sequence of primitive tool calls as a
 * single undoable step (when every operation is sync-safe) or as individual
 * undo steps (mixed sync/async), then runs a post-batch validation pass.
 */

import { type BpmnServices } from './element-shared';
import { dispatchRendererTool, dispatchRendererToolSync, ASYNC_TOOLS } from './bpmn-tools';
import { validateDiagram } from './diagram-io';

export async function batchOperations(
  params: Record<string, unknown>,
  services: BpmnServices
) {
  const { commandStack } = services;
  const operations = params.operations as Array<{ tool: string; params: Record<string, unknown> }>;
  const results: any[] = [];

  // If all operations are sync-safe, run them in a single undoable compound
  const allSync = operations.every(op => !ASYNC_TOOLS.has(op.tool));

  if (allSync) {
    let batchError: any = null;
    commandStack.execute('mcp.compound', { fn: () => {
      for (let i = 0; i < operations.length; i++) {
        const op = operations[i];
        const resolvedParams = resolveRefs(op.params, results);
        try {
          const result = dispatchRendererToolSync(op.tool, resolvedParams, services);
          results.push(result);
        } catch (err: any) {
          batchError = { error: `Operation ${i} (${op.tool}) failed: ${err.message}`, failedIndex: i, results };
          throw err; // abort the compound
        }
      }
    }});
    if (batchError) return batchError;
  } else {
    // Fallback: mixed sync/async — each operation is a separate undo step
    for (let i = 0; i < operations.length; i++) {
      const op = operations[i];
      const resolvedParams = resolveRefs(op.params, results);
      try {
        const result = await dispatchRendererTool(op.tool, resolvedParams, services);
        results.push(result);
      } catch (err: any) {
        return {
          error: `Operation ${i} (${op.tool}) failed: ${err.message}`,
          failedIndex: i,
          results,
        };
      }
    }
  }

  let validation: Record<string, unknown>;
  try {
    validation = await validateDiagram({}, services);
  } catch (err: any) {
    validation = { issues: [], count: 0, warning: `Validation check failed: ${err.message}` };
  }

  return { results, validation };
}

/**
 * Resolves "$ref:N" placeholders in params by replacing them with the
 * elementId or connectionId from the result at index N.
 */
function resolveRefs(
  params: Record<string, unknown>,
  results: any[],
): Record<string, unknown> {
  const resolved: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === 'string' && value.startsWith('$ref:')) {
      const idx = parseInt(value.slice(5), 10);
      if (idx >= 0 && idx < results.length) {
        const ref = results[idx];
        resolved[key] = ref.elementId || ref.connectionId || ref.flowId || ref.id;
      } else {
        resolved[key] = value;
      }
    } else {
      resolved[key] = value;
    }
  }
  return resolved;
}
