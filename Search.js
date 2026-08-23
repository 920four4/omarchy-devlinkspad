.pragma library

function parseCatalog(raw) {
  try {
    var data = JSON.parse(String(raw || "[]"))
    return Array.isArray(data) ? data : []
  } catch (e) {
    return []
  }
}

function primaryLink(service) {
  if (!service || !service.links || !service.links.length) return null
  for (var i = 0; i < service.links.length; i++) {
    if (service.links[i].category === "api_keys") return service.links[i]
  }
  for (var j = 0; j < service.links.length; j++) {
    if (service.links[j].category === "dashboard") return service.links[j]
  }
  return service.links[0]
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
  limit = limit || 40
  var q = (rawQuery || "").trim().toLowerCase()
  var out = []
  var i

  if (!q) {
    var n = Math.min(12, services.length)
    for (i = 0; i < n; i++) {
      var s0 = services[i]
      var link0 = primaryLink(s0)
      out.push({
        title: s0.name + " · " + (link0 ? link0.label : "Open"),
        subtitle: link0 ? link0.url : s0.domain,
        url: link0 ? link0.url : ("https://" + s0.domain),
        serviceName: s0.name,
        label: link0 ? link0.label : "Open"
      })
    }
    return out
  }

  var tokens = q.split(/\s+/).filter(function (t) { return t.length > 0 })
  var hits = []

  for (i = 0; i < services.length; i++) {
    var s = services[i]
    var name = (s.name || "").toLowerCase()
    var domain = (s.domain || "").toLowerCase()
    var tags = ((s.tags || []).join(" ")).toLowerCase()
    var slug = (s.slug || "").toLowerCase()
    var hayService = name + " " + domain + " " + tags + " " + slug

    var serviceScore = 0
    if (name === q || slug === q) serviceScore += 100
    else if (name.indexOf(q) === 0 || slug.indexOf(q) === 0) serviceScore += 60
    else if (name.indexOf(q) !== -1 || domain.indexOf(q) !== -1) serviceScore += 40

    var allInService = true
    for (var t = 0; t < tokens.length; t++) {
      if (hayService.indexOf(tokens[t]) === -1) { allInService = false; break }
    }
    if (allInService) serviceScore += 20

    var links = s.links || []
    for (var li = 0; li < links.length; li++) {
      var link = links[li]
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
        title: s.name + " · " + link.label,
        subtitle: link.url,
        url: link.url,
        serviceName: s.name,
        label: link.label
      })
    }
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
