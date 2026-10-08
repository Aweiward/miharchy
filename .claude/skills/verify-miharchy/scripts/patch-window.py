#!/usr/bin/env python3
# Turns a copy of window/ into one a verify run drives:
#   patch-window.py <window dir> <steps.js> <evidence dir>
# Setup probes the real machine (systemd unit, Java, ...) and jumps to Setup
# when a step is due; the one-time offer also writes meta. Verification wants
# the view it drives, so both jumps are off. The driver (driver.qml.part, with
# the steps) goes at the end of shell.qml.
import os, sys
win, steps, ev = sys.argv[1:]
part = os.path.join(os.path.dirname(os.path.abspath(__file__)), "driver.qml.part")

def patch(path, old, new):
    s = open(path).read()
    assert old in s, f"{os.path.basename(path)} no longer holds {old!r}; update patch-window.py"
    open(path, "w").write(s.replace(old, new, 1))

patch(f"{win}/SetupView.qml", "  function offer() {\n", "  function offer() {\n    return\n")
patch(f"{win}/shell.qml", 'onNeeded: if (root.view === "library") root.view = "setup"', "onNeeded: {}")
# The driver's click(), dblclick() and wheel() send real mouse events through QtTest's TestEvent.
patch(f"{win}/shell.qml", "import QtQuick\n", "import QtQuick\nimport QtTest\n")
s = open(f"{win}/shell.qml").read()
d = open(part).read().replace("@EVIDENCE@", ev).replace("@STEPS@", open(steps).read())
i = s.rindex("}")
open(f"{win}/shell.qml", "w").write(s[:i] + d + s[i:])
