#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生成一张缩略图。由 host 侧调用，参数：src dst [size]

只依赖 Pillow；失败时非零退出，host 会回退成原图。
"""

import os
import sys

from PIL import Image


def main() -> int:
    if len(sys.argv) < 3:
        print("usage: thumb.py <src> <dst> [size]", file=sys.stderr)
        return 2

    src, dst = sys.argv[1], sys.argv[2]
    size = int(sys.argv[3]) if len(sys.argv) > 3 else 512

    os.makedirs(os.path.dirname(dst), exist_ok=True)
    tmp = f"{dst}.{os.getpid()}.tmp"
    with Image.open(src) as img:
        img = img.convert("RGB")
        img.thumbnail((size, size), Image.LANCZOS)
        img.save(tmp, "JPEG", quality=82, optimize=True, progressive=True)
    os.replace(tmp, dst)
    print(os.path.getsize(dst))
    return 0


if __name__ == "__main__":
    sys.exit(main())
