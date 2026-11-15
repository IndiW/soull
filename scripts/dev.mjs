import { context } from 'esbuild';
import { options } from './build.mjs';
import {readFile,mkdir,open} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
const dataDir=path.resolve(process.env.SOULL_DATA_DIR||'.soull');
await mkdir(dataDir,{recursive:true,mode:0o700});
let running=false;
try{const runtime=JSON.parse(await readFile(path.join(dataDir,'runtime.json'),'utf8'));const response=await fetch(runtime.url+'/api/state',{headers:{Authorization:'Bearer '+runtime.token},signal:AbortSignal.timeout(1000)});running=response.ok;}catch{}
if(!running){
 const log=await open(path.join(dataDir,'service.log'),'a',0o600);
 const child=spawn(process.execPath,['service/server.mjs'],{cwd:process.cwd(),env:{...process.env,SOULL_DATA_DIR:dataDir},detached:true,stdio:['ignore',log.fd,log.fd]});
 child.unref();await log.close();
 console.log('Started independent local service. Logs: '+path.join(dataDir,'service.log'));
}
const ctx=await context(options);await ctx.watch();
console.log('Soull UI watch is running. Reload to see changes; agents stay connected.');
console.log('Open: node bin/soull.mjs open, or npm run native after npm run native:build.');
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,async()=>{await ctx.dispose();process.exit(0);});
