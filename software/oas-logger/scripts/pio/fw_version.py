"""
Allows the firmware build identity to be injected via environment variables.
When a variable is set, it replaces the corresponding -D flag from platformio.ini.
"""

import os
import re

Import("env")

# Name -> whether the value is a string literal
OVERRIDABLE = {
    "FW_BUILD_NUMBER": False,
    "FW_VERSION": True,
    "OTA_CHANNEL": True,
    "FW_GIT_HASH": True,
}


def define_flag(name, value, quoted):
    return '-D%s=\\"%s\\"' % (name, value) if quoted else "-D%s=%s" % (name, value)


overrides = {name: os.environ[name] for name in OVERRIDABLE if os.environ.get(name)}
overrides.setdefault("FW_GIT_HASH", "dev")

pattern = re.compile(r"-D(%s)=\S*" % "|".join(overrides))
flags = [pattern.sub("", flag).strip() for flag in env.get("BUILD_FLAGS", [])]
flags = [flag for flag in flags if flag]
flags += [
    define_flag(name, value, OVERRIDABLE[name]) for name, value in overrides.items()
]
env.Replace(BUILD_FLAGS=flags)

print(
    "Firmware identity overrides: "
    + ", ".join("%s=%s" % (name, value) for name, value in overrides.items())
)
