"""Check final debug/release manifests and the debug APK, without installing it.

Run with JAVA_HOME and ANDROID_HOME set:
python3 scripts/check-android-permissions.py DEBUG_MANIFEST RELEASE_MANIFEST DEBUG_APK
Use app/build/intermediates/packaged_manifests/<variant>/process<Variant>ManifestForPackage/AndroidManifest.xml.
"""

import os
from pathlib import Path
import subprocess
import sys
import xml.etree.ElementTree as ET


ANDROID = "{http://schemas.android.com/apk/res/android}"
PACKAGE = "com.palyuksa.palyuksa"
RECEIVER_PERMISSION = PACKAGE + ".DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION"


def check_manifest(root, debug, label):
    expected = {"android.permission.NFC", RECEIVER_PERMISSION}
    if debug:
        expected.update({"android.permission.INTERNET", "android.permission.SYSTEM_ALERT_WINDOW"})
    permissions = {
        element.get(ANDROID + "name")
        for element in root
        if element.tag in {"uses-permission", "uses-permission-sdk-23"}
    }
    assert permissions == expected, (label, "permissions", permissions, expected)
    assert root.get("package") == PACKAGE, label
    assert root.get(ANDROID + "versionCode") == "4", label
    assert root.get(ANDROID + "versionName") == "1.0.0", label
    sdk = root.find("uses-sdk")
    assert sdk.get(ANDROID + "minSdkVersion") == "24", label
    assert sdk.get(ANDROID + "targetSdkVersion") == "36", label
    permission = root.find(f"permission[@{ANDROID}name='{RECEIVER_PERMISSION}']")
    assert permission is not None, label
    # APK binary XML renders Android enum/flag values numerically.
    assert permission.get(ANDROID + "protectionLevel") in {"signature", "0x2"}, label
    feature = root.find(f"uses-feature[@{ANDROID}name='android.hardware.nfc']")
    assert feature is not None and feature.get(ANDROID + "required") == "false", label
    app = root.find("application")
    assert app.get(ANDROID + "name") == PACKAGE + ".MainApplication", label
    assert (app.get(ANDROID + "debuggable") == "true") == debug, label
    assert (app.get(ANDROID + "usesCleartextTraffic") == "true") == debug, label
    updates = app.find(f"meta-data[@{ANDROID}name='expo.modules.updates.ENABLED']")
    assert updates is not None and updates.get(ANDROID + "value") == "false", label
    activity = app.find(f"activity[@{ANDROID}name='{PACKAGE}.MainActivity']")
    assert activity is not None, label
    for name, values in {
        "enableOnBackInvokedCallback": {"false"}, "exported": {"true"},
        "launchMode": {"singleTask", "2"}, "screenOrientation": {"portrait", "1"},
        "windowSoftInputMode": {"adjustResize", "0x10"},
    }.items():
        assert activity.get(ANDROID + name) in values, (label, name)
    filters = []
    for intent in activity.findall("intent-filter"):
        filters.append((
            {e.get(ANDROID + "name") for e in intent.findall("action")},
            {e.get(ANDROID + "name") for e in intent.findall("category")},
            {e.get(ANDROID + "scheme") for e in intent.findall("data")},
        ))
    assert len(filters) == 2, label
    assert ({"android.intent.action.MAIN"}, {"android.intent.category.LAUNCHER"}, set()) in filters, label
    assert ({"android.intent.action.VIEW"}, {
        "android.intent.category.DEFAULT", "android.intent.category.BROWSABLE",
    }, {PACKAGE}) in filters, label
    actions = {e.get(ANDROID + "name") for e in root.findall(".//action")}
    assert not actions.intersection({
        "android.nfc.action.NDEF_DISCOVERED", "android.nfc.action.TECH_DISCOVERED",
        "android.nfc.action.TAG_DISCOVERED",
    }), label
    dev = app.find(f"activity[@{ANDROID}name='com.facebook.react.devsupport.DevSettingsActivity']")
    assert (dev is not None) == debug, label
    print(f"PASS: {label}: {', '.join(sorted(permissions))}; SDK/activity/intents/development settings")


if __name__ == "__main__":
    assert len(sys.argv) == 4, __doc__
    for filename, debug in zip(sys.argv[1:3], (True, False)):
        check_manifest(ET.parse(filename).getroot(), debug, filename)
    analyzer = Path(os.environ["ANDROID_HOME"]) / "cmdline-tools/latest/bin/apkanalyzer"
    result = subprocess.run(
        [str(analyzer), "manifest", "print", sys.argv[3]],
        check=True, capture_output=True, text=True,
    )
    check_manifest(ET.fromstring(result.stdout), True, sys.argv[3])
