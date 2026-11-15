import {test} from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,writeFile,readFile,symlink,rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {startServer} from '../service/server.mjs';
import {git,safeFile,readText,saveText} from '../service/workspace.mjs';
const exec=promisify(execFile);
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));

test('real first-slice flow, isolation, CLI reporting, file conflicts, and durable state',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'soull-test-')),repo=path.join(root,'repo'),dataDir=path.join(root,'data');
 await exec('git',['init',repo]);await git(repo,['config','user.name','Soull Test']);await git(repo,['config','user.email','soull@example.invalid']);
 await writeFile(path.join(repo,'hello.ts'),'export const greeting = "hello";\n');await git(repo,['add','.']);await git(repo,['commit','-m','Initial fixture']);
 const originalBranch=(await git(repo,['branch','--show-current'])).trim();
 let app=await startServer({dataDir,port:0});
 const request=async(route,method='GET',payload,options={})=>{
  const response=await fetch(app.url+'/api'+route,{method,headers:{Authorization:'Bearer '+app.token,...options.headers},body:payload===undefined?undefined:JSON.stringify(payload)});
  const result=await response.json();return {status:response.status,body:result};
 };
 try{
  assert.equal((await fetch(app.url+'/api/state')).status,401);
  assert.equal((await request('/state','GET',undefined,{headers:{Origin:'https://evil.example'}})).status,403);
  const manager=(await request('/managers','POST',{name:'Mika',repo,provider:'codex'})).body;assert.ok(manager.id);
  const created=await request('/features','POST',{managerId:manager.id,title:'Try greeting'});assert.equal(created.status,201);
  const feature=created.body;assert.notEqual(feature.workspace,repo);assert.equal((await git(repo,['branch','--show-current'])).trim(),originalBranch);
  await writeFile(path.join(feature.workspace,'hello.ts'),'export const greeting = "hi";\n');
  assert.match(await readFile(path.join(repo,'hello.ts'),'utf8'),/hello/);
  const changes=(await request('/features/'+feature.id+'/changes')).body;assert.equal(changes.files[0].path,'hello.ts');assert.match(changes.diff,/\+export const greeting = "hi"/);
  const opened=(await request('/features/'+feature.id+'/file?path=hello.ts')).body;
  await writeFile(path.join(feature.workspace,'hello.ts'),'external edit\n');
  assert.equal((await request('/features/'+feature.id+'/file','PUT',{...opened,content:'my edit\n'})).status,409);
  const current=(await request('/features/'+feature.id+'/file?path=hello.ts')).body;
  assert.equal((await request('/features/'+feature.id+'/file','PUT',{...current,content:'saved edit\n'})).status,200);
  assert.equal(await readFile(path.join(feature.workspace,'hello.ts'),'utf8'),'saved edit\n');
  await writeFile(path.join(root,'secret.txt'),'outside workspace');await symlink(path.join(root,'secret.txt'),path.join(feature.workspace,'escape.txt'));
  assert.equal((await request('/features/'+feature.id+'/file?path=escape.txt')).status,403);
  assert.equal((await request('/features/'+feature.id+'/file?path=../secret.txt')).status,403);
  const report=path.join(root,'finding.md');await writeFile(report,'The greeting is ready. See [source](hello.ts:1).');
  const cli=await exec(process.execPath,['bin/soull.mjs','finding','create','--title','Greeting ready','--body-file',report],{cwd:path.resolve(import.meta.dirname,'..'),env:{...process.env,SOULL_RUNTIME_FILE:app.runtimeFile,SOULL_FEATURE_ID:feature.id}});
  const finding=JSON.parse(cli.stdout);assert.equal(finding.featureId,feature.id);assert.equal(finding.isRead,0);
  assert.equal((await request('/findings/'+finding.id,'PATCH',{isRead:true})).status,200);
  const session=(await request('/sessions','POST',{featureId:feature.id,provider:'shell'})).body;assert.ok(session.id);
  await request('/sessions/'+session.id+'/resize','POST',{cols:100,rows:30});
  await request('/sessions/'+session.id+'/input','POST',{input:"printf 'SOULL_%s\\n' 'PTY_OK'\r"});
  let output='';for(let i=0;i<30;i++){await pause(100);const result=(await request('/sessions/'+session.id+'/output?offset=0')).body;output=result.chunks.map(c=>Buffer.from(c.data,'base64').toString()).join('');if(output.includes('SOULL_PTY_OK'))break;}
  assert.match(output,/SOULL_PTY_OK/);
  const afterReconnect=(await request('/state')).body;assert.equal(afterReconnect.sessions[0].id,session.id);
  await request('/sessions/'+session.id+'/input','POST',{input:'exit\r'});
  await app.close();app=await startServer({dataDir,port:0});
  const restored=(await request('/state')).body;assert.equal(restored.managers[0].name,'Mika');assert.equal(restored.features[0].id,feature.id);assert.equal(restored.findings[0].isRead,1);assert.equal(restored.sessions.length,0);
 }finally{await app.close();await rm(root,{recursive:true,force:true});}
});
