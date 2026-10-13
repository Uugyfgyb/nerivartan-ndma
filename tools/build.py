#!/usr/bin/env python3
"""把 src/ 里的样式和脚本内嵌进一个文件，生成根目录的 index.html（双击即可打开）。

改了 src/ 之后运行：python3 tools/build.py
三维坐标改了先运行：python3 tools/geom.py
"""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "src"


def build():
    html = (SRC / "index.html").read_text(encoding="utf-8")
    html, n = re.subn(
        r'<link rel="stylesheet" href="([\w.]+)">',
        lambda m: f'<style data-inline="{m.group(1)}">\n{(SRC / m.group(1)).read_text(encoding="utf-8").strip()}\n</style>',
        html,
    )
    assert n == 1, "找不到样式表的内嵌位置"
    html, n = re.subn(
        r'<script src="([\w.]+)"></script>',
        lambda m: f'<script data-inline="{m.group(1)}">\n{(SRC / m.group(1)).read_text(encoding="utf-8").strip()}\n</script>',
        html,
    )
    assert n == 3, "找不到脚本的内嵌位置"
    assert "</script>" not in "".join((SRC / f).read_text(encoding="utf-8") for f in ("geom.js", "ink3d.js", "page.js"))
    (ROOT / "index.html").write_text(html, encoding="utf-8")
    print(f"built index.html ({len(html.encode('utf-8')) / 1024:.0f} KB)")


if __name__ == "__main__":
    build()
