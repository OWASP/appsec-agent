/**
 * Tests for OpenAI fallback tools (write_file).
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  WRITE_FILE_TOOL,
  messageReducer,
  executeWriteToolCalls,
  type ToolCall
} from '../openai_tools';

describe('openai_tools', () => {
  describe('WRITE_FILE_TOOL', () => {
    it('exposes write_file function tool with path and content parameters', () => {
      expect(WRITE_FILE_TOOL.type).toBe('function');
      expect(WRITE_FILE_TOOL.function?.name).toBe('write_file');
      expect(WRITE_FILE_TOOL.function?.parameters?.required).toEqual(['path', 'content']);
      const props = (WRITE_FILE_TOOL.function?.parameters as { properties?: Record<string, unknown> })?.properties;
      expect(props?.path).toBeDefined();
      expect(props?.content).toBeDefined();
    });
  });

  describe('messageReducer', () => {
    it('accumulates content delta into message', () => {
      const prev = {} as Parameters<typeof messageReducer>[0];
      const chunk = {
        choices: [{ delta: { content: 'Hello ' } }]
      } as Parameters<typeof messageReducer>[1];
      const chunk2 = {
        choices: [{ delta: { content: 'world' } }]
      } as Parameters<typeof messageReducer>[1];
      const m1 = messageReducer(prev, chunk);
      const m2 = messageReducer(m1, chunk2);
      expect(m2.content).toBe('Hello world');
    });

    it('returns previous when chunk has no choice', () => {
      const prev = { content: 'x' } as Parameters<typeof messageReducer>[0];
      const chunk = { choices: [] } as unknown as Parameters<typeof messageReducer>[1];
      const m = messageReducer(prev, chunk);
      expect(m.content).toBe('x');
    });
  });

  describe('executeWriteToolCalls', () => {
    let tmpDir: string;

    beforeEach(() => {
      const dir = path.join(os.tmpdir(), `openai-tools-test-${Date.now()}`);
      fs.mkdirSync(dir, { recursive: true });
      tmpDir = dir;
    });

    afterEach(() => {
      try {
        fs.rmSync(tmpDir, { recursive: true });
      } catch {
        // ignore
      }
    });

    it('writes file when path and content are valid', () => {
      const toolCalls: ToolCall[] = [
        {
          id: 'call_1',
          type: 'function',
          function: {
            name: 'write_file',
            arguments: JSON.stringify({
              path: 'report.md',
              content: '# Report\n\nDone.'
            })
          }
        }
      ];
      const results = executeWriteToolCalls(toolCalls, tmpDir);
      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({ tool_call_id: 'call_1', success: true });
      const filePath = path.join(tmpDir, 'report.md');
      expect(fs.readFileSync(filePath, 'utf8')).toBe('# Report\n\nDone.');
    });

    it('rejects path traversal', () => {
      const toolCalls: ToolCall[] = [
        {
          id: 'call_1',
          type: 'function',
          function: {
            name: 'write_file',
            arguments: JSON.stringify({ path: '../../../etc/passwd', content: 'x' })
          }
        }
      ];
      const results = executeWriteToolCalls(toolCalls, tmpDir);
      expect(results[0].success).toBe(false);
      expect(results[0].error).toBe('Invalid or disallowed path');
    });

    it('returns error when path or content is missing', () => {
      const toolCalls: ToolCall[] = [
        {
          id: 'call_1',
          type: 'function',
          function: {
            name: 'write_file',
            arguments: JSON.stringify({ path: 'a.txt' })
          }
        }
      ];
      const results = executeWriteToolCalls(toolCalls, tmpDir);
      expect(results[0].success).toBe(false);
      expect(results[0].error).toContain('Missing');
    });

    it('returns error for unknown tool name', () => {
      const toolCalls: ToolCall[] = [
        {
          id: 'call_1',
          type: 'function',
          function: { name: 'other_tool', arguments: '{}' }
        }
      ];
      const results = executeWriteToolCalls(toolCalls, tmpDir);
      expect(results[0].success).toBe(false);
      expect(results[0].error).toContain('Unknown tool');
    });
  });
});
