import Quickshell
import Quickshell.Io
import Quickshell.Wayland
import QtQuick
import qs.Commons
import qs.Ui
import "Search.js" as Search
import "License.js" as License

Item {
  id: root

  property string omarchyPath: Quickshell.env("OMARCHY_PATH")
  property var shell: null
  property var manifest: null

  property bool opened: false
  property string filterText: ""
  property int selectedIndex: 0
  property bool cursorActive: false
  property var services: []

  property string siteUrl: "https://devlinkspad.com"
  property int freeOpens: 20
  property string deviceId: ""
  property string licenseToken: ""
  property string licenseEmail: ""
  property bool isPro: false
  property int opens: 0
  property double checkedAt: 0
  property bool connecting: false
  property string httpAction: ""
  property bool pendingConnect: false
  readonly property bool canJump: root.isPro || root.opens < root.freeOpens
  readonly property int remainingOpens: Math.max(0, root.freeOpens - root.opens)
  readonly property int ctaHeight: root.isPro ? 0 : Math.max(Style.space(28), Style.font.caption + Style.spacing.controlPaddingY * 2)
  readonly property string statePath: Quickshell.env("HOME") + "/.local/state/omarchy/devlinkspad.json"

  property color background: Color.menu.background
  property color foreground: Color.menu.text
  property color border: Color.menu.border
  property var borderSpec: Border.surfaceSpec("menu", "border", border, Math.max(1, Style.space(2)))
  property color scrim: Color.menu.scrim
  property color selectedBackground: Color.menu.selectedBackground
  property color selectedText: Color.menu.selectedText
  readonly property int cornerRadius: Style.cornerRadius
  property string fontFamily: Style.font.menuFamily
  property int contentMargin: Style.spacing.panelPadding
  property int headerHeight: Math.max(Style.space(34), Style.font.title + Style.spacing.controlPaddingY * 2)
  property int footerHeight: Math.max(Style.space(22), Style.font.caption + Style.spacing.controlPaddingY)
  property int contentSpacing: Style.spacing.md
  property int cardWidth: Math.min(Style.space(720), panel.width - Style.gapsOut * 2)
  property int cardHeight: Math.min(Style.space(520), panel.height - Style.gapsOut * 2)
  property int rowHeight: Math.max(Style.space(52), Style.font.body + Style.font.caption + Style.spacing.rowPaddingX * 2)

  // FileView needs a filesystem path. Qt.resolvedUrl() returns a URL object
  // here; calling string methods on it throws and leaves the catalog empty.
  readonly property string catalogPath: {
    var dir = (root.manifest && root.manifest.__sourceDir)
      ? String(root.manifest.__sourceDir)
      : (Quickshell.env("HOME") + "/.config/omarchy/plugins/920four.devlinkspad")
    return dir.replace(/\/$/, "") + "/data/services.json"
  }

  function open(payloadJson) {
    var q = ""
    try {
      var payload = JSON.parse(payloadJson || "{}")
      if (payload && payload.q)
        q = String(payload.q)
    } catch (e) {}

    root.opened = true
    root.filterText = q
    root.selectedIndex = 0
    root.cursorActive = true
    root.rebuildDisplay()
    root.refreshLicense()
    Qt.callLater(function() { keyCatcher.forceActiveFocus() })
  }

  function close() {
    root.opened = false
  }

  function dismiss() {
    root.opened = false
    if (root.shell && typeof root.shell.hide === "function")
      root.shell.hide((root.manifest && root.manifest.id) || "920four.devlinkspad")
  }

  function toggle() {
    if (root.opened) root.dismiss()
    else root.open("{}")
  }

  function loadCatalog(raw) {
    root.services = Search.parseCatalog(raw)
    root.rebuildDisplay()
  }

  function rebuildDisplay() {
    var rows = Search.searchCatalog(root.services, root.filterText, 40)
    displayModel.clear()
    for (var i = 0; i < rows.length; i++) {
      displayModel.append({
        title: String(rows[i].title || ""),
        subtitle: String(rows[i].subtitle || ""),
        href: String(rows[i].url || ""),
        serviceName: String(rows[i].serviceName || ""),
        label: String(rows[i].label || "")
      })
    }

    if (displayModel.count === 0) selectedIndex = 0
    else if (selectedIndex >= displayModel.count) selectedIndex = displayModel.count - 1
    else if (selectedIndex < 0) selectedIndex = 0
    cursorActive = displayModel.count > 0

    Qt.callLater(function() {
      if (displayModel.count > 0)
        resultList.positionViewAtIndex(root.selectedIndex, ListView.Contain)
    })
  }

  function setFilter(nextFilter) {
    root.filterText = nextFilter
    root.selectedIndex = 0
    root.cursorActive = true
    root.rebuildDisplay()
  }

  function select(delta) {
    if (displayModel.count === 0) return
    if (!cursorActive) {
      cursorActive = true
      selectedIndex = delta < 0 ? displayModel.count - 1 : 0
    } else {
      selectedIndex = (selectedIndex + delta + displayModel.count) % displayModel.count
    }
    resultList.positionViewAtIndex(selectedIndex, ListView.Contain)
  }

  function selectAbsolute(index) {
    if (displayModel.count === 0) return
    root.cursorActive = true
    root.selectedIndex = Math.max(0, Math.min(index, displayModel.count - 1))
    resultList.positionViewAtIndex(root.selectedIndex, ListView.Contain)
  }

  function activateIndex(index) {
    if (index < 0 || index >= displayModel.count) return
    if (!root.canJump) {
      root.startConnect()
      return
    }
    var row = displayModel.get(index)
    root.openUrl(row.href)
    if (!root.isPro) {
      root.opens += 1
      root.saveState()
    }
  }

  function openUrl(url) {
    if (!url) return
    root.dismiss()
    Quickshell.execDetached(["xdg-open", url])
  }

  function applyState(s) {
    root.deviceId = s.deviceId || ""
    root.licenseToken = s.token || ""
    root.licenseEmail = s.email || ""
    root.isPro = s.isPro === true
    root.opens = s.opens || 0
    root.checkedAt = s.checkedAt || 0
  }

  function saveState() {
    stateFile.setText(License.serializeState({
      deviceId: root.deviceId,
      token: root.licenseToken,
      email: root.licenseEmail,
      isPro: root.isPro,
      opens: root.opens,
      checkedAt: root.checkedAt
    }))
  }

  function randomDeviceId() {
    var hex = "0123456789abcdef"
    var s = ""
    for (var i = 0; i < 40; i++)
      s += hex.charAt(Math.floor(Math.random() * 16))
    return s
  }

  function ensureDeviceId() {
    if (root.deviceId && root.deviceId.length >= 24) return
    root.pendingConnect = true
    randProc.running = true
  }

  function startConnect() {
    if (!root.deviceId || root.deviceId.length < 24) {
      root.ensureDeviceId()
      return
    }
    root.connecting = true
    pollTimer.restart()
    pollDeadline.restart()
    root.httpJson("start", "POST", root.siteUrl + "/api/omarchy/device/start",
                  JSON.stringify({ deviceId: root.deviceId }), "")
  }

  function refreshLicense() {
    if (!root.licenseToken) return
    root.httpJson("license", "GET", root.siteUrl + "/api/omarchy/license", "", root.licenseToken)
  }

  function pollStatus() {
    if (!root.deviceId) return
    root.httpJson("poll", "GET",
                  root.siteUrl + "/api/omarchy/device/status?device=" + root.deviceId, "", "")
  }

  function httpJson(action, method, url, body, token) {
    if (httpProc.running) return
    root.httpAction = action
    var cmd = ["curl", "-sS", "-m", "8", "-X", method, "-H", "Accept: application/json"]
    if (token)
      cmd.push("-H", "Authorization: Bearer " + token)
    if (method === "POST") {
      cmd.push("-H", "Content-Type: application/json")
      cmd.push("-d", body || "{}")
    }
    cmd.push(url)
    httpProc.command = cmd
    httpProc.running = true
  }

  function handleHttp(raw) {
    var action = root.httpAction
    root.httpAction = ""
    var data = License.parseJson(raw)
    if (!data) {
      if (action === "start" && root.deviceId)
        Quickshell.execDetached(["xdg-open", root.siteUrl + "/connect/omarchy?device=" + root.deviceId])
      return
    }

    if (action === "start") {
      if (data.status === "claimed") {
        root.deviceId = root.randomDeviceId()
        root.saveState()
        root.startConnect()
        return
      }
      Quickshell.execDetached(["xdg-open", root.siteUrl + "/connect/omarchy?device=" + root.deviceId])
      return
    }

    if (action === "poll") {
      if (data.status !== "claimed") return
      if (data.token) root.licenseToken = String(data.token)
      root.isPro = data.isPro === true
      if (data.email) root.licenseEmail = String(data.email)
      root.checkedAt = Date.now()
      root.connecting = false
      pollTimer.stop()
      pollDeadline.stop()
      root.saveState()
      return
    }

    if (action === "license") {
      root.isPro = data.isPro === true
      if (data.email) root.licenseEmail = String(data.email)
      root.checkedAt = Date.now()
      root.saveState()
    }
  }

  readonly property string footerCtaLabel: {
    if (root.connecting) return "Waiting for sign-in…"
    if (root.isPro) return "Pro · unlimited"
    return "Unlimited use · $5/yr"
  }

  ListModel { id: displayModel }

  FileView {
    path: root.catalogPath
    preload: true
    watchChanges: true
    onLoaded: root.loadCatalog(text())
    onLoadFailed: function(error) {
      console.warn("devlinkspad: catalog load failed:", error, "path=" + root.catalogPath)
      root.loadCatalog("[]")
    }
    onFileChanged: reload()
  }

  FileView {
    id: stateFile
    path: root.statePath
    preload: true
    watchChanges: true
    atomicWrites: true
    printErrors: false
    onLoaded: root.applyState(License.parseState(text()))
    onLoadFailed: root.applyState(License.emptyState())
    onFileChanged: reload()
  }

  Process {
    id: mkdirProc
    command: ["mkdir", "-p", Quickshell.env("HOME") + "/.local/state/omarchy"]
  }

  Process {
    id: randProc
    command: ["openssl", "rand", "-hex", "20"]
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: {
        var id = String(text).trim()
        if (id.length < 24) return
        root.deviceId = id
        root.saveState()
        if (root.pendingConnect) {
          root.pendingConnect = false
          root.startConnect()
        }
      }
    }
    onExited: function(code) {
      if (root.deviceId && root.deviceId.length >= 24) return
      root.deviceId = root.randomDeviceId()
      root.saveState()
      if (root.pendingConnect) {
        root.pendingConnect = false
        root.startConnect()
      }
    }
  }

  Process {
    id: httpProc
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: root.handleHttp(text)
    }
  }

  Timer {
    id: pollTimer
    interval: 2000
    repeat: true
    onTriggered: root.pollStatus()
  }

  Timer {
    id: pollDeadline
    interval: 300000
    repeat: false
    onTriggered: {
      pollTimer.stop()
      root.connecting = false
    }
  }

  Component.onCompleted: mkdirProc.running = true

  PanelWindow {
    id: panel
    visible: root.opened
    anchors { top: true; bottom: true; left: true; right: true }
    color: "transparent"
    WlrLayershell.namespace: "devlinkspad"
    WlrLayershell.layer: WlrLayer.Overlay
    WlrLayershell.keyboardFocus: WlrKeyboardFocus.Exclusive
    exclusionMode: ExclusionMode.Ignore

    Rectangle {
      anchors.fill: parent
      color: root.scrim
    }

    MouseArea {
      anchors.fill: parent
      onClicked: root.dismiss()
    }

    BorderSurface {
      id: card
      width: root.cardWidth
      height: root.cardHeight
      radius: root.cornerRadius
      anchors.centerIn: parent
      color: root.background
      borderSpec: root.borderSpec
      padding: root.contentMargin

      MouseArea { anchors.fill: parent; onClicked: {} }

      Item {
        id: keyCatcher
        anchors.fill: parent
        focus: true

        Keys.priority: Keys.BeforeItem
        Keys.onPressed: function(event) {
          if (event.key === Qt.Key_Escape) {
            if (root.filterText) root.setFilter("")
            else root.dismiss()
            event.accepted = true
          } else if (Util.editsFilter(event, root.filterText)) {
            root.setFilter(Util.editedFilter(event, root.filterText))
            event.accepted = true
          } else if (event.key === Qt.Key_Up) {
            root.select(-1)
            event.accepted = true
          } else if (event.key === Qt.Key_Down) {
            root.select(1)
            event.accepted = true
          } else if (event.key === Qt.Key_PageUp) {
            root.select(-8)
            event.accepted = true
          } else if (event.key === Qt.Key_PageDown) {
            root.select(8)
            event.accepted = true
          } else if (event.key === Qt.Key_Home) {
            root.selectAbsolute(0)
            event.accepted = true
          } else if (event.key === Qt.Key_End) {
            root.selectAbsolute(displayModel.count - 1)
            event.accepted = true
          } else if (event.key === Qt.Key_Return || event.key === Qt.Key_Enter) {
            if (root.cursorActive) root.activateIndex(root.selectedIndex)
            else if (displayModel.count > 0) root.cursorActive = true
            event.accepted = true
          } else if (event.text && event.text.length === 1 && event.text.charCodeAt(0) >= 32 && event.text.charCodeAt(0) !== 127) {
            root.setFilter(root.filterText + event.text)
            event.accepted = true
          }
        }
      }

      Column {
        anchors.fill: parent
        anchors.topMargin: card.contentTopInset
        anchors.rightMargin: card.contentRightInset
        anchors.bottomMargin: card.contentBottomInset
        anchors.leftMargin: card.contentLeftInset
        spacing: root.contentSpacing

        Rectangle {
          width: parent.width
          height: root.headerHeight
          radius: root.cornerRadius
          color: "transparent"

          Text {
            anchors.left: parent.left
            anchors.right: parent.right
            anchors.verticalCenter: parent.verticalCenter
            text: root.filterText || "Search dashboards… stripe webhook, apple team id, vercel tokens"
            color: root.foreground
            opacity: root.filterText ? 1 : 0.58
            font.family: root.fontFamily
            font.pixelSize: Style.font.heading
            elide: Text.ElideRight
          }
        }

        Rectangle {
          width: parent.width
          height: root.isPro ? 0 : root.ctaHeight
          visible: !root.isPro
          radius: root.cornerRadius
          color: root.selectedBackground

          Text {
            anchors.fill: parent
            anchors.leftMargin: Style.space(12)
            anchors.rightMargin: Style.space(12)
            text: root.connecting
                  ? "Waiting for sign-in in your browser…"
                  : (root.canJump
                    ? "Unlimited use · $5/yr"
                    : "Free jumps used · Unlimited use · $5/yr")
            color: root.selectedText
            font.family: root.fontFamily
            font.pixelSize: Style.font.caption
            font.bold: true
            verticalAlignment: Text.AlignVCenter
            elide: Text.ElideRight
          }

          MouseArea {
            anchors.fill: parent
            cursorShape: Qt.PointingHandCursor
            onClicked: root.startConnect()
          }
        }

        Item {
          width: parent.width
          height: parent.height - root.headerHeight - root.footerHeight - root.ctaHeight
                  - root.contentSpacing * (root.isPro ? 2 : 3)

          ListView {
            id: resultList
            anchors.fill: parent
            model: displayModel
            clip: true
            spacing: Style.space(4)
            boundsBehavior: Flickable.StopAtBounds
            visible: displayModel.count > 0

            delegate: Rectangle {
              id: row
              required property int index
              required property string title
              required property string subtitle
              required property string href

              readonly property bool hasCursor: root.cursorActive && index === root.selectedIndex

              width: ListView.view.width
              height: root.rowHeight
              radius: root.cornerRadius
              color: hasCursor ? root.selectedBackground : "transparent"

              Column {
                anchors.fill: parent
                anchors.leftMargin: Style.space(12)
                anchors.rightMargin: Style.space(12)
                anchors.topMargin: Style.space(8)
                anchors.bottomMargin: Style.space(8)
                spacing: Style.space(2)

                Text {
                  width: parent.width
                  text: row.title
                  color: row.hasCursor ? root.selectedText : root.foreground
                  font.family: root.fontFamily
                  font.pixelSize: Style.font.title
                  elide: Text.ElideRight
                }

                Text {
                  width: parent.width
                  text: row.subtitle
                  color: row.hasCursor ? root.selectedText : root.foreground
                  opacity: 0.62
                  font.family: root.fontFamily
                  font.pixelSize: Style.font.caption
                  elide: Text.ElideMiddle
                }
              }

              MouseArea {
                anchors.fill: parent
                hoverEnabled: true
                cursorShape: Qt.PointingHandCursor
                onContainsMouseChanged: if (containsMouse) {
                  root.cursorActive = true
                  root.selectedIndex = row.index
                }
                onClicked: {
                  root.cursorActive = true
                  root.selectedIndex = row.index
                  root.activateIndex(row.index)
                }
              }
            }
          }

          Column {
            anchors.centerIn: parent
            spacing: Style.space(8)
            visible: displayModel.count === 0

            Text {
              text: "⌘"
              color: root.selectedText
              opacity: 0.8
              font.family: root.fontFamily
              font.pixelSize: Style.font.displayLarge
              horizontalAlignment: Text.AlignHCenter
              width: parent.width
            }

            Text {
              text: root.services.length === 0
                ? "Catalog missing — check data/services.json"
                : "No matches for “" + root.filterText + "”"
              color: root.foreground
              opacity: 0.7
              font.family: root.fontFamily
              font.pixelSize: Style.font.title
              horizontalAlignment: Text.AlignHCenter
              width: parent.width
            }
          }
        }

        Item {
          width: parent.width
          height: root.footerHeight

          Text {
            anchors.left: parent.left
            anchors.right: footerCta.left
            anchors.rightMargin: Style.space(12)
            anchors.verticalCenter: parent.verticalCenter
            text: displayModel.count + " result" + (displayModel.count === 1 ? "" : "s")
                  + " · " + root.services.length + " tools"
                  + (root.isPro || root.remainingOpens <= 0
                    ? ""
                    : " · " + root.remainingOpens + " left")
            color: root.foreground
            opacity: 0.5
            font.family: root.fontFamily
            font.pixelSize: Style.font.caption
            elide: Text.ElideRight
          }

          Text {
            id: footerCta
            anchors.right: parent.right
            anchors.verticalCenter: parent.verticalCenter
            text: root.footerCtaLabel
            color: root.isPro ? root.foreground : root.selectedText
            opacity: root.isPro ? 0.5 : 0.9
            font.family: root.fontFamily
            font.pixelSize: Style.font.caption
            font.bold: !root.isPro

            MouseArea {
              anchors.fill: parent
              cursorShape: Qt.PointingHandCursor
              onClicked: {
                if (!root.isPro) root.startConnect()
              }
            }
          }
        }
      }
    }
  }
}
