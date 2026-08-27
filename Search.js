.pragma library

var MAX_SERVICES = 256
var MAX_LINKS = 32
var MAX_TAGS = 24
var MAX_QUERY = 128
var MAX_TOKENS = 8
var MAX_FIELD = 256
var MAX_HITS = 200

function maxServices() { return MAX_SERVICES }
function maxLinks() { return MAX_LINKS }

function asArray(v) {
  return Array.isArray(v) ? v : []
}

function plain(s, max) {
  max = max || MAX_FIELD
  s = String(s || "")
  var out = ""
  for (var i = 0; i < s.length && out.length < max; i++) {
    var c = s.charCodeAt(i)
    if (c < 32 || c === 127) continue
    if (c >= 0x202A && c <= 0x202E) continue
    if (c >= 0x2066 && c <= 0x2069) continue
    out += s.charAt(i)
  }
  return out
}

function parseCatalog(raw) {
  try {
    var data = JSON.parse(String(raw || "[]"))
    if (!Array.isArray(data)) return []
    var out = []
    var n = Math.min(data.length, MAX_SERVICES)
    for (var i = 0; i < n; i++) {
      var s = data[i]
      if (!s || typeof s !== "object") continue
      var linksIn = asArray(s.links)
      var links = []
      var ln = Math.min(linksIn.length, MAX_LINKS)
      for (var li = 0; li < ln; li++) {
        var link = linksIn[li]
        if (!link || typeof link !== "object") continue
        var url = plain(link.url, MAX_FIELD)
        if (url.indexOf("https://") !== 0) continue
        links.push({
          label: plain(link.label, 80),
          url: url,
          category: plain(link.category, 32)
        })
      }
      var tagsIn = asArray(s.tags)
      var tags = []
      var tn = Math.min(tagsIn.length, MAX_TAGS)
      for (var ti = 0; ti < tn; ti++)
        tags.push(plain(tagsIn[ti], 32))
      out.push({
        name: plain(s.name, 80),
        domain: plain(s.domain, 80),
        slug: plain(s.slug, 80),
        tags: tags,
        links: links
      })
    }
    return out
  } catch (e) {
    return []
  }
}

function primaryLink(service) {
  var links = asArray(service && service.links)
  var n = Math.min(links.length, MAX_LINKS)
  if (n === 0) return null
  var i
  for (i = 0; i < n; i++) {
    if (links[i] && links[i].category === "api_keys") return links[i]
  }
  for (i = 0; i < n; i++) {
    if (links[i] && links[i].category === "dashboard") return links[i]
  }
  return links[0]
}

function intentBoost(token, label, cat) {
  var intents = {
    api: true, key: true, keys: true, webhook: true, webhooks: true,
    billing: true, status: true, token: true, tokens: true, env: true, logs: true
  }
  if (!intents[token]) return 0
  if (label.indexOf(token) !== -1 || cat.indexOf(token) !== -1) return 20
  if ((token === "key" || token === "keys" || token === "token" || token === "tokens") && cat === "api_keys")
    return 20
  return 0
}

function searchCatalog(services, rawQuery, limit) {
  limit = Math.min(limit || 40, 40)
  services = asArray(services)
  var q = plain(rawQuery, MAX_QUERY).trim().toLowerCase()
  var out = []
  var i
  var serviceCount = Math.min(services.length, MAX_SERVICES)

  if (!q) {
    var n = Math.min(12, serviceCount)
    for (i = 0; i < n; i++) {
      var s0 = services[i]
      var link0 = primaryLink(s0)
      out.push({
        title: (s0.name || "") + " · " + (link0 ? link0.label : "Open"),
        subtitle: link0 ? link0.url : (s0.domain || ""),
        url: link0 ? link0.url : (s0.domain ? ("https://" + s0.domain) : ""),
        serviceName: s0.name || "",
        label: link0 ? link0.label : "Open"
      })
    }
    return out
  }

  var tokens = q.split(/\s+/).filter(function (t) { return t.length > 0 }).slice(0, MAX_TOKENS)
  var hits = []

  for (i = 0; i < serviceCount; i++) {
    var s = services[i]
    var name = (s.name || "").toLowerCase()
    var domain = (s.domain || "").toLowerCase()
    var tags = asArray(s.tags).slice(0, MAX_TAGS)
    var slug = (s.slug || "").toLowerCase()
    var hayService = name + " " + domain + " " + tags.join(" ") + " " + slug

    var serviceScore = 0
    if (name === q || slug === q) serviceScore += 100
    else if (name.indexOf(q) === 0 || slug.indexOf(q) === 0) serviceScore += 60
    else if (name.indexOf(q) !== -1 || domain.indexOf(q) !== -1) serviceScore += 40

    var allInService = true
    for (var t = 0; t < tokens.length; t++) {
      if (hayService.indexOf(tokens[t]) === -1) { allInService = false; break }
    }
    if (allInService) serviceScore += 20

    var links = asArray(s.links)
    var linkCount = Math.min(links.length, MAX_LINKS)
    for (var li = 0; li < linkCount; li++) {
      var link = links[li]
      if (!link || typeof link !== "object") continue
      var label = (link.label || "").toLowerCase()
      var cat = (link.category || "").toLowerCase()
      var hay = hayService + " " + label + " " + cat
      var score = serviceScore

      var allInHay = true
      for (var t2 = 0; t2 < tokens.length; t2++) {
        if (hay.indexOf(tokens[t2]) === -1) { allInHay = false; break }
      }
      if (allInHay) score += 15
      if (label.indexOf(q) !== -1) score += 25

      var someLabel = false
      for (var t3 = 0; t3 < tokens.length; t3++) {
        if (label.indexOf(tokens[t3]) !== -1) someLabel = true
        score += intentBoost(tokens[t3], label, cat)
      }
      if (someLabel) score += 10

      if (score <= 0) continue
      hits.push({
        score: score,
        title: (s.name || "") + " · " + (link.label || ""),
        subtitle: link.url || "",
        url: link.url || "",
        serviceName: s.name || "",
        label: link.label || ""
      })
      if (hits.length >= MAX_HITS) break
    }
    if (hits.length >= MAX_HITS) break
  }

  hits.sort(function (a, b) {
    if (b.score !== a.score) return b.score - a.score
    return a.title < b.title ? -1 : a.title > b.title ? 1 : 0
  })

  var seen = {}
  for (i = 0; i < hits.length; i++) {
    if (seen[hits[i].url]) continue
    seen[hits[i].url] = true
    out.push(hits[i])
    if (out.length >= limit) break
  }
  return out
}
