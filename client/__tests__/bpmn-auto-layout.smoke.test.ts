import { describe, it, expect } from 'vitest';
import { layoutProcess } from 'bpmn-auto-layout';

/**
 * Phase 0 scaffolding smoke test — proves the testing strategy the rest of
 * the migration depends on: bpmn-auto-layout runs fine under plain Node/
 * vitest (no live Modeler/DOM needed), so the pure-function logic added in
 * later phases (semantic-XML building, post-processing pass) can be
 * regression-tested the same way instead of relying on manual visual
 * inspection in the live Modeler each time.
 */
describe('bpmn-auto-layout (Phase 0 scaffolding)', () => {
  it('lays out a minimal start -> task -> end process with no input DI', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                   id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_1" isExecutable="true">
    <bpmn:startEvent id="start"><bpmn:outgoing>f1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:task id="task"><bpmn:incoming>f1</bpmn:incoming><bpmn:outgoing>f2</bpmn:outgoing></bpmn:task>
    <bpmn:endEvent id="end"><bpmn:incoming>f2</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="f1" sourceRef="start" targetRef="task" />
    <bpmn:sequenceFlow id="f2" sourceRef="task" targetRef="end" />
  </bpmn:process>
</bpmn:definitions>`;

    const result = await layoutProcess(xml);

    expect(result).toContain('bpmndi:BPMNDiagram');
    expect(result).toContain('bpmnElement="start"');
    expect(result).toContain('bpmnElement="task"');
    expect(result).toContain('bpmnElement="end"');
    expect(result).toContain('bpmnElement="f1"');
    expect(result).toContain('bpmnElement="f2"');
  });
});
