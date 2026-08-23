.pragma library

// Byte ceilings for keep-loaded reads. Oversized remote bodies or a
// replaced state/catalog file must not be retained in the shell.
var MAX_HTTP_BYTES = 8192
var MAX_STATE_BYTES = 8192
var MAX_CATALOG_BYTES = 262144

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

function parseState(raw) {
  var s = emptyState()
  var text = String(raw || "")
  if (text.length > MAX_STATE_BYTES) return s
  try {
    var data = JSON.parse(text || "{}")
    if (!data || typeof data !== "object") return s
    s.deviceId = clip(data.deviceId, 64)
    s.token = clip(data.token, 4096)
    s.email = clip(data.email, 254)
    s.isPro = data.isPro === true
    s.opens = Math.max(0, parseInt(data.opens, 10) || 0)
    s.checkedAt = parseInt(data.checkedAt, 10) || 0
  } catch (e) {}
  return s
}

function serializeState(s) {
  return JSON.stringify({
    deviceId: clip(s.deviceId, 64),
    token: clip(s.token, 4096),
    email: clip(s.email, 254),
    isPro: !!s.isPro,
    opens: s.opens || 0,
    checkedAt: s.checkedAt || 0
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
  return /^https:\/\/devlinkspad\.com\/api\/omarchy\//.test(String(url || ""))
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
