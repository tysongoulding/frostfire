const http = require("http");
const { exec } = require("child_process");
const fs = require("fs");

const PORT = 1339;

function inferFallbackAction(prompt, display) {
  const p = prompt.toLowerCase();
  if (p.includes("chrome") || p.includes("browser") || p.includes("google") || p.includes("http")) {
    const urlMatch = prompt.match(/https?:\/\/[^\s]+/i) || prompt.match(/www\.[^\s]+/i) || prompt.match(/github\.com[^\s]*/i);
    const targetUrl = urlMatch ? urlMatch[0] : "https://google.com";
    return {
      command: "/usr/local/bin/chrome-launcher '" + targetUrl + "' &",
      reply: "Opening " + targetUrl + " in Chrome on Display :" + display + ".",
      tool: "browser_launch"
    };
  }
  if (p.includes("terminal") || p.includes("console") || p.includes("bash")) {
    return {
      command: "/usr/local/bin/terminal-launcher &",
      reply: "Opening Terminal on Display :" + display + ".",
      tool: "terminal_launch"
    };
  }
  if (p.includes("file") || p.includes("folder") || p.includes("directory") || p.includes("explorer")) {
    return {
      command: "/usr/local/bin/files-launcher &",
      reply: "Opening Files manager on Display :" + display + ".",
      tool: "files_launch"
    };
  }
  if (p.includes("screenshot") || p.includes("capture screen") || p.includes("current screen")) {
    return {
      command: "scrot -o /tmp/screen.png",
      reply: "Captured screen snapshot on Display :" + display + ".",
      tool: "screen_capture"
    };
  }
  return null;
}

const server = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-frostfire-display, x-sand-display, x-frostfire-window-owner");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.url === "/health" || req.url === "/status") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "running", display: 1, vncPort: 6080 }));
    return;
  }

  if ((req.url === "/agent/turn" || req.url === "/api/agent/turn") && req.method === "POST") {
    let body = "";
    req.on("data", chunk => { body += chunk; });
    req.on("end", () => {
      let data = {};
      try {
        data = body ? JSON.parse(body) : {};
      } catch (e) {
        data = { prompt: body.trim() };
      }

      const display = data.display || req.headers["x-frostfire-display"] || 1;
      const prompt = data.prompt || "";
      const history = data.history || [];
      const agentName = data.agentName || "Claude 3.7 Sonnet";
      const agentRole = data.agentRole || "Screen Capture & Computer Use";

      let agentsMd = "";
      try {
        agentsMd = fs.readFileSync("/home/ubuntu/AGENTS.md", "utf8");
      } catch (err) {}

      let action = inferFallbackAction(prompt, display);
      if (!action && prompt) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          status: "completed",
          agentName,
          agentRole,
          displayNumber: display,
          reply: "I am " + agentName + " (" + agentRole + ") operating on Display :" + display + ". Directives loaded from /home/ubuntu/AGENTS.md.",
          toolCalls: [],
          commandExecuted: null
        }));
        return;
      }

      const cmd = action ? action.command : "";
      const env = Object.assign({}, process.env, {
        DISPLAY: ":" + display,
        HOME: "/home/ubuntu",
        USER: "ubuntu",
      });

      exec(cmd, { cwd: "/home/ubuntu", env }, (err, stdout, stderr) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          status: err ? "error" : "completed",
          agentName,
          agentRole,
          displayNumber: display,
          reply: action.reply,
          toolCalls: [action.tool],
          commandExecuted: cmd,
          stdout: stdout || "",
          stderr: stderr || (err ? err.message : "")
        }));
      });
    });
    return;
  }

  if ((req.url === "/exec" || req.url === "/api/exec") && req.method === "POST") {
    let body = "";
    req.on("data", chunk => { body += chunk; });
    req.on("end", () => {
      let data = {};
      try {
        data = body ? JSON.parse(body) : {};
      } catch (e) {
        if (body.startsWith("command=")) {
          data = { command: decodeURIComponent(body.replace("command=", "")) };
        } else {
          data = { command: body.trim() };
        }
      }

      const display = data.display || req.headers["x-frostfire-display"] || req.headers["x-sand-display"] || 1;
      const cmd = data.command || "";
      const cwd = data.cwd || "/home/ubuntu";
      const bg = Boolean(data.background) || cmd.endsWith("&");

      if (!cmd) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "error", error: "No command provided" }));
        return;
      }

      console.log(`[Exec Server] Display :${display} -> ${cmd}`);
      const env = Object.assign({}, process.env, {
        DISPLAY: ":" + display,
        HOME: "/home/ubuntu",
        USER: "ubuntu",
      });

      if (bg) {
        exec(cmd, { cwd, env });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "success", ok: true, background: true, command: cmd }));
        return;
      }

      exec(cmd, { cwd, env, timeout: 20000 }, (err, stdout, stderr) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          status: err ? "error" : "success",
          ok: !err,
          code: err ? (err.code || 1) : 0,
          stdout: stdout || "",
          stderr: stderr || (err ? err.message : ""),
          command: cmd
        }));
      });
    });
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ status: "error", error: "Not found" }));
});

server.listen(PORT, "0.0.0.0", () => {
  console.log("Frostfire Exec Server listening on port " + PORT);
});
