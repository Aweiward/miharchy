import QtQuick
import Quickshell
import Quickshell.Io
import "Images.js" as Images
import "Model.js" as Model
import "Session.js" as Session

// An Image that loads the server's own images with the access token.
// Image sends no headers, so Session.image fetches the bytes into a file in
// $XDG_RUNTIME_DIR and the Image shows that file. Images.js shares one file
// per URL between instances. Any other host loads as a plain Image, without
// the token.
Image {
  id: image

  property var config: null
  property string url: ""
  // The fetch or the file write failed, or the image did not decode.
  readonly property bool failed: fetchFailed || status === Image.Error
  property bool fetchFailed: false
  // The file the bytes sit in and their Content-Type, once a server image
  // loads: what the reader saves and copies.
  property string filePath: ""
  property string contentType: ""
  // The Images.js copy this instance holds, and whether that copy may stay
  // idle once this instance lets go: the reader's pages may not.
  property var held: null
  property bool keepIdle: true
  property bool writeFailed: false
  readonly property string dir: Quickshell.env("XDG_RUNTIME_DIR") + "/miharchy/images/"

  onUrlChanged: Qt.callLater(load)
  onConfigChanged: Qt.callLater(load)
  // At once, so a held copy shows in the delegate's first frame.
  Component.onCompleted: load()
  Component.onDestruction: release(held)

  FileView {
    id: file
    preload: false
    blockWrites: true
    printErrors: false
    onSaveFailed: image.writeFailed = true
  }

  function show(path, type) {
    filePath = path
    contentType = type
    source = "file://" + path
  }

  function fail() {
    fetchFailed = true
  }

  // FileView skips a write of the bytes it already holds: clear them first,
  // or a second fetch of one URL would write nothing.
  function write(path, data) {
    writeFailed = false
    file.path = path
    file.setText("")
    file.setData(data)
    return !writeFailed
  }

  // FileView skips a write of the text it already holds, and this one may
  // never have written this file.
  function empty(path) {
    file.path = path
    file.setText(" ")
    file.setText("")
  }

  function release(copy) {
    if (copy) Images.release(Images.shared(dir, Quickshell.processId), copy, image, keepIdle)
  }

  // The new copy is held before the old one goes, so a reload of the same
  // URL keeps its file.
  function load() {
    var old = held
    held = null
    source = ""
    filePath = ""
    contentType = ""
    fetchFailed = false
    var server = Model.serverImageUrl(config, url)
    if (!server) source = url
    else {
      var c = config
      held = Images.hold(Images.shared(dir, Quickshell.processId), server, image, function(u, done) { Session.image(c, u, done) })
    }
    release(old)
  }
}
