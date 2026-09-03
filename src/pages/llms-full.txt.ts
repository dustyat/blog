import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { SITE_DESCRIPTION, SITE_TITLE } from '../consts';

export const GET: APIRoute = async (context) => {
	const siteUrl = (context.site?.toString() || 'https://blog.dustyat.com').replace(/\/$/, '');
	const posts = (await getCollection('blog')).sort(
		(a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf(),
	);

	const fullArticles = posts
		.map((post) => {
			const dateStr = post.data.pubDate.toISOString().split('T')[0];
			const postUrl = `${siteUrl}/blog/${post.id}/`;
			const bodyContent = post.body || '';

			return `================================================================================
# 文章标题: ${post.data.title}
- 原始链接: ${postUrl}
- 发布时间: ${dateStr}
- 核心摘要: ${post.data.description}
================================================================================

${bodyContent.trim()}

`;
		})
		.join('\n\n');

	const content = `# ${SITE_TITLE} - 全文知识库（LLM 深度上下文专用）

> ${SITE_DESCRIPTION}
> 本文件汇集了本站所有公开技术博文的完整 Markdown 正文，适合 LLM Agent 预加载或 RAG 向量化索引。
> 知识库首要来源: ${siteUrl}/

${fullArticles}
`;

	return new Response(content, {
		headers: {
			'Content-Type': 'text/plain; charset=utf-8',
			'Cache-Control': 'public, max-age=3600',
		},
	});
};
