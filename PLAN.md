# Camunda MCP Plugin — v0.2 Implementation Plan

## Context

v0.1 is complete and tested. It ships 8 tools: `create_model`, `add_start_event`, `add_task`, `add_end_event`, `connect_elements`, `create_form`, `add_form_field`, `link_form_to_task`. The architecture is proven — stateless MCP over Streamable HTTP, renderer bridge via `webContents.executeJavaScript()`, bpmn-js DI with `modeling`, `elementRegistry`, `canvas`, `moddle`, `bpmnFactory`.

v0.2 adds the remaining BPMN element types, element configuration (implementation types, conditions, I/O mappings), and diagram introspection — making the plugin capable of building production-grade BPMN workflows entirely through AI tool calls.

---

## Files to modify (all changes follow the established 3-file pattern)

- `src/tools/registry.ts` — add Zod schemas + ToolDefinition entries
- `src/tools/handlers.ts` — add dispatch cases (renderer tools just validate + forward)
- `client/bpmn-tools.ts` — add renderer implementations

---

## Phase 1: Remaining BPMN Elements (can parallelise all 3 tasks)

### Task 1: Gateways — `add_gateway`

**Schema:**
```ts
z.object({
  diagramId: z.string(),
  type: z.enum([
    'bpmn:ExclusiveGateway',   // XOR — decision point
    'bpmn:ParallelGateway',    // AND — parallel split/join
    'bpmn:InclusiveGateway',   // OR — inclusive split
    'bpmn:EventBasedGateway',  // event-driven branching
  ]).default('bpmn:ExclusiveGateway'),
  name: z.string().default(''),
  x: z.number().default(400),
  y: z.number().default(200),
})
```

**Renderer:** Same pattern as `addStartEvent` — `modeling.createShape({ type }, { x, y }, rootElement)` + `modeling.updateLabel()`. Default dimensions for gateways are 50x50 (diamond shape — bpmn-js handles this automatically, no explicit width/height needed).

---

### Task 2: Intermediate & Boundary Events — `add_event`

Generalise event creation into a single `add_event` tool rather than one tool per event type.

**Schema:**
```ts
z.object({
  diagramId: z.string(),
  type: z.enum([
    'bpmn:IntermediateCatchEvent',
    'bpmn:IntermediateThrowEvent',
    'bpmn:BoundaryEvent',
  ]),
  eventDefinitionType: z.enum([
    'bpmn:TimerEventDefinition',
    'bpmn:MessageEventDefinition',
    'bpmn:SignalEventDefinition',
    'bpmn:ErrorEventDefinition',
    'bpmn:EscalationEventDefinition',
    'bpmn:ConditionalEventDefinition',
    'bpmn:CompensateEventDefinition',
    'none',
  ]).default('none'),
  name: z.string().default(''),
  x: z.number().default(400),
  y: z.number().default(200),
  // For BoundaryEvent — attach to a host element
  attachedToId: z.string().optional().describe('Host element ID (required for BoundaryEvent)'),
  cancelActivity: z.boolean().default(true).describe('For BoundaryEvent: interrupting (true) or non-interrupting (false)'),
  // For TimerEventDefinition
  timerValue: z.string().optional().describe('ISO 8601 timer expression (e.g. PT1H, R/PT5M, 2025-12-31T23:59:59Z)'),
  timerType: z.enum(['timeDuration', 'timeCycle', 'timeDate']).optional(),
})
```

**Renderer:**
1. Create shape via `modeling.createShape({ type }, { x, y }, parent)`
   - For `BoundaryEvent`: parent is the host element (from `attachedToId`), not rootElement
2. If `eventDefinitionType !== 'none'`: create event definition via `moddle.create(eventDefinitionType, props)` and attach to `shape.businessObject.eventDefinitions`
3. For timer events: set `timeDuration`, `timeCycle`, or `timeDate` on the TimerEventDefinition
4. Apply via `modeling.updateProperties()`

---

### Task 3: Sub-processes — `add_subprocess`

**Schema:**
```ts
z.object({
  diagramId: z.string(),
  type: z.enum([
    'bpmn:SubProcess',
    'bpmn:CallActivity',
  ]).default('bpmn:SubProcess'),
  name: z.string().default(''),
  x: z.number().default(350),
  y: z.number().default(150),
  width: z.number().default(350),
  height: z.number().default(200),
  collapsed: z.boolean().default(false),
  // For CallActivity
  calledElement: z.string().optional().describe('Process ID to call (for CallActivity)'),
})
```

**Renderer:** `modeling.createShape({ type, isExpanded: !collapsed }, { x, y, width, height }, rootElement)`. For CallActivity, set `calledElement` via `modeling.updateProperties()`.

---

## Phase 2: Element Configuration (sequential — each builds on `set_properties`)

### Task 4: Set Properties — `set_properties`

The core configuration tool. Rather than one massive generic tool, use a structured approach with property groups.

**Schema:**
```ts
z.object({
  diagramId: z.string(),
  elementId: z.string().describe('ID of the element to configure'),
  // Basic BPMN properties
  name: z.string().optional(),
  documentation: z.string().optional(),
  // Sequence flow condition
  conditionExpression: z.string().optional().describe('FEEL/JUEL expression for sequence flow conditions'),
  // Camunda 7 — ServiceTask implementation
  implementationType: z.enum([
    'class',              // camunda:class
    'delegateExpression', // camunda:delegateExpression
    'expression',         // camunda:expression
    'external',           // camunda:type=external + camunda:topic
    'connector',          // camunda:connector
  ]).optional(),
  implementationValue: z.string().optional().describe('Class name, expression, or connector ID'),
  // Camunda 7 — External task
  taskTopic: z.string().optional().describe('Topic name for external tasks'),
  taskPriority: z.string().optional(),
  // Camunda 8 / Zeebe — task definition
  taskType: z.string().optional().describe('Zeebe job type (e.g. "send-email", "payment-service")'),
  taskRetries: z.string().optional().default('3').describe('Zeebe retry count'),
  // Process-level
  isExecutable: z.boolean().optional(),
})
```

**Renderer:**
1. Get element via `elementRegistry.get(elementId)`
2. Build properties object from provided fields
3. For basic props: `modeling.updateProperties(element, { name, documentation })`
4. For Camunda 7 implementation: detect `moddle.getPackage('camunda')`, then set `camunda:class` / `camunda:delegateExpression` / etc. via `modeling.updateProperties()`
5. For Zeebe task definition: create `zeebe:TaskDefinition` via `moddle.create()`, attach to extension elements
6. For conditions on sequence flows: set `conditionExpression` property (create `bpmn:FormalExpression` via moddle if needed)

---

### Task 5: I/O Mappings — `set_io_mapping`

**Schema:**
```ts
z.object({
  diagramId: z.string(),
  elementId: z.string(),
  inputs: z.array(z.object({
    source: z.string().describe('Source expression (Zeebe: FEEL expression prefixed with =)'),
    target: z.string().describe('Target variable name'),
  })).optional(),
  outputs: z.array(z.object({
    source: z.string(),
    target: z.string(),
  })).optional(),
})
```

**Renderer:**
- Camunda 8: Create `zeebe:IoMapping` with `zeebe:Input` / `zeebe:Output` entries via moddle, attach to extension elements
- Camunda 7: Create `camunda:InputOutput` with `camunda:InputParameter` / `camunda:OutputParameter`

---

### Task 6: Task Headers — `set_task_headers`

**Schema:**
```ts
z.object({
  diagramId: z.string(),
  elementId: z.string(),
  headers: z.array(z.object({
    key: z.string(),
    value: z.string(),
  })),
})
```

**Renderer:** Create `zeebe:TaskHeaders` with `zeebe:Header` entries. For Camunda 7, use `camunda:Properties` with `camunda:Property`.

---

## Phase 3: Diagram Introspection & Manipulation (can parallelise all 3)

### Task 7: List Elements — `list_elements`

**Schema:**
```ts
z.object({
  diagramId: z.string(),
  typeFilter: z.string().optional().describe('Filter by BPMN type prefix, e.g. "bpmn:Task" returns all task types'),
})
```

**Renderer:** `elementRegistry.getAll()` or `elementRegistry.filter()`, return array of `{ id, type, name, x, y }`. Exclude `bpmndi:*` diagram elements — only return semantic BPMN elements.

---

### Task 8: Get Element Details — `get_element`

**Schema:**
```ts
z.object({
  diagramId: z.string(),
  elementId: z.string(),
})
```

**Renderer:** Return comprehensive info: `{ id, type, name, properties, extensionElements, incoming, outgoing, x, y, width, height }`. Extract business object properties and extension element values.

---

### Task 9: Delete Element — `delete_element`

**Schema:**
```ts
z.object({
  diagramId: z.string(),
  elementId: z.string(),
})
```

**Renderer:** `modeling.removeElements([elementRegistry.get(elementId)])`. Returns `{ deleted: true, elementId }`.

---

### Task 10: Get/Import Diagram XML — `get_diagram_xml` and `import_xml`

**`get_diagram_xml` schema:**
```ts
z.object({ diagramId: z.string() })
```

**`import_xml` schema:**
```ts
z.object({
  diagramId: z.string(),
  xml: z.string().describe('Complete BPMN 2.0 XML to import'),
})
```

**Renderer challenge:** These need access to the `modeler` instance (not just `modeling`). The modeler provides `saveXML()` and `importXML()`. We may need to add `modeler` or `injector` to the DI injection list, or access it via `eventBus._eventBus` / `canvas._canvas` parent references. Alternative: inject `config.canvas` or use `eventBus` to fire a custom event that the modeler listens for.

**Approach:** Try injecting `injector` (the bpmn-js DI container) which provides `injector.get('modeler')` access. Update `$inject` to include it. If `modeler` isn't injectable, use `canvas._container` to walk up to the modeler instance.

---

## Phase 4: Documentation & Testing

### Task 11: Update README & PLAN.md

- Update Available Tools table with all new tools
- Add examples for common workflows (gateway branching, service task config, I/O mappings)
- Update project structure if new files were added

### Task 12: E2E Verification

Test a complex workflow end-to-end:
1. `create_model` → new diagram
2. `add_start_event` → "Order Received"
3. `add_task` (UserTask) → "Review Order"
4. `add_gateway` (Exclusive) → "Approved?"
5. `connect_elements` → Start → Review → Gateway
6. `add_task` (ServiceTask) → "Process Payment"
7. `add_task` (ServiceTask) → "Send Rejection"
8. `connect_elements` → Gateway → Payment, Gateway → Rejection
9. `set_properties` → set condition on "approved" flow
10. `set_properties` → set Zeebe task type on ServiceTasks
11. `add_end_event` (x2) → "Order Fulfilled", "Order Rejected"
12. `connect_elements` → close all flows
13. `list_elements` → verify all elements present
14. `get_diagram_xml` → export and validate XML

---

## Task Dependency & Parallelisation

```
Phase 1 (parallel):  Task 1 (Gateways) | Task 2 (Events) | Task 3 (Sub-processes)
                              ↓
Phase 2 (sequential): Task 4 (set_properties) → Task 5 (I/O) → Task 6 (Headers)
                              ↓
Phase 3 (parallel):  Task 7 (list) | Task 8 (get) | Task 9 (delete) | Task 10 (XML)
                              ↓
Phase 4:             Task 11 (Docs) → Task 12 (E2E)
```

Phase 1 tasks are fully independent — different element types, no shared code.
Phase 2 is sequential — Tasks 5 and 6 build on the extension element patterns established in Task 4.
Phase 3 tasks are independent — all read-only or simple mutations.

---

## Verification

After all tasks complete:
1. `npm run build` — clean compilation
2. Restart Modeler — plugin loads, `tools/list` returns all new tools
3. Run the E2E workflow from Task 12 via curl or Claude Code
4. Verify in Modeler: elements placed correctly, properties visible in panel, XML export valid
5. Test cross-version: verify `set_properties` works in both Camunda 7 and Camunda 8 mode
