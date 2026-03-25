import { describe, it, expect, afterEach } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { dispatch } from '../handlers';
import { tools } from '../registry';

/**
 * Collects temp files created during tests so we can clean them up.
 */
const tempFiles: string[] = [];

afterEach(() => {
  for (const f of tempFiles) {
    try {
      fs.unlinkSync(f);
    } catch {
      // ignore — file may not have been created
    }
  }
  tempFiles.length = 0;
});

// ---------------------------------------------------------------------------
// createModel tests
// ---------------------------------------------------------------------------
describe('createModel', () => {
  it('returns diagramId, filePath, and message when given a name', async () => {
    const result = await dispatch('create_model', { name: 'test-diagram' });

    expect(result.isError).toBeFalsy();
    const payload = JSON.parse(result.content[0].text);

    expect(payload.diagramId).toBeDefined();
    expect(payload.filePath).toBeDefined();
    expect(payload.message).toContain('test-diagram');

    // Track for cleanup
    tempFiles.push(payload.filePath);

    // Verify the file was written with valid BPMN XML
    const xml = fs.readFileSync(payload.filePath, 'utf-8');
    expect(xml).toContain('<?xml version="1.0"');
    expect(xml).toContain('bpmn:definitions');
    expect(xml).toContain('bpmn:process');
  });

  it('writes the .bpmn file to os.tmpdir()', async () => {
    const result = await dispatch('create_model', { name: 'tmpdir-check' });
    const payload = JSON.parse(result.content[0].text);
    tempFiles.push(payload.filePath);

    expect(payload.filePath).toContain(os.tmpdir());
    expect(payload.filePath).toMatch(/\.bpmn$/);
    expect(fs.existsSync(payload.filePath)).toBe(true);
  });

  it('works with empty params (name is optional)', async () => {
    const result = await dispatch('create_model', {});

    expect(result.isError).toBeFalsy();
    const payload = JSON.parse(result.content[0].text);

    expect(payload.diagramId).toBeDefined();
    expect(payload.filePath).toBeDefined();
    expect(payload.message).toBeDefined();

    tempFiles.push(payload.filePath);
  });
});

// ---------------------------------------------------------------------------
// createForm tests
// ---------------------------------------------------------------------------
describe('createForm', () => {
  it('creates a form with fields and returns formId, filePath, fieldCount', async () => {
    const result = await dispatch('create_form', {
      name: 'test-form',
      fields: [
        {
          key: 'name',
          label: 'Name',
          type: 'textfield',
          required: true,
        },
      ],
    });

    expect(result.isError).toBeFalsy();
    const payload = JSON.parse(result.content[0].text);

    expect(payload.formId).toBeDefined();
    expect(payload.filePath).toBeDefined();
    expect(payload.fieldCount).toBe(1);

    tempFiles.push(payload.filePath);

    // Verify the .form file contains valid JSON with the field
    const formJson = JSON.parse(fs.readFileSync(payload.filePath, 'utf-8'));
    expect(formJson.components).toHaveLength(1);
    expect(formJson.components[0].key).toBe('name');
    expect(formJson.components[0].label).toBe('Name');
    expect(formJson.components[0].type).toBe('textfield');
    expect(formJson.components[0].validate).toEqual({ required: true });
    expect(formJson.type).toBe('default');
    expect(formJson.executionPlatform).toBe('Camunda Cloud');
  });

  it('creates a form with no fields', async () => {
    const result = await dispatch('create_form', { name: 'empty-form' });

    expect(result.isError).toBeFalsy();
    const payload = JSON.parse(result.content[0].text);

    expect(payload.fieldCount).toBe(0);
    tempFiles.push(payload.filePath);

    const formJson = JSON.parse(fs.readFileSync(payload.filePath, 'utf-8'));
    expect(formJson.components).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// addFormField tests
// ---------------------------------------------------------------------------
describe('addFormField', () => {
  it('adds a field to an existing form and increments fieldCount', async () => {
    // Create a form first
    const createResult = await dispatch('create_form', {
      name: 'field-test-form',
      fields: [{ key: 'name', label: 'Name', type: 'textfield' }],
    });
    const createPayload = JSON.parse(createResult.content[0].text);
    tempFiles.push(createPayload.filePath);

    expect(createPayload.fieldCount).toBe(1);

    // Add a new field
    const addResult = await dispatch('add_form_field', {
      formPath: createPayload.filePath,
      key: 'email',
      label: 'Email',
      type: 'textfield',
    });

    expect(addResult.isError).toBeFalsy();
    const addPayload = JSON.parse(addResult.content[0].text);
    expect(addPayload.fieldCount).toBe(2);
    expect(addPayload.key).toBe('email');

    // Verify the file on disk has both fields
    const formJson = JSON.parse(fs.readFileSync(createPayload.filePath, 'utf-8'));
    expect(formJson.components).toHaveLength(2);
    expect(formJson.components[1].key).toBe('email');
    expect(formJson.components[1].label).toBe('Email');
  });

  it('returns an error for a non-existent form file', async () => {
    const result = await dispatch('add_form_field', {
      formPath: path.join(os.tmpdir(), 'nonexistent-form.form'),
      key: 'test',
      label: 'Test',
      type: 'textfield',
    });

    expect(result.isError).toBe(true);
    const payload = JSON.parse(result.content[0].text);
    expect(payload.error).toContain('Failed to read form file');
  });
});

// ---------------------------------------------------------------------------
// createDmn tests
// ---------------------------------------------------------------------------
describe('createDmn', () => {
  it('creates a DMN file with default inputs/outputs and returns metadata', async () => {
    const result = await dispatch('create_dmn', { name: 'test-decision' });

    expect(result.isError).toBeFalsy();
    const payload = JSON.parse(result.content[0].text);

    expect(payload.filePath).toBeDefined();
    expect(payload.tableName).toBe('Decision');
    expect(payload.hitPolicy).toBe('UNIQUE');
    expect(payload.inputCount).toBe(1);
    expect(payload.outputCount).toBe(1);

    tempFiles.push(payload.filePath);

    // Verify the file was written with valid DMN XML
    const xml = fs.readFileSync(payload.filePath, 'utf-8');
    expect(xml).toContain('<?xml version="1.0"');
    expect(xml).toContain('https://www.omg.org/spec/DMN/20191111/MODEL/');
    expect(xml).toContain('decisionTable');
    expect(xml).toContain('hitPolicy="UNIQUE"');
    expect(xml).toContain('name="Decision"');
  });

  it('creates a DMN file with custom inputs, outputs, and hit policy', async () => {
    const result = await dispatch('create_dmn', {
      name: 'custom-decision',
      tableName: 'Eligibility',
      hitPolicy: 'FIRST',
      inputs: [
        { label: 'Age', expression: 'applicant.age', type: 'integer' },
        { label: 'Income', expression: 'applicant.income', type: 'double' },
      ],
      outputs: [
        { label: 'Eligible', name: 'eligible', type: 'boolean' },
        { label: 'Reason', name: 'reason', type: 'string' },
      ],
    });

    expect(result.isError).toBeFalsy();
    const payload = JSON.parse(result.content[0].text);

    expect(payload.tableName).toBe('Eligibility');
    expect(payload.hitPolicy).toBe('FIRST');
    expect(payload.inputCount).toBe(2);
    expect(payload.outputCount).toBe(2);

    tempFiles.push(payload.filePath);

    const xml = fs.readFileSync(payload.filePath, 'utf-8');
    expect(xml).toContain('hitPolicy="FIRST"');
    expect(xml).toContain('name="Eligibility"');
    expect(xml).toContain('label="Age"');
    expect(xml).toContain('applicant.age');
    expect(xml).toContain('typeRef="integer"');
    expect(xml).toContain('label="Income"');
    expect(xml).toContain('name="eligible"');
    expect(xml).toContain('name="reason"');
  });

  it('writes the .dmn file to os.tmpdir()', async () => {
    const result = await dispatch('create_dmn', { name: 'tmpdir-dmn' });
    const payload = JSON.parse(result.content[0].text);
    tempFiles.push(payload.filePath);

    expect(payload.filePath).toContain(os.tmpdir());
    expect(payload.filePath).toMatch(/\.dmn$/);
    expect(fs.existsSync(payload.filePath)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// deployProcess tests
// ---------------------------------------------------------------------------
describe('deployProcess', () => {
  it('returns error when no cluster URL is configured', async () => {
    // Ensure env vars are not set
    const origAddr = process.env.ZEEBE_ADDRESS;
    delete process.env.ZEEBE_ADDRESS;

    const result = await dispatch('deploy_process', {
      filePath: '/tmp/test.bpmn',
    });

    expect(result.isError).toBe(true);
    const payload = JSON.parse(result.content[0].text);
    expect(payload.error).toBe('Zeebe cluster not configured');
    expect(payload.requiredEnvVars).toEqual(['ZEEBE_ADDRESS', 'ZEEBE_CLIENT_ID', 'ZEEBE_CLIENT_SECRET']);

    // Restore
    if (origAddr) process.env.ZEEBE_ADDRESS = origAddr;
  });

  it('returns stub message when cluster URL is provided', async () => {
    const result = await dispatch('deploy_process', {
      filePath: '/tmp/test.bpmn',
      clusterUrl: 'https://zeebe.example.com:26500',
    });

    expect(result.isError).toBeFalsy();
    const payload = JSON.parse(result.content[0].text);
    expect(payload.message).toContain('not yet implemented');
    expect(payload.filePath).toBe('/tmp/test.bpmn');
    expect(payload.clusterUrl).toBe('https://zeebe.example.com:26500');
  });
});

// ---------------------------------------------------------------------------
// dispatch routing tests
// ---------------------------------------------------------------------------
describe('dispatch routing', () => {
  it('returns "Unknown tool" error for an unregistered tool', async () => {
    const result = await dispatch('unknown_tool', {});

    expect(result.isError).toBe(true);
    const payload = JSON.parse(result.content[0].text);
    expect(payload.error).toBe('Unknown tool');
    expect(payload.message).toContain('unknown_tool');
  });

  it('returns "IPC bridge not initialized" for renderer tools', async () => {
    const result = await dispatch('add_start_event', {
      diagramId: 'test',
    });

    expect(result.isError).toBe(true);
    const payload = JSON.parse(result.content[0].text);
    expect(payload.error).toBe('IPC bridge not initialized');
  });

  it('returns a Zod validation error when required params are missing', async () => {
    // create_form requires 'name' — passing empty object should fail validation
    const result = await dispatch('create_form', {});

    expect(result.isError).toBe(true);
    const payload = JSON.parse(result.content[0].text);
    expect(payload.error).toBe('Invalid parameters');
    expect(payload.details).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Registry tests
// ---------------------------------------------------------------------------
describe('tools registry', () => {
  it('has the expected number of tools (28)', () => {
    expect(tools).toHaveLength(28);
  });

  it('every tool has name, description, inputSchema, and executeLocal', () => {
    for (const tool of tools) {
      expect(tool.name).toBeDefined();
      expect(typeof tool.name).toBe('string');
      expect(tool.name.length).toBeGreaterThan(0);

      expect(tool.description).toBeDefined();
      expect(typeof tool.description).toBe('string');
      expect(tool.description.length).toBeGreaterThan(0);

      expect(tool.inputSchema).toBeDefined();

      expect(typeof tool.executeLocal).toBe('boolean');
    }
  });

  it('local tools are create_model, create_form, add_form_field, create_dmn, deploy_process', () => {
    const localTools = tools.filter(t => t.executeLocal).map(t => t.name);
    expect(localTools).toEqual(
      expect.arrayContaining(['create_model', 'create_form', 'add_form_field', 'create_dmn', 'deploy_process'])
    );
    expect(localTools).toHaveLength(5);
  });
});
