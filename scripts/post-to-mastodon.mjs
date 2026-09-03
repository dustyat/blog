import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const MASTODON_INSTANCE = process.env.MASTODON_INSTANCE || 'https://mastodon.social';
const MASTODON_ACCESS_TOKEN = process.env.MASTODON_ACCESS_TOKEN;
const SITE_URL = process.env.SITE_URL || 'https://example.com';

if (!MASTODON_ACCESS_TOKEN) {
	console.log('ℹ️ 未检测到 MASTODON_ACCESS_TOKEN 环境变量，跳过自动发布到 Mastodon。');
	process.exit(0);
}

try {
	// 获取最近一次 Git 提交中新增或修改的 Markdown 文章
	const changedFiles = execSync('git diff --name-only HEAD~1 HEAD', { encoding: 'utf-8' })
		.split('\n')
		.map(f => f.trim())
		.filter(f => f.startsWith('src/content/blog/') && (f.endsWith('.md') || f.endsWith('.mdx')))
		.filter(f => !f.includes('/_templates/') && !f.includes('/templates/'));

	if (changedFiles.length === 0) {
		console.log('ℹ️ 本次提交未包含新增或修改的文章，跳过 Mastodon 自动发布。');
		process.exit(0);
	}

	for (const file of changedFiles) {
		if (!fs.existsSync(file)) continue;

		const content = fs.readFileSync(file, 'utf-8');
		// 提取 frontmatter 中的 title 和 description
		const titleMatch = content.match(/title:\s*['"]?([^'"\n]+)['"]?/);
		const descMatch = content.match(/description:\s*['"]?([^'"\n]+)['"]?/);

		const title = titleMatch ? titleMatch[1].trim() : path.basename(file, path.extname(file));
		const desc = descMatch ? descMatch[1].trim() : '';
		const slug = path.basename(file, path.extname(file));

		const postUrl = `${SITE_URL.replace(/\/$/, '')}/blog/${slug}/`;
		const statusText = `📢 新博文发布：《${title}》\n\n${desc ? desc + '\n\n' : ''}🔗 阅读与交流：${postUrl}`;

		console.log(`🚀 正在向 Mastodon 自动发布嘟文...\n内容:\n${statusText}`);

		const response = await fetch(`${MASTODON_INSTANCE.replace(/\/$/, '')}/api/v1/statuses`, {
			method: 'POST',
			headers: {
				'Authorization': `Bearer ${MASTODON_ACCESS_TOKEN}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				status: statusText,
				visibility: 'public',
			}),
		});

		if (!response.ok) {
			const errorText = await response.text();
			console.error(`❌ 发送嘟文失败: ${response.status} ${errorText}`);
		} else {
			const result = await response.json();
			console.log(`✅ 嘟文发布成功！ID: ${result.id}，地址: ${result.url}`);
		}
	}
} catch (err) {
	console.error('❌ 执行 Mastodon 自动发布脚本出错:', err);
}
