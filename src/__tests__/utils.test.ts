/**
 * Tests for utility functions
 */

import * as fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';
import {
  isDirectory,
  isFile,
  fileToList,
  listToFile,
  fileToJson,
  jsonToFile,
  runCommand,
  getProjectRoot,
  loadYaml,
  getProperty,
  copyProjectSrcDir,
  listRoles,
  printVersionInfo
} from '../utils';

describe('Utils', () => {
  let testDir: string;
  let testFile: string;

  beforeEach(() => {
    testDir = path.join(os.tmpdir(), `appsec-agent-test-${Date.now()}`);
    testFile = path.join(testDir, 'test.txt');
    fs.ensureDirSync(testDir);
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.removeSync(testDir);
    }
  });

  describe('isDirectory', () => {
    it('should return true for existing directory', () => {
      expect(isDirectory(testDir)).toBe(true);
    });

    it('should return false for non-existent path', () => {
      expect(isDirectory(path.join(testDir, 'nonexistent'))).toBe(false);
    });

    it('should return false for file', () => {
      fs.writeFileSync(testFile, 'test');
      expect(isDirectory(testFile)).toBe(false);
    });
  });

  describe('isFile', () => {
    it('should return true for existing file', () => {
      fs.writeFileSync(testFile, 'test');
      expect(isFile(testFile)).toBe(true);
    });

    it('should return false for non-existent file', () => {
      expect(isFile(path.join(testDir, 'nonexistent.txt'))).toBe(false);
    });

    it('should return false for directory', () => {
      expect(isFile(testDir)).toBe(false);
    });
  });

  describe('fileToList', () => {
    it('should read file and return list of lines', () => {
      const content = 'line1\nline2\nline3\n';
      fs.writeFileSync(testFile, content);
      const result = fileToList(testFile);
      expect(result).toEqual(['line1', 'line2', 'line3']);
    });

    it('should filter out comments', () => {
      const content = '# comment\nline1\n  # another comment\nline2\n';
      fs.writeFileSync(testFile, content);
      const result = fileToList(testFile);
      expect(result).toEqual(['line1', 'line2']);
    });

    it('should filter out empty lines', () => {
      const content = 'line1\n\nline2\n   \nline3\n';
      fs.writeFileSync(testFile, content);
      const result = fileToList(testFile);
      expect(result).toEqual(['line1', 'line2', 'line3']);
    });

    it('should return empty array for non-existent file', () => {
      const result = fileToList(path.join(testDir, 'nonexistent.txt'));
      expect(result).toEqual([]);
    });
  });

  describe('listToFile', () => {
    it('should write list to file', () => {
      const list = ['line1', 'line2', 'line3'];
      const result = listToFile(list, testFile);
      expect(result).toBe(true);
      expect(fs.existsSync(testFile)).toBe(true);
      const content = fs.readFileSync(testFile, 'utf-8');
      expect(content).toBe('line1\nline2\nline3\n');
    });

    it('should return false on error', () => {
      const invalidPath = path.join('/invalid/path', 'file.txt');
      const result = listToFile(['test'], invalidPath);
      expect(result).toBe(false);
    });
  });

  describe('fileToJson', () => {
    it('should parse valid JSON file', () => {
      const jsonData = { key: 'value', number: 123 };
      fs.writeFileSync(testFile, JSON.stringify(jsonData));
      const result = fileToJson(testFile);
      expect(result).toEqual(jsonData);
    });

    it('should return empty object for invalid JSON', () => {
      fs.writeFileSync(testFile, 'invalid json');
      const result = fileToJson(testFile);
      expect(result).toEqual({});
    });

    it('should return empty object for non-existent file', () => {
      const result = fileToJson(path.join(testDir, 'nonexistent.json'));
      expect(result).toEqual({});
    });
  });

  describe('jsonToFile', () => {
    it('should write JSON to file', () => {
      const jsonData = { key: 'value', number: 123 };
      const result = jsonToFile(jsonData, testFile);
      expect(result).toBe(true);
      expect(fs.existsSync(testFile)).toBe(true);
      const content = JSON.parse(fs.readFileSync(testFile, 'utf-8'));
      expect(content).toEqual(jsonData);
    });

    it('should format JSON with indentation', () => {
      const jsonData = { key: 'value' };
      jsonToFile(jsonData, testFile);
      const content = fs.readFileSync(testFile, 'utf-8');
      expect(content).toContain('\n');
    });

    it('should return false on error', () => {
      const invalidPath = path.join('/invalid/path', 'file.json');
      const result = jsonToFile({ test: 'data' }, invalidPath);
      expect(result).toBe(false);
    });
  });

  describe('runCommand', () => {
    it('should execute command successfully', () => {
      const result = runCommand('echo "test"');
      expect(result.code).toBe(0);
      expect(result.stdout.trim()).toBe('test');
      expect(result.stderr).toBe('');
    });

    it('should handle command errors', () => {
      const result = runCommand('this-command-does-not-exist-12345');
      expect(result.code).not.toBe(0);
    });

    it('should handle invalid commands', () => {
      const result = runCommand('exit 1');
      expect(result.code).toBe(1);
    });
  });

  describe('getProjectRoot', () => {
    it('should return project root path', () => {
      const root = getProjectRoot();
      expect(root).toBeTruthy();
      expect(typeof root).toBe('string');
      expect(fs.existsSync(root)).toBe(true);
    });

    it('should contain package.json', () => {
      const root = getProjectRoot();
      const packageJson = path.join(root, 'package.json');
      expect(fs.existsSync(packageJson)).toBe(true);
    });
  });

  describe('loadYaml', () => {
    it('should load valid YAML file', () => {
      const yamlFile = path.join(testDir, 'test.yaml');
      const yamlContent = `
        key: value
        number: 123
        nested:
          item: test
      `;
      fs.writeFileSync(yamlFile, yamlContent);
      const result = loadYaml(yamlFile);
      expect(result).toBeTruthy();
      expect(result?.key).toBe('value');
      expect(result?.number).toBe(123);
      expect(result?.nested?.item).toBe('test');
    });

    it('should return null for non-existent file', () => {
      const result = loadYaml(path.join(testDir, 'nonexistent.yaml'));
      expect(result).toBeNull();
    });

    it('should return null for invalid YAML', () => {
      const yamlFile = path.join(testDir, 'invalid.yaml');
      fs.writeFileSync(yamlFile, 'invalid: yaml: content: [');
      const result = loadYaml(yamlFile);
      expect(result).toBeNull();
    });

    it('should process environment variables', () => {
      const yamlFile = path.join(testDir, 'env.yaml');
      process.env.TEST_VAR = 'test_value';
      const yamlContent = `
        key: "<%= ENV['TEST_VAR'] %>"
      `;
      fs.writeFileSync(yamlFile, yamlContent);
      const result = loadYaml(yamlFile);
      expect(result?.key).toBe('test_value');
      delete process.env.TEST_VAR;
    });
  });

  describe('getProperty', () => {
    it('should get property from package.json', () => {
      const name = getProperty('name');
      expect(name).toBe('appsec-agent');
    });

    it('should get version from package.json', () => {
      const version = getProperty('version');
      expect(version).toBeTruthy();
    });

    it('should return empty string for non-existent property', () => {
      const result = getProperty('nonexistent_property_xyz');
      expect(result).toBe('');
    });
  });

  describe('copyProjectSrcDir', () => {
    it('should copy source directory', () => {
      const sourceDir = testDir;
      const sourceFile = path.join(sourceDir, 'test.txt');
      fs.writeFileSync(sourceFile, 'test content');
      
      const destDir = path.join(os.tmpdir(), `appsec-agent-dest-${Date.now()}`);
      fs.ensureDirSync(destDir);
      
      const result = copyProjectSrcDir(destDir, sourceDir);
      
      expect(result).toBeTruthy();
      expect(fs.existsSync(result)).toBe(true);
      const copiedFile = path.join(result, 'test.txt');
      expect(fs.existsSync(copiedFile)).toBe(true);
      expect(fs.readFileSync(copiedFile, 'utf-8')).toBe('test content');
      
      // Cleanup
      if (fs.existsSync(result)) {
        fs.removeSync(result);
      }
      fs.removeSync(destDir);
    });

    it('should exit on non-existent source directory', () => {
      const originalExit = process.exit;
      const exitMock = jest.fn((code?: number) => {
        throw new Error(`process.exit(${code}) called`);
      }) as any;
      process.exit = exitMock;
      
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
      
      const destDir = path.join(os.tmpdir(), `appsec-agent-dest-${Date.now()}`);
      fs.ensureDirSync(destDir);
      
      // Create a path that definitely doesn't exist (outside testDir)
      const nonexistentPath = path.join(os.tmpdir(), `appsec-agent-nonexistent-${Date.now()}`);
      // Ensure it doesn't exist
      if (fs.existsSync(nonexistentPath)) {
        fs.removeSync(nonexistentPath);
      }
      
      // The function should exit before reaching copySync
      expect(() => {
        copyProjectSrcDir(destDir, nonexistentPath);
      }).toThrow('process.exit(1) called');
      
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining(`Error: Source directory ${nonexistentPath} does not exist`)
      );
      expect(exitMock).toHaveBeenCalledWith(1);
      
      consoleErrorSpy.mockRestore();
      process.exit = originalExit;
      fs.removeSync(destDir);
    });
  });

  describe('listRoles', () => {
    it('should list roles from config dict', () => {
      const confDict = {
        default: {
          simple_query_agent: {},
          code_reviewer: {},
          threat_modeler: {}
        }
      };
      
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      listRoles(confDict, 'default');
      
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('should handle missing environment', () => {
      const confDict = {
        default: {}
      };
      
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      listRoles(confDict, 'nonexistent');
      
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('printVersionInfo', () => {
    it('should print version information', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      printVersionInfo();
      
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('should include version in output', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      printVersionInfo();
      
      const calls = consoleSpy.mock.calls.map(call => call[0]);
      const versionLine = calls.find(line => typeof line === 'string' && line.includes('Version'));
      expect(versionLine).toBeTruthy();
      
      consoleSpy.mockRestore();
    });
  });
});

