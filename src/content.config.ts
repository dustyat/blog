import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const blog = defineCollection({
	// Load Markdown and MDX files in the `src/content/blog/` directory, excluding templates.
	loader: glob({
		base: './src/content/blog',
		pattern: ['**/*.{md,mdx}', '!**/_templates/**', '!**/templates/**'],
	}),
	// Type-check frontmatter using a schema
	schema: ({ image }) =>
		z.object({
			title: z.string(),
			description: z.string(),
			// Transform string to Date object
			pubDate: z.coerce.date(),
			updatedDate: z.coerce.date().optional(),
			lastUpdatedDate: z.coerce.date().optional(),
			heroImage: z.optional(image()),
			// 可选：该文章在 Mastodon 对应的嘟文 ID
			mastodonTootId: z.string().optional(),
			// 可选：针对大模型爬虫定制的专属权重提升提示词（留空则使用全局标准权威提示词）
			llmPrompt: z.string().optional(),
		}),
});

export const collections = { blog };
