/** Loopback-only HTTPS CONNECT proxy. DNS is checked and the connection is pinned
 * to the validated IP, rather than asking Chromium to resolve the hostname again.
 * Infrastructure-level egress isolation is still recommended for untrusted sites.
 */
import http from 'node:http';
import net from 'node:net';
import { assertPublicHost, validHostname } from './plan.mjs';

export function parseConnectTarget(target) {
  const m=/^([a-z0-9.-]+):443$/i.exec(target || '');
  if(!m || !validHostname(m[1])) throw new Error('Only public HTTPS hostnames on port 443 are allowed');
  return m[1];
}
export async function resolveConnectTarget(target, lookup) {
  const hostname=parseConnectTarget(target);
  const answers=await assertPublicHost(hostname,lookup);
  // Prefer IPv4 in clusters without IPv6 connectivity.
  return answers.find(x=>x.family===4) || answers[0];
}
export async function startPublicProxy({lookup, connect=net.connect}={}) {
  const sockets=new Set();
  let closing=false;
  function track(socket) {
    sockets.add(socket);
    socket.on('close',()=>sockets.delete(socket));
    socket.on('error',()=>socket.destroy());
    return socket;
  }
  const server=http.createServer((_req,res)=>{
    res.writeHead(403,{'connection':'close'});res.end('HTTPS CONNECT only');
  });
  server.on('connection',track);
  server.on('connect',async (req,client,head)=>{
    client.pause();
    let upstream;
    let established=false;
    let failed=false;
    client.setTimeout(30000,()=>client.destroy());
    const fail=()=>{
      if(failed)return;
      failed=true;
      upstream?.destroy();
      if(client.destroyed) return;
      if(established) client.destroy();
      else client.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
    };
    client.once('close',()=>upstream?.destroy());
    try {
      const target=await resolveConnectTarget(req.url,lookup);
      if(closing||client.destroyed) return client.destroy();
      // A numeric IP and explicit family guarantee no second DNS lookup.
      upstream=track(connect({host:target.address,port:443,family:target.family}));
      upstream.setTimeout(30000,()=>upstream.destroy());
      upstream.once('error',fail);
      upstream.once('close',()=>{if(established)client.destroy();else fail();});
      upstream.once('connect',()=>{
        if(closing||client.destroyed)return upstream.destroy();
        established=true;
        client.setTimeout(0);
        upstream.setTimeout(90000,()=>upstream.destroy());
        client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if(head.length)upstream.write(head);
        client.pipe(upstream);upstream.pipe(client);client.resume();
      });
    } catch {fail();}
  });
  await new Promise((resolve,reject)=>{
    server.once('error',reject);
    server.listen(0,'127.0.0.1',()=>{server.off('error',reject);resolve();});
  });
  return {url:`http://127.0.0.1:${server.address().port}`,close:async()=>{
    closing=true;
    for(const socket of sockets)socket.destroy();
    await new Promise(resolve=>server.close(resolve));
  }};
}
