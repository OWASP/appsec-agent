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
 * Security utility functions
 */

/**
 * Validate that a path is safe and doesn't contain directory traversal sequences
 * @param filePath The path to validate
 * @param allowAbsolute Whether to allow absolute paths (default: false for output files)
 * @returns true if the path is safe, false otherwise
 */
export function isSafePath(filePath: string, allowAbsolute: boolean = false): boolean {
  if (!filePath || typeof filePath !== 'string') {
    return false;
  }
  
  // Check for null bytes and control characters (always dangerous)
  if (/\0/.test(filePath) || /[\x00-\x1f]/.test(filePath)) {
    return false;
  }
  
  // Check for directory traversal patterns
  if (/\.\./.test(filePath)) {
    return false;
  }
  
  // Check for absolute paths if not allowed
  if (!allowAbsolute) {
    if (/^\/+/.test(filePath) || /^[A-Za-z]:/.test(filePath)) {
      return false;
    }
  }
  
  return true;
}

/**
 * Validate and sanitize a file path to prevent directory traversal
 * @param filePath The path to validate
 * @param baseDir Optional base directory to resolve against
 * @param allowAbsolute Whether to allow absolute paths (default: true for source dirs)
 * @returns The normalized safe path, or null if invalid
 */
export function validateAndSanitizePath(
  filePath: string, 
  baseDir?: string, 
  allowAbsolute: boolean = true
): string | null {
  if (!filePath || typeof filePath !== 'string') {
    return null;
  }
  
  // Check for null bytes and control characters
  if (/\0/.test(filePath) || /[\x00-\x1f]/.test(filePath)) {
    return null;
  }
  
  try {
    // Normalize the path
    let normalizedPath = path.normalize(filePath);
    
    // Check for directory traversal patterns after normalization
    if (normalizedPath.includes('..')) {
      return null;
    }
    
    // If absolute paths are not allowed, reject them
    if (!allowAbsolute && (normalizedPath.startsWith('/') || /^[A-Za-z]:/.test(normalizedPath))) {
      return null;
    }
    
    // If baseDir is provided, resolve against it and ensure the result is within baseDir
    if (baseDir) {
      const baseDirResolved = path.resolve(baseDir);
      const resolvedPath = path.resolve(baseDir, normalizedPath);
      
      // Ensure the resolved path is within the base directory
      if (!resolvedPath.startsWith(baseDirResolved + path.sep) && resolvedPath !== baseDirResolved) {
        return null;
      }
      
      return resolvedPath;
    }
    
    // If no baseDir, return the resolved absolute path
    return path.resolve(normalizedPath);
  } catch {
    return null;
  }
}

/**
 * Validate that a directory path is safe and exists
 * @param dirPath The directory path to validate (can be absolute or relative)
 * @param mustExist Whether the directory must exist (default: true)
 * @returns true if the path is safe and valid, false otherwise
 */
export function validateDirectoryPath(dirPath: string, mustExist: boolean = true): boolean {
  if (!dirPath || typeof dirPath !== 'string') {
    return false;
  }
  
  // Check if path is safe (allow absolute paths for source directories)
  const sanitized = validateAndSanitizePath(dirPath, undefined, true);
  if (!sanitized) {
    return false;
  }
  
  // Check if directory exists if required
  if (mustExist) {
    try {
      const stats = fs.statSync(sanitized);
      return stats.isDirectory();
    } catch {
      return false;
    }
  }
  
  return true;
}

/**
 * Validate output file path to prevent writing outside intended directories
 * @param filePath The output file path (must be relative, not absolute)
 * @param baseDir The base directory (usually current working directory)
 * @returns The validated absolute path, or null if invalid
 */
export function validateOutputFilePath(filePath: string, baseDir: string = process.cwd()): string | null {
  if (!filePath || typeof filePath !== 'string') {
    return null;
  }
  
  // Basic validation - output files should be relative paths only
  if (!isSafePath(filePath, false)) {
    return null;
  }
  
  try {
    const baseDirResolved = path.resolve(baseDir);
    const resolvedPath = path.resolve(baseDir, filePath);
    
    // Ensure the resolved path is within the base directory
    if (!resolvedPath.startsWith(baseDirResolved + path.sep) && resolvedPath !== baseDirResolved) {
      return null;
    }
    
    // Ensure the parent directory exists or can be created
    const parentDir = path.dirname(resolvedPath);
    if (!fs.existsSync(parentDir)) {
      try {
        fs.mkdirSync(parentDir, { recursive: true });
      } catch {
        return null;
      }
    }
    
    return resolvedPath;
  } catch {
    return null;
  }
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
 * SECURITY: This function should only be used with trusted, validated commands.
 * Never pass user input directly to this function without validation.
 * @param cmd The command to execute (should be validated and sanitized)
 * @param options Optional execution options
 */
export function runCommand(
  cmd: string,
  options?: { timeout?: number; maxBuffer?: number }
): { code: number; stdout: string; stderr: string } {
  // Security: Validate that the command doesn't contain dangerous patterns
  // This is a basic check - commands should be validated before calling this function
  if (!cmd || typeof cmd !== 'string') {
    return { code: 1, stdout: '', stderr: 'Invalid command: command must be a non-empty string' };
  }
  
  // Check for command injection patterns
  const dangerousPatterns = [
    /[;&|`$(){}[\]]/,  // Command chaining and injection characters
    /\$\{/,            // Variable expansion
    /`/,               // Backticks for command substitution
  ];
  
  for (const pattern of dangerousPatterns) {
    if (pattern.test(cmd)) {
      return { 
        code: 1, 
        stdout: '', 
        stderr: 'Invalid command: command contains potentially dangerous characters' 
      };
    }
  }
  
  try {
    const execOptions = {
      encoding: 'utf-8' as const,
      timeout: options?.timeout || 30000, // 30 second default timeout
      maxBuffer: options?.maxBuffer || 1024 * 1024, // 1MB default buffer
    };
    
    const stdout = execSync(cmd, execOptions);
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
 * SECURITY: Validates paths to prevent directory traversal attacks
 */
export function copyProjectSrcDir(currentWorkingDir: string, srcDir: string): string {
  // Validate source directory path
  if (!srcDir || typeof srcDir !== 'string') {
    console.error('Error: Source directory path is invalid');
    process.exit(1);
  }
  
  // Validate that the source directory path is safe (allow absolute paths for source dirs)
  const sanitizedSrcDir = validateAndSanitizePath(srcDir, undefined, true);
  if (!sanitizedSrcDir) {
    console.error(`Error: Source directory path contains invalid or dangerous characters: ${srcDir}`);
    process.exit(1);
  }
  
  // Check if source directory exists
  if (!fs.existsSync(sanitizedSrcDir)) {
    console.error(`Error: Source directory ${sanitizedSrcDir} does not exist`);
    process.exit(1);
  }
  
  // Verify it's actually a directory
  try {
    const stats = fs.statSync(sanitizedSrcDir);
    if (!stats.isDirectory()) {
      console.error(`Error: Source path ${sanitizedSrcDir} is not a directory`);
      process.exit(1);
    }
  } catch (error) {
    console.error(`Error: Cannot access source directory ${sanitizedSrcDir}:`, error);
    process.exit(1);
  }
  
  // Validate current working directory
  const sanitizedCwd = path.resolve(currentWorkingDir);
  if (!fs.existsSync(sanitizedCwd)) {
    console.error(`Error: Current working directory ${sanitizedCwd} does not exist`);
    process.exit(1);
  }
  
  // Create safe temporary directory name
  const srcDirName = path.basename(sanitizedSrcDir);
  if (!srcDirName || srcDirName === '.' || srcDirName === '..') {
    console.error(`Error: Invalid source directory name: ${srcDirName}`);
    process.exit(1);
  }
  
  // Ensure the temporary directory name is safe
  const safeTmpDirName = '.' + srcDirName.replace(/[^a-zA-Z0-9._-]/g, '_');
  const tmpSrcDir = path.join(sanitizedCwd, safeTmpDirName);
  
  // Ensure the temporary directory path is within the current working directory
  const tmpSrcDirResolved = path.resolve(tmpSrcDir);
  if (!tmpSrcDirResolved.startsWith(sanitizedCwd + path.sep) && tmpSrcDirResolved !== sanitizedCwd) {
    console.error(`Error: Temporary directory path would be outside working directory`);
    process.exit(1);
  }
  
  // Remove existing directory if it exists
  if (fs.existsSync(tmpSrcDirResolved) && fs.statSync(tmpSrcDirResolved).isDirectory()) {
    try {
      fs.removeSync(tmpSrcDirResolved);
    } catch (error) {
      console.error(`Error: Cannot remove existing temporary directory ${tmpSrcDirResolved}:`, error);
      process.exit(1);
    }
  }
  
  console.log(`Copying project source code directory from ${sanitizedSrcDir} to ${tmpSrcDirResolved}`);
  try {
    fs.copySync(sanitizedSrcDir, tmpSrcDirResolved);
  } catch (error) {
    console.error(`Error: Failed to copy directory:`, error);
    process.exit(1);
  }
  
  return tmpSrcDirResolved;
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

