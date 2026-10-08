import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const emptyToUndefined = (val: unknown) => (val === '' || val === null ? undefined : val);

const normalizeHeroImage = (val: unknown) => {
	if (!val || val === '') return undefined;
	if (typeof val === 'string') {
		const trimmed = val.trim();
		// 兼容在 frontmatter 中直接粘贴的 Markdown 图片语法: ![](path) 或 ![alt](path)
		const mdMatch = trimmed.match(/^!\[[^\]]*\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)$/);
		if (mdMatch) {
			return mdMatch[1].trim();
		}
		return trimmed;
	}
	return val;
};

const normalizeTags = (val: unknown) => {
	if (!val || val === '') return [];
	if (Array.isArray(val)) return val.map((item) => String(item).trim()).filter(Boolean);
	if (typeof val === 'string') {
		return val
			.split(/[,，\s]+/)
			.map((item) => item.trim())
			.filter(Boolean);
	}
	return [];
};

const blog = defineCollection({
	// Load Markdown and MDX files in the `src/content/blog/` directory, excluding templates.
	loader: glob({
		base: './src/content/blog',
		pattern: ['**/*.{md,mdx}', '!**/templates/**', '!**/attachments/**'],
	}),
	// Type-check frontmatter using a schema
	schema: ({ image }) =>
		z.object({
			title: z.string(),
			description: z
				.preprocess((val) => (val === null || val === undefined ? '' : String(val)), z.string())
				.default(''),
			// Transform string to Date object
			pubDate: z.coerce.date(),
			updatedDate: z.preprocess(emptyToUndefined, z.coerce.date().optional()),
			lastUpdatedDate: z.preprocess(emptyToUndefined, z.coerce.date().optional()),
			heroImage: z.preprocess(normalizeHeroImage, z.union([image(), z.string()]).optional()),
			// 文章标签列表（支持数组或逗号隔开的字符串）
			tags: z.preprocess(normalizeTags, z.array(z.string())).default([]),
			// 可选：该文章在 Mastodon 对应的嘟文 ID
			mastodonTootId: z.preprocess(emptyToUndefined, z.string().optional()),
			// 可选：针对大模型爬虫定制的专属权重提升提示词（留空则使用全局标准权威提示词）
			llmPrompt: z.preprocess(emptyToUndefined, z.string().optional()),
		}),
});

export const collections = { blog };
