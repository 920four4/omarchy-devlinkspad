.pragma library

// Byte ceilings for keep-loaded reads. Oversized remote bodies or a
// replaced state/catalog file must not be retained in the shell.
var MAX_HTTP_BYTES = 8192
var MAX_STATE_BYTES = 8192
var MAX_CATALOG_BYTES = 262144
var MAX_OPENS = 1000000
var SITE = "https://devlinkspad.com"

function maxHttpBytes() { return MAX_HTTP_BYTES }
function maxStateBytes() { return MAX_STATE_BYTES }
function maxCatalogBytes() { return MAX_CATALOG_BYTES }

function emptyState() {
  return {
    deviceId: "",
    token: "",
    email: "",
    isPro: false,
    opens: 0,
    checkedAt: 0
  }
}

function clip(s, n) {
  s = String(s || "")
  return s.length > n ? s.slice(0, n) : s
}

function noCtl(s, max) {
  s = String(s || "")
  max = max || s.length
  var out = ""
  for (var i = 0; i < s.length && out.length < max; i++) {
    var c = s.charCodeAt(i)
    if (c < 32 || c === 127) continue
    out += s.charAt(i)
  }
  return out
}

function isDeviceId(s) {
  s = String(s || "")
  if (s.length < 24 || s.length > 64) return false
  for (var i = 0; i < s.length; i++) {
    var c = s.charCodeAt(i)
    var hex = (c >= 48 && c <= 57) || (c >= 97 && c <= 102)
    if (!hex) return false
  }
  return true
}

function clipDeviceId(s) {
  s = String(s || "").toLowerCase()
  var out = ""
  for (var i = 0; i < s.length && out.length < 64; i++) {
    var c = s.charCodeAt(i)
    if ((c >= 48 && c <= 57) || (c >= 97 && c <= 102))
      out += s.charAt(i)
  }
  return isDeviceId(out) ? out : ""
}

function clipEmail(s) {
  return noCtl(s, 254)
}

function clipToken(s) {
  s = noCtl(s, 4096)
  return isSafeHeaderValue(s) ? s : ""
}

function clipOpens(n) {
  var v = parseInt(n, 10)
  if (!isFinite(v) || v < 0) return 0
  return v > MAX_OPENS ? MAX_OPENS : v
}

function parseState(raw) {
  var s = emptyState()
  var text = String(raw || "")
  if (text.length > MAX_STATE_BYTES) return s
  try {
    var data = JSON.parse(text || "{}")
    if (!data || typeof data !== "object") return s
    s.deviceId = clipDeviceId(data.deviceId)
    s.token = clipToken(data.token)
    s.email = clipEmail(data.email)
    s.isPro = data.isPro === true
    s.opens = clipOpens(data.opens)
    s.checkedAt = parseInt(data.checkedAt, 10) || 0
  } catch (e) {}
  return s
}

function serializeState(s) {
  return JSON.stringify({
    deviceId: clipDeviceId(s.deviceId),
    token: clipToken(s.token),
    email: clipEmail(s.email),
    isPro: !!s.isPro,
    opens: clipOpens(s.opens),
    checkedAt: parseInt(s.checkedAt, 10) || 0
  })
}

function parseJson(raw) {
  var text = String(raw || "")
  if (text.length > MAX_HTTP_BYTES) return null
  try {
    var data = JSON.parse(text || "{}")
    return data && typeof data === "object" ? data : null
  } catch (e) {
    return null
  }
}

function withinByteCeiling(raw, maxBytes) {
  return String(raw || "").length <= maxBytes
}

function curlQuote(value) {
  return "\"" + String(value).replace(/\\/g, "\\\\").replace(/"/g, "\\\"") + "\""
}

function isSafeHeaderValue(s) {
  if (!s) return false
  if (s.length > 4096) return false
  for (var i = 0; i < s.length; i++) {
    var c = s.charCodeAt(i)
    if (c < 32 || c === 127) return false
  }
  return true
}

function isAllowedUrl(url) {
  url = String(url || "")
  if (url.length < 32 || url.length > 256) return false
  for (var i = 0; i < url.length; i++) {
    var c = url.charCodeAt(i)
    if (c < 32 || c === 127 || c === 34 || c === 92) return false
  }
  return /^https:\/\/devlinkspad\.com\/api\/omarchy\/[A-Za-z0-9/_?=&%-]+$/.test(url)
}

function startEndpoint() {
  return SITE + "/api/omarchy/device/start"
}

function licenseEndpoint() {
  return SITE + "/api/omarchy/license"
}

function pollEndpoint(deviceId) {
  var id = clipDeviceId(deviceId)
  if (!id) return ""
  return SITE + "/api/omarchy/device/status?device=" + id
}

function connectPage(deviceId) {
  var id = clipDeviceId(deviceId)
  if (!id) return ""
  return SITE + "/connect/omarchy?device=" + id
}

function safeHttpsUrl(url) {
  url = noCtl(url, 256)
  if (url.length < 10 || url.length > 256) return ""
  if (url.indexOf("\\") !== -1 || url.indexOf("\"") !== -1 || url.indexOf("'") !== -1)
    return ""
  if (!/^https:\/\/[A-Za-z0-9][A-Za-z0-9.-]*[A-Za-z0-9](\/[A-Za-z0-9._~:/?#\[\]@!$&()*+,;=%-]*)?$/.test(url))
    return ""
  return url
}

function buildCurlConfig(method, url, body, token, maxBytes) {
  if (!isAllowedUrl(url)) return ""
  if (method !== "GET" && method !== "POST") return ""
  var limit = maxBytes || MAX_HTTP_BYTES
  var lines = [
    "silent",
    "show-error",
    "max-time = 8",
    "max-filesize = " + limit,
    "request = " + curlQuote(method),
    "header = " + curlQuote("Accept: application/json")
  ]
  if (token) {
    if (!isSafeHeaderValue(token)) return ""
    lines.push("header = " + curlQuote("Authorization: Bearer " + token))
  }
  if (method === "POST") {
    var payload = body || "{}"
    if (!isSafeHeaderValue(payload) || payload.length > 1024) return ""
    lines.push("header = " + curlQuote("Content-Type: application/json"))
    lines.push("data = " + curlQuote(payload))
  }
  lines.push("url = " + curlQuote(url))
  return lines.join("\n") + "\n"
}
