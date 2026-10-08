/**
 * 从 Markdown / MDX 正文中提取纯文本摘要。
 * 自动剥离 Frontmatter、代码块、图片、链接标记、HTML 标签、标题及列表符号。
 */
export function extractExcerpt(content: string, maxLength = 140): string {
	if (!content) return '';

	let text = content;

	// 1. 移除可能残留的 Frontmatter
	text = text.replace(/^---[\s\S]*?---\s*/, '');

	// 2. 移除代码块 ``` ... ```
	text = text.replace(/```[\s\S]*?```/g, '');

	// 3. 移除行内代码 `...`
	text = text.replace(/`[^`\n]+`/g, '');

	// 4. 移除 Markdown 图片 ![alt](url)
	text = text.replace(/!\[[^\]]*\]\([^)]*\)/g, '');

	// 5. 转换 Markdown 链接 [text](url) -> text
	text = text.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');

	// 6. 移除 HTML 标签及注释
	text = text.replace(/<!--[\s\S]*?-->/g, '');
	text = text.replace(/<[^>]+>/g, '');

	// 7. 移除标题、引用、列表标记、水平线等格式符号
	text = text.replace(/^#{1,6}\s+/gm, ''); // 标题符号
	text = text.replace(/^>\s+/gm, ''); // 引用符号
	text = text.replace(/^[-*+]\s+/gm, ''); // 无序列表
	text = text.replace(/^\d+\.\s+/gm, ''); // 有序列表
	text = text.replace(/[*_~=]/g, ''); // 加粗/斜体/删除线

	// 8. 规整空白字符
	text = text.replace(/\s+/g, ' ').trim();

	if (text.length <= maxLength) {
		return text;
	}
	return text.slice(0, maxLength).trim() + '...';
}

/**
 * 获取文章的有效描述信息。
 * 优先使用作者在 Frontmatter 中手动填写的 description；
 * 若未填写或为空，则自动回退并截取正文首部纯文本作为摘要。
 */
export function getPostDescription(
	post: { data: { description?: string | null }; body?: string },
	maxLength = 140,
): string {
	const manual = post.data.description?.trim();
	if (manual) {
		return manual;
	}
	return extractExcerpt(post.body || '', maxLength);
}
