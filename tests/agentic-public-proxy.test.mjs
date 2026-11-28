import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {once} from 'node:events';
import {parseConnectTarget,resolveConnectTarget,startPublicProxy} from '../src/agentic/public-proxy.mjs';

test('CONNECT authority rejects non-HTTPS ports and internal targets',()=>{
  assert.equal(parseConnectTarget('www.example.com:443'),'www.example.com');
  for(const target of ['example.com:80','example.com:8443','localhost:443','x.default.svc.cluster.local:443','127.0.0.1:443','[::1]:443','example.com:443/path','user@example.com:443']){
    assert.throws(()=>parseConnectTarget(target),/public HTTPS/);
  }
});
test('proxy pins validated public DNS result and fails closed on mixed DNS',async()=>{
  assert.deepEqual(await resolveConnectTarget('example.com:443',async()=>[{address:'2606:4700::1111'},{address:'8.8.8.8'}]),{address:'8.8.8.8',family:4});
  await assert.rejects(()=>resolveConnectTarget('example.com:443',async()=>[{address:'8.8.8.8'},{address:'10.1.2.3'}]),/non-public/);
});
async function request(proxy,requestText){
  const port=Number(new URL(proxy.url).port);
  const client=net.connect({host:'127.0.0.1',port});
  try{
    await once(client,'connect');client.write(requestText);
    const [data]=await once(client,'data');return data.toString();
  }finally{client.destroy();}
}
test('loopback proxy blocks private resolution and direct HTTP without dialing',async()=>{
  let calls=0;
  const proxy=await startPublicProxy({lookup:async()=>[{address:'169.254.169.254'}],connect:()=>{calls++;throw new Error('must not dial');}});
  try{
    assert.match(await request(proxy,'CONNECT example.com:443 HTTP/1.1\r\nHost: example.com:443\r\n\r\n'),/^HTTP\/1.1 403/);
    assert.match(await request(proxy,'GET http://example.com/ HTTP/1.1\r\nHost: example.com\r\n\r\n'),/^HTTP\/1.1 403/);
    assert.equal(calls,0);
  }finally{await proxy.close();}
});
test('CONNECT uses numeric approved IP and forwards bytes through the tunnel',async()=>{
  const upstream=net.createServer(socket=>socket.pipe(socket));
  await new Promise(resolve=>upstream.listen(0,'127.0.0.1',resolve));
  let dialed;
  const proxy=await startPublicProxy({lookup:async()=>[{address:'8.8.8.8'}],connect:options=>{
    dialed=options; // test connector uses a local echo server instead of the public internet
    return net.connect({host:'127.0.0.1',port:upstream.address().port});
  }});
  const client=net.connect({host:'127.0.0.1',port:Number(new URL(proxy.url).port)});
  try{
    await once(client,'connect');
    client.write('CONNECT example.com:443 HTTP/1.1\r\nHost: example.com:443\r\n\r\n');
    const [header]=await once(client,'data');assert.match(header.toString(),/^HTTP\/1.1 200/);
    assert.deepEqual(dialed,{host:'8.8.8.8',port:443,family:4});
    client.write('tunnel-test');const [echo]=await once(client,'data');assert.equal(echo.toString(),'tunnel-test');
  }finally{client.destroy();await proxy.close();await new Promise(resolve=>upstream.close(resolve));}
});
