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

/**
 * 常用技术与主题自动标签规则库（当文章未手动填写 tags 时自动按命中词匹配）
 */
const AUTO_TAG_RULES: Array<{ tag: string; pattern: RegExp }> = [
	{ tag: 'VS Code', pattern: /\b(?:vscode|vs code|visual studio code)\b/i },
	{ tag: 'Astro', pattern: /\bastro\b/i },
	{ tag: 'Cloudflare', pattern: /\b(?:cloudflare|r2|workers|pages)\b/i },
	{ tag: 'Docker', pattern: /\bdocker(?:file)?\b/i },
	{ tag: 'Google Cloud', pattern: /\b(?:gcp|google cloud|cloud run|artifact registry|wif)\b/i },
	{ tag: 'Python', pattern: /\bpython(?:\d+)?\b/i },
	{ tag: 'TypeScript', pattern: /\btypescript\b/i },
	{ tag: 'Markdown', pattern: /\bmarkdown\b/i },
	{ tag: 'MDX', pattern: /\bmdx\b/i },
	{ tag: 'Nginx', pattern: /\bnginx\b/i },
	{ tag: 'Git', pattern: /\bgit(?:hub)?\b/i },
	{ tag: 'AI/LLM', pattern: /\b(?:llm|大模型|ai|gemini|gpt|claude)\b/i },
	{ tag: 'Mastodon', pattern: /\bmastodon\b/i },
	{ tag: 'CI/CD', pattern: /\b(?:ci\/cd|github actions|流水线)\b/i },
	{ tag: 'SOP', pattern: /\bsop\b/i },
	{ tag: '生活思考', pattern: /(?:生活|复盘|方法论|认知|习惯|人生)/i },
	{ tag: '工作流', pattern: /(?:工作流|workflow|效率|指南|教程)/i },
];

/**
 * 从 Markdown 正文中提取第一张图片地址（支持 Markdown 语法与 <img> 标签）
 */
export function extractFirstImage(content: string): string | undefined {
	if (!content) return undefined;

	// 1. 匹配 Markdown 图片: ![alt](url)
	const mdMatch = content.match(/!\[[^\]]*\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/);
	if (mdMatch && mdMatch[1]) {
		return mdMatch[1].trim();
	}

	// 2. 匹配 HTML <img>: <img src="url" />
	const htmlMatch = content.match(/<img\s+[^>]*src=["']([^"']+)["'][^>]*>/i);
	if (htmlMatch && htmlMatch[1]) {
		return htmlMatch[1].trim();
	}

	return undefined;
}

/**
 * 获取文章封面图。
 * 优先使用 Frontmatter 中指定的 heroImage；
 * 若未指定，自动将正文中插入的第一张图片提升为封面（Auto Fallback）；
 * 若通篇无图，则返回 undefined（自适应无图极简排版）。
 */
export function getPostHeroImage(
	post: { data: { heroImage?: any }; body?: string },
): any {
	if (post.data.heroImage) {
		return post.data.heroImage;
	}
	return extractFirstImage(post.body || '');
}

/**
 * 获取文章标签列表。
 * 优先使用 Frontmatter 手动设置的 tags；
 * 若未设置，自动根据标题与正文关键词进行智能匹配（最多返回 3 个标签）。
 */
export function getPostTags(
	post: { data: { title?: string; tags?: string[] }; body?: string },
	maxTags = 3,
): string[] {
	if (post.data.tags && post.data.tags.length > 0) {
		return post.data.tags;
	}

	const searchContext = `${post.data.title || ''}\n${post.body || ''}`;
	const matchedTags: string[] = [];

	for (const rule of AUTO_TAG_RULES) {
		if (rule.pattern.test(searchContext)) {
			matchedTags.push(rule.tag);
			if (matchedTags.length >= maxTags) {
				break;
			}
		}
	}

	return matchedTags;
}

