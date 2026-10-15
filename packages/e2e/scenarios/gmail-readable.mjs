import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

// Executes the installed plugin, MCP server and contained parser together.
// The Gmail service and guard model are recording fakes. No credentials or
// network access are supplied to this process by its installed-test caller.
const pluginRoot = resolve(process.argv[2]);
const root = mkdtempSync(join(tmpdir(), 'gmail-readable-'));
let close;
try {
  const bootstrap = join(root, 'mail.py');
  writeFileSync(bootstrap, `import asyncio, base64, socket, sys
from unittest.mock import MagicMock
sys.dont_write_bytecode = True
sys.path.insert(0, sys.argv[1])
from gmail_mcp import server
def deny(*args, **kwargs):
    raise RuntimeError("Live network forbidden")
socket.socket.connect = socket.socket.connect_ex = socket.create_connection = deny
html = '<html><head><style>' + 'DROP_CSS ' * 5000 + '</style></head><body>'
html += '<table><tr><td>Due</td><td>€42.50</td></tr></table><p>2026-11-01</p>'
html += '<script>DROP_SCRIPT</script><a href="javascript:DROP_URL">Terms</a>'
html += '<!--DROP_COMMENT--><iframe>DROP_FRAME</iframe></body></html>'
service = MagicMock()
def message(email_id):
    if email_id == 'synthetic':
        source, encoding = html.encode(), None
    elif email_id == 'meta-charset':
        source, encoding = '<meta charset="windows-1252"><p>Café €42</p>'.encode('cp1252'), None
    elif email_id == 'bom':
        source, encoding = '<p>Café €42</p>'.encode('utf-16'), 'windows-1252'
    elif email_id == 'transport':
        source, encoding = '<p>Café €42</p>'.encode('cp1252'), 'iso-8859-1'
    else:
        raise RuntimeError('Unknown synthetic email')
    headers = [{'name': 'Content-Type', 'value': 'text/html' + (
        '; charset=' + encoding if encoding else '')}]
    return {'payload': {'headers': [{'name': 'Subject', 'value': 'Synthetic notice'}],
        'mimeType': 'multipart/alternative', 'parts': [
        {'mimeType': 'text/plain', 'body': {'data': 'IA'}},
        {'mimeType': 'text/html', 'headers': headers,
         'body': {'data': base64.urlsafe_b64encode(source).decode()}}]}}
def get_message(**kwargs):
    result = MagicMock()
    result.execute.return_value = message(kwargs['id'])
    return result
service.users.return_value.messages.return_value.get.side_effect = get_message
server.is_authenticated = lambda: True
server.get_gmail_service = lambda **kwargs: service
asyncio.run(server.main())
`);
  const provider = join(root, 'provider.mjs');
  writeFileSync(provider, `export const calls=[];
export default class Provider { async classify(content, prompt, options) {
 calls.push({content,label:options?.label});
 return JSON.stringify({detected:false,findings:[]});
} }
`);
  const {calls} = await import(pathToFileURL(provider));
  const {default: plugin} = await import(pathToFileURL(join(pluginRoot, 'plugin.js')));
  let read;
  plugin.register({
    pluginConfig: {gmailMcpCommand: process.env.GMAIL_MCP_PYTHON ?? 'python3.11',
      gmailMcpArgs: ['-I', bootstrap, join(pluginRoot, 'python/lib')], gmailMcpCwd: root,
      llmProvider: provider, auditLogPath: join(root, 'audit.jsonl')},
    logger: {info() {}, warn() {}, error() {}},
    registerTool(factory) {const tool = factory({agentId:'reader',workspaceDir:root}); if(tool?.name === 'get_email') read = tool;},
    on(name, handler) {if(name === 'session_end') close = handler;},
  });
  assert.ok(read);
  const result = await read.execute('synthetic', {email_id:'synthetic'});
  const data = JSON.parse(result.content[0].text);
  assert.equal(data.body_text, 'Due\t\t€42.50\n2026-11-01\nTerms');
  assert.equal(data.body_html, undefined);
  assert.equal(calls.length, 2);
  assert.deepEqual(new Set(calls.map(c => c.label)), new Set(['injection','secret-redact']));
  for(const call of calls) {
    assert.ok(call.content.includes('€42.50') && call.content.includes('2026-11-01'));
    assert.ok(!call.content.includes('DROP_'));
  }
  for (const email_id of ['meta-charset', 'bom', 'transport']) {
    const before = calls.length;
    const encoded = await read.execute(email_id, {email_id});
    assert.equal(JSON.parse(encoded.content[0].text).body_text, 'Café €42');
    assert.equal(calls.length, before + 2);
    for (const call of calls.slice(before)) assert.ok(call.content.includes('Café €42'));
  }
  assert.ok(!JSON.stringify(result).includes('DROP_'));
  assert.ok(!readFileSync(join(root,'audit.jsonl'),'utf8').includes('DROP_'));
  const raw = await read.execute('raw-denied', {email_id:'synthetic',format:'html_only'});
  assert.ok(JSON.stringify(raw).includes('Only readable text'));
  console.log(JSON.stringify({status:'passed',externalWrites:0,checks:['installed-parser','installed-mcp','html-encoding',
    'both-guards-text-only','reader-result','no-raw-details','raw-format-denied']}));
} finally {
  await close?.();
  rmSync(root,{recursive:true,force:true});
}
