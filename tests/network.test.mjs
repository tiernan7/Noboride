import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer, request } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir, networkInterfaces } from "node:os";
import { join } from "node:path";
import {
  serverHost,
  allowedAuthorities,
  localNetworkName,
} from "../lib/network.mjs";

test("host flag defaults to loopback and accepts optional explicit addresses", () => {
  assert.equal(serverHost([]), "127.0.0.1");
  assert.equal(serverHost(["--host"]), "0.0.0.0");
  assert.equal(serverHost(["--host", "192.168.1.12"]), "192.168.1.12");
  assert.equal(serverHost(["--host=::"]), "::");
  for (const args of [
    ["--host="],
    ["--host", "--bad"],
    ["--other"],
    ["--host=a/b"],
    ["--host", "a", "b"],
  ])
    assert.throws(() => serverHost(args), /Usage/);
});

test("allowed hosts remain constrained to configured addresses and local interfaces", () => {
  const local = allowedAuthorities("127.0.0.1", 4317);
  assert.deepEqual([...local], ["127.0.0.1:4317", "localhost:4317"]);
  assert.ok(allowedAuthorities("::1", 4317).has("[::1]:4317"));
  const network = allowedAuthorities("0.0.0.0", 4317);
  for (const address of Object.values(networkInterfaces()).flat())
    if (address.family === "IPv4")
      assert.ok(network.has(`${address.address}:4317`));
  assert.equal(network.has("evil.example:4317"), false);
  assert.equal(network.has("0.0.0.0:4317"), false);
  assert.ok(
    allowedAuthorities("0.0.0.0", 4317, "my-mac.local").has(
      "my-mac.local:4317",
    ),
  );
  assert.equal(
    allowedAuthorities("127.0.0.1", 4317, "my-mac.local").has(
      "my-mac.local:4317",
    ),
    false,
  );
  assert.equal(
    allowedAuthorities("0.0.0.0", 4317, "evil.example").has(
      "evil.example:4317",
    ),
    false,
  );
});

function query(port, headers = {}, hostname = "127.0.0.1") {
  return new Promise((resolve, reject) => {
    const req = request(
      { hostname, port, path: "/api/workspace", headers },
      (res) => {
        res.resume();
        res.on("end", () => resolve(res.statusCode));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

test("Node server and launcher honor host flags while retaining host and origin checks", async () => {
  const dir = await mkdtemp(join(tmpdir(), "noboride-network-"));
  const lan = Object.values(networkInterfaces())
    .flat()
    .find((address) => address.family === "IPv4" && !address.internal)?.address;
  try {
    for (const [script, args] of [
      ["server.mjs", []],
      ["server.mjs", ["--host"]],
      ["server.mjs", ["--host", "127.0.0.1"]],
      ["scripts/start.mjs", ["--host=127.0.0.1"]],
    ]) {
      const probe = createServer();
      probe.listen(0, "127.0.0.1");
      await once(probe, "listening");
      const port = probe.address().port;
      await new Promise((resolve) => probe.close(resolve));
      const child = spawn(process.execPath, [script, ...args], {
        cwd: new URL("..", import.meta.url),
        env: { ...process.env, PORT: String(port), NOBORIDE_DATA_DIR: dir },
        stdio: ["ignore", "pipe", "pipe"],
      });
      const exited = once(child, "exit");
      try {
        await new Promise((resolve, reject) => {
          let output = "";
          const timer = setTimeout(
            () => reject(new Error(`Startup timed out: ${output}`)),
            10000,
          );
          const finish = (error) => {
            clearTimeout(timer);
            error ? reject(error) : resolve();
          };
          child.stdout.on("data", (data) => {
            output += data;
            if (output.includes("Listening on")) finish();
          });
          child.stderr.on("data", (data) => {
            output += data;
          });
          child.once("error", finish);
          child.once("exit", () => finish(new Error(output)));
        });
        assert.equal(await query(port), 200);
        assert.equal(await query(port, { Host: `evil.example:${port}` }), 403);
        const originResponse = await fetch(
          `http://127.0.0.1:${port}/api/demo`,
          {
            method: "POST",
            headers: {
              Origin: "http://evil.example",
              "Content-Type": "application/json",
            },
            body: "{}",
          },
        );
        assert.equal(originResponse.status, 403);
        const name = localNetworkName();
        if (name) {
          const networkMode = args.length === 1 && args[0] === "--host";
          assert.equal(
            await query(port, { Host: `${name}:${port}` }),
            networkMode ? 200 : 403,
          );
          if (networkMode) {
            const response = await fetch(
              `http://127.0.0.1:${port}/api/settings`,
              {
                method: "PUT",
                headers: {
                  Host: `${name}:${port}`,
                  Origin: `http://${name}:${port}`,
                  "Content-Type": "application/json",
                },
                body: "{}",
              },
            );
            assert.equal(response.status, 200);
          }
        }
        if (lan) {
          const networkMode = args.length === 1 && args[0] === "--host";
          assert.equal(
            await query(port, { Host: `${lan}:${port}` }),
            networkMode ? 200 : 403,
          );
          if (networkMode) {
            assert.equal(await query(port, {}, lan), 200);
            const saved = await fetch(`http://${lan}:${port}/api/settings`, {
              method: "PUT",
              headers: {
                Origin: `http://${lan}:${port}`,
                "Content-Type": "application/json",
              },
              body: "{}",
            });
            assert.equal(saved.status, 200);
          }
        }
      } finally {
        child.kill("SIGTERM");
        await exited;
      }
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
