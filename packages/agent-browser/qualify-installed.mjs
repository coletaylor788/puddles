import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { join, relative, isAbsolute } from 'node:path';
import { ensureBrowser, stopBrowser, containerName } from './launch.mjs';
import { connect } from './test/mcp-client.mjs';
// Required installed acceptance. Never points at a real profile or saved login.
const [runtime, specPathInput, scratch, disposableRoot] = process.argv.slice(2);
assert.ok(runtime && specPathInput && scratch && disposableRoot, 'Usage: qualify-installed.mjs PACKAGED_BROWSER TRUSTED_SPEC SCRATCH DISPOSABLE_ROOT');
const root=mkdtempSync(join(scratch,'browser-fixture-'));
const spec=JSON.parse(readFileSync(specPathInput,'utf8'));
for(const path of [spec.stateDir,spec.profile,spec.downloads]) {
 const child=relative(disposableRoot,path);
 assert.ok(child && !child.startsWith('..') && !isAbsolute(child),'Qualification must use the disposable installed environment');
}
let mcp,server,cli,env,submitted=false,challenge=false,sessionValue='initial',loginCount=0;
const password='synthetic-browser-only';
try {
 server=createServer((req,res)=>{
  res.setHeader('content-type','text/html');
  if(req.method==='POST'&&req.url==='/login') {let body='';req.on('data',c=>body+=c);req.on('end',()=>{
   const p=new URLSearchParams(body);submitted=p.get('password')===password&&p.get('username')==='fixture';loginCount++;
   if(!submitted){res.writeHead(401);res.end('Invalid synthetic login');return;}
   if(challenge){res.writeHead(303,{'set-cookie':'fixture=; Max-Age=0; Path=/','location':'/challenge'});res.end();return;}
   res.writeHead(303,{'set-cookie':'fixture='+sessionValue+'; HttpOnly; SameSite=Strict; Path=/; Max-Age=3600','location':'/welcome'});res.end();});return;}
  if(req.url==='/challenge'){res.end('<h1 id="challenge">MFA required</h1>');return;}
  if(req.url==='/welcome'&&req.headers.cookie?.split(';').some(value=>value.trim()==='fixture='+sessionValue)){res.end('<h1 id="welcome">Signed in to fixture</h1>');return;}
  res.end('<form method="POST" action="/login"><label>Username<input name="username" autocomplete="username"></label><label>Password<input type="password" name="password" autocomplete="current-password"></label><button type="submit">Log in</button></form>');
 });
 await new Promise(resolve=>server.listen(0,'0.0.0.0',resolve));
 const url='http://host.docker.internal:'+server.address().port+'/login';
 const specPath=specPathInput;
 const browser=await ensureBrowser(spec);console.log('Docker CDP ready');
 const home=join(spec.stateDir,'home');mkdirSync(home,{recursive:true});
 cli=join(runtime,'upstream/bin/agent-browser.js');
 env={PATH:process.env.PATH,HOME:home,AGENT_BROWSER_SOCKET_DIR:join(spec.stateDir,'owner-sockets')};
 execFileSync(process.execPath,[cli,'--json','auth','save','fixture','--url',url,'--username','fixture','--password-stdin'],{env,input:password+'\n',timeout:15000});
 mcp=await connect(join(runtime,'launch.mjs'),{PATH:process.env.PATH,HOME:process.env.HOME},[specPath]);
 for(const [name,args] of [['agent_browser_auth_login',{name:'fixture'}],['agent_browser_eval',{script:'document.querySelector("#welcome")?.textContent'}],['agent_browser_snapshot',{}],['agent_browser_screenshot',{}]]) {
  const r=await mcp.call(name,args);assert.ok(!r.error&&!r.result?.isError,JSON.stringify(r));assert.ok(!JSON.stringify(r).includes(password));console.log(name,JSON.stringify(r).length,'bytes');if(name==='agent_browser_eval')assert.match(JSON.stringify(r),/Signed in to fixture/);
 }
 assert.ok(submitted);
 for(const session of ['qualification-one','qualification-two']) {
  const response=await mcp.call('agent_browser_get_title',{session});
  assert.ok(!response.error&&!response.result?.isError,'Named native session failed');
 }
 const serviceSockets=join(spec.stateDir,'sockets');
 const nativePids=readdirSync(serviceSockets).filter(name=>name.endsWith('.pid')).map(name=>Number(readFileSync(join(serviceSockets,name),'utf8').trim()));
 assert.ok(nativePids.length>=3&&nativePids.every(pid=>Number.isSafeInteger(pid)&&pid>1),'Expected default and named native daemons');

 const denied=await mcp.call('agent_browser_read',{url:'file://'+join(home,'.agent-browser/auth/fixture.json'),raw:true});console.log('file URL read denied',!!(denied.error||denied.result?.isError));assert.ok(denied.error||denied.result?.isError);
 const unauth=execFileSync('/usr/bin/curl',['--noproxy','*','--max-time','2','--output','/dev/null','--silent','--write-out','%{http_code}','http://127.0.0.1:'+browser.cdpPort+'/json/version'],{encoding:'utf8'});assert.equal(unauth,'401');console.log('Unauthenticated CDP denied');
 execFileSync(spec.docker,['--host',spec.dockerHost,'exec',containerName(spec),'test','!','-e',join(home,'.agent-browser/auth/fixture.json')],{timeout:10000});console.log('Vault absent in browser container');
 // Chromium buffers persistent cookies. Wait for the synthetic row to reach
 // disk before testing a cold restart; immediate force-stop can lose recent state.
 const {DatabaseSync}=await import('node:sqlite');
 let persisted=false;
 for(const deadline=Date.now()+45_000;Date.now()<deadline;) {
  const db=new DatabaseSync(join(spec.profile,'Default/Cookies'),{readOnly:true});
  try {persisted=db.prepare('select count(*) as n from cookies').get().n>0;} finally {db.close();}
  if(persisted)break;
  await new Promise(resolve=>setTimeout(resolve,1000));
 }
 assert.ok(persisted,'Chromium did not persist the synthetic login');
 await mcp.close();mcp=null;
 execFileSync(process.execPath,[join(runtime,'launch.mjs'),'stop',specPath],{timeout:30000,stdio:'pipe'});
 for(const pid of nativePids) {
  let alive=true;
  for(const deadline=Date.now()+3000;alive&&Date.now()<deadline;) {
   try {process.kill(pid,0);await new Promise(resolve=>setTimeout(resolve,50));} catch(error) {if(error.code!=='ESRCH')throw error;alive=false;}
  }
  assert.equal(alive,false,'Native session daemon survived service stop');
 }
 console.log('Default and named native sessions stopped');
 await ensureBrowser(spec);
 mcp=await connect(join(runtime,'launch.mjs'),{PATH:process.env.PATH,HOME:process.env.HOME},[specPath]);
 const reopened=await mcp.call('agent_browser_open',{url:url.replace('/login','/welcome')});
 assert.ok(!reopened.result?.isError,JSON.stringify(reopened));
 const state=await mcp.call('agent_browser_eval',{script:'document.querySelector("#welcome")?.textContent'});
 assert.match(JSON.stringify(state),/Signed in to fixture/);
 console.log('Profile survives container recreation');
 sessionValue='renewed';
 await mcp.call('agent_browser_open',{url:url.replace('/login','/welcome')});
 const expired=await mcp.call('agent_browser_eval',{script:'document.querySelector("#welcome")?.textContent ?? "login_required"'});
 assert.match(JSON.stringify(expired),/login_required/);
 const renewed=await mcp.call('agent_browser_auth_login',{name:'fixture'});
 assert.ok(!renewed.result?.isError&&!JSON.stringify(renewed).includes(password));
 const renewedPage=await mcp.call('agent_browser_eval',{script:'document.querySelector("#welcome")?.textContent'});
 assert.match(JSON.stringify(renewedPage),/Signed in to fixture/);assert.equal(loginCount,2);
 challenge=true;
 const challenged=await mcp.call('agent_browser_auth_login',{name:'fixture'});
 assert.ok(!JSON.stringify(challenged).includes(password));
 const challengePage=await mcp.call('agent_browser_eval',{script:'document.querySelector("#challenge")?.textContent'});
 assert.match(JSON.stringify(challengePage),/MFA required/);assert.equal(loginCount,3);
 console.log('Saved login renews an expired session; site MFA remains visible');
 console.log('PASS: native login, eval, screenshot, vault isolation, CDP authentication, all-session shutdown, profile restart and renewal');
} finally {
 const failures=[];
 try {await mcp?.close();} catch(error){failures.push(error);}
 if(cli&&env)try{execFileSync(process.execPath,[cli,'close','--all'],{env,timeout:15000,stdio:'pipe'});}catch(error){failures.push(error);}
 try {
  if(existsSync(join(spec.stateDir,'agent-browser.json')))execFileSync(process.execPath,[join(runtime,'launch.mjs'),'stop',specPathInput],{timeout:30000,stdio:'pipe'});
  else stopBrowser(spec);
 }catch(error){failures.push(error);}
 await new Promise(resolve=>server?server.close(resolve):resolve());
 if(failures.length)throw new AggregateError(failures,'Browser fixture cleanup failed');
 rmSync(root,{recursive:true,force:true});
}
