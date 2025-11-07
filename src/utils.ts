/**
 * Utility functions for AppSec AI Agent
 * 
 * Author: Sam Li
 */

import * as fs from 'fs-extra';
import * as path from 'path';
import * as yaml from 'yaml';
import { execSync } from 'child_process';

export interface ConfigDict {
  [key: string]: any;
}

/**
 * Check if a path is a valid directory
 */
export function isDirectory(dirName: string): boolean {
  try {
    return fs.existsSync(dirName) && fs.statSync(dirName).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Check if a path is a valid file
 */
export function isFile(fileName: string): boolean {
  try {
    return fs.statSync(fileName).isFile();
  } catch {
    return false;
  }
}

/**
 * Convert file rows to a list, filtering out comments
 */
export function fileToList(file: string): string[] {
  const commentPattern = /^#|^\s+#/;
  const myList: string[] = [];
  
  try {
    const content = fs.readFileSync(file, 'utf-8');
    const lines = content.split('\n');
    
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && !commentPattern.test(trimmed)) {
        myList.push(trimmed);
      }
    }
  } catch (error) {
    console.error(`Error reading file ${file}:`, error);
  }
  
  return myList;
}

/**
 * Convert a list to a file, one row at a time
 */
export function listToFile(list: string[], file: string): boolean {
  try {
    fs.writeFileSync(file, list.join('\n') + '\n');
    return true;
  } catch (error) {
    console.error('Error:', error);
    return false;
  }
}

/**
 * Convert JSON file content to object
 */
export function fileToJson(file: string): any {
  try {
    const content = fs.readFileSync(file, 'utf-8').replace(/\n/g, '');
    return JSON.parse(content);
  } catch (error) {
    console.error(`Error reading JSON file ${file}:`, error);
    return {};
  }
}

/**
 * Convert JSON data to a file
 */
export function jsonToFile(jsonData: any, file: string): boolean {
  try {
    fs.writeFileSync(file, JSON.stringify(jsonData, null, 4));
    return true;
  } catch (error) {
    console.error('Error:', error);
    return false;
  }
}

/**
 * Execute shell command and return code, stdout, stderr
 */
export function runCommand(cmd: string): { code: number; stdout: string; stderr: string } {
  try {
    const stdout = execSync(cmd, { encoding: 'utf-8' });
    return { code: 0, stdout, stderr: '' };
  } catch (error: any) {
    return {
      code: error.status || 1,
      stdout: error.stdout?.toString() || '',
      stderr: error.stderr?.toString() || error.message || ''
    };
  }
}

/**
 * Get the project root absolute path
 */
export function getProjectRoot(): string {
  return path.resolve(__dirname, '..');
}

/**
 * Process environment variable references in YAML
 */
function processEnvVars(value: any): any {
  if (typeof value === 'string') {
    const envPattern = /^<%= ENV\['(.*)'\] %>(.*)$/;
    const match = value.match(envPattern);
    if (match) {
      return process.env[match[1]] || match[2] || '';
    }
  } else if (Array.isArray(value)) {
    return value.map(processEnvVars);
  } else if (typeof value === 'object' && value !== null) {
    const processed: any = {};
    for (const [key, val] of Object.entries(value)) {
      processed[key] = processEnvVars(val);
    }
    return processed;
  }
  return value;
}

/**
 * Load YAML configuration file
 */
/**
 * Expand YAML merge keys (<<: *anchor)
 */
function expandMergeKeys(obj: any): any {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  
  if (Array.isArray(obj)) {
    return obj.map(expandMergeKeys);
  }
  
  const expanded: any = {};
  
  // First, expand all merge keys
  const mergeKeys: any[] = [];
  for (const [key, value] of Object.entries(obj)) {
    if (key === '<<') {
      // Handle merge key - can be single object or array
      const mergeValue = Array.isArray(value) ? value : [value];
      mergeKeys.push(...mergeValue.map(expandMergeKeys));
    } else {
      expanded[key] = expandMergeKeys(value);
    }
  }
  
  // Merge all merge keys into the expanded object (later keys override earlier ones)
  for (const mergeObj of mergeKeys) {
    if (mergeObj && typeof mergeObj === 'object') {
      Object.assign(expanded, mergeObj);
    }
  }
  
  // Finally, apply the non-merge keys (they override merged values)
  for (const [key, value] of Object.entries(obj)) {
    if (key !== '<<') {
      expanded[key] = expandMergeKeys(value);
    }
  }
  
  return expanded;
}

export function loadYaml(confFile: string, verbose: boolean = false): ConfigDict | null {
  console.log(`Loading yaml configuration file: ${confFile}`);
  
  if (!isFile(confFile)) {
    console.error(`Error file not exist: ${confFile}`);
    return null;
  }
  
  try {
    const content = fs.readFileSync(confFile, 'utf-8');
    const parsed = yaml.parse(content);
    
    // Expand YAML merge keys first
    const withMerges = expandMergeKeys(parsed);
    
    // Process environment variable references
    const processed = processEnvVars(withMerges);
    
    if (verbose) {
      console.log('conf_dict:', JSON.stringify(processed, null, 2));
    }
    
    return processed;
  } catch (error) {
    console.error(`Error loading YAML file ${confFile}:`, error);
    return null;
  }
}

/**
 * Get property value from package.json
 */
export function getProperty(prop: string): string {
  const packageJsonPath = path.join(getProjectRoot(), 'package.json');
  try {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
    return packageJson[prop] || '';
  } catch {
    return '';
  }
}

/**
 * Copy project source code directory to current working directory
 */
export function copyProjectSrcDir(currentWorkingDir: string, srcDir: string): string {
  if (!fs.existsSync(srcDir)) {
    console.error(`Error: Source directory ${srcDir} does not exist`);
    process.exit(1);
  }
  
  const srcDirList = srcDir.split(path.sep).filter(Boolean);
  const tmpSrcDir = path.join(currentWorkingDir, '.' + srcDirList[srcDirList.length - 1]);
  
  // Remove existing directory if it exists
  if (fs.existsSync(tmpSrcDir) && fs.statSync(tmpSrcDir).isDirectory()) {
    fs.removeSync(tmpSrcDir);
  }
  
  console.log(`Copying project source code directory from ${srcDir} to ${tmpSrcDir}`);
  fs.copySync(srcDir, tmpSrcDir);
  
  return tmpSrcDir;
}

/**
 * List all available roles
 */
export function listRoles(confDict: ConfigDict, environment: string): void {
  console.log('Available roles:');
  if (confDict[environment]) {
    for (const role of Object.keys(confDict[environment])) {
      if (role !== 'options') {
        console.log(`- ${role}`);
      }
    }
  }
  console.log();
}

/**
 * Print program version info
 */
export function printVersionInfo(): void {
  console.log(`AppSec AI Agent Version: ${getProperty('version')}`);
  console.log(`AppSec AI Agent Release Date: ${getProperty('date') || 'Oct 27 2025'}`);
  console.log(`AppSec AI Agent Author: ${getProperty('author')}`);
  console.log();
}

