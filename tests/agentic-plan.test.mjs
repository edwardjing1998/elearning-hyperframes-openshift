import test from 'node:test';import assert from 'node:assert/strict';
import {validatePlan,assertPublicHost} from '../src/agentic/plan.mjs';
const env={AGENTIC_ALLOWED_ORIGINS:'https://example.com,https://portal.azure.com'};
const good={title:'Training',course_id:'demo',scenes:[{type:'screenshot',url:'https://example.com/page',narration:'Hello world.'}]};
test('valid plan',()=>{const p=validatePlan(good,env);assert.equal(p.scenes[0].duration_seconds,8);});
test('blocks unapproved host',()=>assert.throws(()=>validatePlan({...good,scenes:[{...good.scenes[0],url:'https://evil.example/'}]},env),/allowlisted/));
test('blocks non-HTTPS',()=>assert.throws(()=>validatePlan({...good,scenes:[{...good.scenes[0],url:'http://example.com/'}]},env),/allowlisted/));
test('rejects action execution',()=>assert.throws(()=>validatePlan({...good,scenes:[{...good.scenes[0],type:'click'}]},env),/screenshot/));
test('blocks invalid narration',()=>assert.throws(()=>validatePlan({...good,scenes:[{...good.scenes[0],narration:''}]},env),/narration/));
test('blocks local DNS',async()=>await assert.rejects(()=>assertPublicHost('test.example',async()=>[{address:'127.0.0.1'}]),/non-public/));

test('without an allowlist accepts different public HTTPS website targets',()=>{
  for(const url of ['https://learn.microsoft.com/en-us/','https://docs.databricks.com/','https://www.snowflake.com/']){
    const input={...good,scenes:[{...good.scenes[0],url}]};
    assert.equal(validatePlan(input,{}).scenes[0].url,url);
    assert.equal(validatePlan(input,{AGENTIC_ALLOWED_ORIGINS:'  '}).scenes[0].url,url);
  }
});
test('public mode rejects unsafe schemes, credentials, IP literals, local names and custom ports',()=>{
  for(const url of ['http://example.com/','file:///etc/passwd','https://user:pass@example.com/','https://example.com:8443/','https://localhost/','https://foo.default.svc.cluster.local/','https://metadata.google.internal/','https://127.0.0.1/','https://2130706433/','https://[::1]/','https://169.254.169.254/']){
    assert.throws(()=>validatePlan({...good,scenes:[{...good.scenes[0],url}]},{}),/public HTTPS hostname|invalid URL/);
  }
});
test('public DNS rejects private, special-use, mixed, and empty DNS results',async()=>{
  for(const address of ['0.0.0.0','10.0.0.1','100.64.0.1','127.0.0.1','169.254.169.254','168.63.129.16','172.16.0.1','192.168.0.1','192.0.2.1','198.18.0.1','198.51.100.1','203.0.113.1','224.0.0.1','240.0.0.1','::','::1','::ffff:8.8.8.8','fe80::1','fc00::1','fd00::1','ff02::1','64:ff9b::7f00:1','2001:db8::1','2002:7f00:1::1']){
    await assert.rejects(()=>assertPublicHost('example.com',async()=>[{address:'8.8.8.8'},{address}]),/non-public/);
  }
  await assert.rejects(()=>assertPublicHost('example.com',async()=>[]),/non-public/);
  assert.deepEqual(await assertPublicHost('example.com',async(host,options)=>{
    assert.equal(host,'example.com.');assert.equal(options.all,true);
    return [{address:'8.8.8.8'},{address:'2606:4700::1111'}];
  }),[{address:'8.8.8.8',family:4},{address:'2606:4700::1111',family:6}]);
});

test('existing scenes retain their normalized shape without new options',()=>{
  assert.deepEqual(validatePlan(good,env).scenes,[{...good.scenes[0],duration_seconds:8}]);
});
test('optional capture readiness controls are separate from video duration',()=>{
  const scene={...good.scenes[0],duration_seconds:60,wait_seconds:20,wait_for_selector:'  h1  '};
  const result=validatePlan({...good,scenes:[scene]},env).scenes[0];
  assert.deepEqual(result,{...scene,wait_for_selector:'h1'});
  assert.equal(validatePlan({...good,scenes:[{...scene,wait_seconds:0}]},env).scenes[0].wait_seconds,0);
  assert.equal(validatePlan({...good,scenes:[{...scene,wait_seconds:30}]},env).scenes[0].wait_seconds,30);
});
test('invalid capture waits are rejected',()=>{
  for(const wait_seconds of [-1,31,Infinity,NaN,'20',null])assert.throws(()=>validatePlan({...good,scenes:[{...good.scenes[0],wait_seconds}]},env),/wait_seconds/);
  for(const wait_for_selector of [null,4,'','   ','x'.repeat(301)])assert.throws(()=>validatePlan({...good,scenes:[{...good.scenes[0],wait_for_selector}]},env),/wait_for_selector/);
});
