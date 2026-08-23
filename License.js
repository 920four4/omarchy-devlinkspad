.pragma library

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

function parseState(raw) {
  var s = emptyState()
  try {
    var data = JSON.parse(String(raw || "{}"))
    if (!data || typeof data !== "object") return s
    s.deviceId = String(data.deviceId || "")
    s.token = String(data.token || "")
    s.email = String(data.email || "")
    s.isPro = data.isPro === true
    s.opens = Math.max(0, parseInt(data.opens, 10) || 0)
    s.checkedAt = parseInt(data.checkedAt, 10) || 0
  } catch (e) {}
  return s
}

function serializeState(s) {
  return JSON.stringify({
    deviceId: s.deviceId || "",
    token: s.token || "",
    email: s.email || "",
    isPro: !!s.isPro,
    opens: s.opens || 0,
    checkedAt: s.checkedAt || 0
  })
}

function parseJson(raw) {
  try {
    var data = JSON.parse(String(raw || "{}"))
    return data && typeof data === "object" ? data : null
  } catch (e) {
    return null
  }
}
