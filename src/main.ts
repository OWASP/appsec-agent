/**
 * Main entry point for AppSec AI Agent
 * 
 * Author: Sam Li
 */

import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs-extra';
import { AgentActions, AgentArgs } from './agent_actions';
import { copyProjectSrcDir } from './utils';

export async function main(confDict: any, args: AgentArgs): Promise<void> {
  const agentActions = new AgentActions(confDict, args.environment, args);

  if (args.role === 'simple_query_agent') {
    console.log('Running Simple Query Agent');
    const readline = require('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    const yourPrompt = await new Promise<string>((resolve) => {
      rl.question('Please enter your query: ', (answer: string) => {
        rl.close();
        resolve(answer);
      });
    });

    await agentActions.simpleQueryClaudeWithOptions(yourPrompt);
  } else if (args.role === 'code_reviewer') {
    console.log('Running Code Review Agent');
    let userPrompt: string;
    
    if (args.src_dir) {
      const currentWorkingDir = process.cwd();
      const tmpSrcDir = copyProjectSrcDir(currentWorkingDir, args.src_dir);
      userPrompt = `Review the code in the current working directory ${tmpSrcDir}, then provide a report of the potential security and privacy issues found in the code. Please write the review report in the ${args.output_file} file under current working directory in ${args.output_format} format.`;
    } else {
      userPrompt = `Review the code in the current working directory, then provide a report of the potential security and privacy issues found in the code. Please write the review report in the ${args.output_file} file under current working directory in ${args.output_format} format.`;
    }
    
    await agentActions.codeReviewerWithOptions(userPrompt);
  } else if (args.role === 'threat_modeler') {
    console.log('Running Threat Modeler');
    const userPrompt0 = `Draw the ASCII text based Data Flow Diagram (DFD), with output format as <codebase_data_flow_diagram_text_timestamp>. Then proceeding to use STRIDE methodology to perform threat modeling on the DFD, without output report in the format <codebase_threat_model_timestamp>. Finally, provide a separate risk registry report including proposed remediation plan in the format <codebase_risk_registry_text_timestamp>. We're looking for 3 reports in the current working directory as the deliverable. Please write the threat modeler report in the ${args.output_file} file under current working directory in ${args.output_format} format.`;
    
    let tmpSrcDir: string | null = null;
    let userPrompt: string;
    
    if (args.src_dir) {
      const currentWorkingDir = process.cwd();
      tmpSrcDir = copyProjectSrcDir(currentWorkingDir, args.src_dir);
      userPrompt = `Review the code in the ${tmpSrcDir} directory. ${userPrompt0}`;
    } else {
      userPrompt = `Review the code in the current working directory. ${userPrompt0}`;
    }
    
    await agentActions.threatModelerAgentWithOptions(userPrompt);
    
    // Clean up temporary source code directory
    if (tmpSrcDir && fs.existsSync(tmpSrcDir)) {
      fs.removeSync(tmpSrcDir);
    }
  } else {
    console.error(`Error: Invalid appsec AI agent role: ${args.role} - refer to 'appsec_agent.yaml' for available roles`);
    process.exit(1);
  }
  
  process.exit(0);
}

