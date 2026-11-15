#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import path from 'node:path';
const args=process.argv.slice(2),command=args[0];
const help=`Soull 0.1
  soull finding create --title "Summary" --body-file findings.md [--kind finding|answer|question|follow-up] [--feature ID]
  soull state
  soull open

Uses SOULL_FEATURE_ID and SOULL_RUNTIME_FILE supplied to workspace terminals.
To use outside a workspace: set SOULL_RUNTIME_FILE and pass --feature ID.
Commands emit JSON; finding IDs are durable. No provider credentials are read.`;
function option(key){const i=args.indexOf('--'+key);return i<0?undefined:args[i+1];}
try{
 if(!command||command==='help'||command==='--help'){console.log(help);process.exit(0);}
 const runtimeFile=process.env.SOULL_RUNTIME_FILE||fileURLToPath(new URL('../.soull/runtime.json',import.meta.url));
 const runtime=JSON.parse(await readFile(runtimeFile,'utf8'));
 if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(runtime.url))throw new Error('Invalid local runtime URL');
 if(command==='open'){const child=spawn('open',[`${runtime.url}/#${runtime.token}`],{stdio:'ignore'});child.on('error',error=>{console.error(error.message);process.exitCode=1;});}
 else{
 let endpoint='/api/state',init={headers:{Authorization:'Bearer '+runtime.token}};
 if(command==='finding'&&args[1]==='create'){
  endpoint='/api/findings';const file=option('body-file');if(!file)throw new Error('--body-file is required');
  init={...init,method:'POST',body:JSON.stringify({featureId:option('feature')||process.env.SOULL_FEATURE_ID,title:option('title'),body:await readFile(path.resolve(file),'utf8'),kind:option('kind')||'finding'})};
 }else if(command!=='state')throw new Error('Unknown command. Run soull help.');
 const response=await fetch(runtime.url+endpoint,init),result=await response.json();if(!response.ok)throw new Error(result.error);console.log(JSON.stringify(result,null,2));
 }
}catch(error){console.error(`soull: ${error.message}`);process.exitCode=1;}
