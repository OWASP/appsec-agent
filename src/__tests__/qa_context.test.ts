/**
 * Tests for QA context loading and validation
 */

import { loadQaContext, QA_VERDICT_SCHEMA } from '../schemas/qa_context';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs-extra';

describe('qa_context', () => {
  let testDir: string;

  const validContext = {
    pr_url: 'https://github.com/owner/repo/pull/42',
    test_command: 'npm test',
    test_framework: 'jest',
    setup_commands: 'npm ci',
    timeout_seconds: 120,
    block_on_failure: true,
  };

  beforeEach(() => {
    testDir = path.join(os.tmpdir(), `qa-context-test-${Date.now()}`);
    fs.ensureDirSync(testDir);
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.removeSync(testDir);
    }
  });

  describe('loadQaContext', () => {
    it('should load valid QA context from file', () => {
      const filePath = path.join(testDir, 'qa.json');
      fs.writeFileSync(filePath, JSON.stringify(validContext));

      const ctx = loadQaContext(filePath, testDir);

      expect(ctx.pr_url).toBe('https://github.com/owner/repo/pull/42');
      expect(ctx.test_command).toBe('npm test');
      expect(ctx.test_framework).toBe('jest');
      expect(ctx.setup_commands).toBe('npm ci');
      expect(ctx.timeout_seconds).toBe(120);
      expect(ctx.block_on_failure).toBe(true);
    });

    it('should resolve relative paths against cwd', () => {
      const filePath = path.join(testDir, 'qa.json');
      fs.writeFileSync(filePath, JSON.stringify(validContext));

      const ctx = loadQaContext('qa.json', testDir);

      expect(ctx.pr_url).toBe(validContext.pr_url);
    });

    it('should resolve absolute paths directly', () => {
      const filePath = path.join(testDir, 'qa.json');
      fs.writeFileSync(filePath, JSON.stringify(validContext));

      const ctx = loadQaContext(filePath, '/some/other/dir');

      expect(ctx.pr_url).toBe(validContext.pr_url);
    });

    it('should throw when file does not exist', () => {
      expect(() => loadQaContext('nonexistent.json', testDir))
        .toThrow('QA context file not found');
    });

    it('should throw when pr_url is missing', () => {
      const filePath = path.join(testDir, 'qa.json');
      const { pr_url, ...noUrl } = validContext;
      fs.writeFileSync(filePath, JSON.stringify(noUrl));

      expect(() => loadQaContext(filePath, testDir))
        .toThrow('valid pr_url');
    });

    it('should throw when pr_url is not a string', () => {
      const filePath = path.join(testDir, 'qa.json');
      fs.writeFileSync(filePath, JSON.stringify({ ...validContext, pr_url: 123 }));

      expect(() => loadQaContext(filePath, testDir))
        .toThrow('valid pr_url');
    });

    it('should throw when pr_url is empty string', () => {
      const filePath = path.join(testDir, 'qa.json');
      fs.writeFileSync(filePath, JSON.stringify({ ...validContext, pr_url: '' }));

      expect(() => loadQaContext(filePath, testDir))
        .toThrow('valid pr_url');
    });

    it('should throw when test_command is missing', () => {
      const filePath = path.join(testDir, 'qa.json');
      const { test_command, ...noCmd } = validContext;
      fs.writeFileSync(filePath, JSON.stringify(noCmd));

      expect(() => loadQaContext(filePath, testDir))
        .toThrow('valid test_command');
    });

    it('should throw when test_command is not a string', () => {
      const filePath = path.join(testDir, 'qa.json');
      fs.writeFileSync(filePath, JSON.stringify({ ...validContext, test_command: 42 }));

      expect(() => loadQaContext(filePath, testDir))
        .toThrow('valid test_command');
    });

    it('should default timeout_seconds to 300 when not a number', () => {
      const filePath = path.join(testDir, 'qa.json');
      fs.writeFileSync(filePath, JSON.stringify({ ...validContext, timeout_seconds: 'bad' }));

      const ctx = loadQaContext(filePath, testDir);

      expect(ctx.timeout_seconds).toBe(300);
    });

    it('should default timeout_seconds to 300 when less than 1', () => {
      const filePath = path.join(testDir, 'qa.json');
      fs.writeFileSync(filePath, JSON.stringify({ ...validContext, timeout_seconds: 0 }));

      const ctx = loadQaContext(filePath, testDir);

      expect(ctx.timeout_seconds).toBe(300);
    });

    it('should default block_on_failure to false when not boolean', () => {
      const filePath = path.join(testDir, 'qa.json');
      fs.writeFileSync(filePath, JSON.stringify({ ...validContext, block_on_failure: 'yes' }));

      const ctx = loadQaContext(filePath, testDir);

      expect(ctx.block_on_failure).toBe(false);
    });

    it('should preserve optional fields like deployment_context', () => {
      const filePath = path.join(testDir, 'qa.json');
      const ctxWithDeploy = { ...validContext, deployment_context: 'K8s prod cluster' };
      fs.writeFileSync(filePath, JSON.stringify(ctxWithDeploy));

      const ctx = loadQaContext(filePath, testDir);

      expect(ctx.deployment_context).toBe('K8s prod cluster');
    });

    it('should preserve optional environment_variables', () => {
      const filePath = path.join(testDir, 'qa.json');
      const ctxWithEnv = { ...validContext, environment_variables: { NODE_ENV: 'test', CI: 'true' } };
      fs.writeFileSync(filePath, JSON.stringify(ctxWithEnv));

      const ctx = loadQaContext(filePath, testDir);

      expect(ctx.environment_variables).toEqual({ NODE_ENV: 'test', CI: 'true' });
    });

    it('should throw on invalid JSON', () => {
      const filePath = path.join(testDir, 'qa.json');
      fs.writeFileSync(filePath, 'not json');

      expect(() => loadQaContext(filePath, testDir)).toThrow();
    });
  });

  describe('QA_VERDICT_SCHEMA', () => {
    it('should have correct schema structure', () => {
      expect(QA_VERDICT_SCHEMA.name).toBe('qa_verdict');
      expect(QA_VERDICT_SCHEMA.strict).toBe(true);
      expect(QA_VERDICT_SCHEMA.schema.type).toBe('object');
      expect(QA_VERDICT_SCHEMA.schema.required).toEqual(['pass', 'test_exit_code', 'failures', 'logs']);
      expect(QA_VERDICT_SCHEMA.schema.additionalProperties).toBe(false);
    });

    it('should define all expected properties', () => {
      const props = QA_VERDICT_SCHEMA.schema.properties;
      expect(props.pass.type).toBe('boolean');
      expect(props.test_exit_code.type).toBe('number');
      expect(props.failures.type).toBe('array');
      expect(props.logs.type).toBe('string');
      expect(props.analysis.type).toBe('string');
      expect(props.suggestions.type).toBe('array');
    });
  });
});
