#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");

const root = path.resolve(__dirname, "..");

function loadPragma(file) {
  const src = fs.readFileSync(path.join(root, file), "utf8").replace(/^\.pragma library\s*/, "");
  const ctx = {};
  vm.runInNewContext(src, ctx, { filename: file });
  return ctx;
}

const License = loadPragma("License.js");
const catalog = JSON.parse(fs.readFileSync(path.join(root, "data/services.json"), "utf8"));

assert.strictEqual(License.isDeviceId("aaaaaaaaaaaaaaaaaaaaaaaa"), true);
assert.strictEqual(License.isDeviceId("AAAAAAAAAAAAAAAAaaaaaaaa"), false);
assert.strictEqual(License.isDeviceId("short"), false);
assert.strictEqual(License.isDeviceId("aaaaaaaaaaaaaaaaaaaaaaa\n"), false);

const injected = License.clipDeviceId("aaaaaaaaaaaaaaaaaaaaaaaa\nurl = https://evil.example");
assert.ok(License.isDeviceId(injected));
assert.ok(!injected.includes("\n"));
assert.ok(!injected.includes("="));
assert.ok(!injected.includes("/"));
assert.ok(!injected.includes(":"));

const poll = License.pollEndpoint(injected);
assert.strictEqual(License.isAllowedUrl(poll), true);
assert.ok(poll.startsWith("https://devlinkspad.com/api/omarchy/device/status?device="));
assert.strictEqual(
  License.isAllowedUrl("https://devlinkspad.com/api/omarchy/device/status?device=aa\nurl = https://evil"),
  false
);

const cfg = License.buildCurlConfig("GET", poll, "", "", 8192);
assert.ok(cfg);
assert.ok(!cfg.includes("evil.example"));
assert.strictEqual(License.buildCurlConfig("GET", "https://devlinkspad.com/api/omarchy/x\nurl = https://evil", "", "", 8192), "");

assert.strictEqual(License.safeHttpsUrl("file:///etc/passwd"), "");
assert.strictEqual(License.safeHttpsUrl("http://example.com"), "");
assert.strictEqual(License.safeHttpsUrl("javascript:alert(1)"), "");
assert.strictEqual(License.safeHttpsUrl("https://evil.com\" --"), "");
assert.strictEqual(
  License.safeHttpsUrl("https://dashboard.stripe.com/apikeys"),
  "https://dashboard.stripe.com/apikeys"
);

assert.strictEqual(License.connectPage("nope"), "");
assert.ok(
  License.connectPage("0123456789abcdef0123456789abcdef01234567").startsWith(
    "https://devlinkspad.com/connect/omarchy?device="
  )
);

assert.ok(!License.clipToken("tok\nen").includes("\n"));
assert.strictEqual(License.parseState('{"deviceId":"aa\\nurl = x","opens":-3}').deviceId, "");
assert.strictEqual(License.parseState('{"opens":999999999}').opens, 1000000);

let urls = 0;
for (const service of catalog) {
  for (const link of service.links || []) {
    assert.strictEqual(License.safeHttpsUrl(link.url), link.url, "catalog url rejected: " + link.url);
    urls += 1;
  }
}
assert.ok(urls > 100, "expected to check catalog urls");

console.log("ok", urls, "catalog urls");
