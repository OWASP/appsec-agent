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
 * Sanitize file path for error messages to prevent information disclosure
 * Returns only the filename or a sanitized version of the path
 * @param filePath The full file path to sanitize
 * @param verbose If true, shows more path information (for debug mode)
 * @returns Sanitized path string safe for error messages
 */
export function sanitizePathForError(filePath: string, verbose: boolean = false): string {
  if (!filePath || typeof filePath !== 'string') {
    return '[invalid path]';
  }
  
  try {
    // In verbose mode, show relative path from home directory if possible
    if (verbose) {
      const homeDir = process.env.HOME || process.env.USERPROFILE || '';
      if (homeDir && filePath.startsWith(homeDir)) {
        return '~' + filePath.slice(homeDir.length);
      }
      // Show last 2 path segments for context
      const parts = filePath.split(path.sep).filter(p => p);
      if (parts.length > 2) {
        return '...' + path.sep + parts.slice(-2).join(path.sep);
      }
    }
    
    // Default: show only basename
    return path.basename(filePath) || '[unknown file]';
  } catch {
    return '[invalid path]';
  }
}

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
  
  // Check for null bytes and control characters
  if (/\0/.test(dirPath) || /[\x00-\x1f]/.test(dirPath)) {
    return false;
  }
  
  try {
    // Resolve the path to an absolute path (handles relative paths with ..)
    const resolvedPath = path.resolve(dirPath);
    
    // Check if directory exists if required
    if (mustExist) {
      const stats = fs.statSync(resolvedPath);
      return stats.isDirectory();
    }
    
    return true;
  } catch {
    return false;
  }
}

/**
 * Validate output file path to prevent writing outside intended directories
 * @param filePath The output file path (must be relative, not absolute)
 * @param baseDir The base directory (must be provided explicitly to avoid race conditions in concurrent contexts)
 * @returns The validated absolute path, or null if invalid
 */
export function validateOutputFilePath(filePath: string, baseDir: string): string | null {
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
 * Validate an input file path for security concerns
 * Allows absolute paths but validates relative paths for directory traversal
 * @param filePath - The file path to validate
 * @param baseDir - The base directory for relative path resolution
 * @returns The resolved absolute path if valid, null otherwise
 */
export function validateInputFilePath(filePath: string, baseDir: string): string | null {
  if (!filePath || typeof filePath !== 'string') {
    return null;
  }
  
  // Check for null bytes and control characters
  if (/\0/.test(filePath) || /[\x00-\x1f]/.test(filePath)) {
    return null;
  }
  
  try {
    // For relative paths, check for directory traversal
    if (!path.isAbsolute(filePath)) {
      if (!isSafePath(filePath, false)) {
        return null;
      }
    }
    
    // Resolve the path
    const resolvedPath = path.isAbsolute(filePath) 
      ? filePath 
      : path.resolve(baseDir, filePath);
    
    // For relative paths, ensure the resolved path stays within or at the base directory
    if (!path.isAbsolute(filePath)) {
      const baseDirResolved = path.resolve(baseDir);
      if (!resolvedPath.startsWith(baseDirResolved + path.sep) && resolvedPath !== baseDirResolved) {
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

/** Dir names to skip when sampling for prompt (failover code review). */
const SAMPLE_SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage', '__pycache__', '.venv', 'venv']);

/** File extensions to include when sampling (others skipped to keep prompt small). */
const SAMPLE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.py', '.java', '.go', '.rs', '.rb', '.php', '.c', '.cpp', '.h', '.hpp', '.cs', '.vue', '.svelte', '.md', '.yaml', '.yml', '.json', '.html', '.css', '.scss', '.sh', '.bash']);

/**
 * Sample a directory for inclusion in a prompt (e.g. when using OpenAI fallback for code review).
 * Returns a string of file contents up to maxChars. Skips binary and large dirs.
 */
export function sampleDirectoryForPrompt(dirPath: string, maxChars: number = 70_000): string {
  if (!dirPath || !fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
    return '';
  }
  const parts: string[] = [];
  let total = 0;
  const baseDir = path.resolve(dirPath);

  function walk(dir: string): void {
    if (total >= maxChars) return;
    let entries: string[];
    try {
      entries = fs.readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries.sort()) {
      if (total >= maxChars) break;
      const full = path.join(dir, name);
      const rel = path.relative(baseDir, full);
      if (name.startsWith('.') && name !== '.env' && name !== '.eslintrc') continue;
      try {
        const stat = fs.statSync(full);
        if (stat.isDirectory()) {
          if (SAMPLE_SKIP_DIRS.has(name)) continue;
          walk(full);
          continue;
        }
        if (!stat.isFile()) continue;
        const ext = path.extname(name).toLowerCase();
        if (!SAMPLE_EXTENSIONS.has(ext) && !name.includes('.')) continue;
        const content = fs.readFileSync(full, 'utf-8');
        if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(content)) continue;
        const block = `--- ${rel} ---\n${content}\n`;
        if (total + block.length > maxChars) {
          const cap = maxChars - total - 50;
          parts.push(`--- ${rel} (truncated) ---\n${content.slice(0, cap)}\n...\n`);
          total = maxChars;
          return;
        }
        parts.push(block);
        total += block.length;
      } catch {
        // skip unreadable
      }
    }
  }

  walk(baseDir);
  return parts.join('\n');
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
  } catch (error: any) {
    const safePath = sanitizePathForError(file);
    const errorMessage = error?.message || 'Unknown error';
    console.error(`Error reading file ${safePath}: ${errorMessage}`);
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
  } catch (error: any) {
    const safePath = sanitizePathForError(file);
    const errorMessage = error?.message || 'Unknown error';
    console.error(`Error reading JSON file ${safePath}: ${errorMessage}`);
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
  const safePath = sanitizePathForError(confFile, verbose);
  console.log(`Loading yaml configuration file: ${safePath}`);
  
  if (!isFile(confFile)) {
    console.error(`Error: Configuration file does not exist: ${safePath}`);
    if (verbose) {
      console.error(`Full path: ${confFile}`);
    }
    return null;
  }
  
  try {
    const content = fs.readFileSync(confFile, 'utf-8');
    
    // SECURITY: Use safe YAML parsing to prevent code execution
    // Parse with 'core' schema to disable unsafe features like custom tags
    // that could lead to code execution or object injection
    let parsed: any;
    try {
      // Try parsing with safe schema first
      parsed = yaml.parse(content, { schema: 'core' });
    } catch (schemaError) {
      // If core schema fails, try default but validate structure
      // This allows YAML merge keys and anchors while still being safer
      parsed = yaml.parse(content);
      
      // Validate that parsed result is a plain object/array (not a function or other dangerous type)
      if (typeof parsed === 'function' || (typeof parsed === 'object' && parsed !== null && parsed.constructor !== Object && !Array.isArray(parsed))) {
        throw new Error('Invalid YAML structure: contains unsafe object types');
      }
    }
    
    // Expand YAML merge keys first
    const withMerges = expandMergeKeys(parsed);
    
    // Process environment variable references
    const processed = processEnvVars(withMerges);
    
    if (verbose) {
      const maxStrLen = 120;
      const truncateForLog = (obj: unknown): unknown => {
        if (typeof obj === 'string') {
          return obj.length <= maxStrLen ? obj : obj.slice(0, maxStrLen) + '...';
        }
        if (Array.isArray(obj)) return obj.map(truncateForLog);
        if (obj !== null && typeof obj === 'object') {
          const out: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(obj)) out[k] = truncateForLog(v);
          return out;
        }
        return obj;
      };
      console.log('conf_dict:', JSON.stringify(truncateForLog(processed), null, 2));
    }
    
    return processed;
  } catch (error: any) {
    const errorMessage = error?.message || 'Unknown error';
    console.error(`Error loading YAML file ${safePath}: ${errorMessage}`);
    if (verbose) {
      console.error(`Full error details:`, error);
      console.error(`Full path: ${confFile}`);
    }
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
  
  // Check for null bytes and control characters
  if (/\0/.test(srcDir) || /[\x00-\x1f]/.test(srcDir)) {
    const safePath = sanitizePathForError(srcDir);
    console.error(`Error: Source directory path contains invalid or dangerous characters: ${safePath}`);
    process.exit(1);
  }
  
  // Resolve the path to an absolute path (handles relative paths with ..)
  let sanitizedSrcDir: string;
  try {
    sanitizedSrcDir = path.resolve(srcDir);
  } catch (error: any) {
    const safePath = sanitizePathForError(srcDir);
    const errorMessage = error?.message || 'Invalid path';
    console.error(`Error: Invalid source directory path: ${safePath} (${errorMessage})`);
    process.exit(1);
  }
  
  // Check if source directory exists
  if (!fs.existsSync(sanitizedSrcDir)) {
    const safePath = sanitizePathForError(sanitizedSrcDir);
    console.error(`Error: Source directory does not exist: ${safePath}`);
    process.exit(1);
  }
  
  // Verify it's actually a directory
  try {
    const stats = fs.statSync(sanitizedSrcDir);
    if (!stats.isDirectory()) {
      const safePath = sanitizePathForError(sanitizedSrcDir);
      console.error(`Error: Source path is not a directory: ${safePath}`);
      process.exit(1);
    }
  } catch (error: any) {
    const safePath = sanitizePathForError(sanitizedSrcDir);
    const errorMessage = error?.message || 'Access denied';
    console.error(`Error: Cannot access source directory ${safePath}: ${errorMessage}`);
    process.exit(1);
  }
  
  // Validate current working directory
  const sanitizedCwd = path.resolve(currentWorkingDir);
  if (!fs.existsSync(sanitizedCwd)) {
    const safePath = sanitizePathForError(sanitizedCwd);
    console.error(`Error: Current working directory does not exist: ${safePath}`);
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
    } catch (error: any) {
      const safePath = sanitizePathForError(tmpSrcDirResolved);
      const errorMessage = error?.message || 'Unknown error';
      console.error(`Error: Cannot remove existing temporary directory ${safePath}: ${errorMessage}`);
      process.exit(1);
    }
  }
  
  const safeSrcPath = sanitizePathForError(sanitizedSrcDir);
  const safeTmpPath = sanitizePathForError(tmpSrcDirResolved);
  console.log(`Copying project source code directory from ${safeSrcPath} to ${safeTmpPath}`);
  try {
    fs.copySync(sanitizedSrcDir, tmpSrcDirResolved);
  } catch (error: any) {
    const errorMessage = error?.message || 'Unknown error';
    console.error(`Error: Failed to copy directory: ${errorMessage}`);
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

/**
 * Mapping of output formats to file extensions.
 * Add new formats here to extend support.
 */
export const FORMAT_TO_EXTENSION: Record<string, string> = {
  markdown: 'md',
  md: 'md',
  json: 'json',
  xml: 'xml',
  xlsx: 'xlsx',
  csv: 'csv',
};

/**
 * Get file extension for a given output format.
 * Falls back to 'md' for unknown formats.
 */
export function getExtensionForFormat(format: string | undefined): string {
  if (!format) return 'md';
  return FORMAT_TO_EXTENSION[format.toLowerCase()] || 'md';
}

