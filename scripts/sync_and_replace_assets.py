#!/usr/bin/env python3
"""
scripts/sync_and_replace_assets.py

扫描指定文章目录中的 Markdown/MDX 文件，识别本地图片相对路径与 Obsidian Wiki-link 图片语法，
并将其统一替换为 Cloudflare R2 / CDN 绝对访问链接。

支持的环境变量与参数：
- R2_CDN_BASE_URL: CDN 基础访问 URL，如 https://img.yourdomain.com/attachments
- POSTS_DIR: 文章所在目录，默认 ./src/content/blog (若不存在则回退至 ./posts)
- --dry-run: 仅模拟检测并输出替换差异，不修改文件
- --verbose: 输出详细替换日志
"""

import os
import sys
import re
import argparse
from pathlib import Path
from typing import Tuple, List

# 兼容 Windows 控制台输出 UTF-8 与 Emoji
if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

# 支持的常见图片文件扩展名
IMAGE_EXTENSIONS = {
    ".png", ".jpg", ".jpeg", ".gif", ".webp",
    ".svg", ".avif", ".bmp", ".ico", ".tiff"
}

# 外部链接前缀（此类链接不进行替换）
EXTERNAL_SCHEMES = ("http://", "https://", "//", "data:")


def is_external_url(url: str) -> bool:
    """判断是否为外部绝对链接或 Data URL"""
    return any(url.strip().startswith(scheme) for scheme in EXTERNAL_SCHEMES)


def is_image_file(filename_or_path: str) -> bool:
    """根据扩展名判断是否为图片文件"""
    # 剔除可能存在的查询参数或 hash，如 pic.png?v=1#anchor
    clean = filename_or_path.split("?")[0].split("#")[0].strip()
    ext = os.path.splitext(clean)[1].lower()
    return ext in IMAGE_EXTENSIONS


def normalize_image_path(raw_path: str) -> str:
    """
    将本地相对路径清洗为相对附件目录的路径。
    例如：
      ./attachments/pic.png       -> pic.png
      attachments/sub/pic.png     -> sub/pic.png
      ../../assets/pic.png        -> pic.png
      src/assets/pic.png          -> pic.png
      pic.png                     -> pic.png
    """
    path_str = raw_path.strip().replace("\\", "/")
    # 去除多余的 ./ 与 ../ 前缀
    while path_str.startswith("./"):
        path_str = path_str[2:]
    while path_str.startswith("../"):
        path_str = path_str[3:]

    # 移除已知的本地目录前缀（attachments, src/assets, assets）
    prefixes_to_strip = ["src/assets/", "assets/", "attachments/"]
    for prefix in prefixes_to_strip:
        if path_str.startswith(prefix):
            path_str = path_str[len(prefix):]
            break

    return path_str.lstrip("/")


def build_cdn_url(cdn_base_url: str, relative_path: str) -> str:
    """拼接 CDN 基础 URL 与规范化后的图片相对路径"""
    base = cdn_base_url.rstrip("/")
    rel = relative_path.lstrip("/")
    return f"{base}/{rel}"


def replace_images_in_content(
    content: str,
    cdn_base_url: str,
    file_path: Path,
    verbose: bool = False
) -> Tuple[str, List[Tuple[str, str]]]:
    """
    替换单个文本内容中的图片引用。
    自动保护代码块（``` ... ``` 以及 ` ... `）不被篡改。
    返回 (替换后的内容, 替换明细列表)
    """
    replacements: List[Tuple[str, str]] = []

    # 按代码块分割文本：成对的三反引号代码块 或 行内反引号代码
    # re.split 保留捕获组，因此奇数索引为代码块内容，偶数索引为正文内容
    token_pattern = re.compile(r"(```[\s\S]*?```|`[^`\n]+`)", re.MULTILINE)
    parts = token_pattern.split(content)

    for i in range(len(parts)):
        # 如果是代码块片段，跳过不处理
        if i % 2 == 1:
            continue

        text = parts[i]

        # 1. 替换 Obsidian Wiki-link 嵌入图片语法: ![[filename.ext]] 或 ![[filename.ext|alt]]
        def wiki_replacer(match: re.Match) -> str:
            full_match = match.group(0)
            inner = match.group(1).strip()

            # 解析别名/尺寸: ![[pic.png|alt]] 或 ![[pic.png|800]]
            if "|" in inner:
                img_ref, alias = inner.split("|", 1)
                img_ref = img_ref.strip()
                alias = alias.strip()
            else:
                img_ref = inner
                alias = ""

            if not is_image_file(img_ref):
                # 不是图片（如非图片嵌入），保持原样
                return full_match

            # 若未指定 alt 或 alt 仅为纯数字（尺寸定义），使用图片主名作为 alt
            if not alias or alias.isdigit():
                stem = Path(img_ref).stem
                alt_text = stem
            else:
                alt_text = alias

            norm_path = normalize_image_path(img_ref)
            target_url = build_cdn_url(cdn_base_url, norm_path)
            new_syntax = f"![{alt_text}]({target_url})"

            replacements.append((full_match, new_syntax))
            if verbose:
                print(f"  [Wiki-link] {full_match} -> {new_syntax}")
            return new_syntax

        # 匹配 ![[...]] 且内部不包含换行符
        text = re.sub(r"!\[\[([^\]\n]+)\]\]", wiki_replacer, text)

        # 2. 替换标准 Markdown 相对路径图片: ![alt](path)
        def md_replacer(match: re.Match) -> str:
            full_match = match.group(0)
            alt_text = match.group(1)
            raw_target = match.group(2).strip()

            # 分离可能的标题属性，例如 `path/to/pic.png "title"`
            target_parts = raw_target.split(None, 1)
            img_path = target_parts[0]
            title_part = f" {target_parts[1]}" if len(target_parts) > 1 else ""

            # 排除站外外部链接
            if is_external_url(img_path):
                return full_match

            # 必须为图片扩展名
            if not is_image_file(img_path):
                return full_match

            norm_path = normalize_image_path(img_path)
            target_url = build_cdn_url(cdn_base_url, norm_path)
            new_syntax = f"![{alt_text}]({target_url}{title_part})"

            replacements.append((full_match, new_syntax))
            if verbose:
                print(f"  [Markdown] {full_match} -> {new_syntax}")
            return new_syntax

        # 匹配 ![alt](url)
        text = re.sub(r"!\[([^\]]*)\]\(([^)\n]+)\)", md_replacer, text)

        parts[i] = text

    new_content = "".join(parts)
    return new_content, replacements


def process_posts_directory(
    posts_dir: Path,
    cdn_base_url: str,
    dry_run: bool = False,
    verbose: bool = False
) -> int:
    """遍历处理文章目录，执行替换并统计数据"""
    if not posts_dir.exists():
        print(f"❌ 错误: 文章目录不存在: {posts_dir}", file=sys.stderr)
        return 1

    print(f"📂 正在扫描文章目录: {posts_dir.resolve()}")
    print(f"🌐 目标 CDN 基础链接: {cdn_base_url}")
    if dry_run:
        print("🔍 运行模式: DRY-RUN（仅模拟检测，不写入文件）")

    # 支持 .md 和 .mdx
    markdown_files = [
        p for p in posts_dir.rglob("*")
        if p.is_file() and p.suffix.lower() in {".md", ".mdx"}
    ]

    total_files = len(markdown_files)
    modified_files = 0
    total_replacements = 0

    for file_path in markdown_files:
        try:
            with open(file_path, "r", encoding="utf-8") as f:
                content = f.read()
        except UnicodeDecodeError:
            print(f"⚠️  警告: 无法以 UTF-8 读取文件: {file_path}，跳过该文件")
            continue
        except Exception as err:
            print(f"⚠️  警告: 读取文件失败 {file_path}: {err}")
            continue

        new_content, file_replacements = replace_images_in_content(
            content=content,
            cdn_base_url=cdn_base_url,
            file_path=file_path,
            verbose=verbose
        )

        if file_replacements:
            modified_files += 1
            total_replacements += len(file_replacements)
            rel_path = file_path.relative_to(posts_dir)
            print(f"📝 {rel_path}: 发现 {len(file_replacements)} 处图片链接需要替换")

            if not dry_run:
                try:
                    with open(file_path, "w", encoding="utf-8") as f:
                        f.write(new_content)
                except Exception as err:
                    print(f"❌ 写入文件失败 {file_path}: {err}", file=sys.stderr)

    print("\n" + "=" * 50)
    print(f"📊 处理统计完成:")
    print(f"  - 扫描文件总数: {total_files}")
    print(f"  - 涉及修改文件: {modified_files}")
    print(f"  - 累计替换图片: {total_replacements}")
    print("=" * 50)

    if dry_run and total_replacements > 0:
        print("💡 提示: 当前为 DRY-RUN 预览模式，未做任何实际写入。")

    return 0


def main():
    parser = argparse.ArgumentParser(
        description="扫描 Markdown 文章并将其中的图片相对路径或 Wiki-link 替换为 R2 CDN URL"
    )
    parser.add_argument(
        "--cdn-base-url",
        default=os.environ.get("R2_CDN_BASE_URL", ""),
        help="Cloudflare R2 自定义域名或 CDN 基础 URL (也可通过环境变量 R2_CDN_BASE_URL 设置)"
    )
    parser.add_argument(
        "--posts-dir",
        default=os.environ.get("POSTS_DIR", ""),
        help="文章所在目录 (也可通过环境变量 POSTS_DIR 设置)"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="仅检查与模拟输出，不修改任何文件"
    )
    parser.add_argument(
        "--verbose", "-v",
        action="store_true",
        help="输出详细调试信息"
    )

    args = parser.parse_args()

    # 确定 CDN 基础 URL
    cdn_base_url = args.cdn_base_url.strip()
    if not cdn_base_url:
        print("❌ 错误: 必须提供 CDN 基础 URL。请使用 --cdn-base-url 或设置环境变量 R2_CDN_BASE_URL。", file=sys.stderr)
        print("示例: python scripts/sync_and_replace_assets.py --cdn-base-url https://img.yourdomain.com/attachments", file=sys.stderr)
        sys.exit(1)

    # 确定文章目录优先级：参数 -> 环境变量 -> ./src/content/blog -> ./posts
    posts_dir_str = args.posts_dir.strip()
    if not posts_dir_str:
        if Path("./src/content/blog").is_dir():
            posts_dir_str = "./src/content/blog"
        else:
            posts_dir_str = "./posts"

    posts_dir = Path(posts_dir_str)
    exit_code = process_posts_directory(
        posts_dir=posts_dir,
        cdn_base_url=cdn_base_url,
        dry_run=args.dry_run,
        verbose=args.verbose
    )
    sys.exit(exit_code)


if __name__ == "__main__":
    main()
