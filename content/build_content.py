#!/usr/bin/env python3
"""Build a trimmed OpenArena content set for the browser client.

The full OpenArena data is ~400 MB, far too much for a phone. This script
resolves the virtual filesystem of the stock pk3s and writes:

  <out>/baseoa/pak0-web.pk3        shared core: game code, weapons, items, UI,
                                   sounds and a handful of player models
  <out>/baseoa/map-<name>.pk3      per map: the BSP, its levelshot and only the
                                   textures that map's surfaces reference
  <out>/manifest.json              file list with sizes, read by the play page

The dedicated server does not use this output; it reads the stock pk3s.

Usage: build_content.py <openarena baseoa dir> <out dir>
"""
import glob
import hashlib
import io
import json
import os
import re
import struct
import sys
import zipfile

MAPS = {
    "wrackdm17":  {"title": "Wrack DM17", "note": "Longest Yard remake: floating platforms in space", "players": 6},
    "q3dm6ish":   {"title": "Campgrounds-ish", "note": "Remake of the classic q3dm6", "players": 8},
    "dm4ish":     {"title": "DM4-ish", "note": "Tight arena remake", "players": 6},
    "aggressor":  {"title": "Aggressor", "note": "Fast mid-sized arena", "players": 8},
    "oa_dm1":     {"title": "Ancient Ruins", "note": "OpenArena DM1, good for beginners", "players": 6},
    "kaos2":      {"title": "Kaos 2", "note": "Vertical gothic arena", "players": 8},
    "oa_rpg3dm2": {"title": "Tempered Graveyard", "note": "Large outdoor graveyard", "players": 10},
    "am_thornish":{"title": "Thornish", "note": "Compact arena with jump pads", "players": 6},
}

# Player models shipped to the browser. Bots using other models fall back
# to the default model (sarge) in OpenArena's cgame.
PLAYER_MODELS = {"sarge", "tony", "major", "grism", "liz"}

ALL_PLAYER_MODELS = set()  # filled from the pk3s

IMAGE_EXTS = (".tga", ".jpg", ".jpeg", ".png")

# Shipped only when a chosen map or the game code references the file.
SELECTIVE_PREFIXES = ("sound/world/", "sound/feedback/", "models/mapobjects/")

# Top-level paths never shipped to the browser.
DROP_PREFIXES = (
    "music/", "video/", "demos/", "glsl/", "sound/teamplay/",
    "maps/", "levelshots/", "textures/", "env/",
)


def load_vfs(baseoa):
    """Return {lowercase path: (pk3 path, real name)}; later pk3s win."""
    vfs = {}
    for pk3 in sorted(glob.glob(os.path.join(baseoa, "*.pk3"))):
        if "mature" in os.path.basename(pk3):
            continue
        with zipfile.ZipFile(pk3) as z:
            for info in z.infolist():
                if not info.is_dir():
                    vfs[info.filename.lower()] = (pk3, info.filename)
    return vfs


_zips = {}


def read(vfs, path):
    pk3, name = vfs[path]
    if pk3 not in _zips:
        _zips[pk3] = zipfile.ZipFile(pk3)
    return _zips[pk3].read(name)


def strip_ext(p):
    return re.sub(r"\.(tga|jpg|jpeg|png)$", "", p.lower())


def find_image(vfs, p):
    base = strip_ext(p)
    for ext in IMAGE_EXTS:
        if base + ext in vfs:
            return base + ext
    return None


def parse_shaders(vfs):
    """Return {shader name: set of image paths it references}."""
    shaders = {}
    for path in vfs:
        if not (path.startswith("scripts/") and path.endswith(".shader")):
            continue
        text = read(vfs, path).decode("latin-1")
        text = re.sub(r"//[^\n]*", "", text)
        tokens = re.findall(r"[{}]|[^\s{}]+", text)
        i, depth, name = 0, 0, None
        while i < len(tokens):
            t = tokens[i]
            if t == "{":
                depth += 1
            elif t == "}":
                depth -= 1
                if depth == 0:
                    name = None
            elif depth == 0:
                name = t.lower()
                shaders.setdefault(name, set())
            elif name:
                kw = t.lower()
                if kw in ("map", "clampmap", "videomap") and i + 1 < len(tokens):
                    shaders[name].add(tokens[i + 1].lower())
                elif kw == "animmap":
                    j = i + 2
                    while j < len(tokens) and tokens[j] not in "{}" and "/" in tokens[j]:
                        shaders[name].add(tokens[j].lower())
                        j += 1
                elif kw == "skyparms" and i + 1 < len(tokens) and tokens[i + 1] != "-":
                    for side in ("rt", "bk", "lf", "ft", "up", "dn"):
                        shaders[name].add(f"{tokens[i + 1].lower()}_{side}")
            i += 1
    return shaders


def shader_images(vfs, shaders, name):
    """Images needed to draw shader `name` (or the implicit image of that name)."""
    name = strip_ext(name.lower())
    out = set()
    refs = shaders.get(name)
    if refs is None:
        refs = {name}
    for r in refs:
        if r.startswith("$"):
            continue
        img = find_image(vfs, r)
        if img:
            out.add(img)
    return out


def bsp_refs(data):
    """Shader names and entity-referenced files from a Q3 BSP (IBSP v46)."""
    ident, version = struct.unpack_from("<4si", data, 0)
    assert ident == b"IBSP" and version == 46, (ident, version)
    lumps = [struct.unpack_from("<ii", data, 8 + 8 * n) for n in range(17)]
    names = set()
    off, ln = lumps[1]
    for k in range(ln // 72):
        names.add(data[off + 72 * k: off + 72 * k + 64].split(b"\0")[0].decode("latin-1").lower())
    off, ln = lumps[12]  # fogs
    for k in range(ln // 72):
        names.add(data[off + 72 * k: off + 72 * k + 64].split(b"\0")[0].decode("latin-1").lower())
    off, ln = lumps[0]
    ents = data[off: off + ln].decode("latin-1")
    files = {v.lower().replace("\\", "/") for v in re.findall(r'"(?:noise|model2|model|music)"\s+"([^"*]+)"', ents)}
    return names, files


def md3_shaders(data):
    if data[:4] != b"IDP3":
        return set()
    num_surfs, = struct.unpack_from("<i", data, 84)
    ofs_surfs, = struct.unpack_from("<i", data, 100)
    out, off = set(), ofs_surfs
    for _ in range(num_surfs):
        num_shaders, = struct.unpack_from("<i", data, off + 76)
        ofs_shaders, = struct.unpack_from("<i", data, off + 92)
        ofs_end, = struct.unpack_from("<i", data, off + 104)
        for k in range(num_shaders):
            s = data[off + ofs_shaders + 68 * k: off + ofs_shaders + 68 * k + 64]
            out.add(s.split(b"\0")[0].decode("latin-1").lower())
        off += ofs_end
    return out


def qvm_strings(data):
    """Asset paths the game code asks for by name (string literals in the QVM)."""
    pat = rb"((?:textures|sound|models)/[a-z0-9_/\-.]+)"
    return {m.decode("latin-1").lower() for m in re.findall(pat, data, re.I)}


def player_model_ok(path):
    parts = path.split("/")
    return not path.startswith("models/players/") or (len(parts) > 3 and parts[2] in PLAYER_MODELS)


def model_deps(vfs, shaders, path):
    """Images for an md3 (and its skins)."""
    out = set()
    if path in vfs and path.endswith(".md3"):
        for s in md3_shaders(read(vfs, path)):
            out |= shader_images(vfs, shaders, s)
    return out


def is_core(path):
    if path.startswith(DROP_PREFIXES + SELECTIVE_PREFIXES):
        return False
    if path.startswith("models/players/"):
        parts = path.split("/")
        return len(parts) > 3 and parts[2] in PLAYER_MODELS
    if path.startswith("sound/player/"):
        # Per-model voice sets live in sound/player/<model>/; keep shared sounds
        # (footsteps, announcer, gibs) and the shipped models' voices.
        parts = path.split("/")
        return len(parts) == 3 or parts[2] not in ALL_PLAYER_MODELS or parts[2] in PLAYER_MODELS
    # Top-level docs and stock map-rotation configs are not needed by the client.
    return "/" in path or not re.search(r"\.(txt|org|readme)$|^(changes|copying|credits|readme|linuxnotes)", path)


def write_pk3(path, vfs, files):
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for f in sorted(files):
            # Images and sounds are already compressed; store to save CPU on decode.
            ctype = zipfile.ZIP_STORED if f.endswith((".jpg", ".ogg", ".png")) else zipfile.ZIP_DEFLATED
            z.writestr(zipfile.ZipInfo(vfs[f][1], date_time=(2026, 1, 1, 0, 0, 0)), read(vfs, f), ctype)
    return os.path.getsize(path)


def sha(path):
    with open(path, "rb") as fh:
        return hashlib.sha256(fh.read()).hexdigest()[:16]


def main(baseoa, out):
    vfs = load_vfs(baseoa)
    ALL_PLAYER_MODELS.update(p.split("/")[2] for p in vfs if p.startswith("models/players/") and p.count("/") >= 3)
    shaders = parse_shaders(vfs)
    os.makedirs(os.path.join(out, "baseoa"), exist_ok=True)

    core = {p for p in vfs if is_core(p)}
    # Images the core needs that live under textures/: model/skin shaders,
    # every non-surface shader, and textures the game code asks for by name.
    extra = set()
    for p in list(core):
        if p.endswith(".md3"):
            extra |= model_deps(vfs, shaders, p)
        elif p.endswith(".skin"):
            for line in read(vfs, p).decode("latin-1").splitlines():
                if "," in line:
                    extra |= shader_images(vfs, shaders, line.split(",", 1)[1].strip())
    for name, refs in shaders.items():
        if not name.startswith(("textures/", "models/mapobjects/")) and player_model_ok(name):
            extra |= shader_images(vfs, shaders, name)
    for qvm in ("vm/cgame.qvm", "vm/ui.qvm", "vm/qagame.qvm"):
        for s in qvm_strings(read(vfs, qvm)):
            if s.startswith("textures/"):
                extra |= shader_images(vfs, shaders, s)
            elif s in vfs and player_model_ok(s):
                extra.add(s)
                extra |= model_deps(vfs, shaders, s)
    extra |= {p for p in vfs if p.startswith("textures/effects/") and p.endswith(IMAGE_EXTS)}
    core |= {p for p in extra if not p.startswith(("sound/teamplay/", "music/", "video/"))}

    manifest = {"basegame": "baseoa", "core": [], "maps": {}}
    core_file = os.path.join(out, "baseoa", "pak0-web.pk3")
    size = write_pk3(core_file, vfs, core)
    manifest["core"].append({"file": "baseoa/pak0-web.pk3", "size": size, "hash": sha(core_file)})
    print(f"core: {len(core)} files, {size / 1e6:.1f} MB")

    for name, meta in MAPS.items():
        bsp = f"maps/{name}.bsp"
        names, files = bsp_refs(read(vfs, bsp))
        need = {bsp}
        for s in names:
            need |= shader_images(vfs, shaders, s)
        for f in files:
            if f.endswith(".md3"):
                need.add(f) if f in vfs else None
                need |= model_deps(vfs, shaders, f)
            elif f in vfs:
                need.add(f)
            elif f.endswith(".wav") and f[:-4] + ".ogg" in vfs:
                need.add(f[:-4] + ".ogg")
        shot = find_image(vfs, f"levelshots/{name}")
        if shot:
            need.add(shot)
        need -= core
        missing = sorted(s for s in names if not shader_images(vfs, shaders, s)
                         and not s.startswith(("noshader", "textures/common/")) and s not in shaders)
        path = os.path.join(out, "baseoa", f"map-{name}.pk3")
        size = write_pk3(path, vfs, need)
        if shot:
            # Raw levelshot for the lobby page; build.sh converts TGA to JPG.
            os.makedirs(os.path.join(out, "levelshots"), exist_ok=True)
            with open(os.path.join(out, "levelshots", name + os.path.splitext(shot)[1]), "wb") as fh:
                fh.write(read(vfs, shot))
        manifest["maps"][name] = {**meta, "file": f"baseoa/map-{name}.pk3", "size": size,
                                  "hash": sha(path), "levelshot": f"levelshots/{name}.jpg" if shot else None}
        print(f"{name}: {len(need)} files, {size / 1e6:.1f} MB, unresolved shaders: {len(missing)}")

    with open(os.path.join(out, "manifest.json"), "w") as fh:
        json.dump(manifest, fh, indent=2)


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
