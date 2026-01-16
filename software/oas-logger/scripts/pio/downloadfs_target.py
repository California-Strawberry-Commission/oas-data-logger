# This script provides functions to download the filesystem (LittleFS) from a running ESP32 or
# ESP8266 over the serial bootloader using esptool.py and littlefs-python.
#
# Adds a VS Code PlatformIO project task "Custom" -> "Download Filesystem".
# Alternatively, it can be run via 'pio run -t downloadfs' from the commandline.
#
# The output will be saved, by default, in the "unpacked_fs" of the project. This can be configured
# by setting 'custom_unpack_dir = some_other_dir' in the corresponding platformio.ini environment.

import os
import re
import shutil
import subprocess
from enum import Enum
from os.path import join
from pathlib import Path

from colorama import Fore
from littlefs import LittleFS

Import("env")

platform = env["PIOPLATFORM"]
board = env.BoardConfig()
mcu = board.get("build.mcu", "esp32").lower()


class FSType(Enum):
    LITTLEFS = "littlefs"


class FSInfo:
    def __init__(self, fs_type, start, length, page_size, block_size):
        self.fs_type = fs_type
        self.start = start
        self.length = length
        self.page_size = page_size
        self.block_size = block_size

    def __repr__(self):
        return f"FS type {self.fs_type} Start {hex(self.start)} Len {self.length} Page size {self.page_size} Block size {self.block_size}"


class FS_Info(FSInfo):
    def __init__(self, start, length, page_size, block_size):
        super().__init__(FSType.LITTLEFS, start, length, page_size, block_size)

    def __repr__(self):
        return f"{self.fs_type} Start {hex(self.start)} Len {hex(self.length)} Page size {hex(self.page_size)} Block size {hex(self.block_size)}"


def _parse_size(value):
    if isinstance(value, int):
        return value
    elif value.isdigit():
        return int(value)
    elif value.startswith("0x"):
        return int(value, 16)
    elif value[-1].upper() in ("K", "M"):
        base = 1024 if value[-1].upper() == "K" else 1024 * 1024
        return int(value[:-1]) * base
    return value


def _parse_ld_sizes(ldscript_path):
    assert ldscript_path
    result = {}
    # Get flash size from LD script path
    match = re.search(r"\.flash\.(\d+[mk]).*\.ld", ldscript_path)
    if match:
        result["flash_size"] = _parse_size(match.group(1))

    appsize_re = re.compile(r"irom0_0_seg\s*:.+len\s*=\s*(0x[\da-f]+)", flags=re.I)
    filesystem_re = re.compile(
        (
            r"PROVIDE\s*\(\s*_%s_(\w+)\s*=\s*(0x[\da-f]+)\s*\)" % "FS"
            if "arduino" in env.subst("$PIOFRAMEWORK")
            else "SPIFFS"
        ),
        flags=re.I,
    )
    with open(ldscript_path) as fp:
        for line in fp.readlines():
            line = line.strip()
            if not line or line.startswith("/*"):
                continue
            match = appsize_re.search(line)
            if match:
                result["app_size"] = _parse_size(match.group(1))
                continue
            match = filesystem_re.search(line)
            if match:
                result["fs_%s" % match.group(1)] = _parse_size(match.group(2))
    return result


def esp8266_fetch_fs_size(env):
    ldsizes = _parse_ld_sizes(env.GetActualLDScript())
    for key in ldsizes:
        if key.startswith("fs_"):
            env[key.upper()] = ldsizes[key]

    assert all([k in env for k in ["FS_START", "FS_END", "FS_PAGE", "FS_BLOCK"]])

    # esptool flash starts from 0
    for k in ("FS_START", "FS_END"):
        _value = 0
        if env[k] < 0x40300000:
            _value = env[k] & 0xFFFFF
        elif env[k] < 0x411FB000:
            _value = env[k] & 0xFFFFFF
            _value -= 0x200000  # correction
        else:
            _value = env[k] & 0xFFFFFF
            _value += 0xE00000  # correction

        env[k] = _value


def parse_partition_table(content):
    entries = [e for e in content.split(b"\xaaP") if len(e) > 0]
    for entry in entries:
        type = entry[1]
        if type in [0x82, 0x83]:  # SPIFFS or LITTLEFS
            offset = int.from_bytes(entry[2:6], byteorder="little", signed=False)
            size = int.from_bytes(entry[6:10], byteorder="little", signed=False)
            env["FS_START"] = offset
            env["FS_SIZE"] = size
            env["FS_PAGE"] = int("0x100", 16)
            env["FS_BLOCK"] = int("0x1000", 16)


def get_partition_table():
    upload_port = join(env.get("UPLOAD_PORT", "none"))
    download_speed = join(str(board.get("download.speed", "115200")))
    if "none" in upload_port:
        env.AutodetectUploadPort()
        upload_port = join(env.get("UPLOAD_PORT", "none"))
        build_dir = env.subst("$BUILD_DIR")
        if not os.path.exists(build_dir):
            os.makedirs(build_dir)
    fs_file = join(env.subst("$BUILD_DIR"), "partition_table_from_flash.bin")
    esptool_flags = [
        "--chip",
        mcu,
        "--port",
        upload_port,
        "--baud",
        download_speed,
        "--before",
        "default_reset",
        "--after",
        "hard_reset",
        "read_flash",
        "0x8000",
        "0x1000",
        fs_file,
    ]
    ESPTOOL_EXE = (
        env.get("ERASETOOL") if platform == "espressif8266" else env.get("OBJCOPY")
    )
    esptool_cmd = [ESPTOOL_EXE] + esptool_flags
    try:
        returncode = subprocess.call(esptool_cmd, shell=False)
    except subprocess.CalledProcessError as exc:
        print("Downloading failed with " + str(exc))
    with open(fs_file, mode="rb") as file:
        content = file.read()
        parse_partition_table(content)


def get_fs_type_start_and_length():
    if platform == "espressif32":
        print(f"Retrieving filesystem info for {mcu}.")
        get_partition_table()
        return FS_Info(env["FS_START"], env["FS_SIZE"], env["FS_PAGE"], env["FS_BLOCK"])
    elif platform == "espressif8266":
        print("Retrieving filesystem info for ESP8266.")
        filesystem = board.get("build.filesystem", "littlefs")
        if filesystem not in ("littlefs"):
            print(
                "Unrecognized board_build.filesystem option '" + str(filesystem) + "'."
            )
            env.Exit(1)
        # Fetching sizes is the same for all filesystems
        esp8266_fetch_fs_size(env)
        # print("FS_START: " + hex(env["FS_START"]))
        # print("FS_SIZE: " + hex(env["FS_END"] - env["FS_START"]))
        # print("FS_PAGE: " + hex(env["FS_PAGE"]))
        # print("FS_BLOCK: " + hex(env["FS_BLOCK"]))
        if filesystem == "littlefs":
            print("Recognized LittleFS filesystem.")
            return FS_Info(
                env["FS_START"],
                env["FS_END"] - env["FS_START"],
                env["FS_PAGE"],
                env["FS_BLOCK"],
            )
        else:
            print("Unrecongized configuration.")
    pass


def download_fs(fs_info: FSInfo):
    print(fs_info)
    upload_port = join(env.get("UPLOAD_PORT", "none"))
    download_speed = join(str(board.get("download.speed", "115200")))
    if "none" in upload_port:
        env.AutodetectUploadPort()
        upload_port = join(env.get("UPLOAD_PORT", "none"))
    fs_file = join(
        env.subst("$BUILD_DIR"),
        f"downloaded_fs_{hex(fs_info.start)}_{hex(fs_info.length)}.bin",
    )
    esptool_flags = [
        "--chip",
        mcu,
        "--port",
        upload_port,
        "--baud",
        download_speed,
        "--before",
        "default_reset",
        "--after",
        "hard_reset",
        "read_flash",
        hex(fs_info.start),
        hex(fs_info.length),
        fs_file,
    ]
    ESPTOOL_EXE = (
        env.get("ERASETOOL") if platform == "espressif8266" else env.get("OBJCOPY")
    )
    esptool_cmd = [ESPTOOL_EXE] + esptool_flags
    print("Download filesystem image")
    try:
        returncode = subprocess.call(esptool_cmd, shell=False)
        return (True, fs_file)
    except subprocess.CalledProcessError as exc:
        print("Downloading failed with " + str(exc))
        return (False, "")


def unpack_fs(fs_info: FSInfo, downloaded_file: str):
    unpack_dir = env.GetProjectOption("custom_unpack_dir", "unpacked_fs")
    current_build_dir = env.subst("$BUILD_DIR")
    filename = f"downloaded_fs_{hex(fs_info.start)}_{hex(fs_info.length)}.bin"
    downloaded_file = join(current_build_dir, filename)
    if not os.path.exists(downloaded_file):
        print(
            f"ERROR: {downloaded_file} with filesystem not found, maybe download failed due to download_speed setting being too high."
        )
        assert 0
    try:
        if os.path.exists(unpack_dir):
            shutil.rmtree(unpack_dir)
    except Exception as exc:
        print(
            "Exception while attempting to remove the folder '"
            + str(unpack_dir)
            + "': "
            + str(exc)
        )
    if not os.path.exists(unpack_dir):
        os.makedirs(unpack_dir)

    print()
    try:
        # Read the downloaded filesystem image
        with open(downloaded_file, "rb") as f:
            fs_data = f.read()

        # Calculate block count
        block_count = fs_info.length // fs_info.block_size

        # Create LittleFS instance and mount the image
        fs = LittleFS(
            block_size=fs_info.block_size, block_count=block_count, mount=False
        )
        fs.context.buffer = bytearray(fs_data)
        fs.mount()

        # Extract all files
        unpack_path = Path(unpack_dir)
        for root, dirs, files in fs.walk("/"):
            if not root.endswith("/"):
                root += "/"
            # Create directories
            for dir_name in dirs:
                src_path = root + dir_name
                dst_path = unpack_path / src_path[1:]  # Remove leading '/'
                dst_path.mkdir(parents=True, exist_ok=True)
            # Extract files
            for file_name in files:
                src_path = root + file_name
                dst_path = unpack_path / src_path[1:]  # Remove leading '/'
                dst_path.parent.mkdir(parents=True, exist_ok=True)
                with fs.open(src_path, "rb") as src:
                    dst_path.write_bytes(src.read())

        fs.unmount()
        return (True, unpack_dir)
    except Exception as exc:
        print("Unpacking filesystem with littlefs-python failed with " + str(exc))
        return (False, "")


def display_fs(extracted_dir):
    # List all extracted files
    file_count = 0
    print(Fore.GREEN + "Extracted files from filesystem image:")
    print()
    for root, dirs, files in os.walk(extracted_dir):
        # Display directories
        for dir_name in dirs:
            dir_path = os.path.join(root, dir_name)
            rel_path = os.path.relpath(dir_path, extracted_dir)
            print(f"  [DIR]  {rel_path}/")
        # Display files
        for file_name in files:
            file_path = os.path.join(root, file_name)
            rel_path = os.path.relpath(file_path, extracted_dir)
            file_size = os.path.getsize(file_path)
            print(f"  [FILE] {rel_path} ({file_size} bytes)")
            file_count += 1
    print(f"\nExtracted {file_count} file(s) from filesystem.")


def command_download_fs(*args, **kwargs):
    fs_info = get_fs_type_start_and_length()
    download_ok, downloaded_file = download_fs(fs_info)
    unpack_ok, unpacked_dir = unpack_fs(fs_info, downloaded_file)
    if unpack_ok is True:
        display_fs(unpacked_dir)


# Custom Target Definitions
env.AddCustomTarget(
    name="downloadfs",
    dependencies=None,
    actions=[command_download_fs],
    title="Download Filesystem",
    description="Downloads and displays files stored in the target ESP32/ESP8266",
)
