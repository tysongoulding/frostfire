import http from "node:http";
import net from "node:net";

const backend = http.createServer((req, res) => {
  res.end("backend");
});

backend.on("upgrade", (req, socket, head) => {
  console.log("Backend received upgrade request:", req.url);
  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\n" +
    "Upgrade: websocket\r\n" +
    "Connection: Upgrade\r\n" +
    "Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=\r\n\r\n"
  );
  socket.on("data", (chunk) => {
    console.log("Backend received data:", chunk.toString());
    socket.write("PONG:" + chunk.toString());
  });
});

backend.listen(19999, "127.0.0.1", () => {
  const proxy = http.createServer((req, res) => {
    res.end("proxy");
  });

  proxy.on("upgrade", (req, socket, head) => {
    console.log("Proxy received upgrade request:", req.url);
    const upstream = net.connect(19999, "127.0.0.1", () => {
      let rawReq = `${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`;
      for (let i = 0; i < req.rawHeaders.length; i += 2) {
        rawReq += `${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}\r\n`;
      }
      rawReq += "\r\n";
      upstream.write(rawReq);
      if (head && head.length > 0) upstream.write(head);
      upstream.pipe(socket);
      socket.pipe(upstream);
    });
    upstream.on("error", (e) => { console.error("Upstream error:", e); socket.destroy(); });
    socket.on("error", (e) => { console.error("Socket error:", e); upstream.destroy(); });
  });

  proxy.listen(19998, "127.0.0.1", () => {
    const client = net.connect(19998, "127.0.0.1", () => {
      console.log("Client connected, sending upgrade handshake");
      client.write(
        "GET /ws HTTP/1.1\r\n" +
        "Host: 127.0.0.1:19998\r\n" +
        "Upgrade: websocket\r\n" +
        "Connection: Upgrade\r\n" +
        "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n" +
        "Sec-WebSocket-Version: 13\r\n\r\n"
      );
    });

    let received = "";
    client.on("data", (d) => {
      received += d.toString();
      console.log("Client received data:", d.toString());
      if (received.includes("101 Switching Protocols")) {
        client.write("PING");
      }
      if (received.includes("PONG:PING")) {
        console.log("SUCCESS: End-to-end upgrade proxying confirmed!");
        process.exit(0);
      }
    });
    client.on("error", (e) => console.error("Client error:", e));
  });
});
setTimeout(() => {
  console.error("TIMEOUT!");
  process.exit(1);
}, 3000);
