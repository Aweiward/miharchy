import QtQuick
import Quickshell
import Quickshell.Io
import "Model.js" as Model
import "Session.js" as Session

// An Image that loads the server's own images with the access token.
// Image sends no headers, so Session.image fetches the bytes into a file in
// $XDG_RUNTIME_DIR and the Image shows that file. Any other host loads as a
// plain Image, without the token.
Image {
  id: image

  property var config: null
  property string url: ""
  // The fetch or the file write failed, or the image did not decode.
  readonly property bool failed: fetchFailed || status === Image.Error
  property bool fetchFailed: false
  // The file the bytes sit in and their Content-Type, once a server image
  // loads: what the reader saves and copies.
  readonly property string filePath: source.toString() !== "" && file.path ? file.path : ""
  property string contentType: ""
  // Each instance writes its own files, so a file only ever holds one URL's
  // bytes and the pixmap cache, keyed by file URL, never shows stale ones.
  readonly property string key: Math.random().toString(36).slice(2)
  readonly property string dir: Quickshell.env("XDG_RUNTIME_DIR") + "/miharchy/images/"

  onUrlChanged: Qt.callLater(load)
  onConfigChanged: Qt.callLater(load)
  Component.onCompleted: Qt.callLater(load)
  Component.onDestruction: release()

  FileView {
    id: file
    preload: false
    blockWrites: true
    printErrors: false
    onSaveFailed: image.fetchFailed = true
  }

  // The runtime dir is RAM, so a file is emptied once its image leaves:
  // a long read keeps only the pages on screen.
  function release() {
    if (!file.path) return
    file.setText("")
    file.path = ""
  }

  function load() {
    source = ""
    fetchFailed = false
    release()
    var server = Model.serverImageUrl(config, url)
    if (!server) {
      source = url
      return
    }
    var wanted = url
    Session.image(config, server, function(r) {
      // A grid change may destroy this image before its bytes arrive.
      if (!image || wanted !== image.url) return
      if (r.status !== 200) {
        image.fetchFailed = true
        return
      }
      file.path = image.dir + image.key + "-" + Qt.md5(server)
      file.setData(r.data)
      image.contentType = r.contentType
      if (!image.fetchFailed) image.source = "file://" + file.path
    })
  }
}
